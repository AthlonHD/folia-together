// Contract between the page and the Windows pass-through helper (electron/audioHelper, packaging/windows/audio-helper).

export type PassthroughRateStrategy = 'native' | 'fixed';

/** Which resampler converts the sample rate when the device cannot take the source's rate as is. */
export type PassthroughResampler = 'rubato' | 'soxr';

/** Exclusive bypasses the Windows mixer; shared goes through it at the endpoint's own format (for drivers that only pass shared streams on). */
export type PassthroughOutputMode = 'exclusive' | 'shared';

export interface PassthroughDevice {
    id: string;
    name: string;
    isDefault: boolean;
    mixRate: number | null;
    mixBits: number | null;
}

export interface PassthroughFormatProbe {
    rate: number;
    /** Container size in bits. */
    bits: number;
    validBits: number;
    exclusive: boolean;
    /** 32-bit IEEE float samples rather than integers. */
    float: boolean;
}

/** What the playback chain really is for the loaded track; the UI shows this, never a claim. */
export interface PassthroughChain {
    sourceRate: number;
    /** 0 for lossy codecs, which decode to float rather than a fixed depth. */
    sourceBits: number;
    sourceChannels: number;
    codec: string;
    deviceName: string;
    outputRate: number;
    outputBits: number;
    outputValidBits: number;
    exclusive: boolean;
    resampled: boolean;
    truncated: boolean;
    downmixed: boolean;
    bitPerfect: boolean;
    /** Which resampler made the conversion; absent when the rate was not converted. */
    resampler?: PassthroughResampler;
}

export type PassthroughHelperEvent =
    | { event: 'ready'; version: string }
    | { event: 'chain'; token: number; chain: PassthroughChain }
    | { event: 'state'; state: 'playing' | 'paused' | 'stopped' }
    | { event: 'position'; sec: number; durationSec: number; token: number; peakDb: number }
    | { event: 'ended'; token: number }
    | { event: 'error'; code: string; message: string }
    | { event: 'exit'; code: number | null; signal: string | null };

export type PassthroughSource =
    | { kind: 'url'; url: string }
    | { kind: 'bytes'; bytes: ArrayBuffer; ext?: string };

export interface PassthroughLoadRequest {
    source: PassthroughSource;
    startSec: number;
    autoplay: boolean;
    token: number;
}

export interface AudioHelperApi {
    getStatus: () => Promise<{ available: boolean; running: boolean }>;
    listDevices: () => Promise<{ ok: true; devices: PassthroughDevice[] } | { ok: false; error: string }>;
    probeDevice: (deviceId: string) => Promise<{ ok: true; formats: PassthroughFormatProbe[] } | { ok: false; error: string }>;
    configure: (config: { deviceId: string; rateStrategy: PassthroughRateStrategy; fixedRate: number; mode: PassthroughOutputMode; resampler: PassthroughResampler }) => Promise<boolean>;
    load: (request: PassthroughLoadRequest) => Promise<{ ok: true } | { ok: false; error: string }>;
    play: () => Promise<boolean>;
    pause: () => Promise<boolean>;
    seek: (sec: number) => Promise<boolean>;
    stop: () => Promise<boolean>;
    onEvent: (callback: (event: PassthroughHelperEvent) => void) => () => void;
}
