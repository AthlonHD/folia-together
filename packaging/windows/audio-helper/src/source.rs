// Decodes one audio file into left-justified 32-bit integers (16-bit -> <<16, 24-bit -> <<8), which is exact for every integer source up to 32 bits.
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use symphonia::core::codecs::audio::{AudioDecoder, AudioDecoderOptions};
use symphonia::core::errors::Error;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo, TrackType};
use symphonia::core::io::{MediaSource, MediaSourceStream};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::units::Time;

/// How long a read waits for the download to move on before the song is given up on.
const STALL_LIMIT: Duration = Duration::from_secs(30);

/// A file another process is still writing (the download of the song). Reads wait for the bytes they need instead of seeing the end of
/// the file early, so a song can start playing while it is still coming in. `total` is the size the finished file will have; a read of
/// the bytes beyond what has arrived waits, until `cancel` is set (the song was replaced) or nothing has arrived for STALL_LIMIT.
pub struct GrowingFile {
    file: File,
    total: u64,
    pos: u64,
    seen_len: u64,
    last_growth: Instant,
    cancel: Arc<AtomicBool>,
    /// While the container is being recognised, the tail of the file that has not arrived reads as zeros instead of being waited
    /// for: format detection looks for tags at the very end (ID3v1, APE), and waiting for those would mean waiting for the whole download.
    probing: Arc<AtomicBool>,
}

const TAIL_BYTES: u64 = 256 * 1024;

impl GrowingFile {
    pub fn open(path: &str, total: u64, cancel: Arc<AtomicBool>, probing: Arc<AtomicBool>) -> io::Result<GrowingFile> {
        let file = match File::open(path) {
            Ok(file) => file,
            // The download finished (and the file got its final name) between the page handing over the `.part` path and this open.
            Err(e) if e.kind() == io::ErrorKind::NotFound && path.ends_with(".part") => File::open(&path[..path.len() - 5])?,
            Err(e) => return Err(e),
        };
        Ok(GrowingFile { file, total, pos: 0, seen_len: 0, last_growth: Instant::now(), cancel, probing })
    }
}

impl Read for GrowingFile {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.pos >= self.total || buf.is_empty() {
            return Ok(0);
        }
        loop {
            let available = self.file.metadata()?.len();
            if available > self.seen_len {
                self.seen_len = available;
                self.last_growth = Instant::now();
            }
            if self.pos < available {
                let want = ((available - self.pos) as usize).min(buf.len());
                self.file.seek(SeekFrom::Start(self.pos))?;
                let n = self.file.read(&mut buf[..want])?;
                self.pos += n as u64;
                return Ok(n);
            }
            if self.probing.load(Ordering::SeqCst) && self.pos >= self.total.saturating_sub(TAIL_BYTES) {
                // Zeros: no tag signature in them, so the detection moves on; an end of file here would make some containers give up.
                let n = ((self.total - self.pos) as usize).min(buf.len());
                buf[..n].fill(0);
                self.pos += n as u64;
                return Ok(n);
            }
            if self.cancel.load(Ordering::SeqCst) {
                return Err(io::Error::new(io::ErrorKind::Interrupted, "the song was replaced while it was downloading"));
            }
            if self.last_growth.elapsed() > STALL_LIMIT {
                return Err(io::Error::new(io::ErrorKind::TimedOut, "the download stalled"));
            }
            std::thread::sleep(Duration::from_millis(15));
        }
    }
}

impl Seek for GrowingFile {
    fn seek(&mut self, from: SeekFrom) -> io::Result<u64> {
        let target = match from {
            SeekFrom::Start(p) => p as i128,
            SeekFrom::End(d) => self.total as i128 + d as i128,
            SeekFrom::Current(d) => self.pos as i128 + d as i128,
        };
        if target < 0 {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "seek before the start"));
        }
        self.pos = target as u64;
        Ok(self.pos)
    }
}

