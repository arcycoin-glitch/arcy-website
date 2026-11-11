'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { parseMetricEvidence, isTrustedEvidence, STATES } = require('./metric-evidence');

const SCHEMA_VERSION = 1;
const MAX_ENTRIES = 256;
const MAX_TRANSITIONS = 12;
const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;
const STATE_SET = new Set(Object.values(STATES));
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const REASON_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

// The durable volume has one worker process. Serialize writes from all ledger instances in it.
const writers = new Map();

function fail(code) {
  return Object.assign(new Error(code), { code });
}

function evidenceKey({ network, token, metricId, scope }) {
  return JSON.stringify([network, token, metricId, scope]);
}

function hasKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function isTimestamp(value) {
  if (typeof value !== 'string' || !UTC_TIMESTAMP.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function validEntry(entry) {
  if (!hasKeys(entry, ['latestEvidence', 'historicalOnly', 'lastTrusted', 'previousTrusted', 'lastFailure', 'transitions']) ||
      typeof entry.historicalOnly !== 'boolean' || !Array.isArray(entry.transitions) ||
      entry.transitions.length === 0 || entry.transitions.length > MAX_TRANSITIONS) return false;

  const latest = parseMetricEvidence(entry.latestEvidence);
  const { lastTrusted, previousTrusted, lastFailure, transitions } = entry;
  const key = evidenceKey(latest);
  for (const trusted of [lastTrusted, previousTrusted]) {
    if (trusted !== null && (!isTrustedEvidence(parseMetricEvidence(trusted)) ||
        evidenceKey(trusted) !== key || trusted.generatedAt > latest.generatedAt)) return false;
  }
  if (previousTrusted && (!lastTrusted || previousTrusted.generatedAt >= lastTrusted.generatedAt)) return false;
  if (lastFailure !== null && (!hasKeys(lastFailure, ['at', 'state', 'reasonCode']) ||
      !isTimestamp(lastFailure.at) || lastFailure.at > latest.generatedAt || !STATE_SET.has(lastFailure.state) ||
      isTrustedEvidence(lastFailure) || typeof lastFailure.reasonCode !== 'string' ||
      !REASON_CODE.test(lastFailure.reasonCode))) return false;
  if (isTrustedEvidence(latest) ? !isDeepStrictEqual(latest, lastTrusted) : !isDeepStrictEqual(failureOf(latest), lastFailure)) {
    return false;
  }
  return transitions.every((transition, index) => {
    const previous = transitions[index - 1];
    return hasKeys(transition, ['at', 'from', 'to', 'reasonCode']) && isTimestamp(transition.at) &&
      transition.at <= latest.generatedAt && (transition.from === null || STATE_SET.has(transition.from)) &&
      STATE_SET.has(transition.to) && transition.from !== transition.to &&
      typeof transition.reasonCode === 'string' && REASON_CODE.test(transition.reasonCode) &&
      (!previous || (transition.at > previous.at && (transition.from === null || transition.from === previous.to)));
  }) && transitions.at(-1).to === latest.state;
}

function digest(snapshot) {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

async function readSlot(file) {
  let handle;
  try {
    handle = await fs.open(file, 'r');
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_SNAPSHOT_BYTES) return { state: 'CORRUPT' };
    const envelope = JSON.parse(await handle.readFile('utf8'));
    if (!hasKeys(envelope, ['digest', 'snapshot']) || typeof envelope.digest !== 'string' ||
        !envelope.snapshot || envelope.digest !== digest(envelope.snapshot)) return { state: 'CORRUPT' };

    const { snapshot } = envelope;
    if (Number.isSafeInteger(snapshot.schemaVersion) && snapshot.schemaVersion > SCHEMA_VERSION) {
      return { state: 'UNSUPPORTED_SCHEMA' };
    }
    if (!hasKeys(snapshot, ['schemaVersion', 'revision', 'entries']) || snapshot.schemaVersion !== SCHEMA_VERSION ||
        !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1 ||
        !Array.isArray(snapshot.entries) || snapshot.entries.length > MAX_ENTRIES ||
        !snapshot.entries.every(validEntry) ||
        new Set(snapshot.entries.map(entry => evidenceKey(entry.latestEvidence))).size !== snapshot.entries.length) {
      return { state: 'CORRUPT' };
    }
    return { state: 'READY', snapshot };
  } catch (error) {
    if (error.code === 'ENOENT') return { state: 'MISSING' };
    if (error instanceof SyntaxError || error instanceof TypeError) return { state: 'CORRUPT' };
    throw fail('EVIDENCE_LEDGER_READ_FAILED');
  } finally {
    await handle?.close();
  }
}

async function load(current, previous) {
  const primary = await readSlot(current);
  if (primary.state === 'READY' || primary.state === 'UNSUPPORTED_SCHEMA') return primary;

  const backup = await readSlot(previous);
  if (backup.state === 'UNSUPPORTED_SCHEMA') return backup;
  if (backup.state === 'READY') {
    // A missing primary may have contained a newer observation or a verification failure.
    return {
      state: 'RECOVERED',
      snapshot: {
        ...backup.snapshot,
        entries: backup.snapshot.entries.map(entry => ({ ...entry, historicalOnly: true }))
      }
    };
  }
  return { state: primary.state === 'MISSING' && backup.state === 'MISSING' ? 'EMPTY' : 'CORRUPT' };
}

async function syncDirectory(directory) {
  if (process.platform === 'win32') return;
  const handle = await fs.open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function ensureDirectory(directory) {
  try {
    await fs.mkdir(directory, { mode: 0o700 });
    await syncDirectory(path.dirname(directory));
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}

async function writeSlot(file, staging, snapshot) {
  const body = JSON.stringify({ digest: digest(snapshot), snapshot });
  if (Buffer.byteLength(body) > MAX_SNAPSHOT_BYTES) throw fail('EVIDENCE_LEDGER_SNAPSHOT_TOO_LARGE');

  try {
    await fs.unlink(staging).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    const handle = await fs.open(staging, 'wx', 0o600);
    try {
      await handle.writeFile(body);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(staging, file);
    await syncDirectory(path.dirname(file));
  } finally {
    await fs.unlink(staging).catch(() => {});
  }
}

function failureOf(evidence) {
  return { at: evidence.generatedAt, state: evidence.state, reasonCode: evidence.reasonCode };
}

function updateEntry(prior, evidence) {
  const trusted = isTrustedEvidence(evidence);
  const previousState = prior?.historicalOnly ? null : prior?.latestEvidence.state ?? null;
  const transitions = prior?.transitions.slice() ?? [];
  if (previousState !== evidence.state) {
    transitions.push({ at: evidence.generatedAt, from: previousState, to: evidence.state, reasonCode: evidence.reasonCode });
  }
  return {
    latestEvidence: evidence,
    historicalOnly: false,
    lastTrusted: trusted ? evidence : prior?.lastTrusted ?? null,
    previousTrusted: trusted ? prior?.lastTrusted ?? null : prior?.previousTrusted ?? null,
    lastFailure: trusted ? prior?.lastFailure ?? null : failureOf(evidence),
    transitions: transitions.slice(-MAX_TRANSITIONS)
  };
}

function visibleEntry(entry) {
  const { latestEvidence, historicalOnly, ...history } = entry;
  const { network, token, metricId, scope } = latestEvidence;
  return {
    network, token, metricId, scope,
    current: historicalOnly ? null : latestEvidence,
    ...history,
    lastSuccess: history.lastTrusted?.generatedAt ?? null
  };
}

function retainedSnapshot(revision, entries, maxEntries) {
  if (!Number.isSafeInteger(revision)) throw fail('EVIDENCE_LEDGER_REVISION_EXHAUSTED');
  const snapshot = { schemaVersion: SCHEMA_VERSION, revision, entries: [] };
  let bytes = Buffer.byteLength(JSON.stringify({ digest: '0'.repeat(64), snapshot }));
  for (const entry of entries.slice(-maxEntries).reverse()) {
    bytes += Buffer.byteLength(JSON.stringify(entry)) + Number(snapshot.entries.length > 0);
    if (bytes > MAX_SNAPSHOT_BYTES) break;
    snapshot.entries.unshift(entry);
  }
  if (snapshot.entries.length === 0) throw fail('EVIDENCE_LEDGER_SNAPSHOT_TOO_LARGE');
  return snapshot;
}

function serialize(directory, work) {
  const pending = (writers.get(directory) ?? Promise.resolve()).catch(() => {}).then(work);
  writers.set(directory, pending);
  return pending.finally(() => {
    if (writers.get(directory) === pending) writers.delete(directory);
  });
}

function createEvidenceLedger({ env = process.env, maxEntries = MAX_ENTRIES } = {}) {
  const root = env.ARC_VERIFICATION_STATE_DIR || env.ARC_HOLDER_PUBLISHED_DIR;
  if (!root || !path.isAbsolute(root)) throw fail('EVIDENCE_LEDGER_STORAGE_UNCONFIGURED');
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > MAX_ENTRIES) {
    throw fail('EVIDENCE_LEDGER_RETENTION_INVALID');
  }
  const directory = path.join(path.resolve(root), 'verification-ledger');
  const current = path.join(directory, 'current.json');
  const previous = path.join(directory, 'previous.json');
  const staging = path.join(directory, 'pending.json');

  async function read() {
    let loaded;
    try {
      loaded = await load(current, previous);
    } catch {
      loaded = { state: 'UNAVAILABLE' };
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      storageState: loaded.state,
      revision: loaded.snapshot?.revision ?? null,
      entries: loaded.snapshot?.entries.map(visibleEntry) ?? []
    };
  }

  async function record(input) {
    const evidence = parseMetricEvidence(input);
    const key = evidenceKey(evidence);
    return serialize(directory, async () => {
      const loaded = await load(current, previous);
      if (loaded.state === 'UNSUPPORTED_SCHEMA') throw fail('EVIDENCE_LEDGER_SCHEMA_UNSUPPORTED');
      const entries = loaded.snapshot?.entries ?? [];
      const prior = entries.find(entry => evidenceKey(entry.latestEvidence) === key);
      if (prior && evidence.generatedAt <= prior.latestEvidence.generatedAt) {
        if (!prior.historicalOnly && isDeepStrictEqual(prior.latestEvidence, evidence)) return visibleEntry(prior);
        throw fail('EVIDENCE_LEDGER_ATTEMPT_OUT_OF_ORDER');
      }
      if (isTrustedEvidence(evidence) && prior?.lastTrusted && evidence.observedAt < prior.lastTrusted.observedAt) {
        throw fail('EVIDENCE_LEDGER_OBSERVATION_REGRESSED');
      }
      const entry = updateEntry(prior, evidence);
      const next = retainedSnapshot((loaded.snapshot?.revision ?? 0) + 1,
        [...entries.filter(candidate => candidate !== prior), entry], maxEntries);

      try {
        await ensureDirectory(directory);
        // Rotate only validated primary data. A recovery write leaves the good backup intact.
        if (loaded.state === 'READY') await writeSlot(previous, staging, loaded.snapshot);
        await writeSlot(current, staging, next);
      } catch {
        throw fail('EVIDENCE_LEDGER_WRITE_FAILED');
      }
      return visibleEntry(entry);
    });
  }

  return { read, record };
}

module.exports = { createEvidenceLedger, SCHEMA_VERSION, MAX_ENTRIES, MAX_TRANSITIONS };
