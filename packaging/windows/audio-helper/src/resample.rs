// One-stage sample-rate conversion (rubato FFT resampler, f64 internally) used only when the device cannot take the source rate as is.
use rubato::audioadapter::{Adapter, AdapterMut};
use rubato::audioadapter_buffers::owned::InterleavedOwned;
use rubato::{Fft, FixedSync, Indexing, Resampler as _, WindowFunction};

/// A long filter (one 8192-frame FFT block) keeps the passband flat to within about 100 Hz of the source Nyquist; the old 2048-frame
/// blocks cut off near 21.5 kHz (48 kHz) and 20 kHz (44.1 kHz source).
const CHUNK_FRAMES: usize = 8192;
const SUB_CHUNKS: usize = 1;
const WINDOW: WindowFunction = WindowFunction::BlackmanHarris2;
const SCALE: f64 = 2_147_483_648.0;

pub struct Resampler {
    inner: Fft<f64>,
    channels: usize,
    pending: Vec<f64>,
    in_buf: InterleavedOwned<f64>,
    out_buf: InterleavedOwned<f64>,
    delay_left: usize,
    ratio: f64,
    frames_in: u64,
    emitted: u64,
}

impl Resampler {
    pub fn new(rate_in: u32, rate_out: u32, channels: usize) -> Result<Resampler, String> {
        Self::with_config(rate_in, rate_out, channels, CHUNK_FRAMES, SUB_CHUNKS, WINDOW)
    }

    /// `chunk` and `sub_chunks` set the FFT size: a longer filter has a narrower transition band, so more of the top octave survives.
    pub fn with_config(rate_in: u32, rate_out: u32, channels: usize, chunk: usize, sub_chunks: usize, window: WindowFunction) -> Result<Resampler, String> {
        let inner = Fft::<f64>::new_custom(rate_in as usize, rate_out as usize, chunk, sub_chunks, channels, window, FixedSync::Input)
            .map_err(|e| format!("resampler {rate_in}->{rate_out}: {e}"))?;
        let in_buf = InterleavedOwned::<f64>::new(0.0, channels, inner.input_frames_max());
        let out_buf = InterleavedOwned::<f64>::new(0.0, channels, inner.output_frames_max());
        let delay_left = inner.output_delay();
        Ok(Resampler {
            inner,
            channels,
            pending: Vec::new(),
            in_buf,
            out_buf,
            delay_left,
            ratio: rate_out as f64 / rate_in as f64,
            frames_in: 0,
            emitted: 0,
        })
    }

    /// Feeds interleaved i32 frames; returns whatever output is ready (interleaved i32, full-scale 32-bit).
    pub fn push(&mut self, input: &[i32]) -> Vec<i32> {
        self.frames_in += (input.len() / self.channels) as u64;
        self.pending.extend(input.iter().map(|&s| s as f64 / SCALE));
        let mut out = Vec::new();
        loop {
            let need = self.inner.input_frames_next();
            if self.pending.len() < need * self.channels {
                break;
            }
            self.run_chunk(need, None, &mut out);
            self.pending.drain(..need * self.channels);
        }
        out
    }

    /// Flushes the tail by padding with silence, then trims to exactly the length the ratio gives, so the song neither loses its last samples nor gains a tail.
    pub fn finish(&mut self) -> Vec<i32> {
        let target = (self.frames_in as f64 * self.ratio).round() as u64;
        let mut out = Vec::new();
        let mut guard = 0;
        while self.emitted < target && guard < 16 {
            guard += 1;
            let need = self.inner.input_frames_next();
            let have = (self.pending.len() / self.channels).min(need);
            self.run_chunk(have, Some(Indexing::new().partial_len(have)), &mut out);
            self.pending.drain(..have * self.channels);
        }
        let excess = self.emitted.saturating_sub(target) as usize;
        out.truncate(out.len().saturating_sub(excess * self.channels));
        out
    }

