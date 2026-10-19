// One-stage sample-rate conversion (rubato FFT resampler, f64 internally) used only when the device cannot take the source rate as is.
use rubato::audioadapter::{Adapter, AdapterMut};
use rubato::audioadapter_buffers::owned::InterleavedOwned;
use rubato::{Fft, FixedSync, Indexing, Resampler as _};

const CHUNK_FRAMES: usize = 2048;
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
        let inner = Fft::<f64>::new(rate_in as usize, rate_out as usize, CHUNK_FRAMES, channels, FixedSync::Input)
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
