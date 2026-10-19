// Render endpoint enumeration and the exclusive-mode capability probe.
use crate::protocol::{DeviceInfo, FormatProbe};
use wasapi::{DeviceEnumerator, Direction, SampleType, WaveFormat};

pub const PROBE_RATES: [u32; 9] = [44_100, 48_000, 88_200, 96_000, 176_400, 192_000, 352_800, 384_000, 768_000];

/// (container bits, valid bits) pairs, in the order the player prefers them for lossless output.
pub const PROBE_LAYOUTS: [(u16, u16); 4] = [(32, 24), (24, 24), (32, 32), (16, 16)];

pub fn list_devices() -> Result<Vec<DeviceInfo>, String> {
    let enumerator = DeviceEnumerator::new().map_err(|e| e.to_string())?;
    let default_id = enumerator
        .get_default_device(&Direction::Render)
        .ok()
        .and_then(|d| d.get_id().ok());
    let collection = enumerator.get_device_collection(&Direction::Render).map_err(|e| e.to_string())?;
    let count = collection.get_nbr_devices().map_err(|e| e.to_string())?;
    let mut devices = Vec::new();
    for index in 0..count {
        let Ok(device) = collection.get_device_at_index(index) else { continue };
        let Ok(id) = device.get_id() else { continue };
        let name = device.get_friendlyname().unwrap_or_else(|_| id.clone());
        let mix = device.get_device_format().ok();
        devices.push(DeviceInfo {
            is_default: default_id.as_deref() == Some(id.as_str()),
            id,
            name,
            mix_rate: mix.as_ref().map(|f| f.get_samplespersec()),
            mix_bits: mix.as_ref().map(|f| f.get_validbitspersample()),
        });
    }
    Ok(devices)
}

/// Asks the endpoint's driver which exclusive formats it accepts; the answer decides what "pass-through" can mean there.
pub fn probe_device(device_id: &str) -> Result<Vec<FormatProbe>, String> {
    let enumerator = DeviceEnumerator::new().map_err(|e| e.to_string())?;
    let device = enumerator.get_device(device_id).map_err(|e| e.to_string())?;
    let client = device.get_iaudioclient().map_err(|e| e.to_string())?;
    let mut formats = Vec::new();
    for rate in PROBE_RATES {
        for (bits, valid) in PROBE_LAYOUTS {
            let wanted = WaveFormat::new(bits as usize, valid as usize, &SampleType::Int, rate as usize, 2, None);
            let exclusive = client.is_supported_exclusive_with_quirks(&wanted).is_ok();
            formats.push(FormatProbe { rate, bits, valid_bits: valid, exclusive });
        }
    }
    Ok(formats)
}
