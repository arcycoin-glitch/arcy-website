'use strict';

const { NETWORKS } = require('../verification/metric-evidence');
const { RULES } = require('./rules');
const { MAX_RECORDS, collectEvidence, inspectEvidence } = require('./evidence');

const SCHEMA_VERSION = 1;
const STATUSES = Object.freeze(['CONFIRMED', 'NOT_CONFIRMED', 'UNKNOWN', 'STALE', 'CONFLICTING', 'UNSUPPORTED']);
const ADDRESS = /^0x[0-9a-f]{40}$/;
const POOL = /^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const explanations = Object.freeze({
  EVIDENCE_MISSING: 'No matching typed evidence was provided for this rule.',
  INVALID_MATCHING_EVIDENCE: 'A record for this rule and target failed evidence validation.',
  POOL_SCOPE_REQUIRED: 'This rule requires a specific reviewed pool.',
  FUTURE_EVIDENCE: 'The evidence was generated after the evaluation time.',
  EVIDENCE_EXPIRED: 'The evidence is outside the rule’s evaluation window.',
  SOURCE_CONFLICT: 'The verification record reports a source conflict.',
  BLOCK_ANCHOR_CONFLICT: 'The supplied verified records disagree on the hash at the same block height.',
  VALUE_CONFLICT: 'The supplied verified records disagree on the value at the same block.',
  AMBIGUOUS_CURRENT_EVIDENCE: 'Multiple distinct current records were supplied for this rule.',
  EVIDENCE_UNSUPPORTED: 'The verification producer reports that this claim is unsupported.',
  INDEPENDENT_ONCHAIN_PROOF_REQUIRED: 'The record lacks independently corroborated pinned on-chain proof.',
  SEMANTIC_PROOF_REQUIRED: 'The record does not prove the bounded claim required by this rule.',
});

function evaluateRisk({ network, chainId, token, scope = null, evidence = [], now } = {}) {
  if (typeof network !== 'string' || !Object.hasOwn(NETWORKS, network) || NETWORKS[network] !== chainId ||
      typeof token !== 'string' || !ADDRESS.test(token) || /^0x0+$/.test(token) ||
      (scope !== null && (typeof scope !== 'string' || !POOL.test(scope) || /^0x0+$/.test(scope)))) {
    throw new TypeError('Invalid risk target identity');
  }
  if (!Number.isSafeInteger(now) || now < 0 || now > 253402300799999) throw new TypeError('Risk evaluation requires an explicit UTC millisecond clock');
  const evaluatedAt = new Date(now).toISOString();
  const { byMetric, rejected, ignored } = collectEvidence(evidence, { network, token, scope }, RULES);
  const counts = Object.fromEntries(STATUSES.map(status => [status, 0]));
  const findings = RULES.map(rule => {
    const assessment = rule.scoped && scope === null ?
      { status: 'UNKNOWN', reasonCode: 'POOL_SCOPE_REQUIRED', evidenceRefs: [], observedAt: null } :
      inspectEvidence(rule, byMetric.get(rule.metricId), now);
    counts[assessment.status]++;
    const explanation = assessment.status === 'CONFIRMED' ? rule.positive :
      assessment.status === 'NOT_CONFIRMED' ? rule.negative : explanations[assessment.reasonCode];
    return { ruleId: rule.id, ruleVersion: rule.version, network, chainId, token, scope: rule.scoped ? scope : null,
      severity: assessment.status === 'CONFIRMED' ? rule.severity : null, ...assessment, evaluatedAt, explanation };
  });
  const complete = counts.CONFIRMED + counts.NOT_CONFIRMED === findings.length && rejected === 0;
  return { schemaVersion: SCHEMA_VERSION, findings, dataQuality: { coverage: complete ? 'COMPLETE' : 'INCOMPLETE', counts,
    rejectedEvidence: rejected, ignoredEvidence: ignored } };
}

module.exports = { evaluateRisk, SCHEMA_VERSION, STATUSES, MAX_RECORDS };
