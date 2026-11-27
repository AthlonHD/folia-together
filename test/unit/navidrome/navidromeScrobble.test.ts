import { describe, expect, it } from 'vitest';
import {
    getNavidromeScrobbleThresholdSeconds,
    NavidromeScrobbleSessionTracker,
    type NavidromeScrobbleReport,
} from '@/utils/navidromeScrobble';

// test/unit/navidrome/navidromeScrobble.test.ts
// Verifies Navidrome playback-report session dedupe and threshold behavior.

describe('NavidromeScrobbleSessionTracker', () => {
    it('submits a song parked by a deck handoff once that deck crosses the line', () => {
        const reports: NavidromeScrobbleReport[] = [];
        const tracker = new NavidromeScrobbleSessionTracker(report => reports.push(report));

        tracker.startSession('song-1', 120_000);
        tracker.handlePlaybackStart(10);
        tracker.parkCurrent();
        tracker.startSession('song-2', 180_000);
        tracker.handlePlaybackStart(0);
        tracker.progressParked(56);
        expect(reports.filter(report => report.kind === 'submission')).toEqual([]);

        tracker.progressParked(60);
        tracker.progressParked(90);
        expect(reports.filter(report => report.kind === 'submission').map(report => report.songId)).toEqual(['song-1']);
        expect(tracker.getCurrentSongId()).toBe('song-2');
    });

    it('does not submit a parked song that stops before the line', () => {
        const reports: NavidromeScrobbleReport[] = [];
        const tracker = new NavidromeScrobbleSessionTracker(report => reports.push(report));

        tracker.startSession('song-1', 120_000);
        tracker.parkCurrent();
        tracker.startSession('song-2', 120_000);
        tracker.progressParked(50);
        tracker.dropParked();
        tracker.progressParked(80);
        expect(reports.filter(report => report.kind === 'submission')).toEqual([]);
    });

    it('uses half duration capped at 60 seconds for the submission threshold', () => {
        expect(getNavidromeScrobbleThresholdSeconds(240_000)).toBe(60);
        expect(getNavidromeScrobbleThresholdSeconds(80_000)).toBe(40);
        expect(getNavidromeScrobbleThresholdSeconds(0)).toBe(60);
    });

    it('reports now playing once and submission once per playback session', () => {
        const reports: NavidromeScrobbleReport[] = [];
        const tracker = new NavidromeScrobbleSessionTracker(report => reports.push(report));

        tracker.startSession('song-1', 120_000);
        tracker.handlePlaybackStart(0);
        tracker.handlePlaybackStart(10);
        tracker.handleProgress(59.9);
        tracker.handleProgress(60);
        tracker.handleProgress(90);

        expect(reports.map(report => report.kind)).toEqual(['now-playing', 'submission']);
        expect(reports.every(report => report.songId === 'song-1')).toBe(true);
        expect(new Set(reports.map(report => report.sessionId)).size).toBe(1);
    });

    it('allows the same song to report again after a new playback session starts', () => {
        const reports: NavidromeScrobbleReport[] = [];
        const tracker = new NavidromeScrobbleSessionTracker(report => reports.push(report));

        tracker.startSession('song-1', 20_000);
        tracker.handlePlaybackStart(0);
        tracker.handleProgress(10);
        tracker.startSession('song-1', 20_000);
        tracker.handlePlaybackStart(0);
        tracker.handleProgress(10);

        expect(reports.map(report => report.kind)).toEqual([
            'now-playing',
            'submission',
            'now-playing',
            'submission',
        ]);
        expect(reports[0].sessionId).not.toBe(reports[2].sessionId);
    });
});
