'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { NETWORKS, validSnapshot, validHistory, combineHistory, coverageFor, scanNews, newsView, emptyView } = require('./pulse-projects');

const INTERVAL_MS = 15 * 60_000;
const MAX_ENVELOPE_BYTES = 512 * 1024;
const PUBLICATION_SCHEMA_VERSION = 1;
const NETWORK_IDS = Object.keys(NETWORKS);
const EMPTY_SUCCESS = Object.freeze(Object.fromEntries(NETWORK_IDS.map(chain => [chain, null])));
const ATTEMPT_STATES = new Set(['CHECKING', 'CHECKED', 'FAILED']);

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function isoTime(value) {
  if (typeof value !== 'string') return NaN;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value ? epoch : NaN;
}

function validPublication(state, now) {
  const v4 = state?.schemaVersion === 2;
  const keys = ['schemaVersion', 'attempt', 'attemptedAt', 'nextAttemptAt', 'lastSuccessfulAt', 'snapshot', 'lastVerifiedSnapshot'];
  if (!exactKeys(state, v4 ? [...keys, 'history'] : keys) ||
      (!v4 && state.schemaVersion !== PUBLICATION_SCHEMA_VERSION) || !ATTEMPT_STATES.has(state.attempt) ||
      !exactKeys(state.lastSuccessfulAt, NETWORK_IDS)) return false;
  const attempted = isoTime(state.attemptedAt);
  if (!Number.isFinite(attempted) || attempted > now || isoTime(state.nextAttemptAt) !== attempted + INTERVAL_MS) return false;
  if (!NETWORK_IDS.every(chain => {
    const value = state.lastSuccessfulAt[chain];
    return value === null || isoTime(value) <= attempted;
  })) return false;
  return (!v4 || state.history === null || validHistory(state.history, state.attemptedAt)) &&
    (state.attempt !== 'CHECKED' || state.snapshot?.checkedAt === state.attemptedAt) &&
    [state.snapshot, state.lastVerifiedSnapshot].every(snapshot => snapshot === null ||
      (validSnapshot(snapshot) && isoTime(snapshot.checkedAt) <= attempted));
}

function unpack(envelope, key, now = Date.now()) {
  try {
    if (!exactKeys(envelope, ['payload', 'signature']) || typeof envelope.payload !== 'string' ||
        !envelope.payload || Buffer.byteLength(envelope.payload) > MAX_ENVELOPE_BYTES ||
        typeof envelope.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature) || !key ||
        !crypto.verify(null, Buffer.from(envelope.payload), key, Buffer.from(envelope.signature, 'base64'))) return null;
    const state = JSON.parse(envelope.payload);
    return validPublication(state, now) ? state : null;
  } catch {
    return null;
  }
}

function configured(env = process.env) {
  const root = env.ARC_PULSE_EDITION_DIR || env.ARC_HOLDER_PUBLISHED_DIR;
  return env.ARC_PULSE_NEWS_ENABLED !== '0' && Boolean(root && path.isAbsolute(root) &&
    (env.ARC_PULSE_SIGNING_KEY || env.ARC_HOLDER_SIGNING_KEY));
}

