// Playback session: a decoder thread fills a ring buffer, an event-driven WASAPI exclusive render thread drains it.
use crate::devices::PROBE_RATES;
use crate::protocol::{emit, emit_error, Chain, Event, RateStrategy};
use crate::resample::Resampler;
use crate::source::Source;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use wasapi::{
    calculate_period_100ns, initialize_mta, DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat,
    WasapiError,
};
use windows::Win32::Media::Audio::{
    AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED, AUDCLNT_E_DEVICE_IN_USE, AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED,
    AUDCLNT_E_UNSUPPORTED_FORMAT,
};

const RING_SECONDS: usize = 3;
const OUT_CHANNELS: usize = 2;
/// Per-frame gain step of the pause/resume ramp: about 4 ms at 96 kHz.
const RAMP_STEP: f32 = 1.0 / 384.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Layout {
    pub store_bits: u16,
    pub valid_bits: u16,
}

/// Layouts in the order the player prefers them; 24 valid bits left-justified in 32 first because that is what most drivers expose.
fn layout_order(source_bits: u32) -> Vec<Layout> {
    let l = |store_bits, valid_bits| Layout { store_bits, valid_bits };
    if source_bits > 24 {
        vec![l(32, 32), l(32, 24), l(24, 24)]
    } else {
        vec![l(32, 24), l(24, 24), l(32, 32), l(16, 16)]
    }
}

/// Rates to try, best first: the target, then higher rates (integer multiples first), then lower ones.
fn rate_candidates(target: u32) -> Vec<u32> {
    let mut higher: Vec<u32> = PROBE_RATES.iter().copied().filter(|&r| r > target).collect();
    higher.sort_by_key(|&r| (r % target != 0, r));
    let mut lower: Vec<u32> = PROBE_RATES.iter().copied().filter(|&r| r < target).collect();
    lower.sort_by(|a, b| b.cmp(a));
    let mut all = vec![target];
    all.extend(higher);
    all.extend(lower);
    all
}

pub struct Shared {
    ring: Mutex<VecDeque<i32>>,
    space: Condvar,
    stop: AtomicBool,
    pub paused: AtomicBool,
    decode_done: AtomicBool,
    pub ended: AtomicBool,
    frames_rendered: AtomicU64,
    base_sec_bits: AtomicU64,
    seek_req: Mutex<Option<f64>>,
    out_rate: u32,
    latency_frames: AtomicU64,
    ring_cap: usize,
}

struct RenderInfo {
    rate: u32,
    layout: Layout,
    device_name: String,
}

pub struct Session {
    pub shared: Arc<Shared>,
    pub token: u64,
    pub duration_sec: f64,
    render: Option<JoinHandle<()>>,
    decode: Option<JoinHandle<()>>,
}

impl Session {
    pub fn position_sec(&self) -> f64 {
        let base = f64::from_bits(self.shared.base_sec_bits.load(Ordering::Relaxed));
        let played = self.shared.frames_rendered.load(Ordering::Relaxed) as f64 / self.shared.out_rate as f64;
        let latency = self.shared.latency_frames.load(Ordering::Relaxed) as f64 / self.shared.out_rate as f64;
        base + (played - latency).max(0.0)
    }

    /// True once the whole file is decoded and only the tail still has to be played.
    pub fn is_finishing(&self) -> bool {
        self.shared.decode_done.load(Ordering::SeqCst) && !self.shared.paused.load(Ordering::SeqCst)
    }

    pub fn seek(&self, sec: f64) {
        *self.shared.seek_req.lock().unwrap() = Some(sec);
        self.shared.space.notify_all();
    }

    pub fn stop(mut self) {
        self.shared.stop.store(true, Ordering::SeqCst);
        self.shared.space.notify_all();
        if let Some(h) = self.decode.take() {
            let _ = h.join();
        }
        if let Some(h) = self.render.take() {
            let _ = h.join();
        }
    }
}

