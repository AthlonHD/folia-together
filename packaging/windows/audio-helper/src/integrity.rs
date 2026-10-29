// Conservative claims about steady PCM output; device internals and short de-click ramps are outside this scope.

pub fn supports_channels(channels: u32) -> bool {
    matches!(channels, 1 | 2)
}

pub fn steady_pcm_unchanged(
    source_rate: u32,
    source_bits: u32,
    source_channels: u32,
    codec: &str,
    output_rate: u32,
    output_valid_bits: u16,
    exclusive: bool,
) -> bool {
    let codec = codec.to_ascii_lowercase();
    let floating = ["f32", "f64", "float", "double"].iter().any(|name| codec.contains(name));
    exclusive && source_channels == 2 && (1..=32).contains(&source_bits)
        && !floating && source_rate > 0 && source_rate == output_rate
        && u32::from(output_valid_bits) >= source_bits
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_stereo_pcm_in_exclusive_mode_can_be_unchanged() {
        assert!(steady_pcm_unchanged(96000, 24, 2, "flac", 96000, 24, true));
        assert!(steady_pcm_unchanged(44100, 16, 2, "pcm_s16le", 44100, 24, true));
        assert!(!steady_pcm_unchanged(96000, 24, 2, "flac", 96000, 24, false));
        assert!(!steady_pcm_unchanged(96000, 24, 1, "flac", 96000, 24, true));
        assert!(!steady_pcm_unchanged(96000, 24, 6, "flac", 96000, 24, true));
        assert!(!steady_pcm_unchanged(48000, 0, 2, "mp3", 48000, 32, true));
        assert!(!steady_pcm_unchanged(48000, 32, 2, "pcm_f32le", 48000, 32, true));
        assert!(!steady_pcm_unchanged(48000, 64, 2, "pcm_f64le", 48000, 32, true));
        assert!(!steady_pcm_unchanged(96000, 24, 2, "flac", 48000, 24, true));
        assert!(!steady_pcm_unchanged(96000, 24, 2, "flac", 96000, 16, true));
    }

    #[test]
    fn surround_channels_are_rejected_instead_of_discarded() {
        assert!(supports_channels(1));
        assert!(supports_channels(2));
        for channels in [0, 3, 4, 6, 8] {
            assert!(!supports_channels(channels));
        }
    }
}
