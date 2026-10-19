// Developer/diagnostic: plays a 440 Hz tone to an endpoint, once in shared mode (the reference) and once per exclusive layout,
// so you can see which of them a driver or a plugin on the other side actually passes on.
use crate::player::{pack_sample, Layout};
use std::time::{Duration, Instant};
use wasapi::{DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat};

const LEVEL: f64 = 0.25; // -12 dBFS

fn find_device(spec: &str) -> Result<wasapi::Device, String> {
    let enumerator = DeviceEnumerator::new().map_err(|e| e.to_string())?;
    if spec.starts_with('{') {
        return enumerator.get_device(spec).map_err(|e| e.to_string());
    }
    let collection = enumerator.get_device_collection(&Direction::Render).map_err(|e| e.to_string())?;
    let count = collection.get_nbr_devices().map_err(|e| e.to_string())?;
    for index in 0..count {
        let device = collection.get_device_at_index(index).map_err(|e| e.to_string())?;
        if device.get_friendlyname().unwrap_or_default().to_lowercase().contains(&spec.to_lowercase()) {
            return Ok(device);
        }
    }
    Err(format!("no render endpoint matching {spec}"))
}

fn play(device: &wasapi::Device, rate: u32, layout: Option<Layout>, seconds: f64) -> Result<(), String> {
    let mut client = device.get_iaudioclient().map_err(|e| e.to_string())?;
    let (format, sample_bytes, shared) = match layout {
        None => (WaveFormat::new(32, 32, &SampleType::Float, rate as usize, 2, None), 4usize, true),
        Some(l) => {
            let wanted = if l.float {
                WaveFormat::new(32, 32, &SampleType::Float, rate as usize, 2, None)
            } else {
                WaveFormat::new(l.store_bits as usize, l.valid_bits as usize, &SampleType::Int, rate as usize, 2, None)
            };
            (client.is_supported_exclusive_with_quirks(&wanted).map_err(|e| format!("format not accepted: {e}"))?, l.store_bits as usize / 8, false)
        }
    };
    let (_, min_period) = client.get_device_period().map_err(|e| e.to_string())?;
    let mode = if shared {
        StreamMode::EventsShared { autoconvert: true, buffer_duration_hns: min_period }
    } else {
        let period = client.calculate_aligned_period_near(min_period * 2, Some(128), &format).unwrap_or(min_period * 2);
        StreamMode::EventsExclusive { period_hns: period }
    };
    client.initialize_client(&format, &Direction::Render, &mode).map_err(|e| format!("initialize failed: {e}"))?;
    let event = client.set_get_eventhandle().map_err(|e| e.to_string())?;
    let render = client.get_audiorenderclient().map_err(|e| e.to_string())?;
    let block = sample_bytes * 2;
    let mut phase = 0.0f64;
    let step = 2.0 * std::f64::consts::PI * 440.0 / rate as f64;
    let mut write = |frames: usize| {
        let mut bytes = vec![0u8; frames * block];
        for frame in 0..frames {
            let value = phase.sin() * LEVEL;
            phase += step;
            for channel in 0..2 {
                let offset = frame * block + channel * sample_bytes;
                match layout {
                    None => bytes[offset..offset + 4].copy_from_slice(&(value as f32).to_le_bytes()),
                    Some(l) => pack_sample((value * 2_147_483_647.0) as i32, l, &mut bytes[offset..]),
                }
            }
        }
        let _ = render.write_to_device(frames, &bytes, None);
    };
    if let Ok(space) = client.get_available_space_in_frames() {
        write(space as usize);
    }
    client.start_stream().map_err(|e| e.to_string())?;
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs_f64(seconds) {
        if event.wait_for_event(1000).is_err() {
            break;
        }
        if let Ok(space) = client.get_available_space_in_frames() {
            write(space as usize);
        }
    }
    client.stop_stream().map_err(|e| e.to_string())
}

