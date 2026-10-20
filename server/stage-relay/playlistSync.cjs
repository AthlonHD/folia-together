'use strict';

// server/stage-relay/playlistSync.cjs
// Keeps the cross-platform playlists of a "sync group" for the devices that joined it (see src/components/app/crossPlaylist).
//
// A group is a random id and a random secret the first device made; the server keeps only a hash of the secret and the playlists.
// A second device joins with a short code: the first one asks for a code (`/pair`), which holds the secret in memory for a few minutes
// and is used once (`/redeem`). After that every device calls `/groups/:id` with the secret in `Authorization: Bearer`, and the server
// merges what it sends into what it has - the playlist that changed later wins whole, a deleted playlist stays as a mark - and answers
// with the merged set, so devices that sync in turn arrive at the same playlists.
//
// There is no stage token here on purpose: a browser that plays on its own has none. What is guarded instead is the group secret
// (the hash is compared in constant time), the sizes (a body, a group, the number of groups), and the guesses at a code (limited as a whole).
// The playlists are kept as they are sent, in plain JSON: the server is the owner's own.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const GROUP_ID = /^[0-9a-f]{32}$/;
const SECRET = /^[0-9a-f]{64}$/;
// No 0 / O / 1 / I / L: a code is read off one screen and typed on another.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 8;
const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_GROUP_BYTES = 8 * 1024 * 1024;
const MAX_GROUPS = 500;
const MAX_PLAYLISTS = 500;
const CREATE_WINDOW_MS = 60 * 60 * 1000;
const CREATE_LIMIT = 20;
const GUESS_WINDOW_MS = 60 * 1000;
const GUESS_LIMIT = 15;

const sha256 = (text) => crypto.createHash('sha256').update(String(text)).digest('hex');
const sameHash = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** Playlists as devices send them: only what the merge needs is checked; the rest is kept as sent. */
const cleanPlaylists = (value) => {
  if (!Array.isArray(value) || value.length > MAX_PLAYLISTS) return null;
  const seen = new Set();
  const playlists = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    if (typeof item.id !== 'string' || !item.id || item.id.length > 120 || seen.has(item.id)) return null;
    if (typeof item.updatedAt !== 'number' || !Number.isFinite(item.updatedAt)) return null;
    if (!Array.isArray(item.entries)) return null;
    seen.add(item.id);
    playlists.push(item);
  }
  return playlists;
};

/** The later change of a playlist wins whole; a playlist only one side has is kept. */
const mergeLists = (stored, incoming) => {
  const byId = new Map(stored.map((playlist) => [playlist.id, playlist]));
  for (const playlist of incoming) {
    const existing = byId.get(playlist.id);
    if (!existing || playlist.updatedAt > existing.updatedAt) byId.set(playlist.id, playlist);
  }
  return [...byId.values()];
};

/**
 * @param {{ dataDir: string, now?: () => number }} options
 * @returns {{ handle: (req, res, requestUrl: URL) => Promise<boolean> }}
 */
