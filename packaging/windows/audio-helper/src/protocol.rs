// Line-delimited JSON protocol between Electron's main process and the helper (stdin -> commands, stdout -> events).
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(tag = "cmd", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Command {
    /// List render endpoints.
    Devices,
    /// Test which exclusive-mode formats an endpoint accepts.
    Probe { device_id: String },
    /// Choose the output endpoint and how the output rate is picked.
    Configure {
        device_id: String,
        #[serde(default)]
        rate_strategy: RateStrategy,
        #[serde(default = "default_fixed_rate")]
        fixed_rate: u32,
        #[serde(default)]
        mode: OutputMode,
    },
    Load {
        path: String,
        #[serde(default)]
        start_sec: f64,
        #[serde(default = "yes")]
        autoplay: bool,
        #[serde(default)]
        token: u64,
    },
    Play,
    Pause,
    Seek { sec: f64 },
    Stop,
    Quit,
}

fn default_fixed_rate() -> u32 {
    192_000
}

fn yes() -> bool {
    true
}

/// Exclusive bypasses the Windows mixer; Shared goes through it at the endpoint's own format (for drivers that only pass shared streams on).
#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum OutputMode {
    #[default]
    Exclusive,
    Shared,
}

/// `Native` offers the source rate to the device first; `Fixed` always targets `fixed_rate`.
#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum RateStrategy {
    #[default]
    Native,
    Fixed,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub mix_rate: Option<u32>,
    pub mix_bits: Option<u16>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FormatProbe {
    pub rate: u32,
    pub bits: u16,
    pub valid_bits: u16,
    pub exclusive: bool,
    pub float: bool,
}

/// What the playback chain actually is for the loaded track; the UI shows this instead of a claim.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Chain {
    pub source_rate: u32,
    pub source_bits: u32,
    pub source_channels: u32,
    pub codec: String,
    pub device_name: String,
    pub output_rate: u32,
    pub output_bits: u16,
    pub output_valid_bits: u16,
    pub exclusive: bool,
    pub resampled: bool,
    pub truncated: bool,
    pub downmixed: bool,
    pub bit_perfect: bool,
}

#[derive(Debug, Serialize)]
#[serde(tag = "event", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Event {
    Ready { version: String },
    Devices { devices: Vec<DeviceInfo> },
    Probe { device_id: String, formats: Vec<FormatProbe> },
    Configured { device_id: String },
    Chain { token: u64, chain: Chain },
    State { state: &'static str },
    Position { sec: f64, duration_sec: f64, token: u64, peak_db: f64 },
    Ended { token: u64 },
    Error { code: String, message: String },
}

pub fn emit(event: &Event) {
    use std::io::Write;
    if let Ok(line) = serde_json::to_string(event) {
        let stdout = std::io::stdout();
        let mut lock = stdout.lock();
        let _ = writeln!(lock, "{line}");
        let _ = lock.flush();
    }
}

pub fn emit_error(code: &str, message: impl Into<String>) {
    emit(&Event::Error { code: code.to_string(), message: message.into() });
}