/// Opens the file, negotiates an exclusive format with the endpoint, and starts both threads.
pub fn start_session(
    path: &str,
    device_id: &str,
    strategy: RateStrategy,
    fixed_rate: u32,
    start_sec: f64,
    autoplay: bool,
    token: u64,
) -> Result<Session, (String, String)> {
    let source = Source::open(path).map_err(|e| ("decode-failed".to_string(), e))?;
    let target = if strategy == RateStrategy::Fixed { fixed_rate } else { source.info.rate };
    let layouts = layout_order(source.info.bits);
    let rates = rate_candidates(target);

    let (tx, rx) = mpsc::channel::<Result<RenderInfo, (String, String)>>();
    // The render thread negotiates the output format first; `Shared` needs the resulting rate, so it is handed back through `ready_tx`.
    let device_id_owned = device_id.to_string();
    let (ready_tx, ready_rx) = mpsc::channel::<Arc<Shared>>();
    let render = thread::Builder::new()
        .name("folia-render".into())
        .spawn(move || {
            render_thread(device_id_owned, rates, layouts, tx, ready_rx);
        })
        .map_err(|e| ("open-failed".to_string(), e.to_string()))?;

    let info = match rx.recv_timeout(Duration::from_secs(8)) {
        Ok(Ok(info)) => info,
        Ok(Err(e)) => {
            let _ = render.join();
            return Err(e);
        }
        Err(_) => return Err(("open-failed".into(), "timed out opening the output device".into())),
    };

    let shared = Arc::new(Shared {
        ring: Mutex::new(VecDeque::new()),
        space: Condvar::new(),
        stop: AtomicBool::new(false),
        paused: AtomicBool::new(!autoplay),
        decode_done: AtomicBool::new(false),
        ended: AtomicBool::new(false),
        frames_rendered: AtomicU64::new(0),
        base_sec_bits: AtomicU64::new(start_sec.to_bits()),
        seek_req: Mutex::new(if start_sec > 0.0 { Some(start_sec) } else { None }),
        out_rate: info.rate,
        latency_frames: AtomicU64::new(0),
        ring_cap: info.rate as usize * OUT_CHANNELS * RING_SECONDS,
    });
    let _ = ready_tx.send(shared.clone());

    let resampled = info.rate != source.info.rate;
    let truncated = source.info.bits > info.layout.valid_bits as u32;
    let downmixed = source.info.channels > 2;
    emit(&Event::Chain {
        token,
        chain: Chain {
            source_rate: source.info.rate,
            source_bits: source.info.bits,
            source_channels: source.info.channels,
            codec: source.info.codec.clone(),
            device_name: info.device_name.clone(),
            output_rate: info.rate,
            output_bits: info.layout.store_bits,
            output_valid_bits: info.layout.valid_bits,
            exclusive: true,
            resampled,
            truncated,
            downmixed,
            bit_perfect: !resampled && !truncated && !downmixed,
        },
    });

    let duration_sec = source.info.duration_sec;
    let shared_decode = shared.clone();
    let decode = thread::Builder::new()
        .name("folia-decode".into())
        .spawn(move || decode_thread(source, shared_decode))
        .map_err(|e| ("open-failed".to_string(), e.to_string()))?;
    Ok(Session { shared, token, duration_sec, render: Some(render), decode: Some(decode) })
}

fn to_stereo(chunk: Vec<i32>, channels: usize) -> Vec<i32> {
    match channels {
        2 => chunk,
        1 => chunk.iter().flat_map(|&s| [s, s]).collect(),
        n => chunk.chunks_exact(n).flat_map(|f| [f[0], f[1]]).collect(),
    }
}

fn push_ring(shared: &Shared, samples: &[i32]) -> bool {
    let mut offset = 0;
    while offset < samples.len() {
        let mut ring = shared.ring.lock().unwrap();
        while ring.len() >= shared.ring_cap && !shared.stop.load(Ordering::SeqCst) && shared.seek_req.lock().unwrap().is_none() {
            ring = shared.space.wait_timeout(ring, Duration::from_millis(50)).unwrap().0;
        }
        if shared.stop.load(Ordering::SeqCst) || shared.seek_req.lock().unwrap().is_some() {
            return false;
        }
        let room = shared.ring_cap.saturating_sub(ring.len()).max(OUT_CHANNELS);
        let end = (offset + room).min(samples.len());
        ring.extend(&samples[offset..end]);
        offset = end;
    }
    true
}

