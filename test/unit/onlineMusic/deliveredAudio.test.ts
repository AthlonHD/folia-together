import { describe, expect, it } from 'vitest';
import type { SongResult } from '@/types';
import { describeDeliveredAudio, getDeliveredAudio, isDowngraded, noteDeliveredAudio } from '@/services/onlineMusic/deliveredAudio';

// test/unit/onlineMusic/deliveredAudio.test.ts
// 本 Fork:播放条显示平台实际给的音质;比用户所选低时标为降级。

const song = (id: string) => ({ id, name: id, sourceRef: { kind: 'online', providerId: 'netease', mediaId: id } }) as unknown as SongResult;

describe('the quality that is actually playing', () => {
    it('is kept per song, with the quality the listener chose', () => {
        noteDeliveredAudio(song('1'), 'hires', { level: 'lossless', codec: 'FLAC' });
        expect(getDeliveredAudio(song('1'))).toEqual({ level: 'lossless', codec: 'FLAC', requested: 'hires' });
        expect(getDeliveredAudio(song('2'))).toBeUndefined();
    });

    it('is a downgrade only when the level is known and lower than the one chosen', () => {
        expect(isDowngraded({ level: 'high', requested: 'hires' })).toBe(true);
        expect(isDowngraded({ level: 'hires', requested: 'hires' })).toBe(false);
        expect(isDowngraded({ requested: 'hires' })).toBe(false);
    });

    it('is described the way a listener reads it', () => {
        expect(describeDeliveredAudio({ level: 'hires', codec: 'FLAC' })).toBe('Hi-Res · FLAC');
        expect(describeDeliveredAudio({ level: 'lossless', codec: 'FLAC' })).toBe('Lossless · FLAC');
        expect(describeDeliveredAudio({ level: 'high', codec: 'Ogg Vorbis', bitrateKbps: 320 })).toBe('Ogg Vorbis · 320k');
    });
});

describe('each platform lists the levels it really has', () => {
    it('offers NetEase its two tiers above Hi-Res, and asks the API for them by their own names', async () => {
        const { omni } = await import('@/services/onlineMusic/omni');
        expect(omni.getAudioQualityLevels('netease')).toContain('master');
        expect(omni.getAudioQualityLabel('netease', 'high')).toBe('320k');
        expect(omni.getAudioQualityLevels('qq')).toEqual(['standard', 'high', 'lossless']);
        expect(omni.resolveAudioQuality('qq', 'hires')).toBe('lossless');
        expect(omni.resolveAudioQuality('netease', 'master')).toBe('master');
    });
});
