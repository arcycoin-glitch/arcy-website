'use strict';
// Security review regressions for Autonomous Risk Engine V1 (PR #224).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateRisk } = require('../lib/risk-engine');
const engine = require('../lib/risk-engine/engine');
const { RULES: V1 } = require('../lib/risk-engine/rules');
const { NETWORKS } = require('../lib/verification/metric-evidence');

const now = Date.parse('2026-11-12T20:00:00.000Z');
const token = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const poolA = '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640', poolB = '0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8';
const poolId = '0x' + 'c'.repeat(64);
const block = { number: '15000000', hash: '0x' + 'a'.repeat(64) };
const PRODUCER = { id: 'reviewed-fixture', version: 1 };
const RULES = V1.map(rule => ({ ...rule, producers: [{ id: PRODUCER.id, minVersion: 1 }] }));
const rule = id => RULES.find(r => r.id === id);
const index = id => RULES.findIndex(r => r.id === id);
const target = { network: 'ethereum', chainId: 1, token, scope: poolA, now };
const reviewed = (evidence, overrides = {}) => engine.evaluate({ ...target, ...overrides, evidence }, RULES);
const finding = (id, evidence, overrides) => reviewed(evidence, overrides).findings[index(id)];

function record(r, value, o = {}) {
  const { network = 'ethereum', pool = poolA, age = 1000, state = 'VERIFIED_ONCHAIN', producer = PRODUCER, method, reference,
    operators = ['op-a', 'op-b'], unit = r.unit, sourceClass = 'ONCHAIN_RPC', metricId = r.metricId, scope } = o;
  const observedAt = new Date(now - age).toISOString(), recordScope = scope !== undefined ? scope : r.scoped ? pool : null;
  const observations = operators.map((op, i) => ({ source: { id: 'src-' + i, class: sourceClass, operator: op }, value, unit, token,
    scope: recordScope, observedAt, block: { ...block }, chainId: NETWORKS[network],
    provenance: { method: method || r.method(value), reference: reference || (r.scoped ? pool : token) } }));
  return { schemaVersion: 1, metricId, network, token, scope: recordScope, value, unit, observedAt, generatedAt: new Date(now).toISOString(),
    block: { ...block }, source: { ...observations[0].source }, state, reasonCode: state === 'VERIFIED_ONCHAIN' ? 'EXACT_ONCHAIN_AGREEMENT' : 'ONLY_ONE_OPERATOR',
    dataAgeMs: age, observations, disagreement: null, engine: { ...producer } };
}
const all = values => V1.map((r, i) => record(RULES[i], values[i]));

test('public V1 has no reviewed producer: perfect-looking evidence never yields CONFIRMED or NOT_CONFIRMED', () => {
  // Issue #226 reviews exactly one producer, for exactly two rules, for positive values only.
  const reviewedRules = { 'admin-upgrade-authority': true, 'privileged-minting': true };
  for (const r of V1) {
    assert.ok(Object.isFrozen(r)); assert.ok(Object.isFrozen(r.producers));
    if (reviewedRules[r.id]) {
      assert.equal(r.producers.length, 1); assert.ok(Object.isFrozen(r.producers[0])); assert.ok(Object.isFrozen(r.producers[0].values));
      assert.deepEqual({ ...r.producers[0], values: [...r.producers[0].values] }, { id: 'arcy-risk-authority-producer', minVersion: 4, values: [true] });
    } else assert.equal(r.producers.length, 0, r.id);
  }
  for (const values of [[true, 500, '2499999', true, 100, 5000], [false, 499, '2500000', false, 99, 4999]]) {
    const out = evaluateRisk({ ...target, evidence: all(values) });
    assert.equal(out.dataQuality.coverage, 'INCOMPLETE');
    assert.equal(out.dataQuality.counts.CONFIRMED + out.dataQuality.counts.NOT_CONFIRMED, 0);
    for (const f of out.findings) { assert.equal(f.status, 'UNKNOWN'); assert.equal(f.reasonCode, 'PRODUCER_NOT_REVIEWED'); assert.equal(f.severity, null); }
  }
  // The same records with a reviewed producer do determine every rule (the gate is the only difference).
  assert.equal(reviewed(all([false, 499, '2500000', false, 99, 4999])).dataQuality.counts.NOT_CONFIRMED, 6);
  // A producer below its reviewed version is not reviewed.
  const old = record(rule('privileged-minting'), true, { producer: { id: PRODUCER.id, version: 1 } });
  const strict = RULES.map(r => ({ ...r, producers: [{ id: PRODUCER.id, minVersion: 2 }] }));
  assert.equal(engine.evaluate({ ...target, evidence: [old] }, strict).findings[index('privileged-minting')].reasonCode, 'PRODUCER_NOT_REVIEWED');
  assert.throws(() => engine.evaluate({ ...target, evidence: [] }, []), TypeError);
});