fn decode_thread(mut source: Source, shared: Arc<Shared>) {
    let channels = source.info.channels as usize;
    let rate_in = source.info.rate;
    let make_resampler = || -> Option<Resampler> {
        if rate_in == shared.out_rate {
            return None;
        }
        match Resampler::new(rate_in, shared.out_rate, OUT_CHANNELS) {
            Ok(r) => Some(r),
            Err(e) => {
                emit_error("resample-failed", e);
                None
            }
        }
    };
    let mut resampler = make_resampler();
    // Frames of the source still to be dropped after a seek landed before the requested time.
    let mut skip_frames: usize = 0;
    loop {
        if shared.stop.load(Ordering::SeqCst) {
            return;
        }
        if let Some(sec) = shared.seek_req.lock().unwrap().take() {
            match source.seek(sec) {
                Ok(skip_sec) => {
                    skip_frames = (skip_sec * rate_in as f64).round() as usize;
                    shared.ring.lock().unwrap().clear();
                    shared.frames_rendered.store(0, Ordering::SeqCst);
                    shared.base_sec_bits.store(sec.to_bits(), Ordering::SeqCst);
                    shared.decode_done.store(false, Ordering::SeqCst);
                    resampler = make_resampler();
                }
                Err(e) => emit_error("seek-failed", e),
            }
        }
        if shared.decode_done.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_millis(20));
            continue;
        }
        match source.next_chunk() {
            Ok(Some(mut chunk)) => {
                if skip_frames > 0 {
                    let drop_frames = skip_frames.min(chunk.len() / channels);
                    chunk.drain(..drop_frames * channels);
                    skip_frames -= drop_frames;
                    if chunk.is_empty() {
                        continue;
                    }
                }
                let stereo = to_stereo(chunk, channels);
                let out = match resampler.as_mut() {
                    Some(r) => r.push(&stereo),
                    None => stereo,
                };
                push_ring(&shared, &out);
            }
            Ok(None) => {
                if let Some(r) = resampler.as_mut() {
                    let tail = r.finish();
                    push_ring(&shared, &tail);
                }
                shared.decode_done.store(true, Ordering::SeqCst);
            }
            Err(e) => {
                emit_error("decode-failed", e);
                shared.decode_done.store(true, Ordering::SeqCst);
            }
        }
    }
}

fn classify(error: &WasapiError) -> (String, String) {
    if let WasapiError::Windows(w) = error {
        let code = w.code();
        let name = if code == AUDCLNT_E_DEVICE_IN_USE {
            "device-in-use"
        } else if code == AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED {
            "exclusive-not-allowed"
        } else if code == AUDCLNT_E_UNSUPPORTED_FORMAT {
            "format-unsupported"
        } else {
            "open-failed"
        };
        return (name.to_string(), format!("{} (0x{:08x})", w.message(), code.0 as u32));
    }
    ("open-failed".to_string(), error.to_string())
}

