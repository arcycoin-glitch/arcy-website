'use strict';

const SCHEMA_VERSION = 1;
const NETWORKS = Object.freeze({ arc: 5042, ethereum: 1, robinhood: 4663 });
const STATES = Object.freeze({
  VERIFIED_ONCHAIN: 'VERIFIED_ONCHAIN',
  INDEPENDENTLY_CROSS_CHECKED: 'INDEPENDENTLY_CROSS_CHECKED',
  SINGLE_SOURCE: 'SINGLE_SOURCE',
  CONFLICTING: 'CONFLICTING',
  STALE: 'STALE',
  UNAVAILABLE: 'UNAVAILABLE',
  UNSUPPORTED: 'UNSUPPORTED',
  NOT_VERIFIED: 'NOT_VERIFIED',
});
const SOURCE_CLASSES = new Set(['ONCHAIN_RPC', 'INDEXER', 'MARKET', 'WORKER', 'ISSUER']);
const MAX_OBSERVATIONS = 8;
const SLUG = /^[a-z][a-z0-9_.-]{0,63}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const HASH = /^0x[0-9a-f]{64}$/;
const UINT = /^(0|[1-9][0-9]{0,77})$/;
const REASON = /^[A-Z][A-Z0-9_]{0,63}$/;
const VALUE_TEXT = /^(?:[a-z][a-z0-9_.-]{0,63}|0x[0-9a-f]{2,128}|-?(?:0|[1-9][0-9]{0,77})(?:\.[0-9]{0,36}[1-9])?)$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function requireValid(condition, field) {
  if (!condition) throw new TypeError(`Invalid metric evidence: ${field}`);
}

function shape(input, fields, field) {
  requireValid(input && Object.getPrototypeOf(input) === Object.prototype &&
    Reflect.ownKeys(input).length === fields.length &&
    fields.every(key => Object.getOwnPropertyDescriptor(input, key)?.hasOwnProperty('value')), field);
}

function matches(pattern, value) {
  return typeof value === 'string' && pattern.test(value);
}

function timestamp(value, field) {
  const time = matches(TIME, value) ? Date.parse(value) : NaN;
  requireValid(Number.isFinite(time) && new Date(time).toISOString() === value, field);
  return time;
}

function parseBlock(block) {
  if (block === null) return null;
  shape(block, ['number', 'hash'], 'block');
  requireValid(matches(UINT, block.number) && matches(HASH, block.hash) && !/^0x0+$/.test(block.hash), 'block anchor');
  return { number: block.number, hash: block.hash };
}

function sameBlock(a, b) {
  return a === b || (a !== null && b !== null && a.number === b.number && a.hash === b.hash);
}

function parseSource(source) {
  shape(source, ['id', 'class', 'operator'], 'source');
  requireValid(matches(SLUG, source.id) && SOURCE_CLASSES.has(source.class) && matches(SLUG, source.operator), 'source identity');
  return { id: source.id, class: source.class, operator: source.operator };
}

function sameSource(a, b) {
  return a.id === b.id && a.class === b.class && a.operator === b.operator;
}

function validValue(value) {
  return typeof value === 'boolean' || (Number.isSafeInteger(value) && !Object.is(value, -0)) ||
    (matches(VALUE_TEXT, value) && value !== '-0');
}

function parseObservation(observation, metric, generated) {
  shape(observation, ['source', 'value', 'unit', 'token', 'scope', 'observedAt', 'block', 'chainId', 'provenance'], 'observation');
  const { value, unit, token, scope, observedAt, chainId, provenance } = observation;
  const source = parseSource(observation.source);
  const block = parseBlock(observation.block);
  requireValid(validValue(value) && matches(SLUG, unit) && token === metric.token && scope === metric.scope &&
    chainId === NETWORKS[metric.network] && timestamp(observedAt, 'observedAt') <= generated, 'observation identity or value');
  requireValid(source.class !== 'ONCHAIN_RPC' || block !== null, 'on-chain block anchor');
  shape(provenance, ['method', 'reference'], 'provenance');
  requireValid(matches(SLUG, provenance.method) && (provenance.reference === null ||
    matches(SLUG, provenance.reference) || matches(ADDRESS, provenance.reference) || matches(HASH, provenance.reference)), 'provenance');
  return { source, value, unit, token, scope, observedAt, block, chainId, provenance: { ...provenance } };
}

