'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { evaluateRisk, MAX_RECORDS, STATUSES } = require('../lib/risk-engine');
const { RULES } = require('../lib/risk-engine/rules');
const { NETWORKS, parseMetricEvidence } = require('../lib/verification/metric-evidence');

const now = Date.parse('2026-11-12T20:00:00.000Z');
const token = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const scope = '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640';
const poolId = '0xa857a22b0869f0371b451019bc1b0ebb369a2d782fb0af42595976157c8d1f0e';
const block = { number: '15000000', hash: '0x' + 'a'.repeat(64) };
const positive = [true, 500, '2499999', true, 100, 5000];
const negative = [false, 499, '2500000', false, 99, 4999];
const target = { network: 'ethereum', chainId: 1, token, scope, now };

// Synthetic evidence using contract-shaped identifiers. Values do not describe the named contracts.
function fixture(rule, value, options = {}) {
  const { network = 'ethereum', address = token, pool = scope, age = 1000, generated = now, anchor = block } = options;
  const observedAt = new Date(generated - age).toISOString();
  const observations = ['provider-a', 'provider-b'].map(id => ({ source: { id, class: 'ONCHAIN_RPC', operator: id }, value,
    unit: rule.unit, token: address, scope: rule.scoped ? pool : null, observedAt, block: { ...anchor }, chainId: NETWORKS[network],
    provenance: { method: rule.method(value), reference: rule.scoped ? pool : address } }));
  return { schemaVersion: 1, metricId: rule.metricId, network, token: address, scope: observations[0].scope, value,
    unit: rule.unit, observedAt, generatedAt: new Date(generated).toISOString(), block: { ...anchor }, source: { ...observations[0].source },
    state: 'VERIFIED_ONCHAIN', reasonCode: 'EXACT_ONCHAIN_AGREEMENT', dataAgeMs: age, observations, disagreement: null,
    engine: { id: 'synthetic-fixture', version: 1 } };
}

const suite = (values, options) => RULES.map((rule, index) => fixture(rule, values[index], options));
const assess = (index, evidence, overrides) => evaluateRisk({ ...target, ...overrides, evidence }).findings[index];

function failed(evidence, state, disagreement = null) {
  return { ...evidence, state, value: null, observedAt: null, block: null, source: null, dataAgeMs: null,
    disagreement, reasonCode: 'FIXTURE_STATUS' };
}

test('all six rules report evidenced positive and explicit negative conditions at policy boundaries on all chains', () => {
  for (const [network, chainId] of Object.entries(NETWORKS)) {
    const pool = network === 'arc' ? poolId : scope;
    for (const [values, status] of [[positive, 'CONFIRMED'], [negative, 'NOT_CONFIRMED']]) {
      const records = suite(values, { network, pool });
      records.forEach(parseMetricEvidence);
      const result = evaluateRisk({ ...target, network, chainId, scope: pool, evidence: records });
      assert.equal(result.dataQuality.coverage, 'COMPLETE');
      assert.equal(result.dataQuality.counts[status], 6);
      for (const finding of result.findings) {
        assert.deepEqual(Object.keys(finding).sort(), ['ruleId', 'ruleVersion', 'network', 'chainId', 'token', 'scope',
          'severity', 'status', 'reasonCode', 'evidenceRefs', 'observedAt', 'evaluatedAt', 'explanation'].sort());
        assert.equal(finding.status, status);
        assert.equal(finding.chainId, chainId);
        assert.equal(finding.token, token);
        assert.equal(finding.severity === null, status === 'NOT_CONFIRMED');
        assert.match(finding.evidenceRefs[0].digest, /^[a-f0-9]{64}$/);
        assert.deepEqual(finding.evidenceRefs[0].block, block);
      }
    }
  }
});