function createPlaylistSync({ dataDir, now = () => Date.now() }) {
  const groupFile = (id) => path.join(dataDir, `${id}.json`);
  /** code -> { groupId, secret, expiresAt } (memory only: a restart ends the codes). */
  const codes = new Map();
  const createTimes = [];
  const guessTimes = [];

  const send = (res, status, payload) => {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  };

  const readJson = (req) => new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(Object.assign(new Error('bad json'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });

  const readGroup = (id) => {
    try {
      return JSON.parse(fs.readFileSync(groupFile(id), 'utf8'));
    } catch {
      return null;
    }
  };

  const writeGroup = (id, group) => {
    const text = JSON.stringify(group);
    if (Buffer.byteLength(text) > MAX_GROUP_BYTES) return false;
    fs.mkdirSync(dataDir, { recursive: true });
    const temp = `${groupFile(id)}.${process.pid}.tmp`;
    fs.writeFileSync(temp, text, { mode: 0o600 });
    fs.renameSync(temp, groupFile(id));
    return true;
  };

  const countGroups = () => {
    try {
      return fs.readdirSync(dataDir).filter((name) => name.endsWith('.json')).length;
    } catch {
      return 0;
    }
  };

  const within = (times, windowMs) => {
    const t = now();
    while (times.length > 0 && t - times[0] > windowMs) times.shift();
    return times;
  };

  const bearerOf = (req) => {
    const header = String(req.headers.authorization || '');
    return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  };

  /** The group the request is about, when its secret is right; otherwise null (and the answer is already sent). */
  const authorize = (req, res, groupId) => {
    if (!GROUP_ID.test(groupId)) {
      send(res, 400, { error: 'Bad group id.' });
      return null;
    }
    const group = readGroup(groupId);
    const secret = bearerOf(req);
    // The same answer for a group that is not there and a secret that is wrong: nothing tells which groups exist.
    if (!group || !SECRET.test(secret) || !sameHash(sha256(secret), group.secretHash)) {
      send(res, 401, { error: 'Unknown group or wrong secret.' });
      return null;
    }
    return group;
  };

  const newCode = () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      let code = '';
      const bytes = crypto.randomBytes(CODE_LENGTH);
      for (let i = 0; i < CODE_LENGTH; i += 1) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
      if (!codes.has(code)) return code;
    }
    return null;
  };

  const sweepCodes = () => {
    const t = now();
    for (const [code, entry] of codes) if (entry.expiresAt <= t) codes.delete(code);
  };

  const handle = async (req, res, requestUrl) => {
    const { pathname } = requestUrl;
    if (!pathname.startsWith('/stage/sync/')) return false;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '600',
      });
      res.end();
      return true;
    }

    try {
      if (pathname === '/stage/sync/ping' && req.method === 'GET') {
        send(res, 200, { ok: true, playlistSync: 1 });
        return true;
      }

      // A device makes a group.
      if (pathname === '/stage/sync/groups' && req.method === 'POST') {
        const body = await readJson(req);
        if (!GROUP_ID.test(String(body.groupId)) || !SECRET.test(String(body.secret))) {
          send(res, 400, { error: 'Bad group id or secret.' });
          return true;
        }
        if (within(createTimes, CREATE_WINDOW_MS).length >= CREATE_LIMIT || countGroups() >= MAX_GROUPS) {
          send(res, 429, { error: 'Too many groups.' });
          return true;
        }
        if (readGroup(body.groupId)) {
          send(res, 409, { error: 'The group exists.' });
          return true;
        }
        createTimes.push(now());
        writeGroup(body.groupId, { secretHash: sha256(body.secret), revision: 0, updatedAt: now(), playlists: [] });
        send(res, 201, { ok: true });
        return true;
      }

      // The first device asks for a code to hand its group to another device.
      if (pathname === '/stage/sync/pair' && req.method === 'POST') {
        const body = await readJson(req);
        const groupId = String(body.groupId || '');
        if (!authorize(req, res, groupId)) return true;
        sweepCodes();
        const code = newCode();
        if (!code) {
          send(res, 503, { error: 'No code available, try again.' });
          return true;
        }
        codes.set(code, { groupId, secret: bearerOf(req), expiresAt: now() + CODE_TTL_MS });
        send(res, 200, { code, expiresInSec: Math.round(CODE_TTL_MS / 1000) });
        return true;
      }

      // The other device gives the code and gets the group back. A code works once.
      if (pathname === '/stage/sync/redeem' && req.method === 'POST') {
        if (within(guessTimes, GUESS_WINDOW_MS).length >= GUESS_LIMIT) {
          send(res, 429, { error: 'Too many wrong codes, try again in a minute.' });
          return true;
        }
        const body = await readJson(req);
        const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        sweepCodes();
        const entry = codes.get(code);
        if (!entry) {
          guessTimes.push(now());
          send(res, 404, { error: 'This code is wrong or has expired.' });
          return true;
        }
        codes.delete(code);
        send(res, 200, { groupId: entry.groupId, secret: entry.secret });
        return true;
      }

      const match = /^\/stage\/sync\/groups\/([0-9a-f]{32})$/.exec(pathname);
      if (match) {
        const groupId = match[1];
        const group = authorize(req, res, groupId);
        if (!group) return true;

        if (req.method === 'GET') {
          send(res, 200, { revision: group.revision, updatedAt: group.updatedAt, playlists: group.playlists });
          return true;
        }

        if (req.method === 'POST') {
          const body = await readJson(req);
          const incoming = cleanPlaylists(body.playlists);
          if (!incoming) {
            send(res, 400, { error: 'Bad playlists.' });
            return true;
          }
          const merged = mergeLists(group.playlists, incoming);
          if (merged.length > MAX_PLAYLISTS) {
            send(res, 413, { error: 'Too many playlists.' });
            return true;
          }
          const changed = JSON.stringify(merged) !== JSON.stringify(group.playlists);
          const next = changed ? { ...group, revision: group.revision + 1, updatedAt: now(), playlists: merged } : group;
          if (changed && !writeGroup(groupId, next)) {
            send(res, 413, { error: 'The group is too large.' });
            return true;
          }
          send(res, 200, { revision: next.revision, updatedAt: next.updatedAt, playlists: next.playlists });
          return true;
        }

        if (req.method === 'DELETE') {
          try {
            fs.unlinkSync(groupFile(groupId));
          } catch { /* already gone */ }
          send(res, 200, { ok: true });
          return true;
        }
      }

      send(res, 404, { error: 'Not found.' });
      return true;
    } catch (error) {
      const status = error && typeof error.status === 'number' ? error.status : 500;
      send(res, status, { error: status === 500 ? 'Sync failed.' : String(error.message) });
      return true;
    }
  };

  return { handle };
}

module.exports = { createPlaylistSync, mergeLists, CODE_TTL_MS, CODE_ALPHABET, CODE_LENGTH };