    fn run_chunk(&mut self, frames: usize, indexing: Option<Indexing>, out: &mut Vec<i32>) {
        for frame in 0..frames {
            for ch in 0..self.channels {
                self.in_buf.write_sample(ch, frame, &self.pending[frame * self.channels + ch]);
            }
        }
        let Ok((_, produced)) = self.inner.process_into_buffer(&self.in_buf, &mut self.out_buf, indexing.as_ref()) else {
            return;
        };
        let skip = self.delay_left.min(produced);
        self.delay_left -= skip;
        self.emitted += (produced - skip) as u64;
        for frame in skip..produced {
            for ch in 0..self.channels {
                let v = self.out_buf.read_sample(ch, frame).unwrap_or(0.0);
                out.push((v * SCALE).round().clamp(i32::MIN as f64, i32::MAX as f64) as i32);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_length_follows_the_ratio_and_a_constant_stays_constant() {
        let mut r = Resampler::new(44_100, 96_000, 2).unwrap();
        let level = 1 << 28;
        let input = vec![level; 44_100 * 2];
        let mut out = r.push(&input);
        out.extend(r.finish());
        let frames = out.len() / 2;
        assert_eq!(frames, 96_000);
        let middle = &out[out.len() / 2 - 200..out.len() / 2 + 200];
        assert!(middle.iter().all(|&s| (s - level).abs() < 1 << 12), "constant drifted");
    }
}

#[cfg(test)]
mod quality {
    use super::*;

    /// Upsamples pure tones 48 kHz -> 192 kHz and measures how far the result is from the ideal tone at 192 kHz.
    #[test]
    fn upsampling_error_against_the_ideal_signal() {
        let (rate_in, rate_out) = (48_000usize, 192_000usize);
        let seconds = 2usize;
        let amp = 0.5 * 2_147_483_647.0;
        println!("tone      error vs ideal (dBFS)   max sample error (24-bit steps)   original samples kept (max diff, 24-bit steps)");
        for hz in [100.0f64, 1_000.0, 10_000.0, 15_000.0, 20_000.0, 21_000.0, 22_000.0] {
            let input: Vec<i32> = (0..rate_in * seconds)
                .flat_map(|n| {
                    let v = ((2.0 * std::f64::consts::PI * hz * n as f64 / rate_in as f64).sin() * amp).round() as i32;
                    [v, v]
                })
                .collect();
            let mut r = Resampler::new(rate_in as u32, rate_out as u32, 2).unwrap();
            let mut out = r.push(&input);
            out.extend(r.finish());
            let frames = out.len() / 2;
            assert_eq!(frames, rate_out * seconds);
            // Compare the middle of the signal, away from the start and end of the file.
            let (from, to) = (frames / 4, frames * 3 / 4);
            let (mut sum_sq, mut max_abs) = (0.0f64, 0.0f64);
            for k in from..to {
                let ideal = (2.0 * std::f64::consts::PI * hz * k as f64 / rate_out as f64).sin() * amp;
                let err = out[k * 2] as f64 - ideal;
                sum_sq += err * err;
                max_abs = max_abs.max(err.abs());
            }
            let rms = (sum_sq / (to - from) as f64).sqrt();
            let rms_db = 20.0 * (rms / 2_147_483_648.0).log10();
            // Every fourth output sample sits exactly where an input sample was.
            let kept = (from / 4..to / 4).map(|n| ((out[n * 4 * 2] as i64 - input[n * 2] as i64).abs()) as f64 / 256.0).fold(0.0f64, f64::max);
            println!("{hz:>7.0} Hz   {rms_db:>9.1}              {:>10.2}                      {kept:>10.2}", max_abs / 256.0);
        }
    }
}

#[cfg(test)]
mod passband {
    use super::*;

    /// Highest tone (scanned in 50 Hz steps) that is still reproduced to better than -120 dBFS, for several filter configurations.
    fn edge(rate_in: usize, rate_out: usize, chunk: usize, sub: usize, window: WindowFunction) -> f64 {
        let amp = 0.5 * 2_147_483_647.0;
        let nyquist = rate_in as f64 / 2.0;
        let mut best = 0.0;
        let mut hz = nyquist * 0.80;
        while hz < nyquist - 50.0 {
            let input: Vec<i32> = (0..rate_in)
                .flat_map(|n| {
                    let v = ((2.0 * std::f64::consts::PI * hz * n as f64 / rate_in as f64).sin() * amp).round() as i32;
                    [v, v]
                })
                .collect();
            let mut r = Resampler::with_config(rate_in as u32, rate_out as u32, 2, chunk, sub, window).unwrap();
            let mut out = r.push(&input);
            out.extend(r.finish());
            let frames = out.len() / 2;
            let (from, to) = (frames / 4, frames * 3 / 4);
            let mut sum_sq = 0.0f64;
            for k in from..to {
                let ideal = (2.0 * std::f64::consts::PI * hz * k as f64 / rate_out as f64).sin() * amp;
                let e = out[k * 2] as f64 - ideal;
                sum_sq += e * e;
            }
            let db = 20.0 * ((sum_sq / (to - from) as f64).sqrt() / 2_147_483_648.0).log10();
            if db > -120.0 {
                break;
            }
            best = hz;
            hz += 50.0;
        }
        best
    }

    #[test]
    fn where_the_passband_ends() {
        let configs: [(&str, usize, usize, WindowFunction); 6] = [
            ("current: 2048/8 BlackmanHarris2", 2048, 8, WindowFunction::BlackmanHarris2),
            ("8192/1 BlackmanHarris2", 8192, 1, WindowFunction::BlackmanHarris2),
            ("16384/1 BlackmanHarris2", 16384, 1, WindowFunction::BlackmanHarris2),
            ("16384/1 Blackman", 16384, 1, WindowFunction::Blackman),
            ("32768/1 BlackmanHarris2", 32768, 1, WindowFunction::BlackmanHarris2),
            ("32768/1 Blackman", 32768, 1, WindowFunction::Blackman),
        ];
        println!("config                              48k->192k edge (Hz)   44.1k->192k edge (Hz)   44.1k Nyquist 22050");
        for (name, chunk, sub, window) in configs {
            let a = edge(48_000, 192_000, chunk, sub, window);
            let b = edge(44_100, 192_000, chunk, sub, window);
            println!("{name:<36}{a:>10.0}{b:>24.0}");
        }
    }
}