impl MediaSource for GrowingFile {
    fn is_seekable(&self) -> bool {
        true
    }
    fn byte_len(&self) -> Option<u64> {
        Some(self.total)
    }
}

pub struct SourceInfo {
    pub rate: u32,
    pub channels: u32,
    /// Bit depth of the stored samples; lossy codecs report 0 (they decode to float, not to a fixed depth).
    pub bits: u32,
    pub codec: String,
    pub duration_sec: f64,
}

pub struct Source {
    format: Box<dyn FormatReader>,
    decoder: Box<dyn AudioDecoder>,
    track_id: u32,
    time_base: Option<symphonia::core::units::TimeBase>,
    pub info: SourceInfo,
}

impl Source {
    /// `growing`: the size the finished file will have, for a file that is still being written (see GrowingFile).
    pub fn open(path: &str, growing: Option<u64>, cancel: Arc<AtomicBool>) -> Result<Source, String> {
        // A file still being written is first recognised without its tail (most containers keep everything needed at the front, and the song
        // can start at once). One that cannot be (an MP4 with its index at the end) is recognised again once the tail has arrived.
        if growing.is_some() {
            if let Ok(source) = Self::open_once(path, growing, cancel.clone(), true) {
                return Ok(source);
            }
            if cancel.load(Ordering::SeqCst) {
                return Err("the song was replaced while it was downloading".to_string());
            }
        }
        Self::open_once(path, growing, cancel, false)
    }

    fn open_once(path: &str, growing: Option<u64>, cancel: Arc<AtomicBool>, tail_as_end: bool) -> Result<Source, String> {
        let probing = Arc::new(AtomicBool::new(tail_as_end));
        let source: Box<dyn MediaSource> = match growing {
            Some(total) => Box::new(GrowingFile::open(path, total, cancel, probing.clone()).map_err(|e| format!("open {path}: {e}"))?),
            None => Box::new(File::open(path).map_err(|e| format!("open {path}: {e}"))?),
        };
        let mss = MediaSourceStream::new(source, Default::default());
        let mut hint = Hint::new();
        if let Some(ext) = Path::new(path).extension().and_then(|e| e.to_str()) {
            hint.with_extension(ext);
        }
        let format = symphonia::default::get_probe()
            .probe(&hint, mss, FormatOptions::default(), MetadataOptions::default())
            .map_err(|e| format!("unsupported container: {e}"))?;
        probing.store(false, Ordering::SeqCst);
        let track = format.default_track(TrackType::Audio).ok_or("no audio track")?;
        let params = track
            .codec_params
            .as_ref()
            .and_then(|p| p.audio())
            .ok_or("missing audio codec parameters")?
            .clone();
        let decoder = symphonia::default::get_codecs()
            .make_audio_decoder(&params, &AudioDecoderOptions::default())
            .map_err(|e| format!("unsupported codec: {e}"))?;
        let rate = params.sample_rate.ok_or("unknown sample rate")?;
        let channels = params.channels.as_ref().map(|c| c.count() as u32).unwrap_or(2);
        let duration_sec = match (track.num_frames, track.duration, track.time_base) {
            (Some(frames), _, _) => frames as f64 / rate as f64,
            (None, Some(duration), Some(base)) => base
                .calc_duration(duration)
                .map(|t| t.as_secs_f64())
                .unwrap_or(0.0),
            _ => 0.0,
        };
        let info = SourceInfo {
            rate,
            channels,
            bits: params.bits_per_sample.unwrap_or(0),
            codec: decoder.codec_info().short_name.to_string(),
            duration_sec,
        };
        let track_id = track.id;
        let time_base = track.time_base;
        Ok(Source { format, decoder, track_id, time_base, info })
    }

