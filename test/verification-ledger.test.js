'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const { createEvidenceLedger, MAX_TRANSITIONS } = require('../lib/verification/evidence-ledger');
const { NETWORKS, STATES } = require('../lib/verification/metric-evidence');

const TOKEN = '0x' + '1'.repeat(40);
const START = Date.parse('2026-01-01T00:00:00.000Z');

function at(step) {
  return new Date(START + step * 1000).toISOString();
}

function unavailable(step, overrides = {}) {
  return {
    schemaVersion: 1,
    metricId: 'supply.total',
    network: 'arc',
    token: TOKEN,
    scope: null,
    value: null,
    unit: 'raw-token',
    observedAt: null,
    generatedAt: at(step),
    block: null,
    source: null,
    state: STATES.UNAVAILABLE,
    reasonCode: 'PROVIDER_UNAVAILABLE',
    dataAgeMs: null,
    observations: [],
    disagreement: null,
    engine: { id: 'verification', version: 1 },
    ...overrides
  };
}

function verified(step, value, overrides = {}, observed = step) {
  const record = unavailable(step, overrides);
  const block = { number: String(step), hash: '0x' + 'a'.repeat(64) };
  const observations = ['rpc-a', 'rpc-b'].map(id => ({
    source: { id, class: 'ONCHAIN_RPC', operator: id },
    value,
    unit: record.unit,
    token: record.token,
    scope: record.scope,
    observedAt: at(observed),
    block,
    chainId: NETWORKS[record.network],
    provenance: { method: 'erc20.total-supply', reference: null }
  }));
  return {
    ...record, value, observedAt: at(observed), block, source: observations[0].source,
    state: STATES.VERIFIED_ONCHAIN, reasonCode: 'EXACT_ONCHAIN_AGREEMENT',
    dataAgeMs: (step - observed) * 1000, observations
  };
}

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(__dirname, '.arcy-verification-ledger-'));
  t.after(async () => {
    const resolvedRoot = await fs.realpath(root);
    const temporaryDirectory = await fs.realpath(__dirname);
    assert.equal(path.dirname(resolvedRoot), temporaryDirectory);
    assert.match(path.basename(resolvedRoot), /^\.arcy-verification-ledger-/);
    await fs.rm(resolvedRoot, { recursive: true, force: true });
  });
  const directory = path.join(root, 'verification-ledger');
  const env = { ARC_HOLDER_PUBLISHED_DIR: root };
  return {
    root, directory, env,
    ledger: createEvidenceLedger({ env, ...options }),
    current: path.join(directory, 'current.json'),
    previous: path.join(directory, 'previous.json'),
    staging: path.join(directory, 'pending.json')
  };
}

async function changeSnapshot(file, mutate, recomputeDigest = true) {
  const envelope = JSON.parse(await fs.readFile(file, 'utf8'));
  mutate(envelope.snapshot);
  if (recomputeDigest) {
    envelope.digest = createHash('sha256').update(JSON.stringify(envelope.snapshot)).digest('hex');
  }
  await fs.writeFile(file, JSON.stringify(envelope));
}

test('ledger requires a durable root and leaves neighboring worker files alone', async t => {
  assert.throws(() => createEvidenceLedger({ env: {} }), { code: 'EVIDENCE_LEDGER_STORAGE_UNCONFIGURED' });
  assert.throws(() => createEvidenceLedger({ env: { ARC_VERIFICATION_STATE_DIR: 'relative' } }), {
    code: 'EVIDENCE_LEDGER_STORAGE_UNCONFIGURED'
  });
  const { root, env, ledger } = await fixture(t);
  assert.deepEqual(await ledger.read(), { schemaVersion: 1, storageState: 'EMPTY', revision: null, entries: [] });

  const neighbor = path.join(root, 'holder-index.json');
  await fs.writeFile(neighbor, 'holder checkpoint');
  const explicit = path.join(root, 'explicit');
  await fs.mkdir(explicit);
  const override = createEvidenceLedger({ env: { ...env, ARC_VERIFICATION_STATE_DIR: explicit } });
  await override.record(verified(1, '100'));
  assert.deepEqual(await fs.readdir(path.join(explicit, 'verification-ledger')), ['current.json']);
  assert.equal(await fs.readFile(neighbor, 'utf8'), 'holder checkpoint');
  assert.equal((await ledger.read()).storageState, 'EMPTY');
});

