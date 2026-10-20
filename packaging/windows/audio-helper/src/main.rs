// folia-audio-helper: WASAPI exclusive pass-through player. `serve` speaks line-delimited JSON on stdio; `devices` and `probe` are for humans.
mod capture;
mod devices;
mod player;
mod protocol;
mod resample;
mod tone;
mod source;

use player::{start_session, Session};
use protocol::{emit, emit_error, Command, Event, OutputMode, RateStrategy, ResampleEngine};
use std::io::BufRead;
use std::sync::atomic::Ordering;
use std::sync::mpsc;
use std::time::{Duration, Instant};

const POSITION_INTERVAL: Duration = Duration::from_millis(100);

fn main() {
    let _ = wasapi::initialize_mta();
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("devices") => print_json(&devices::list_devices()),
        Some("probe") => match args.get(2) {
            Some(id) => print_json(&devices::probe_device(id)),
            None => eprintln!("usage: folia-audio-helper probe <deviceId>"),
        },
        Some("serve") => serve(),
        // Developer check of the Windows engine stage: loopback <endpoint name part> <seconds> <out.raw>
        Some("loopback") if args.len() >= 5 => {
            if let Err(e) = capture::loopback(&args[2], args[3].parse().unwrap_or(5.0), &args[4]) {
                eprintln!("{e}");
                std::process::exit(1);
            }
        }
        // Self-check of shared mode: selftest <device id or name part>
        Some("selftest") if args.len() >= 3 => {
            if let Err(e) = tone::selftest(&args[2]) {
                eprintln!("{e}");
                std::process::exit(1);
            }
        }
        // Diagnostic: tone <device id or name part> [rate=48000] [seconds=3]
        Some("tone") if args.len() >= 3 => {
            let rate = args.get(3).and_then(|v| v.parse().ok()).unwrap_or(48_000);
            let seconds = args.get(4).and_then(|v| v.parse().ok()).unwrap_or(3.0);
            if let Err(e) = tone::sweep(&args[2], rate, seconds) {
                eprintln!("{e}");
                std::process::exit(1);
            }
        }
        // Developer check of the render path: capture <endpoint name part> <rate> <valid bits> <store bits> <seconds> <out.raw>
        Some("capture") if args.len() >= 8 => {
            let parse = |i: usize| args[i].parse::<f64>().unwrap_or(0.0);
            if let Err(e) = capture::capture(&args[2], parse(3) as u32, parse(4) as u16, parse(5) as u16, parse(6), &args[7]) {
                eprintln!("{e}");
                std::process::exit(1);
            }
        }
        _ => eprintln!("usage: folia-audio-helper <devices | probe <deviceId> | tone <device> [rate] [seconds] | serve>"),
    }
}

fn print_json<T: serde::Serialize>(value: &Result<T, String>) {
    match value {
        Ok(v) => println!("{}", serde_json::to_string_pretty(v).unwrap_or_default()),
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    }
}

struct Config {
    device_id: String,
    strategy: RateStrategy,
    fixed_rate: u32,
    mode: OutputMode,
    engine: ResampleEngine,
}

fn serve() {
    emit(&Event::Ready { version: env!("CARGO_PKG_VERSION").to_string() });
    let (tx, rx) = mpsc::channel::<Command>();
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines() {
            let Ok(line) = line else { break };
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<Command>(&line) {
                Ok(cmd) => {
                    if tx.send(cmd).is_err() {
                        break;
                    }
                }
                Err(e) => emit_error("bad-command", format!("{e}: {line}")),
            }
        }
        // stdin closed: the parent is gone, shut down instead of holding the device.
        let _ = tx.send(Command::Quit);
    });

    let mut config = Config { device_id: String::new(), strategy: RateStrategy::Native, fixed_rate: 192_000, mode: OutputMode::Exclusive, engine: ResampleEngine::Rubato };
    let mut session: Option<Session> = None;
    let mut last_position = Instant::now();
    loop {
        match rx.recv_timeout(POSITION_INTERVAL) {
            Ok(Command::Quit) => break,
            Ok(cmd) => handle(cmd, &mut config, &mut session),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
        if let Some(s) = session.as_ref() {
            if s.shared.ended.swap(false, Ordering::SeqCst) {
                emit(&Event::Ended { token: s.token });
                if let Some(done) = session.take() {
                    done.stop();
                    emit(&Event::State { state: "stopped" });
                }
            } else if last_position.elapsed() >= POSITION_INTERVAL && !s.shared.paused.load(Ordering::Relaxed) {
                emit(&Event::Position { sec: s.position_sec(), duration_sec: s.duration_sec, token: s.token, peak_db: s.take_peak_db() });
                last_position = Instant::now();
            }
        }
    }
    if let Some(s) = session.take() {
        s.stop();
    }
}

fn handle(cmd: Command, config: &mut Config, session: &mut Option<Session>) {
    match cmd {
        Command::Devices => match devices::list_devices() {
            Ok(devices) => emit(&Event::Devices { devices }),
            Err(e) => emit_error("devices-failed", e),
        },
        Command::Probe { device_id } => match devices::probe_device(&device_id) {
            Ok(formats) => emit(&Event::Probe { device_id, formats }),
            Err(e) => emit_error("probe-failed", e),
        },
        Command::Configure { device_id, rate_strategy, fixed_rate, mode, resampler } => {
            config.device_id = device_id.clone();
            config.strategy = rate_strategy;
            config.fixed_rate = fixed_rate;
            config.mode = mode;
            config.engine = resampler;
            emit(&Event::Configured { device_id });
        }
        Command::Load { path, start_sec, autoplay, token, total_bytes } => {
            // Release the device before reopening it: an exclusive endpoint cannot be opened twice.
            if let Some(old) = session.take() {
                // The page moves to the next track the moment its own clock ends; let the last buffers of this one finish first.
                if old.is_finishing() {
                    let deadline = Instant::now() + Duration::from_millis(2000);
                    while !old.shared.ended.load(Ordering::SeqCst) && Instant::now() < deadline {
                        std::thread::sleep(Duration::from_millis(10));
                    }
                }
                old.stop();
            }
            match start_session(&path, &config.device_id, config.strategy, config.fixed_rate, config.mode, config.engine, start_sec, autoplay, token, total_bytes) {
                Ok(s) => {
                    emit(&Event::State { state: if autoplay { "playing" } else { "paused" } });
                    *session = Some(s);
                }
                Err((code, message)) => emit_error(&code, message),
            }
        }
        Command::Play => {
            if let Some(s) = session.as_ref() {
                s.shared.paused.store(false, Ordering::SeqCst);
                emit(&Event::State { state: "playing" });
            }
        }
        Command::Pause => {
            if let Some(s) = session.as_ref() {
                s.shared.paused.store(true, Ordering::SeqCst);
                emit(&Event::State { state: "paused" });
            }
        }
        Command::Seek { sec } => {
            if let Some(s) = session.as_ref() {
                s.seek(sec);
            }
        }
        Command::Stop => {
            if let Some(s) = session.take() {
                s.stop();
                emit(&Event::State { state: "stopped" });
            }
        }
        Command::Quit => {}
    }
}