    /// Next decoded packet as interleaved i32 (source channel layout); None at end of stream.
    pub fn next_chunk(&mut self) -> Result<Option<Vec<i32>>, String> {
        loop {
            let packet = match self.format.next_packet() {
                Ok(Some(p)) => p,
                Ok(None) => return Ok(None),
                Err(Error::ResetRequired) => return Ok(None),
                Err(e) => return Err(e.to_string()),
            };
            if packet.track_id != self.track_id {
                continue;
            }
            match self.decoder.decode(&packet) {
                Ok(buf) => {
                    let mut out = vec![0i32; buf.samples_interleaved()];
                    buf.copy_to_slice_interleaved(&mut out[..]);
                    return Ok(Some(out));
                }
                // A corrupt packet is skipped; one bad frame must not end the song.
                Err(Error::DecodeError(_)) | Err(Error::IoError(_)) => continue,
                Err(e) => return Err(e.to_string()),
            }
        }
    }

    /// Seeks to just before `sec` (the container can only land on packet boundaries); returns how many seconds of audio
    /// after the landing point still have to be dropped to start exactly at `sec`.
    pub fn seek(&mut self, sec: f64) -> Result<f64, String> {
        let time = Time::try_from_secs_f64(sec.max(0.0)).ok_or("bad seek time")?;
        let landed = self
            .format
            .seek(SeekMode::Accurate, SeekTo::Time { time, track_id: Some(self.track_id) })
            .map_err(|e| e.to_string())?;
        self.decoder.reset();
        let to_secs = |ts| self.time_base.and_then(|base| base.calc_time(ts)).map(|t| t.as_secs_f64());
        Ok(match (to_secs(landed.required_ts), to_secs(landed.actual_ts)) {
            (Some(required), Some(actual)) => (required - actual).max(0.0),
            _ => 0.0,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp_path(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("folia-growing-{}-{name}", std::process::id()));
        let _ = std::fs::remove_file(&dir);
        dir
    }

    #[test]
    fn reads_wait_for_bytes_that_have_not_arrived_yet() {
        let path = temp_path("wait");
        std::fs::write(&path, [1u8, 2, 3, 4]).unwrap();
        let mut reader = GrowingFile::open(path.to_str().unwrap(), 10, Arc::new(AtomicBool::new(false)), Arc::new(AtomicBool::new(false))).unwrap();
        let writer_path = path.clone();
        let writer = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(120));
            let mut f = std::fs::OpenOptions::new().append(true).open(writer_path).unwrap();
            f.write_all(&[5, 6, 7, 8, 9, 10]).unwrap();
        });
        let mut all = Vec::new();
        reader.read_to_end(&mut all).unwrap();
        writer.join().unwrap();
        assert_eq!(all, (1u8..=10).collect::<Vec<_>>());
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn the_end_is_the_announced_size_and_seeks_are_relative_to_it() {
        let path = temp_path("end");
        std::fs::write(&path, [9u8; 8]).unwrap();
        let mut reader = GrowingFile::open(path.to_str().unwrap(), 8, Arc::new(AtomicBool::new(false)), Arc::new(AtomicBool::new(false))).unwrap();
        assert_eq!(reader.byte_len(), Some(8));
        assert_eq!(reader.seek(SeekFrom::End(-2)).unwrap(), 6);
        let mut tail = Vec::new();
        reader.read_to_end(&mut tail).unwrap();
        assert_eq!(tail.len(), 2);
        assert!(reader.seek(SeekFrom::Current(-100)).is_err());
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn a_replaced_song_ends_a_waiting_read() {
        let path = temp_path("cancel");
        std::fs::write(&path, [1u8]).unwrap();
        let cancel = Arc::new(AtomicBool::new(false));
        let mut reader = GrowingFile::open(path.to_str().unwrap(), 100, cancel.clone(), Arc::new(AtomicBool::new(false))).unwrap();
        let mut one = [0u8; 1];
        assert_eq!(reader.read(&mut one).unwrap(), 1);
        let flag = cancel.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(80));
            flag.store(true, Ordering::SeqCst);
        });
        let started = Instant::now();
        let err = reader.read(&mut one).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::Interrupted);
        assert!(started.elapsed() < Duration::from_secs(5));
        let _ = std::fs::remove_file(path);
    }
}
