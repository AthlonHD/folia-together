'use strict';

// electron/audioHelper/helperProcess.cjs
// Owns the folia-audio-helper child process: spawns it on demand, speaks its line-delimited JSON protocol,
// and forwards its events. The helper is the only thing that touches the WASAPI endpoint in pass-through mode.

const { spawn } = require('child_process');

const REQUEST_TIMEOUT_MS = 8000;
const KILL_GRACE_MS = 1500;

/**
 * @param {{ resolveExecutable: () => string | null, onEvent: (event: object) => void, args?: string[] }} options
 *   `args` is what the executable is started with; tests substitute a stand-in script for the real helper.
 */
function createAudioHelperProcess({ resolveExecutable, onEvent, args = ['serve'] }) {
    let child = null;
    let stdoutBuffer = '';
    let lastConfigure = null;
    /** replyKey -> { resolve, reject, timer } */
    const waiters = new Map();

    const waiterKeyOf = (event) => {
        if (event.event === 'devices') return 'devices';
        if (event.event === 'probe') return `probe:${event.deviceId}`;
        return null;
    };

    const settle = (key, fn) => {
        const waiter = waiters.get(key);
        if (!waiter) return;
        clearTimeout(waiter.timer);
        waiters.delete(key);
        fn(waiter);
    };

    const handleLine = (line) => {
        let event;
        try {
            event = JSON.parse(line);
        } catch {
            console.warn('[AudioHelper] unparseable line from helper:', line);
            return;
        }
        const key = waiterKeyOf(event);
        if (key) settle(key, (waiter) => waiter.resolve(event));
        // A failed request has no reply event of its own, only an error: fail whatever is waiting on it.
        if (event.event === 'error' && (event.code === 'devices-failed' || event.code === 'probe-failed')) {
            const failKey = event.code === 'devices-failed'
                ? 'devices'
                : [...waiters.keys()].find((k) => k.startsWith('probe:'));
            if (failKey) settle(failKey, (waiter) => waiter.reject(new Error(event.message)));
        }
        onEvent(event);
    };

    const write = (command) => {
        if (!child || !child.stdin.writable) return false;
        child.stdin.write(`${JSON.stringify(command)}\n`);
        return true;
    };

    const start = () => {
        if (child) return true;
        const executable = resolveExecutable();
        if (!executable) return false;
        const proc = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        child = proc;
        stdoutBuffer = '';
        proc.stdout.setEncoding('utf8');
        proc.stdout.on('data', (chunk) => {
            stdoutBuffer += chunk;
            let newline = stdoutBuffer.indexOf('\n');
            while (newline >= 0) {
                const line = stdoutBuffer.slice(0, newline).trim();
                stdoutBuffer = stdoutBuffer.slice(newline + 1);
                if (line) handleLine(line);
                newline = stdoutBuffer.indexOf('\n');
            }
        });
        proc.stderr.setEncoding('utf8');
        proc.stderr.on('data', (text) => console.warn('[AudioHelper] stderr:', text.trim()));
        proc.on('error', (error) => {
            console.error('[AudioHelper] failed to run helper', error);
        });
        proc.on('exit', (code, signal) => {
            console.warn(`[AudioHelper] helper exited code=${code} signal=${signal}`);
            if (child === proc) child = null;
            for (const key of [...waiters.keys()]) settle(key, (waiter) => waiter.reject(new Error('helper exited')));
            onEvent({ event: 'exit', code, signal });
        });
        if (lastConfigure) write(lastConfigure);
        return true;
    };

    /** The page may ask for the same thing twice at once (two refreshes); one question to the helper answers both. */
    const inFlight = new Map();

    const request = (command, replyKey) => {
        const pending = inFlight.get(replyKey);
        if (pending) return pending;
        const promise = new Promise((resolve, reject) => {
            if (!start()) {
                reject(new Error('audio helper is not available'));
                return;
            }
            const timer = setTimeout(() => {
                waiters.delete(replyKey);
                reject(new Error(`audio helper did not answer ${command.cmd}`));
            }, REQUEST_TIMEOUT_MS);
            waiters.set(replyKey, { resolve, reject, timer });
            write(command);
        }).finally(() => inFlight.delete(replyKey));
        inFlight.set(replyKey, promise);
        return promise;
    };

    return {
        isAvailable: () => Boolean(resolveExecutable()),
        isRunning: () => Boolean(child),
        devices: () => request({ cmd: 'devices' }, 'devices').then((event) => event.devices),
        probe: (deviceId) => request({ cmd: 'probe', deviceId }, `probe:${deviceId}`).then((event) => event.formats),
        configure: (config) => {
            lastConfigure = { cmd: 'configure', ...config };
            if (!start()) return false;
            return write(lastConfigure);
        },
        send: (command) => start() && write(command),
        sendIfRunning: (command) => Boolean(child) && write(command),
        stop: () => new Promise((resolve) => {
            const proc = child;
            if (!proc) {
                resolve();
                return;
            }
            const timer = setTimeout(() => proc.kill(), KILL_GRACE_MS);
            proc.once('exit', () => {
                clearTimeout(timer);
                resolve();
            });
            write({ cmd: 'quit' });
        }),
    };
}

module.exports = { createAudioHelperProcess };