function parseDisagreement(input, observations) {
  shape(input, ['kind', 'sources'], 'disagreement');
  requireValid(['VALUE_MISMATCH', 'BLOCK_HASH_MISMATCH'].includes(input.kind) &&
    Array.isArray(input.sources) && input.sources.length >= 2 && input.sources.length <= observations.length, 'disagreement kind or source count');
  const sources = [...input.sources];
  requireValid(new Set(sources).size === sources.length && sources.every(id => observations.some(item => item.source.id === id)), 'disagreement sources');
  return { kind: input.kind, sources };
}

function isTrustedEvidence(evidence) {
  return evidence?.state === STATES.VERIFIED_ONCHAIN || evidence?.state === STATES.INDEPENDENTLY_CROSS_CHECKED;
}

function parseMetricEvidence(input) {
  shape(input, ['schemaVersion', 'metricId', 'network', 'token', 'scope', 'value', 'unit', 'observedAt', 'generatedAt',
    'block', 'source', 'state', 'reasonCode', 'dataAgeMs', 'observations', 'disagreement', 'engine'], 'record');
  const { schemaVersion, metricId, network, token, scope, value, unit, observedAt, generatedAt,
    state, reasonCode, dataAgeMs, engine } = input;
  requireValid(schemaVersion === SCHEMA_VERSION && matches(SLUG, metricId) && typeof network === 'string' &&
    Object.hasOwn(NETWORKS, network) && matches(ADDRESS, token) && (scope === null || matches(SLUG, scope) ||
    matches(ADDRESS, scope) || matches(HASH, scope)) && matches(SLUG, unit), 'identity');
  requireValid(typeof state === 'string' && Object.hasOwn(STATES, state) && matches(REASON, reasonCode), 'state or reason');
  shape(engine, ['id', 'version'], 'engine');
  requireValid(matches(SLUG, engine.id) && Number.isSafeInteger(engine.version) && engine.version > 0, 'engine version');
  const generated = timestamp(generatedAt, 'generatedAt');
  requireValid(Array.isArray(input.observations) && input.observations.length <= MAX_OBSERVATIONS, 'observation count');
  const observations = Array.from(input.observations, item => parseObservation(item, input, generated));
  requireValid(new Set(observations.map(item => item.source.id)).size === observations.length, 'duplicate source');
  const block = parseBlock(input.block);
  const source = input.source === null ? null : parseSource(input.source);
  const disagreement = state === STATES.CONFLICTING ? parseDisagreement(input.disagreement, observations) : null;
  requireValid(state === STATES.CONFLICTING || input.disagreement === null, 'disagreement state');

  if (isTrustedEvidence(input) || state === STATES.SINGLE_SOURCE) {
    const observed = timestamp(observedAt, 'observedAt');
    requireValid(validValue(value) && source && observed <= generated && dataAgeMs === generated - observed, 'current value');
    requireValid(observations.some(item => sameSource(source, item.source) && item.value === value &&
      item.unit === unit && item.observedAt === observedAt && sameBlock(item.block, block)), 'selected observation');
    const operators = new Set(observations.map(item => item.source.operator));
    if (isTrustedEvidence(input)) {
      const onchain = state === STATES.VERIFIED_ONCHAIN;
      requireValid(operators.size >= 2 && observations.every(item => item.value === value && item.unit === unit &&
        sameBlock(item.block, block) && (onchain ? item.source.class === 'ONCHAIN_RPC' : item.observedAt === observedAt)) &&
        (onchain ? block !== null && reasonCode === 'EXACT_ONCHAIN_AGREEMENT' : reasonCode === 'INDEPENDENT_AGREEMENT'), 'independent agreement');
    } else {
      requireValid(operators.size === 1 && observations.every(item => item.value === value && item.unit === unit &&
        sameBlock(item.block, block)), 'single-source agreement');
    }
  } else {
    requireValid(value === null && observedAt === null && source === null && block === null && dataAgeMs === null, 'failed record contains a current value');
  }

  return { schemaVersion, metricId, network, token, scope, value, unit, observedAt, generatedAt,
    block, source, state, reasonCode, dataAgeMs, observations, disagreement, engine: { ...engine } };
}

module.exports = { SCHEMA_VERSION, NETWORKS, STATES, MAX_OBSERVATIONS, isTrustedEvidence, parseMetricEvidence };