test('independent process restart retains failure, current evidence and two trusted checkpoints', async t => {
  const { env, ledger } = await fixture(t);
  const first = verified(1, '100');
  const second = verified(2, '101');
  const failed = unavailable(3);
  await ledger.record(first);
  await ledger.record(second);
  await ledger.record(failed);

  const readInFreshProcess = `
    const { createEvidenceLedger } = require(process.argv[1]);
    createEvidenceLedger().read().then(result => process.stdout.write(JSON.stringify(result)));
  `;
  const snapshot = JSON.parse(execFileSync(process.execPath, [
    '-e', readInFreshProcess, require.resolve('../lib/verification/evidence-ledger')
  ], { env: { ...process.env, ...env, ARC_VERIFICATION_STATE_DIR: '' }, encoding: 'utf8' }));
  assert.equal(snapshot.storageState, 'READY');
  assert.equal(snapshot.revision, 3);
  const [entry] = snapshot.entries;
  assert.deepEqual(entry.current, failed);
  assert.deepEqual(entry.lastTrusted, second);
  assert.deepEqual(entry.previousTrusted, first);
  assert.equal(entry.lastSuccess, at(2));
  assert.deepEqual(entry.lastFailure, { at: at(3), state: STATES.UNAVAILABLE, reasonCode: 'PROVIDER_UNAVAILABLE' });
  assert.deepEqual(entry.transitions.map(({ from, to }) => [from, to]), [
    [null, STATES.VERIFIED_ONCHAIN], [STATES.VERIFIED_ONCHAIN, STATES.UNAVAILABLE]
  ]);
});

test('primary corruption recovers historical evidence and refreshes one key without promoting other backup data', async t => {
  const { env, current, previous, ledger } = await fixture(t);
  const one = verified(1, '100');
  const anotherToken = '0x' + '2'.repeat(40);
  const two = verified(2, '200', { token: anotherToken });
  await ledger.record(one);
  await ledger.record(two);
  await ledger.record(unavailable(3));
  const preserved = await fs.readFile(previous, 'utf8');
  await changeSnapshot(current, snapshot => { snapshot.revision = 100; }, false);

  const restarted = createEvidenceLedger({ env });
  const recovered = await restarted.read();
  assert.equal(recovered.storageState, 'RECOVERED');
  assert.equal(recovered.revision, 2);
  assert.ok(recovered.entries.every(entry => entry.current === null));
  assert.deepEqual(recovered.entries.map(entry => entry.lastTrusted), [one, two]);
  await assert.rejects(restarted.record(one), { code: 'EVIDENCE_LEDGER_ATTEMPT_OUT_OF_ORDER' });

  const newObservation = verified(4, '101');
  await restarted.record(newObservation);
  assert.equal(await fs.readFile(previous, 'utf8'), preserved);
  const healthy = await restarted.read();
  assert.equal(healthy.storageState, 'READY');
  assert.equal(healthy.entries.find(entry => entry.token === anotherToken).current, null);
  assert.deepEqual(healthy.entries.find(entry => entry.token === TOKEN).current, newObservation);
});

test('valid checksum cannot bypass schema validation, and fresh evidence can rebuild a corrupt ledger', async t => {
  const { current, previous, ledger } = await fixture(t);
  await ledger.record(verified(1, '100'));
  await ledger.record(unavailable(2));
  await changeSnapshot(current, snapshot => { snapshot.entries[0].latestEvidence.value = '0'; });
  await fs.writeFile(previous, '{invalid JSON');
  assert.deepEqual(await ledger.read(), { schemaVersion: 1, storageState: 'CORRUPT', revision: null, entries: [] });
  await ledger.record(verified(3, '102'));
  const restored = await ledger.read();
  assert.equal(restored.storageState, 'READY');
  assert.equal(restored.entries[0].current.value, '102');
  assert.equal(restored.entries[0].previousTrusted, null);
});