test('verification-runtime and Search metric records are never turned into risk evidence', () => {
  // Shapes emitted by lib/verification/runtime.js (PR #225): Search metric ids and engine arcy-verification-runtime.
  const runtime = { id: 'arcy-verification-runtime', version: 1 };
  const search = ['mechanics.mint_capability', 'mechanics.owner_admin', 'mechanics.trading_taxes', 'holders.top10_pct', 'liquidity.liquidity_usd']
    .map(metricId => record(rule('privileged-minting'), false, { metricId, producer: runtime }));
  const out = evaluateRisk({ ...target, evidence: search });
  assert.equal(out.dataQuality.ignoredEvidence, 5);assert.equal(out.dataQuality.rejectedEvidence, 0);
  assert.ok(out.findings.every(f => f.status === 'UNKNOWN'));
  // Relabelled as a risk.* id: still not a reviewed producer, even for the reviewed-fixture rule set.
  const relabelled = record(rule('privileged-minting'), false, { producer: runtime });
  assert.equal(finding('privileged-minting', [relabelled]).reasonCode, 'PRODUCER_NOT_REVIEWED');
  assert.equal(evaluateRisk({ ...target, evidence: [relabelled] }).findings[index('privileged-minting')].reasonCode, 'PRODUCER_NOT_REVIEWED');
});

test('wrong-chain evidence is ignored or rejected, never counted', () => {
  const r = rule('privileged-minting');
  // Same token address, other network: not this target.
  const arc = record(r, false, { network: 'arc' });
  assert.equal(reviewed([arc]).dataQuality.ignoredEvidence, 1);
  assert.equal(finding('privileged-minting', [arc]).reasonCode, 'EVIDENCE_MISSING');
  // Record says ethereum, one observation carries Robinhood's chain id: contract rejects it and the rule fails closed.
  const mixed = record(r, false); mixed.observations[1].chainId = 4663;
  const out = reviewed([mixed]);
  assert.equal(out.dataQuality.rejectedEvidence, 1);
  assert.equal(out.findings[index('privileged-minting')].reasonCode, 'INVALID_MATCHING_EVIDENCE');
  // A valid record cannot rescue a rejected one for the same rule.
  assert.equal(finding('privileged-minting', [record(r, false), mixed]).reasonCode, 'INVALID_MATCHING_EVIDENCE');
  for (const bad of [{ chainId: 4663 }, { network: 'robinhood', chainId: 1 }, { network: 'base', chainId: 8453 }])
    assert.throws(() => evaluateRisk({ ...target, ...bad }), TypeError);
});

test('mismatched pools: other pool, other identifier type or observations referencing the token cannot decide a pool rule', () => {
  const r = rule('low-pool-liquidity');
  assert.equal(finding('low-pool-liquidity', [record(r, '100', { pool: poolB })]).reasonCode, 'EVIDENCE_MISSING');
  assert.equal(finding('low-pool-liquidity', [record(r, '100', { pool: poolId })]).reasonCode, 'EVIDENCE_MISSING');
  // Record scoped to the target pool, but its observations measured something else.
  assert.equal(finding('low-pool-liquidity', [record(r, '100', { reference: poolB })]).reasonCode, 'SEMANTIC_PROOF_REQUIRED');
  assert.equal(finding('low-pool-liquidity', [record(r, '100', { reference: token })]).reasonCode, 'SEMANTIC_PROOF_REQUIRED');
  // Pool evidence for a different target pool, and a token-wide record carrying a pool scope.
  assert.equal(finding('low-pool-liquidity', [record(r, '100')], { scope: poolB }).reasonCode, 'EVIDENCE_MISSING');
  const tokenWide = record(rule('privileged-minting'), true, { scope: poolA });
  assert.equal(finding('privileged-minting', [tokenWide]).reasonCode, 'EVIDENCE_MISSING');
  // No pool given: pool rules are UNKNOWN, never NOT_CONFIRMED.
  for (const id of ['low-pool-liquidity', 'high-exit-impact', 'sell-transfer-tax'])
    assert.equal(finding(id, [record(rule(id), id === 'low-pool-liquidity' ? '9999999999' : 0)], { scope: null }).reasonCode, 'POOL_SCOPE_REQUIRED');
});

