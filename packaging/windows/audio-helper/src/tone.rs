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
            let wanted = WaveFormat::new(l.store_bits as usize, l.valid_bits as usize, &SampleType::Int, rate as usize, 2, None);
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
    let l = |store_bits, valid_bits| Some(Layout { store_bits, valid_bits });
    let tests: [(&str, Option<Layout>); 5] = [
        ("1  shared mode, float (reference)", None),
        ("2  exclusive 32-bit container, 24 valid", l(32, 24)),
        ("3  exclusive 24-bit packed", l(24, 24)),
        ("4  exclusive 32-bit", l(32, 32)),
        ("5  exclusive 16-bit", l(16, 16)),
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