test('older worker leaves a checksum-valid future schema intact', async t => {
  const { current, ledger } = await fixture(t);
  await ledger.record(verified(1, '100'));
  await changeSnapshot(current, snapshot => { snapshot.schemaVersion = 2; });
  const future = await fs.readFile(current, 'utf8');
  assert.equal((await ledger.read()).storageState, 'UNSUPPORTED_SCHEMA');
  await assert.rejects(ledger.record(verified(2, '101')), { code: 'EVIDENCE_LEDGER_SCHEMA_UNSUPPORTED' });
  assert.equal(await fs.readFile(current, 'utf8'), future);
});

test('failed atomic rename and orphaned staging data leave the current checkpoint usable', async t => {
  const { current, directory, staging, ledger } = await fixture(t);
  const first = verified(1, '100');
  const second = verified(2, '101');
  await ledger.record(first);

  const rename = fs.rename;
  const injected = t.mock.method(fs, 'rename', async (from, to) => {
    if (to === current) throw Object.assign(new Error('injected I/O failure'), { code: 'EIO' });
    return rename(from, to);
  });
  await assert.rejects(ledger.record(second), { code: 'EVIDENCE_LEDGER_WRITE_FAILED' });
  injected.mock.restore();
  assert.deepEqual((await ledger.read()).entries[0].current, first);

  await fs.writeFile(staging, '{process interrupted during write');
  assert.deepEqual((await ledger.read()).entries[0].current, first);
  assert.deepEqual((await ledger.record(second)).current, second);
  assert.deepEqual(await fs.readdir(directory), ['current.json', 'previous.json']);
});

test('older attempts and invalid evidence cannot replace or churn a valid snapshot', async t => {
  const { ledger } = await fixture(t);
  const known = verified(2, '100');
  await ledger.record(known);
  await ledger.record(known);
  await assert.rejects(ledger.record(verified(2, '50')), { code: 'EVIDENCE_LEDGER_ATTEMPT_OUT_OF_ORDER' });
  await assert.rejects(ledger.record(unavailable(1)), { code: 'EVIDENCE_LEDGER_ATTEMPT_OUT_OF_ORDER' });
  await assert.rejects(ledger.record(verified(3, '99', {}, 1)), { code: 'EVIDENCE_LEDGER_OBSERVATION_REGRESSED' });
  await assert.rejects(ledger.record(unavailable(3, { value: '0' })), TypeError);
  const snapshot = await ledger.read();
  assert.equal(snapshot.revision, 1);
  assert.deepEqual(snapshot.entries[0].current, known);
});

test('same-directory writers serialize, while key and transition retention stay bounded', async t => {
  const { env, ledger } = await fixture(t, { maxEntries: 2 });
  const secondWriter = createEvidenceLedger({ env, maxEntries: 2 });
  await Promise.all([
    ledger.record(unavailable(1, { scope: 'pool-a' })),
    secondWriter.record(unavailable(1, { scope: 'pool-b' }))
  ]);
  assert.deepEqual((await ledger.read()).entries.map(entry => entry.scope), ['pool-a', 'pool-b']);
  await ledger.record(unavailable(1, { network: 'robinhood' }));
  assert.deepEqual((await ledger.read()).entries.map(entry => [entry.network, entry.scope]), [
    ['arc', 'pool-b'], ['robinhood', null]
  ]);

  for (let step = 2; step <= MAX_TRANSITIONS + 4; step++) {
    const state = step % 2 === 0 ? STATES.NOT_VERIFIED : STATES.UNAVAILABLE;
    await ledger.record(unavailable(step, { network: 'robinhood', state }));
  }
  const robinhood = (await ledger.read()).entries[1];
  assert.equal(robinhood.transitions.length, MAX_TRANSITIONS);
  assert.equal(robinhood.transitions.at(-1).at, at(MAX_TRANSITIONS + 4));
  assert.equal(robinhood.transitions.at(-1).to, robinhood.current.state);
});
