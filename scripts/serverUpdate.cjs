'use strict';

// scripts/serverUpdate.cjs
// Keeps the Stage server on the same code as the repository's branch, so one push updates the server too (the desktop app updates from the
// release that CI builds from the same commit). Used by stage-all.cjs with --auto-update.
//
// The decision is a pure function of a few git facts; the git calls are injected so the decision and the steps are testable.

const SERVER_RELEVANT_LOCKFILES = ['package.json', 'package-lock.json'];

/**
 * @param {{ behind: number, dirty: boolean, head: string, runningCommit: string }} facts
 *   behind: commits on the remote branch that this checkout does not have; dirty: uncommitted changes to tracked files;
 *   head: this checkout's commit; runningCommit: the commit the services were started from.
 * @returns {{ action: 'none' | 'restart' | 'merge-and-restart' | 'skip', reason?: string }}
 */
function planServerUpdate({ behind, dirty, head, runningCommit }) {
    if (behind > 0) {
        // A fast-forward cannot clobber local work, but it can fail to apply over uncommitted edits to the same files.
        if (dirty) return { action: 'skip', reason: 'the checkout has uncommitted changes, so it was not updated' };
        return { action: 'merge-and-restart' };
    }
    if (head !== runningCommit) return { action: 'restart' };
    return { action: 'none' };
}

/** Whether the dependencies must be installed again between two commits. */
function needsInstall(changedFiles) {
    return changedFiles.some((file) => SERVER_RELEVANT_LOCKFILES.includes(file.trim()));
}

/**
 * One round of the update loop.
 * @param {{
 *   git: (args: string[]) => { ok: boolean, out: string },
 *   branch: string,
 *   runningCommit: string,
 *   log?: (line: string) => void,
 *   install: () => boolean,
 * }} io
 * @returns {{ restart: boolean, commit: string }}
 */
function runUpdateRound({ git, branch, runningCommit, log = () => {}, install }) {
    const fetched = git(['fetch', 'origin', branch]);
    if (!fetched.ok) {
        log(`could not reach the remote (${fetched.out.trim().split('\n').pop()})`);
        return { restart: false, commit: runningCommit };
    }
    const head = git(['rev-parse', 'HEAD']).out.trim();
    const behind = Number(git(['rev-list', '--count', `HEAD..origin/${branch}`]).out.trim()) || 0;
    const dirty = git(['status', '--porcelain', '--untracked-files=no']).out.trim().length > 0;
    const plan = planServerUpdate({ behind, dirty, head, runningCommit });

    if (plan.action === 'none') return { restart: false, commit: runningCommit };
    if (plan.action === 'skip') {
        log(`${behind} new commit(s) on ${branch}, but ${plan.reason}`);
        return { restart: false, commit: runningCommit };
    }
    if (plan.action === 'merge-and-restart') {
        const merged = git(['merge', '--ff-only', `origin/${branch}`]);
        if (!merged.ok) {
            log(`could not fast-forward to origin/${branch}: ${merged.out.trim().split('\n').pop()}`);
            return { restart: false, commit: runningCommit };
        }
    }
    const newHead = git(['rev-parse', 'HEAD']).out.trim();
    const changed = git(['diff', '--name-only', runningCommit, newHead]);
    if (changed.ok && needsInstall(changed.out.split('\n')) && !install()) {
        log('npm ci failed; the running services were left as they are');
        return { restart: false, commit: runningCommit };
    }
    log(`updating ${runningCommit.slice(0, 7)} -> ${newHead.slice(0, 7)}; restarting the services`);
    return { restart: true, commit: newHead };
}

module.exports = { planServerUpdate, needsInstall, runUpdateRound };
