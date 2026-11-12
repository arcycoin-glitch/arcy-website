'use strict';

const HOUR = 3_600_000;
const MINUTE = 60_000;

// Values and method names form a producer contract. Only reviewed producers may assert these semantics.
// Each scoped rule applies to exactly one supplied pool, and each observation must reference that pool.
const RULES = Object.freeze([
  {
    id: 'admin-upgrade-authority', metricId: 'risk.upgrade-authority', unit: 'boolean', severity: 'HIGH',
    maxAgeMs: HOUR, scoped: false,
    method: value => value ? 'reachable-upgrade-authority' : 'complete-upgrade-authority-audit',
    evaluate: value => typeof value === 'boolean' ? value : null,
    positive: 'A reviewed reachable upgrade path is controlled by a privileged actor.',
    negative: 'The complete upgrade-authority audit found no privileged upgrade path in the reviewed architecture.',
  },
  {
    id: 'high-exit-impact', metricId: 'risk.exit-impact', unit: 'bps', severity: 'HIGH',
    maxAgeMs: 5 * MINUTE, scoped: true,
    method: () => 'pinned-one-percent-reserve-exit-replay',
    evaluate: value => basisPoints(value, 500),
    positive: 'The reviewed single-pool sell probe measured at least 5% model price impact.',
    negative: 'The reviewed single-pool sell probe measured less than 5% model price impact.',
  },
  {
    id: 'low-pool-liquidity', metricId: 'risk.pool-liquidity', unit: 'usd-cent', severity: 'MEDIUM',
    maxAgeMs: 15 * MINUTE, scoped: true,
    method: () => 'pinned-pool-reserves-oracle-usd',
    evaluate: value => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) ? BigInt(value) < 2_500_000n : null,
    positive: 'The reviewed pool had less than $25,000 in oracle-valued reserves.',
    negative: 'The reviewed pool had at least $25,000 in oracle-valued reserves.',
  },
  {
    id: 'privileged-minting', metricId: 'risk.mint-authority', unit: 'boolean', severity: 'HIGH',
    maxAgeMs: HOUR, scoped: false,
    method: value => value ? 'reachable-mint-authority' : 'complete-mint-authority-audit',
    evaluate: value => typeof value === 'boolean' ? value : null,
    positive: 'A reviewed reachable supply-increase path is controlled by a privileged actor.',
    negative: 'The complete mint-authority audit found no privileged mint path in the reviewed architecture.',
  },
  {
    id: 'sell-transfer-tax', metricId: 'risk.sell-transfer-tax', unit: 'bps', severity: 'MEDIUM',
    maxAgeMs: 15 * MINUTE, scoped: true,
    method: () => 'pinned-one-percent-reserve-sell-transfer-replay',
    evaluate: value => basisPoints(value, 100),
    positive: 'The reviewed sell transfer measured a token-side deduction of at least 1%.',
    negative: 'The reviewed sell transfer measured a token-side deduction below 1%.',
  },
  {
    id: 'top-ten-holder-concentration', metricId: 'risk.top-ten-concentration', unit: 'bps', severity: 'MEDIUM',
    maxAgeMs: 24 * HOUR, scoped: false,
    method: () => 'pinned-complete-holder-supply-reconciliation',
    evaluate: value => basisPoints(value, 5_000),
    positive: 'The ten largest eligible addresses held at least 50% of eligible reconciled supply.',
    negative: 'The ten largest eligible addresses held less than 50% of eligible reconciled supply.',
  },
].map(rule => Object.freeze({ ...rule, version: 1 })));

function basisPoints(value, threshold) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 10_000 ? value >= threshold : null;
}

module.exports = { RULES };