test('missing, source-reported, and typed but incomplete authority evidence provide no negative proof', () => {
  const mint = fixture(RULES[3], false);
  for (const state of ['UNAVAILABLE', 'NOT_VERIFIED', 'UNSUPPORTED']) {
    assert.equal(assess(3, [failed(mint, state)]).status, state === 'UNSUPPORTED' ? 'UNSUPPORTED' : 'UNKNOWN');
  }
  const single = { ...mint, state: 'SINGLE_SOURCE', reasonCode: 'ONLY_ONE_OPERATOR', observations: mint.observations.slice(0, 1) };
  assert.equal(assess(3, [single]).status, 'UNKNOWN');
  const external = structuredClone(mint);
  external.state = 'INDEPENDENTLY_CROSS_CHECKED';
  external.reasonCode = 'INDEPENDENT_AGREEMENT';
  external.source.class = 'INDEXER';
  for (const obs of external.observations) obs.source.class = 'INDEXER';
  assert.equal(assess(3, [external]).reasonCode, 'INDEPENDENT_ONCHAIN_PROOF_REQUIRED');
  assert.equal(assess(3, [{ value: 'Verified safe', dataState: 'DATA_FOUND' }]).status, 'UNKNOWN');
  for (const item of mint.observations) item.provenance.method = 'reachable-mint-authority';
  assert.equal(assess(3, [mint]).reasonCode, 'SEMANTIC_PROOF_REQUIRED');
});

test('exact chain, token and pool isolation; wrong chain and bad anchor cannot confirm', () => {
  const rule = RULES[2];
  const elsewhere = [fixture(rule, '100', { network: 'arc' }), fixture(rule, '100', { pool: poolId }),
    fixture(rule, '100', { address: '0x' + 'b'.repeat(40) })];
  const result = evaluateRisk({ ...target, evidence: elsewhere });
  assert.equal(result.dataQuality.ignoredEvidence, 3);
  assert.equal(result.findings[2].status, 'UNKNOWN');
  const wrong = fixture(rule, '100');
  wrong.observations[1].chainId = 5042;
  const badBlock = fixture(rule, '100', { anchor: { ...block, hash: '0x' + '0'.repeat(64) } });
  assert.equal(evaluateRisk({ ...target, evidence: [wrong, badBlock] }).dataQuality.rejectedEvidence, 2);
  assert.equal(assess(2, [fixture(rule, '2500000'), wrong]).reasonCode, 'INVALID_MATCHING_EVIDENCE');
  for (const overrides of [{ network: 'polygon', chainId: 137 }, { chainId: 5042 }, { scope: 'uniswap' },
    { token: '0x' + '0'.repeat(40) }, { now: NaN }, { now: undefined }]) {
    assert.throws(() => evaluateRisk({ ...target, ...overrides }), TypeError);
  }
  assert.equal(assess(2, [], { scope: null }).reasonCode, 'POOL_SCOPE_REQUIRED');
});

test('one upstream cannot independently verify itself and every observation must establish the semantic claim', () => {
  const mint = fixture(RULES[3], true);
  mint.observations[1].source.operator = mint.observations[0].source.operator;
  assert.equal(evaluateRisk({ ...target, evidence: [mint] }).dataQuality.rejectedEvidence, 1);
  const two = fixture(RULES[3], true);
  two.observations[1].provenance.reference = scope;
  assert.equal(assess(3, [two]).reasonCode, 'SEMANTIC_PROOF_REQUIRED');
});

test('stale, conflicting, future and ambiguous records fail closed with distinct reasons', () => {
  const rule = RULES[1], fresh = fixture(rule, 501);
  const expired = fixture(rule, 501, { age: rule.maxAgeMs + 1 });
  assert.equal(assess(1, [expired]).status, 'STALE');
  assert.equal(assess(1, [fixture(rule, 501, { age: rule.maxAgeMs })]).status, 'CONFIRMED');
  assert.equal(assess(1, [failed(fresh, 'STALE')]).status, 'STALE');
  const conflict = failed(fresh, 'CONFLICTING', { kind: 'VALUE_MISMATCH', sources: ['provider-b', 'provider-a'] });
  conflict.observations = [fresh.observations[0], { ...fresh.observations[1], value: 600 }];
  assert.equal(assess(1, [fresh, conflict]).status, 'CONFLICTING');
  const fork = fixture(rule, 501, { anchor: { ...block, hash: '0x' + 'b'.repeat(64) } });
  assert.equal(assess(1, [fresh, fork]).reasonCode, 'BLOCK_ANCHOR_CONFLICT');
  assert.equal(assess(1, [fresh, fixture(rule, 200)]).reasonCode, 'VALUE_CONFLICT');
  assert.equal(assess(1, [fresh, failed(fresh, 'UNAVAILABLE')]).reasonCode, 'AMBIGUOUS_CURRENT_EVIDENCE');
  assert.equal(assess(1, [fresh, expired]).reasonCode, 'AMBIGUOUS_CURRENT_EVIDENCE');
  assert.equal(assess(1, [fresh, fixture(rule, 0, { generated: now + 1 })]).reasonCode, 'FUTURE_EVIDENCE');
});