test('false-negative security claims: a "no risk" value needs the complete-audit method, two operators and fresh on-chain anchoring', () => {
  const mint = rule('privileged-minting'), upgrade = rule('admin-upgrade-authority'), tax = rule('sell-transfer-tax');
  assert.equal(finding('privileged-minting', [record(mint, false, { method: 'reachable-mint-authority' })]).reasonCode, 'SEMANTIC_PROOF_REQUIRED');
  assert.equal(finding('privileged-minting', [record(mint, false, { method: 'mint-selector-absent' })]).reasonCode, 'SEMANTIC_PROOF_REQUIRED');
  assert.equal(finding('privileged-minting', [record(mint, false, { state: 'SINGLE_SOURCE', operators: ['op-a'] })]).reasonCode, 'INDEPENDENT_ONCHAIN_PROOF_REQUIRED');
  // Two "operators" that are one upstream: the evidence contract rejects it outright.
  assert.equal(finding('admin-upgrade-authority', [record(upgrade, false, { operators: ['same', 'same'] })]).reasonCode, 'INVALID_MATCHING_EVIDENCE');
  // Cross-checked by indexers is not on-chain proof of an absence.
  const indexed = record(upgrade, false, { state: 'INDEPENDENTLY_CROSS_CHECKED', sourceClass: 'INDEXER' }); indexed.reasonCode = 'INDEPENDENT_AGREEMENT';
  assert.equal(finding('admin-upgrade-authority', [indexed]).reasonCode, 'INDEPENDENT_ONCHAIN_PROOF_REQUIRED');
  // Operators disagreeing on the audit result is not a "no risk" result.
  const split = record(mint, false); split.observations[1].value = true;
  assert.equal(finding('privileged-minting', [split]).reasonCode, 'INVALID_MATCHING_EVIDENCE');
  // An old "no mint" audit is STALE, not NOT_CONFIRMED.
  assert.equal(finding('privileged-minting', [record(mint, false, { age: mint.maxAgeMs + 1 })]).status, 'STALE');
  // A tax below threshold with a quote method (pool fee mixed in) is not a measured token-side deduction.
  assert.equal(finding('sell-transfer-tax', [record(tax, 0, { method: 'quoter-amount-out' })]).reasonCode, 'SEMANTIC_PROOF_REQUIRED');
  // A negative for one rule never answers another.
  const out = reviewed([record(mint, false)]);
  assert.equal(out.findings[index('privileged-minting')].status, 'NOT_CONFIRMED');
  assert.equal(out.findings[index('admin-upgrade-authority')].reasonCode, 'EVIDENCE_MISSING');
});

test('insufficient holder evidence: samples, wrong types and out-of-range shares stay UNKNOWN; old censuses are STALE', () => {
  const r = rule('top-ten-holder-concentration');
  const cases = [record(r, 4999, { method: 'top-holder-sample' }), record(r, '4999', { unit: 'bps' }), record(r, 10_001), record(r, -1), record(r, 4999, { unit: 'percent' })];
  for (const c of cases) assert.equal(finding('top-ten-holder-concentration', [c]).status, 'UNKNOWN', JSON.stringify(c.value) + ' ' + c.unit);
  assert.equal(finding('top-ten-holder-concentration', [record(r, 4999, { state: 'SINGLE_SOURCE', operators: ['blockscout'], sourceClass: 'INDEXER' })]).status, 'UNKNOWN');
  assert.equal(finding('top-ten-holder-concentration', [record(r, 4999, { age: 24 * 3_600_000 + 1 })]).status, 'STALE');
  assert.equal(finding('top-ten-holder-concentration', [record(r, 4999)]).status, 'NOT_CONFIRMED');
});

test('insufficient liquidity and exit evidence: provider values, non-integer cents and wrong units never decide', () => {
  const liq = rule('low-pool-liquidity'), exit = rule('high-exit-impact');
  for (const [value, opts] of [[2_500_000, {}], ['2500000.5', {}], ['-1', {}], ['2500000', { method: 'provider-reported' }], ['2500000', { unit: 'usd' }]])
    assert.equal(finding('low-pool-liquidity', [record(liq, value, opts)]).status, 'UNKNOWN', String(value) + JSON.stringify(opts));
  assert.equal(finding('low-pool-liquidity', [record(liq, '2500000')]).status, 'NOT_CONFIRMED');
  for (const value of [499.5, -3, 10_001]) assert.equal(finding('high-exit-impact', [record(exit, value)]).status, 'UNKNOWN', String(value));
  assert.equal(finding('high-exit-impact', [record(exit, 499, { age: exit.maxAgeMs + 1 })]).status, 'STALE');
});

test('CONFLICTING and UNSUPPORTED from any producer stay fail-closed and carry no severity', () => {
  const r = rule('privileged-minting'), base = record(r, false, { producer: { id: 'unreviewed', version: 1 } });
  const conflict = { ...base, state: 'CONFLICTING', reasonCode: 'VALUES_DISAGREE', value: null, observedAt: null, block: null, source: null, dataAgeMs: null,
    disagreement: { kind: 'VALUE_MISMATCH', sources: ['src-0', 'src-1'] } };
  conflict.observations = [base.observations[0], { ...base.observations[1], value: true, provenance: { method: 'reachable-mint-authority', reference: token } }];
  const c = finding('privileged-minting', [conflict]);
  assert.equal(c.status, 'CONFLICTING');assert.equal(c.severity, null);
  const unsupported = { ...base, state: 'UNSUPPORTED', reasonCode: 'PROXY_PATTERN_UNREVIEWED', value: null, observedAt: null, block: null, source: null, dataAgeMs: null, observations: [] };
  assert.equal(finding('privileged-minting', [unsupported]).status, 'UNSUPPORTED');
});