fn render_thread(
    device_id: String,
    rates: Vec<u32>,
    layouts: Vec<Layout>,
    result_tx: mpsc::Sender<Result<RenderInfo, (String, String)>>,
    shared_rx: mpsc::Receiver<Arc<Shared>>,
) {
    let _ = initialize_mta();
    let opened = open_exclusive(&device_id, &rates, &layouts);
    let (client, render_client, event, rate, layout, device_name, buffer_frames) = match opened {
        Ok(v) => v,
        Err(e) => {
            let _ = result_tx.send(Err(e));
            return;
        }
    };
    let _ = result_tx.send(Ok(RenderInfo { rate, layout, device_name }));
    let Ok(shared) = shared_rx.recv_timeout(Duration::from_secs(5)) else { return };
    shared.latency_frames.store(buffer_frames as u64, Ordering::Relaxed);

    let sample_bytes = layout.store_bits as usize / 8;
    let block = sample_bytes * OUT_CHANNELS;
    // Gain is 1.0 (samples untouched, bit-exact) except for a few milliseconds around pause, resume and gaps, where a
    // hard cut would click. A track that starts playing begins at full gain; one that starts paused fades in on resume.
    let mut gain: f32 = if shared.paused.load(Ordering::Relaxed) { 0.0 } else { 1.0 };
    let mut delivered = false;
    let mut write = |frames: usize, shared: &Shared| {
        let mut bytes = vec![0u8; frames * block];
        let want_play = !shared.paused.load(Ordering::Relaxed);
        if want_play || gain > 0.0 {
            let target = if want_play { 1.0f32 } else { 0.0 };
            let mut ring = shared.ring.lock().unwrap();
            let available = ring.len() / OUT_CHANNELS;
            let mut done = 0usize;
            while done < frames && done < available {
                if gain != target {
                    gain = if target > gain { (gain + RAMP_STEP).min(1.0) } else { (gain - RAMP_STEP).max(0.0) };
                }
                if gain == 0.0 && !want_play {
                    break;
                }
                for channel in 0..OUT_CHANNELS {
                    let raw = ring.pop_front().unwrap_or(0);
                    let sample = if gain >= 1.0 { raw } else { (raw as f64 * gain as f64) as i32 };
                    pack_sample(sample, layout, &mut bytes[done * block + channel * sample_bytes..]);
                }
                done += 1;
            }
            // Ran dry while playing (a seek, a slow disk): restart from silence once data returns instead of jumping in at full level.
            if done > 0 {
                delivered = true;
            }
            if want_play && done < frames && delivered {
                gain = 0.0;
            }
            drop(ring);
            shared.space.notify_all();
            shared.frames_rendered.fetch_add(done as u64, Ordering::Relaxed);
        }
        let _ = render_client.write_to_device(frames, &bytes, None);
    };
    if let Ok(space) = client.get_available_space_in_frames() {
        write(space as usize, &shared);
    }
    if client.start_stream().is_err() {
        emit_error("open-failed", "start_stream failed");
        return;
    }
    let mut silent_after_end = 0usize;
    while !shared.stop.load(Ordering::SeqCst) {
        if event.wait_for_event(1000).is_err() {
            emit_error("device-lost", "the output device stopped responding");
            break;
        }
        let Ok(space) = client.get_available_space_in_frames() else { break };
        write(space as usize, &shared);
        // Once everything has been decoded and drained, wait one device buffer so the tail is actually played before reporting the end.
        let drained = shared.decode_done.load(Ordering::SeqCst) && shared.ring.lock().unwrap().is_empty();
        if drained && shared.seek_req.lock().unwrap().is_none() {
            silent_after_end += space as usize;
            if silent_after_end > buffer_frames as usize * 2 {
                shared.ended.store(true, Ordering::SeqCst);
            }
        } else {
            silent_after_end = 0;
        }
    }
    let _ = client.stop_stream();
}

/// Left-justified 32-bit sample -> the device layout, rounding (never truncating) when bits are dropped.
fn pack_sample(sample: i32, layout: Layout, out: &mut [u8]) {
    let drop = 32 - layout.valid_bits as u32;
    let value: i64 = if drop == 0 {
        sample as i64
    } else {
        let max = (1i64 << (layout.valid_bits - 1)) - 1;
        let min = -(1i64 << (layout.valid_bits - 1));
        (((sample as i64) + (1i64 << (drop - 1))) >> drop).clamp(min, max)
    };
    let aligned = value << (layout.store_bits as u32 - layout.valid_bits as u32);
    let bytes = aligned.to_le_bytes();
    let n = layout.store_bits as usize / 8;
    out[..n].copy_from_slice(&bytes[..n]);
}

type Opened = (wasapi::AudioClient, wasapi::AudioRenderClient, wasapi::Handle, u32, Layout, String, u32);

