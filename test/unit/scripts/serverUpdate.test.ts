import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// test/unit/scripts/serverUpdate.test.ts
// The server's auto-update: when it restarts, and that it never overwrites local work.

const require = createRequire(import.meta.url);
const { planServerUpdate, needsInstall, runUpdateRound } = require('../../../scripts/serverUpdate.cjs') as typeof import('../../../scripts/serverUpdate.cjs');

describe('planServerUpdate', () => {
    it('does nothing when the services run the checkout and the remote has nothing new', () => {
        expect(planServerUpdate({ behind: 0, dirty: false, head: 'a', runningCommit: 'a' })).toEqual({ action: 'none' });
    });

    it('restarts when the checkout moved on (a local commit) while the services still run the old one', () => {
        expect(planServerUpdate({ behind: 0, dirty: false, head: 'b', runningCommit: 'a' })).toEqual({ action: 'restart' });
    });

    it('merges and restarts when the remote is ahead and the tree is clean', () => {
        expect(planServerUpdate({ behind: 2, dirty: false, head: 'a', runningCommit: 'a' })).toEqual({ action: 'merge-and-restart' });
    });

    it('skips, with a reason, when the remote is ahead but there are uncommitted changes', () => {
        const plan = planServerUpdate({ behind: 1, dirty: true, head: 'a', runningCommit: 'a' });
        expect(plan.action).toBe('skip');
        expect(plan.reason).toMatch(/uncommitted/);
    });
});

describe('needsInstall', () => {
    it('is true only when the dependency files changed', () => {
        expect(needsInstall(['src/App.tsx', 'package-lock.json'])).toBe(true);
        expect(needsInstall(['package.json\r'])).toBe(true);
        expect(needsInstall(['src/App.tsx', 'docs/x.md'])).toBe(false);
    });
});

/** A fake git whose answers are set per command. */
const fakeGit = (answers: Record<string, { ok?: boolean; out?: string }>) => {
    const calls: string[] = [];
    const git = (args: string[]) => {
        const key = args.join(' ');
        calls.push(key);
        const hit = Object.entries(answers).find(([prefix]) => key.startsWith(prefix));
        return { ok: hit?.[1].ok ?? true, out: hit?.[1].out ?? '' };
    };
    return { git, calls };
};

describe('runUpdateRound', () => {
    const base = {
        'fetch origin': {},
        'rev-parse HEAD': { out: 'a'.repeat(40) },
        'rev-list --count': { out: '0' },
        'status --porcelain': { out: '' },
    };

    it('does nothing and restarts nothing when up to date', () => {
        const { git } = fakeGit(base);
        expect(runUpdateRound({ git, branch: 'stage-remote', runningCommit: 'a'.repeat(40), install: () => true })).toEqual({ restart: false, commit: 'a'.repeat(40) });
    });

    it('fast-forwards, reinstalls when the lockfile changed, then asks for a restart', () => {
        let head = 'a'.repeat(40);
        const calls: string[] = [];
        const git = (args: string[]) => {
            const key = args.join(' ');
            calls.push(key);
            if (key.startsWith('rev-parse HEAD')) return { ok: true, out: head };
            if (key.startsWith('rev-list --count')) return { ok: true, out: '1' };
            if (key.startsWith('merge --ff-only')) { head = 'b'.repeat(40); return { ok: true, out: '' }; }
            if (key.startsWith('diff --name-only')) return { ok: true, out: 'src/App.tsx\npackage-lock.json\n' };
            return { ok: true, out: '' };
        };
        let installed = 0;
        const result = runUpdateRound({ git, branch: 'stage-remote', runningCommit: 'a'.repeat(40), install: () => { installed += 1; return true; } });
        expect(result).toEqual({ restart: true, commit: 'b'.repeat(40) });
        expect(installed).toBe(1);
        expect(calls).toContain('merge --ff-only origin/stage-remote');
    });

    it('leaves the running services alone when the install fails', () => {
        let head = 'a'.repeat(40);
        const git = (args: string[]) => {
            const key = args.join(' ');
            if (key.startsWith('rev-parse HEAD')) return { ok: true, out: head };
            if (key.startsWith('rev-list --count')) return { ok: true, out: '1' };
            if (key.startsWith('merge --ff-only')) { head = 'b'.repeat(40); return { ok: true, out: '' }; }
            if (key.startsWith('diff --name-only')) return { ok: true, out: 'package-lock.json' };
            return { ok: true, out: '' };
        };
        expect(runUpdateRound({ git, branch: 'x', runningCommit: 'a'.repeat(40), install: () => false })).toEqual({ restart: false, commit: 'a'.repeat(40) });
    });

    it('does not merge over uncommitted changes', () => {
        const { git, calls } = fakeGit({ ...base, 'rev-list --count': { out: '3' }, 'status --porcelain': { out: ' M src/App.tsx' } });
        const logs: string[] = [];
        const result = runUpdateRound({ git, branch: 'stage-remote', runningCommit: 'a'.repeat(40), install: () => true, log: (l: string) => logs.push(l) });
        expect(result.restart).toBe(false);
        expect(calls.some((c) => c.startsWith('merge'))).toBe(false);
        expect(logs[0]).toMatch(/uncommitted/);
    });

    it('survives an unreachable remote', () => {
        const { git } = fakeGit({ 'fetch origin': { ok: false, out: 'fatal: unable to access' } });
        expect(runUpdateRound({ git, branch: 'stage-remote', runningCommit: 'a'.repeat(40), install: () => true })).toEqual({ restart: false, commit: 'a'.repeat(40) });
    });
});