pub fn sweep(device_spec: &str, rate: u32, seconds: f64) -> Result<(), String> {
    let device = find_device(device_spec)?;
    println!("Device: {}", device.get_friendlyname().unwrap_or_default());
    println!("Each test plays a 440 Hz tone for {seconds} s. Watch the level meter on the other side and note which ones move.\n");
    let l = |store_bits, valid_bits| Some(Layout { store_bits, valid_bits, float: false });
    let float = Some(Layout { store_bits: 32, valid_bits: 24, float: true });
    let tests: [(&str, Option<Layout>); 6] = [
        ("1  shared mode, float (reference)", None),
        ("2  exclusive 32-bit container, 24 valid", l(32, 24)),
        ("3  exclusive 24-bit packed", l(24, 24)),
        ("4  exclusive 32-bit", l(32, 32)),
        ("5  exclusive 16-bit", l(16, 16)),
        ("6  exclusive 32-bit float", float),
    ];
    for (label, layout) in tests {
        println!("--- {label} @ {rate} Hz");
        match play(&device, rate, layout, seconds) {
            Ok(()) => println!("    played"),
            Err(e) => println!("    FAILED: {e}"),
        }
        std::thread::sleep(Duration::from_millis(800));
    }
    Ok(())
}

/// Does the Windows engine (and the driver's tap on it) hand a shared-mode stream through unchanged? Plays a known 24-bit signal
/// in shared mode at the endpoint's own format while recording that endpoint's loopback, then compares sample by sample.
pub fn selftest(device_spec: &str) -> Result<(), String> {
    use std::sync::{Arc, Mutex};
    let device = find_device(device_spec)?;
    println!("Device: {}", device.get_friendlyname().unwrap_or_default());
    let mut client = device.get_iaudioclient().map_err(|e| e.to_string())?;
    let format = client.get_mixformat().map_err(|e| e.to_string())?;
    let rate = format.get_samplespersec() as usize;
    let channels = format.get_nchannels() as usize;
    if channels != 2 || format.get_bitspersample() != 32 || format.get_subformat().map_err(|e| e.to_string())? != SampleType::Float {
        return Err(format!("the endpoint mixes {channels} ch / {} bit; this check needs stereo 32-bit float", format.get_bitspersample()));
    }
    println!("Endpoint mix format: {rate} Hz, 2 ch, 32-bit float");

    // Signal: half a second of silence, then 3 s of two sines on the 24-bit grid.
    let lead = rate / 2;
    let body = rate * 3;
    let mut signal = vec![0f32; (lead + body) * 2];
    for i in 0..body {
        for (ch, hz) in [440.0f64, 660.0].into_iter().enumerate() {
            let v = ((2.0 * std::f64::consts::PI * hz * i as f64 / rate as f64).sin() * 0.5 * 8_388_607.0).round();
            signal[(lead + i) * 2 + ch] = (v / 8_388_608.0) as f32;
        }
    }

    // Loopback recorder on its own thread.
    let recorded: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let (rec, stop_rec, spec) = (recorded.clone(), stop.clone(), device_spec.to_string());
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let recorder = std::thread::spawn(move || {
        let _ = wasapi::initialize_mta();
        let run = || -> Result<(), String> {
            let device = find_device(&spec)?;
            let mut client = device.get_iaudioclient().map_err(|e| e.to_string())?;
            let format = client.get_mixformat().map_err(|e| e.to_string())?;
            let (_, min_period) = client.get_device_period().map_err(|e| e.to_string())?;
            client
                .initialize_client(&format, &Direction::Capture, &StreamMode::EventsShared { autoconvert: false, buffer_duration_hns: min_period })
                .map_err(|e| format!("loopback: {e}"))?;
            let event = client.set_get_eventhandle().map_err(|e| e.to_string())?;
            let capture = client.get_audiocaptureclient().map_err(|e| e.to_string())?;
            client.start_stream().map_err(|e| e.to_string())?;
            let _ = ready_tx.send(Ok(()));
            let mut queue = std::collections::VecDeque::new();
            while !stop_rec.load(std::sync::atomic::Ordering::SeqCst) {
                capture.read_from_device_to_deque(&mut queue).map_err(|e| e.to_string())?;
                let bytes: Vec<u8> = queue.drain(..).collect();
                let mut out = rec.lock().unwrap();
                out.extend(bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])));
                drop(out);
                let _ = event.wait_for_event(200);
            }
            client.stop_stream().map_err(|e| e.to_string())
        };
        if let Err(e) = run() {
            let _ = ready_tx.send(Err(e));
        }
    });
    ready_rx.recv_timeout(Duration::from_secs(5)).map_err(|_| "loopback recorder did not start".to_string())??;

    // Render the signal in shared mode, exactly as the pass-through player does.
    let (_, min_period) = client.get_device_period().map_err(|e| e.to_string())?;
    client
        .initialize_client(&format, &Direction::Render, &StreamMode::EventsShared { autoconvert: false, buffer_duration_hns: min_period })
        .map_err(|e| format!("render: {e}"))?;
    let event = client.set_get_eventhandle().map_err(|e| e.to_string())?;
    let render = client.get_audiorenderclient().map_err(|e| e.to_string())?;
    let position = std::cell::Cell::new(0usize);
    let write = |frames: usize| {
        let mut bytes = vec![0u8; frames * 8];
        for frame in 0..frames {
            for ch in 0..2 {
                let idx = (position.get() + frame) * 2 + ch;
                let v = signal.get(idx).copied().unwrap_or(0.0);
                bytes[frame * 8 + ch * 4..frame * 8 + ch * 4 + 4].copy_from_slice(&v.to_le_bytes());
            }
        }
        position.set(position.get() + frames);
        let _ = render.write_to_device(frames, &bytes, None);
    };
    if let Ok(space) = client.get_available_space_in_frames() {
        write(space as usize);
    }
    client.start_stream().map_err(|e| e.to_string())?;
    while position.get() < lead + body + rate / 2 {
        if event.wait_for_event(1000).is_err() {
            break;
        }
        if let Ok(space) = client.get_available_space_in_frames() {
            write(space as usize);
        }
    }
    std::thread::sleep(Duration::from_millis(400));
    let _ = client.stop_stream();
    stop.store(true, std::sync::atomic::Ordering::SeqCst);
    let _ = recorder.join();

    let captured = recorded.lock().unwrap().clone();
    let first_sent = signal.iter().position(|&v| v != 0.0).ok_or("empty signal")?;
    let Some(first_got) = captured.iter().position(|&v| v != 0.0) else {
        println!("RESULT: the loopback recorded only silence - the device passed nothing through in shared mode.");
        return Ok(());
    };
    // Align on the first non-zero sample (they are both interleaved, so the offset keeps the channel order).
    let offset = first_got as i64 - first_sent as i64;
    let mut mismatches = 0usize;
    let mut max_lsb = 0f64;
    let mut compared = 0usize;
    for (i, &sent) in signal.iter().enumerate().skip(first_sent) {
        let at = i as i64 + offset;
        if at < 0 || at as usize >= captured.len() {
            break;
        }
        let got = captured[at as usize];
        compared += 1;
        if got != sent {
            mismatches += 1;
            max_lsb = max_lsb.max(((got - sent) as f64 * 8_388_608.0).abs());
        }
    }
    println!("Compared {compared} samples: {mismatches} differ, largest difference {max_lsb:.1} (24-bit steps)");
    if mismatches == 0 {
        println!("RESULT: the Windows engine passed the stream through bit-exactly in shared mode.");
    } else if max_lsb <= 1.0 {
        println!("RESULT: differences of at most one 24-bit step (rounding at the last bit).");
    } else {
        println!("RESULT: the stream is changed on its way through (largest difference {max_lsb:.1} steps of 24 bits).");
        println!("        Check the device's volume is 100%, enhancements are off, and the endpoint format in Windows sound settings.");
    }
    Ok(())
}