fn open_exclusive(device_id: &str, rates: &[u32], layouts: &[Layout]) -> Result<Opened, (String, String)> {
    let enumerator = DeviceEnumerator::new().map_err(|e| classify(&e))?;
    let device = if device_id.is_empty() {
        enumerator.get_default_device(&Direction::Render)
    } else {
        enumerator.get_device(device_id)
    }
    .map_err(|e| ("device-missing".to_string(), e.to_string()))?;
    let name = device.get_friendlyname().unwrap_or_default();
    let mut last: Option<(String, String)> = None;
    for &rate in rates {
        for &layout in layouts {
            let mut client = device.get_iaudioclient().map_err(|e| classify(&e))?;
            let wanted = WaveFormat::new(
                layout.store_bits as usize,
                layout.valid_bits as usize,
                &SampleType::Int,
                rate as usize,
                OUT_CHANNELS,
                None,
            );
            let Ok(format) = client.is_supported_exclusive_with_quirks(&wanted) else { continue };
            let (_, min_period) = client.get_device_period().map_err(|e| classify(&e))?;
            let period = client
                .calculate_aligned_period_near(min_period * 2, Some(128), &format)
                .unwrap_or(min_period * 2);
            let mode = StreamMode::EventsExclusive { period_hns: period };
            let mut init = client.initialize_client(&format, &Direction::Render, &mode);
            if let Err(WasapiError::Windows(w)) = &init {
                if w.code() == AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED {
                    // Documented recovery: take the aligned size the driver proposes and initialise a fresh client with it.
                    let frames = client.get_buffer_size().unwrap_or(0) as i64;
                    let aligned = calculate_period_100ns(frames, rate as i64);
                    client = device.get_iaudioclient().map_err(|e| classify(&e))?;
                    init = client.initialize_client(&format, &Direction::Render, &StreamMode::EventsExclusive { period_hns: aligned });
                }
            }
            match init {
                Ok(()) => {
                    let event = client.set_get_eventhandle().map_err(|e| classify(&e))?;
                    let render = client.get_audiorenderclient().map_err(|e| classify(&e))?;
                    let buffer_frames = client.get_buffer_size().unwrap_or(0);
                    return Ok((client, render, event, rate, layout, name, buffer_frames));
                }
                Err(e) => {
                    let classified = classify(&e);
                    // Someone else owns the device, or exclusive use is switched off: no other format will change that.
                    if classified.0 == "device-in-use" || classified.0 == "exclusive-not-allowed" {
                        return Err(classified);
                    }
                    last = Some(classified);
                }
            }
        }
    }
    Err(last.unwrap_or(("format-unsupported".into(), "the device accepts none of the formats this track needs".into())))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn packed(sample: i32, store_bits: u16, valid_bits: u16) -> Vec<u8> {
        let mut out = vec![0u8; store_bits as usize / 8];
        pack_sample(sample, Layout { store_bits, valid_bits }, &mut out);
        out
    }

    #[test]
    fn a_24_bit_sample_survives_every_24_bit_layout_unchanged() {
        // 24-bit value 0x123456 as the decoder hands it over: left-justified in 32 bits.
        let sample = 0x1234_5600u32 as i32;
        assert_eq!(packed(sample, 24, 24), vec![0x56, 0x34, 0x12]);
        assert_eq!(packed(sample, 32, 24), vec![0x00, 0x56, 0x34, 0x12]);
        assert_eq!(packed(sample, 32, 32), sample.to_le_bytes().to_vec());
    }

    #[test]
    fn a_16_bit_sample_is_exact_in_a_24_bit_container() {
        let sample = (-12345i32) << 16;
        let expected = ((-12345i32) << 8).to_le_bytes();
        assert_eq!(packed(sample, 24, 24), expected[..3].to_vec());
        assert_eq!(packed(sample, 16, 16), (-12345i16).to_le_bytes().to_vec());
    }

    #[test]
    fn dropped_bits_round_to_nearest_and_saturate() {
        assert_eq!(packed(0x0000_0080, 24, 24), vec![0x01, 0x00, 0x00]);
        assert_eq!(packed(0x0000_007F, 24, 24), vec![0x00, 0x00, 0x00]);
        assert_eq!(packed(i32::MAX, 24, 24), vec![0xFF, 0xFF, 0x7F]);
        assert_eq!(packed(i32::MIN, 16, 16), i16::MIN.to_le_bytes().to_vec());
    }

    #[test]
    fn rate_candidates_prefer_the_target_then_integer_multiples() {
        let rates = rate_candidates(44_100);
        assert_eq!(rates[0], 44_100);
        assert_eq!(&rates[1..3], &[88_200, 176_400]);
        assert!(rates.contains(&48_000) && rates.contains(&192_000));
        let low_first = rate_candidates(48_000);
        assert_eq!(&low_first[1..4], &[96_000, 192_000, 384_000]);
    }
}