async function atomicWrite(file, envelope) {
  const body = JSON.stringify(envelope);
  if (Buffer.byteLength(body) > MAX_ENVELOPE_BYTES) throw Error('PULSE_NEWS_SNAPSHOT_TOO_LARGE');
  const pending = file + '.pending';
  try {
    const output = await fs.open(pending, 'w', 0o600);
    try {
      await output.writeFile(body);
      await output.sync();
    } finally {
      await output.close();
    }
    await fs.rename(pending, file);
    if (process.platform !== 'win32') {
      const directory = await fs.open(path.dirname(file), 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
  } finally {
    await fs.unlink(pending).catch(() => {});
  }
}

function createStore({ env = process.env, now = Date.now, scan = scanNews } = {}) {
  let running = null;
  let checkAgainAt = 0;
  const file = (name = 'pulse-news.v2.json') => path.join(env.ARC_PULSE_EDITION_DIR || env.ARC_HOLDER_PUBLISHED_DIR, name);
  const signingKey = () => env.ARC_PULSE_SIGNING_KEY || env.ARC_HOLDER_SIGNING_KEY;

  async function readFile(key, at, filename) {
    if (!configured(env)) return null;
    let handle;
    try {
      handle = await fs.open(filename, 'r');
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_ENVELOPE_BYTES) return null;
      const envelope = JSON.parse(await handle.readFile('utf8'));
      const state = unpack(envelope, key, at);
      return state ? { envelope, state } : null;
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async function read(key, at) {
    return await readFile(key, at, file()) || await readFile(key, at, file('pulse-news.v1.json'));
  }

  async function latest({ legacy = false } = {}) {
    if (!configured(env)) return null;
    try {
      const key = crypto.createPublicKey(signingKey()), at = now();
      const saved = legacy ? await readFile(key, at, file('pulse-news.v1.json')) : await read(key, at);
      return saved?.envelope ?? null;
    } catch {
      return null;
    }
  }

  async function refreshIfDue({ fetcher = fetch } = {}) {
    if (!configured(env)) return null;
    if (running) return running;
    const checkedAt = now();
    if (checkedAt < checkAgainAt) return null;
    checkAgainAt = checkedAt + INTERVAL_MS;
    running = (async () => {
      try {
        const key = signingKey();
        const previous = (await read(crypto.createPublicKey(key), checkedAt))?.state;
        if (previous && isoTime(previous.nextAttemptAt) > checkedAt) {
          checkAgainAt = isoTime(previous.nextAttemptAt);
          return null;
        }
        const save = async state => {
          if (!validPublication(state, checkedAt)) throw Error('PULSE_NEWS_INVALID_SNAPSHOT');
          const payload = JSON.stringify(state);
          await atomicWrite(file(), { payload, signature: crypto.sign(null, Buffer.from(payload), key).toString('base64') });
        };
        const reservation = {
          schemaVersion: 2,
          attempt: previous?.attempt === 'FAILED' ? 'FAILED' : 'CHECKING',
          attemptedAt: new Date(checkedAt).toISOString(),
          nextAttemptAt: new Date(checkAgainAt).toISOString(),
          lastSuccessfulAt: previous?.lastSuccessfulAt || EMPTY_SUCCESS,
          snapshot: previous?.snapshot || null,
          lastVerifiedSnapshot: previous?.lastVerifiedSnapshot || null,
          history: previous?.history ?? null,
        };
        // Arm the global scan throttle before making any publisher requests. A restart reuses this deadline.
        await fs.mkdir(path.dirname(file()), { recursive: true });
        await save(reservation);
        let snapshot;
        try {
          snapshot = await scan({ fetcher, now: checkedAt, cooldowns: reservation.snapshot?.cooldowns || {} });
          if (!validSnapshot(snapshot) || snapshot.checkedAt !== reservation.attemptedAt) {
            throw Error('PULSE_NEWS_INVALID_SNAPSHOT');
          }
        } catch (error) {
          await save({ ...reservation, attempt: 'FAILED' });
          throw error;
        }
        const success = Object.fromEntries(NETWORK_IDS.map(chain => [chain, coverageFor(snapshot, chain).checked > 0
          ? snapshot.checkedAt : reservation.lastSuccessfulAt[chain]]));
        const sourcesChecked = snapshot.sources.filter(source => source.state === 'CHECKED').length;
        const lastVerifiedSnapshot = sourcesChecked ? null : reservation.lastVerifiedSnapshot ||
          (reservation.snapshot?.sources.some(source => source.state === 'CHECKED') ? reservation.snapshot : null);
        const seed = reservation.history || (reservation.snapshot ? combineHistory(null, reservation.snapshot) : null);
        const history = combineHistory(seed, snapshot);
        await save({ ...reservation, attempt: 'CHECKED', lastSuccessfulAt: success, snapshot, lastVerifiedSnapshot, history });
        return { state: 'CHECKED', checkedAt: snapshot.checkedAt,
          sourcesChecked, sourcesAttempted: snapshot.sources.length, requests: snapshot.requests };
      } catch {
        return { state: 'FAILED', reasonCode: 'PULSE_NEWS_REFRESH_FAILED' };
      }
    })().finally(() => { running = null; });
    return running;
  }

  return { latest, refreshIfDue };
}

function origin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.origin : null;
  } catch {
    return null;
  }
}

function createClient({ env = process.env, now = Date.now, fetcher = (...args) => fetch(...args) } = {}) {
  let cached = null;
  let pending = null;
  let kickAfter = 0;

  async function request(host, endpoint, options = {}) {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve(null); }, 1800);
    });
    const work = (async () => {
      const response = await fetcher(new URL(endpoint, host), {
        ...options, redirect: 'error', signal: controller.signal, cache: 'no-store'
      });
      if (options.method === 'POST') {
        await response.body?.cancel();
        return null;
      }
      return response.ok ? require('../search/server/lib/http').readJson(response, MAX_ENVELOPE_BYTES) : null;
    })();
    try {
      return await Promise.race([work, deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function read() {
    const host = origin(env.ARC_PULSE_PUBLISHED_URL || env.ARC_HOLDER_PUBLISHED_URL || env.ARC_HOLDER_QUEUE_URL);
    const key = env.ARC_PULSE_PUBLIC_KEY || env.ARC_HOLDER_PUBLIC_KEY;
    if (!host || !key) return null;
    if (cached?.host === host && cached.key === key && cached.until > now()) return cached.value;
    if (pending?.host === host && pending.key === key) return pending.promise;
    const previous = cached?.host === host && cached.key === key ? cached.value : null;
    const promise = (async () => {
      let value = null;
      try {
        value = unpack(await request(host, '/pulse/news/latest?schema=2'), key, now());
      } catch {}
      const result = { state: value || previous?.state || null, reachable: Boolean(value) };
      cached = { host, key, until: now() + (value ? 30_000 : 15_000), value: result };
      return result;
    })().finally(() => { if (pending?.promise === promise) pending = null; });
    pending = { host, key, promise };
    return promise;
  }

  async function kick() {
    const host = origin(env.ARC_PULSE_QUEUE_URL || env.ARC_HOLDER_QUEUE_URL);
    const token = env.ARC_PULSE_QUEUE_TOKEN || env.ARC_HOLDER_QUEUE_TOKEN;
    if (!host || !token || now() < kickAfter) return;
    kickAfter = now() + INTERVAL_MS;
    try {
      await request(host, '/pulse/news/refresh', { method: 'POST', headers: { authorization: 'Bearer ' + token } });
    } catch {}
  }

  return async function latestNews(chain) {
    const loaded = await read();
    const state = loaded?.state;
    const checkedAt = state?.snapshot?.checkedAt ?? null;
    const lastSuccessfulAt = state?.lastSuccessfulAt[chain] ?? null;
    if (loaded?.reachable && state.snapshot && state.attempt !== 'FAILED') {
      const view = newsView(state.snapshot, chain, { now: now(), lastSuccessfulAt, history: state.history });
      if (isoTime(state.nextAttemptAt) <= now()) await kick();
      return view;
    }
    if (!state || isoTime(state.nextAttemptAt) <= now()) await kick();
    return emptyView(chain, { now: now(), checkedAt, lastSuccessfulAt,
      reasonCode: 'SOURCE_COVERAGE_UNAVAILABLE', freshness: checkedAt ? 'STALE' : 'UNAVAILABLE' });
  };
}

const worker = createStore();
module.exports = { INTERVAL_MS, MAX_ENVELOPE_BYTES, configured, unpack, createStore, createClient, worker, latestNews: createClient() };
