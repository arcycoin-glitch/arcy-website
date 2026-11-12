'use strict';

const { createHash } = require('node:crypto');
const { STATES, parseMetricEvidence } = require('../verification/metric-evidence');

const MAX_RECORDS = 32;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function ref(evidence) {
  // Hash the canonical record, ordering observations by source ID so replay is stable.
  const observations = evidence.observations.slice().sort((a, b) => compare(a.source.id, b.source.id));
  const disagreement = evidence.disagreement && { ...evidence.disagreement, sources: evidence.disagreement.sources.slice().sort(compare) };
  const digest = createHash('sha256').update(JSON.stringify({ ...evidence, engine: { id: evidence.engine.id, version: evidence.engine.version },
    observations: observations.map(o => ({ ...o, provenance: { method: o.provenance.method, reference: o.provenance.reference } })), disagreement })).digest('hex');
  return { metricId: evidence.metricId, digest, block: evidence.block, state: evidence.state };
}

function collectEvidence(records, target, rules) {
  if (!Array.isArray(records) || records.length > MAX_RECORDS) throw new TypeError('Risk evidence must be an array of at most 32 records');
  const byMetric = new Map(rules.map(rule => [rule.metricId, { rule, records: new Map(), invalid: false }]));
  function matchingEntry(record) {
    // Use only own data properties to attribute malformed JSON records without invoking accessors.
    const field = key => record && Object.getOwnPropertyDescriptor(record, key)?.value;
    const entry = byMetric.get(field('metricId'));
    if (entry && field('network') === target.network && field('token') === target.token &&
        field('scope') === (entry.rule.scoped ? target.scope : null)) return entry;
    return null;
  }
  let rejected = 0, ignored = 0;
  for (const input of records) {
    let evidence;
    try { evidence = parseMetricEvidence(input); } catch {
      rejected++;
      const entry = matchingEntry(input);
      if (entry) entry.invalid = true;
      continue;
    }
    const entry = matchingEntry(evidence);
    if (!entry) {
      ignored++;
      continue;
    }
    const reference = ref(evidence);
    entry.records.set(reference.digest, { evidence, reference });
  }
  return { byMetric, rejected, ignored };
}

const result = (status, reasonCode, candidates = [], observedAt = null) => ({ status, reasonCode,
  evidenceRefs: candidates.slice(0, 2).map(candidate => candidate.reference), observedAt });

function inspectEvidence(rule, entry, now) {
  const ordered = [...entry.records.values()].sort((a, b) => compare(a.reference.digest, b.reference.digest));
  if (entry.invalid) return result('UNKNOWN', 'INVALID_MATCHING_EVIDENCE', ordered);
  if (!ordered.length) return result('UNKNOWN', 'EVIDENCE_MISSING');
  const fresh = [];
  for (const item of ordered) {
    const evidence = item.evidence;
    if (Date.parse(evidence.generatedAt) > now) return result('UNKNOWN', 'FUTURE_EVIDENCE', [item]);
    const timestamps = evidence.observations.map(o => o.observedAt).sort(compare);
    const observedAt = timestamps[0] ?? evidence.observedAt;
    if (evidence.state === STATES.STALE || (observedAt && now - Date.parse(observedAt) > rule.maxAgeMs)) continue;
    fresh.push({ ...item, observedAt });
  }
  if (!fresh.length) return result('STALE', 'EVIDENCE_EXPIRED', ordered);
  const conflict = fresh.find(({ evidence }) => evidence.state === STATES.CONFLICTING);
  if (conflict) return result('CONFLICTING', 'SOURCE_CONFLICT', [conflict], conflict.observedAt);

  const verified = fresh.filter(({ evidence }) => evidence.state === STATES.VERIFIED_ONCHAIN);
  for (const [index, first] of verified.entries()) {
    for (const second of verified.slice(index + 1)) {
      const a = first.evidence, b = second.evidence;
      if (a.block.number !== b.block.number) continue;
      if (a.block.hash !== b.block.hash) return result('CONFLICTING', 'BLOCK_ANCHOR_CONFLICT', [first, second]);
      if (a.unit === b.unit && a.value !== b.value) return result('CONFLICTING', 'VALUE_CONFLICT', [first, second]);
    }
  }
  if (ordered.length !== 1) return result('UNKNOWN', 'AMBIGUOUS_CURRENT_EVIDENCE', ordered);
  const [current] = fresh;
  const { evidence, observedAt } = current;
  if (evidence.state === STATES.UNSUPPORTED) return result('UNSUPPORTED', 'EVIDENCE_UNSUPPORTED', [current]);
  if (evidence.state !== STATES.VERIFIED_ONCHAIN) return result('UNKNOWN', 'INDEPENDENT_ONCHAIN_PROOF_REQUIRED', [current], observedAt);
  // A positive or negative determination needs a producer reviewed for THIS rule (see rules.js).
  const reviewed = Array.isArray(rule.producers) && rule.producers.some(p =>
    p && p.id === evidence.engine.id && Number.isSafeInteger(p.minVersion) && evidence.engine.version >= p.minVersion);
  if (!reviewed) return result('UNKNOWN', 'PRODUCER_NOT_REVIEWED', [current], observedAt);
  const matched = evidence.unit === rule.unit && evidence.observations.every(item =>
    item.provenance.method === rule.method(evidence.value) && item.provenance.reference === (rule.scoped ? evidence.scope : evidence.token));
  const verdict = matched ? rule.evaluate(evidence.value) : null;
  if (verdict === null) return result('UNKNOWN', 'SEMANTIC_PROOF_REQUIRED', [current], observedAt);
  return result(verdict ? 'CONFIRMED' : 'NOT_CONFIRMED', verdict ? 'CONDITION_EVIDENCED' : 'NEGATIVE_CONDITION_EVIDENCED', [current], observedAt);
}

module.exports = { MAX_RECORDS, collectEvidence, inspectEvidence };
