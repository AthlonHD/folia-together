// Decodes one audio file into left-justified 32-bit integers (16-bit -> <<16, 24-bit -> <<8), which is exact for every integer source up to 32 bits.
use std::fs::File;
use std::path::Path;
use symphonia::core::codecs::audio::{AudioDecoder, AudioDecoderOptions};
use symphonia::core::errors::Error;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::units::Time;

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
    pub fn open(path: &str) -> Result<Source, String> {
        let file = File::open(path).map_err(|e| format!("open {path}: {e}"))?;
        let mss = MediaSourceStream::new(Box::new(file), Default::default());
        let mut hint = Hint::new();
        if let Some(ext) = Path::new(path).extension().and_then(|e| e.to_str()) {
            hint.with_extension(ext);
        }
        let format = symphonia::default::get_probe()
            .probe(&hint, mss, FormatOptions::default(), MetadataOptions::default())
            .map_err(|e| format!("unsupported container: {e}"))?;
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
