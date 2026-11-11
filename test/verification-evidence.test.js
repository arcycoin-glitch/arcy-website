'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { STATES, isTrustedEvidence, parseMetricEvidence } = require('../lib/verification/metric-evidence');

const token = '0x' + '1'.repeat(40);
const block = { number: '123', hash: '0x' + 'a'.repeat(64) };
const observedAt = '2026-11-11T00:00:00.000Z';
const generatedAt = '2026-11-11T00:00:01.000Z';

function observation(id, operator = id) {
  return { source: { id, class: 'ONCHAIN_RPC', operator }, value: '123456789012345678901234567890',
    unit: 'raw-token', token, scope: null, observedAt, block, chainId: 5042,
    provenance: { method: 'erc20.total-supply', reference: token } };
}

function evidence() {
  const first = observation('first');
  return { schemaVersion: 1, metricId: 'supply.total', network: 'arc', token, scope: null,
    value: first.value, unit: first.unit, observedAt, generatedAt, block, source: first.source,
    state: STATES.VERIFIED_ONCHAIN, reasonCode: 'EXACT_ONCHAIN_AGREEMENT', dataAgeMs: 1000,
    observations: [first, observation('second')], disagreement: null, engine: { id: 'verification', version: 1 } };
}

test('verified evidence preserves exact decimal strings and returns detached canonical data', () => {
  const input = evidence();
  const parsed = parseMetricEvidence(input);
  assert.deepEqual(parsed, input);
  assert.equal(isTrustedEvidence(parsed), true);
  parsed.observations[0].provenance.reference = null;
  assert.equal(input.observations[0].provenance.reference, token);
});

test('strict parsing rejects malformed shape, provenance, clock, and chain identity', () => {
  const changes = [
    e => { e.observations[0].chainId = 1; },
    e => { e.observations[1].token = '0x' + '2'.repeat(40); },
    e => { e.observations[0].block = null; },
    e => { e.observations[0].provenance = null; },
    e => { e.observations[0].provenance.reference = 'https://private.invalid?key=example'; },
    e => { e.source.operator = 'operator with spaces'; },
    e => { e.dataAgeMs = 0; },
    e => { e.generatedAt = '2026-11-31T00:00:01.000Z'; },
    e => { e.schemaVersion = 2; },
    e => { e.value = Number.MAX_SAFE_INTEGER + 1; },
    e => { e.additional = true; },
    e => { e.observations = new Array(2); },
  ];
  for (const change of changes) {
    const input = structuredClone(evidence());
    change(input);
    assert.throws(() => parseMetricEvidence(input), TypeError, String(change));
  }
});

test('two labels for one operator, mismatched block hashes, and differing values cannot verify', () => {
  for (const change of [
    second => { second.source.operator = 'first'; },
    second => { second.block.hash = '0x' + 'b'.repeat(64); },
    second => { second.value = '1'; },
    second => { second.unit = 'token'; },
  ]) {
    const input = evidence();
    input.observations[1] = structuredClone(input.observations[1]);
    change(input.observations[1]);
    assert.throws(() => parseMetricEvidence(input), /independent agreement/);
  }
});

test('single-source and failed evidence can never become trusted or present a failed value as current', () => {
  const input = evidence();
  input.observations.pop();
  input.state = STATES.SINGLE_SOURCE;
  input.reasonCode = 'ONLY_ONE_OPERATOR';
  assert.equal(isTrustedEvidence(parseMetricEvidence(input)), false);

  for (const state of [STATES.STALE, STATES.UNAVAILABLE, STATES.UNSUPPORTED, STATES.NOT_VERIFIED]) {
    const failed = { ...input, state, reasonCode: 'SOURCE_UNAVAILABLE' };
    assert.throws(() => parseMetricEvidence(failed), /contains a current value/);
    Object.assign(failed, { value: null, source: null, block: null, observedAt: null, dataAgeMs: null });
    assert.deepEqual(parseMetricEvidence(failed), failed);
  }
});