test('missing liquidity or price impact stays unknown and pool reserve evidence proves only its own rule', () => {
  assert.equal(assess(2, []).status, 'UNKNOWN');
  const low = fixture(RULES[2], '100');
  assert.equal(assess(2, [low]).status, 'CONFIRMED');
  assert.equal(assess(1, [low]).status, 'UNKNOWN');
  assert.equal(assess(1, [fixture(RULES[1], 10_001)]).reasonCode, 'SEMANTIC_PROOF_REQUIRED');
  const tracked = { ...low, metricId: 'liquidityUsd' };
  assert.equal(assess(2, [tracked]).status, 'UNKNOWN');
  const quote = fixture(RULES[1], 500);
  quote.observations.forEach(o => { o.provenance.method = 'quoter-amount-out'; });
  assert.equal(assess(1, [quote]).status, 'UNKNOWN');
});

test('allowlisted output redacts upstream URLs, opaque identifiers, provenance and failure text', () => {
  const source = fixture(RULES[3], true);
  source.source.id = source.observations[0].source.id = 'opaquesecretidentifier';
  const malformed = structuredClone(source);
  malformed.metricId = RULES[5].metricId;
  malformed.observations[0].provenance.reference = 'https://private.invalid/rpc?key=supersecret';
  const failure = failed(fixture(RULES[0], true), 'UNAVAILABLE');
  failure.reasonCode = 'EXAMPLE_CREDENTIAL';
  const output = evaluateRisk({ ...target, evidence: [source, malformed, failure] });
  assert.equal(output.dataQuality.rejectedEvidence, 1);
  assert.equal(output.findings[3].status, 'CONFIRMED');
  assert.doesNotMatch(JSON.stringify(output), /private\.invalid|supersecret|opaquesecretidentifier|EXAMPLE_CREDENTIAL|provider-a/);
});

test('replay is stable, deduplicated and bounded, with a version floor and no network requests', t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw Error('Unexpected fetch'); });
  const records = suite(positive);
  const original = evaluateRisk({ ...target, evidence: records });
  const replay = records.slice().reverse().map(record => ({ ...record, observations: record.observations.slice().reverse() }));
  assert.deepEqual(evaluateRisk({ ...target, evidence: replay.concat(records) }), original);
  assert.deepEqual(original.findings.map(f => f.ruleId), original.findings.map(f => f.ruleId).sort());
  const versionFloor = { 'admin-upgrade-authority': 1, 'high-exit-impact': 1, 'low-pool-liquidity': 1,
    'privileged-minting': 1, 'sell-transfer-tax': 1, 'top-ten-holder-concentration': 1 };
  for (const f of original.findings) assert.ok(Number.isSafeInteger(f.ruleVersion) && f.ruleVersion >= versionFloor[f.ruleId]);
  const full = Array.from({ length: MAX_RECORDS }, (_, i) => fixture(RULES[1], i));
  const start = performance.now();
  const stressed = evaluateRisk({ ...target, evidence: full });
  assert.ok(performance.now() - start < 2000, 'single max-size evaluation stays within stress budget');
  assert.ok(stressed.findings.every(f => f.evidenceRefs.length <= 2 && f.explanation.length <= 160 && STATUSES.includes(f.status)));
  assert.ok(Buffer.byteLength(JSON.stringify(stressed)) < 8192);
  assert.throws(() => evaluateRisk({ ...target, evidence: full.concat(full[0]) }), /at most 32/);
  assert.equal(fetch.mock.callCount(), 0);
});
