// Developer diagnostic: records an endpoint in exclusive mode to a raw file, so the bit-exactness of the render path can be checked against the source.
use std::collections::VecDeque;
use std::io::Write;
use std::time::{Duration, Instant};
use wasapi::{DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat};

pub fn capture(name_part: &str, rate: u32, valid_bits: u16, store_bits: u16, seconds: f64, out_path: &str) -> Result<(), String> {
    let enumerator = DeviceEnumerator::new().map_err(|e| e.to_string())?;
    let collection = enumerator.get_device_collection(&Direction::Capture).map_err(|e| e.to_string())?;
    let count = collection.get_nbr_devices().map_err(|e| e.to_string())?;
    let mut found = None;
    for index in 0..count {
        let device = collection.get_device_at_index(index).map_err(|e| e.to_string())?;
        if device.get_friendlyname().unwrap_or_default().contains(name_part) {
            found = Some(device);
            break;
        }
    }
    let device = found.ok_or_else(|| format!("no capture endpoint matching {name_part}"))?;
    let mut client = device.get_iaudioclient().map_err(|e| e.to_string())?;
    let wanted = WaveFormat::new(store_bits as usize, valid_bits as usize, &SampleType::Int, rate as usize, 2, None);
    let format = client.is_supported_exclusive_with_quirks(&wanted).map_err(|e| e.to_string())?;
    let (_, min_period) = client.get_device_period().map_err(|e| e.to_string())?;
    let period = client.calculate_aligned_period_near(min_period * 2, Some(128), &format).unwrap_or(min_period * 2);
    client
        .initialize_client(&format, &Direction::Capture, &StreamMode::EventsExclusive { period_hns: period })
        .map_err(|e| e.to_string())?;
    let event = client.set_get_eventhandle().map_err(|e| e.to_string())?;
    let capture_client = client.get_audiocaptureclient().map_err(|e| e.to_string())?;
    let mut queue: VecDeque<u8> = VecDeque::new();
    let mut file = std::fs::File::create(out_path).map_err(|e| e.to_string())?;
    client.start_stream().map_err(|e| e.to_string())?;
    eprintln!("capturing {name_part} {rate}Hz {valid_bits}/{store_bits} for {seconds}s");
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs_f64(seconds) {
        capture_client.read_from_device_to_deque(&mut queue).map_err(|e| e.to_string())?;
        let (a, b) = queue.as_slices();
        file.write_all(a).and_then(|_| file.write_all(b)).map_err(|e| e.to_string())?;
        queue.clear();
        let _ = event.wait_for_event(500);
    }
    client.stop_stream().map_err(|e| e.to_string())
}

/// Developer check of the Windows engine stage: records what the shared-mode mixer outputs for a render endpoint (loopback) as raw 32-bit float,
/// so the samples this player wrote can be compared with what the engine produced from them.
pub fn loopback(name_part: &str, seconds: f64, out_path: &str) -> Result<(), String> {
    let enumerator = DeviceEnumerator::new().map_err(|e| e.to_string())?;
    let collection = enumerator.get_device_collection(&Direction::Render).map_err(|e| e.to_string())?;
    let count = collection.get_nbr_devices().map_err(|e| e.to_string())?;
    let mut found = None;
    for index in 0..count {
        let device = collection.get_device_at_index(index).map_err(|e| e.to_string())?;
        if device.get_friendlyname().unwrap_or_default().contains(name_part) {
            found = Some(device);
            break;
        }
    }
    let device = found.ok_or_else(|| format!("no render endpoint matching {name_part}"))?;
    let mut client = device.get_iaudioclient().map_err(|e| e.to_string())?;
    let format = client.get_mixformat().map_err(|e| e.to_string())?;
    let (_, min_period) = client.get_device_period().map_err(|e| e.to_string())?;
    client
        .initialize_client(&format, &Direction::Capture, &StreamMode::EventsShared { autoconvert: false, buffer_duration_hns: min_period })
        .map_err(|e| e.to_string())?;
    let event = client.set_get_eventhandle().map_err(|e| e.to_string())?;
    let capture_client = client.get_audiocaptureclient().map_err(|e| e.to_string())?;
    let mut queue: VecDeque<u8> = VecDeque::new();
    let mut file = std::fs::File::create(out_path).map_err(|e| e.to_string())?;
    client.start_stream().map_err(|e| e.to_string())?;
    eprintln!("loopback {name_part}: {} Hz, {} ch, {} bit", format.get_samplespersec(), format.get_nchannels(), format.get_bitspersample());
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs_f64(seconds) {
        capture_client.read_from_device_to_deque(&mut queue).map_err(|e| e.to_string())?;
        let (a, b) = queue.as_slices();
        file.write_all(a).and_then(|_| file.write_all(b)).map_err(|e| e.to_string())?;
        queue.clear();
        let _ = event.wait_for_event(500);
    }
    client.stop_stream().map_err(|e| e.to_string())
}
