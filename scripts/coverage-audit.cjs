'use strict';
// Read-only verified-coverage audit of real ARCY SEARCH token reports.
//
//   node scripts/coverage-audit.cjs <repo> <output.json> [--env=clean|production-equivalent] [--cohort=<cohort.json>]
//   node scripts/coverage-audit.cjs --summarize <captured.json> <output.json>
//
// Guarantees:
// - Read-only: holder refresh queues and every write-capable credential are
//   always removed, so an audit can never enqueue indexing or publish data.
// - No secret values are written: only the PRESENCE of allow-listed
//   configuration names is recorded, and the output is redacted again before
//   it is saved.
// - A missing value is never coerced into coverage. Only an explicit status
//   allow-list counts as VERIFIED; SOURCE_REPORTED is counted separately and
//   unknown statuses are UNCLASSIFIED (never VERIFIED).
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const OS_KEEP = Object.freeze(['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP']);
// Configuration a production deployment may legitimately use for READ-ONLY
// evidence. Values are never written to the output; only presence is.
const PRODUCTION_EQUIVALENT_KEYS = Object.freeze([
  'ETH_RPC_URL', 'ETH_RPC_FALLBACK_URL', 'ARC_RPC_URL', 'ARC_RPC_FALLBACK_URL',
  'ROBINHOOD_RPC_URL', 'ROBINHOOD_RPC_FALLBACK_URL',
  'BLOCKSCOUT_API_KEY', 'ETHERSCAN_API_KEY', 'TOKENOMIST_API_KEY',
  'GOPLUS_PUBLIC_DISPLAY_APPROVED', 'DEXSCREENER_PUBLIC_DISPLAY_APPROVED',
  'TETHER_TRANSPARENCY_DISPLAY_APPROVED',
  'ARC_HOLDER_PUBLISHED_URL', 'ARC_HOLDER_PUBLIC_KEY', 'ARC_HOLDER_INTERACTIVE_LIMIT'
]);
// Never present during an audit, in any mode: these enable writes/side effects.
const ALWAYS_REMOVED = Object.freeze(['ARC_HOLDER_QUEUE_URL', 'ARC_HOLDER_QUEUE_TOKEN', 'CRON_SECRET']);

const DEFAULT_TOKENS = Object.freeze([
  ['arc', 'ARCY', '0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b'],
  ['ethereum', 'USDT', '0xdac17f958d2ee523a2206206994597c13d831ec7'],
  ['robinhood', 'AAPL', '0xaf3d76f1834a1d425780943c99ea8a608f8a93f9'],
  ['arc', 'ARGUS', '0xece5ca8bf9220718e5727754026757512212cb3c'],
  ['ethereum', 'USDC', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'],
  ['robinhood', 'TSLA', '0x322f0929c4625ed5bad873c95208d54e1c003b2d'],
  ['arc', 'USDT-Arc', '0x3b0d0f9825850d3ab1491253b86c4cc26ff1250a'],
  ['ethereum', 'UNI', '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984'],
  ['robinhood', 'LINK', '0x492641f648a4986844848e0befe66d14817bce34']
]);
const NETWORKS = Object.freeze(['arc', 'ethereum', 'robinhood']);
// The three research cards this audit measures (four primary fields each).
const AUDITED_CARDS = Object.freeze(['mechanics', 'holders', 'supply']);
const FALLBACK_SCHEMA = Object.freeze({
  supply: ['totalSupply', 'circulatingSupply', 'burnAddressBalance', 'nextUnlock'],
  holders: ['holderCount', 'largestWalletPct', 'top10Pct', 'top20Pct'],
  mechanics: ['tradingTaxes', 'mintCapability', 'ownerAdmin', 'contractArchitecture']
});

// ---- Evidence tiers --------------------------------------------------------
// VERIFIED: value read or derived on-chain at the analysis/snapshot block, or
// a reviewed source matched to pinned deployed bytecode.
const VERIFIED_STATUSES = Object.freeze({
  ON_CHAIN: 'ONCHAIN_READ', ON_CHAIN_DERIVED: 'ONCHAIN_DERIVED', ONCHAIN_VERIFIED: 'ONCHAIN_READ',
  ON_CHAIN_VERIFIED_UNITS: 'ONCHAIN_READ', ONCHAIN_RECONCILED: 'ONCHAIN_RECONCILED',
  RECONCILED_SNAPSHOT: 'ONCHAIN_RECONCILED', SIGNED_ONCHAIN_SNAPSHOT: 'ONCHAIN_RECONCILED',
  HISTORICAL_ONCHAIN_VERIFIED: 'ONCHAIN_HISTORICAL',
  VERIFIED_SOURCE: 'REVIEWED_SOURCE', VERIFIED_SOURCE_AND_STATE: 'REVIEWED_SOURCE_AND_STATE',
  // A pinned-block getter read: the returned value is on-chain, its meaning
  // (complete admin model) is limited by the field's own scope text.
  GETTER_REPORTED: 'ONCHAIN_GETTER',
  // Complete runtime analysis that found no such capability.
  NOT_DETECTED: 'ONCHAIN_ANALYSIS_NEGATIVE'
});
// SOURCE_REPORTED: an attributed third-party/issuer/project statement, or a
// source-ranked candidate set whose completeness is not proven on-chain.
const SOURCE_REPORTED_STATUSES = Object.freeze({
  SOURCE_REPORTED: 'THIRD_PARTY', SOURCE_REPORTED_RPC_RECONCILED: 'SOURCE_RANKED_RPC_BALANCES',
  PROJECT_REPORTED: 'PROJECT', OFFICIAL_DOCUMENTATION: 'PROJECT', MARKET_API_VERIFIED: 'THIRD_PARTY'
});
function tierOf(field) {
  if (!field || field.dataState !== 'DATA_FOUND') return {tier: 'MISSING', subtier: null};
  if (field.value === null || field.value === undefined) return {tier: 'UNCLASSIFIED', subtier: 'DATA_FOUND_WITHOUT_VALUE'};
  const status = String(field.status || '');
  if (Object.hasOwn(VERIFIED_STATUSES, status)) return {tier: 'VERIFIED', subtier: VERIFIED_STATUSES[status]};
  if (Object.hasOwn(SOURCE_REPORTED_STATUSES, status)) return {tier: 'SOURCE_REPORTED', subtier: SOURCE_REPORTED_STATUSES[status]};
  return {tier: 'UNCLASSIFIED', subtier: status || 'NO_STATUS'};
}

// ---- Missing-data reasons --------------------------------------------------
const REASON_CLASSES = Object.freeze([
  'LICENSE_OR_PERMISSION_GATED', 'UNSUPPORTED_ADAPTER', 'PROVIDER_FAILURE',
  'IDENTITY_OR_VALIDATION_REJECTED', 'NO_EVIDENCE', 'REPORT_FAILED'
]);
function classifyMissing(field) {
  const state = String(field?.dataState || ''), code = String(field?.reasonCode || '');
  if (/LICENSE|PERMISSION|APPROVAL|CREDENTIALS_REQUIRED|PROVIDER_DISABLED/.test(code)) return 'LICENSE_OR_PERMISSION_GATED';
  if (state === 'UNSUPPORTED' || /UNSUPPORTED|NOT_IMPLEMENTED/.test(code)) return 'UNSUPPORTED_ADAPTER';
  if (state === 'SOURCE_API_FAILED' || state === 'RPC_FAILED') return 'PROVIDER_FAILURE';
  // Evidence that was retrieved but rejected by identity/consistency checks
  // (possible software, mapping or source-scope problem — investigate).
  if (/MISMATCH|INVALID|MALFORMED|SCHEMA|RECONCILIATION_FAILED/.test(code)) return 'IDENTITY_OR_VALIDATION_REJECTED';
  if (/FAILED|TIMEOUT|HTTP_\d|RATE_LIMIT|CIRCUIT|UNAVAILABLE/.test(code)) return 'PROVIDER_FAILURE';
  return 'NO_EVIDENCE';
}

// ---- Applicability ---------------------------------------------------------
// A field is NOT applicable only on explicit, issuer-registry identity. Every
// other field stays APPLICABLE (in the denominator) so missing evidence is
// never hidden by reclassification.
function applicability(network, cardId, fieldId, report) {
  const identity = report?.tokenIdentity;
  if (network === 'robinhood' && cardId === 'supply' && fieldId === 'nextUnlock' &&
      identity?.status === 'REGISTRY_MATCHED' && identity?.type === 'STOCK_TOKEN' &&
      identity?.source === 'Robinhood official asset registry') {
    return {state: 'NOT_APPLICABLE_BY_REGISTRY',
      basis: 'Robinhood official asset registry identifies this exact contract as a Stock Token; token vesting unlocks do not apply.'};
  }
  return {state: 'APPLICABLE', basis: null};
}

function compact(fields, keys) {
  const source = fields || {};
  const names = Array.isArray(keys) ? keys : Object.keys(source);
  return Object.fromEntries(names.map(key => {
    const f = source[key];
    return [key, {
      dataState: f?.dataState || null, status: f?.status || null,
      reasonCode: f?.reasonCode || null, source: f?.source || null,
      value: f?.value ?? null, freshness: f?.freshness || null,
      ...(key === 'circulatingSupply' ? {evidence: f?.evidence || []} : {})
    }];
  }));
}

function blockNumber(hex) {
  return typeof hex === 'string' && /^0x[0-9a-f]+$/i.test(hex) ? BigInt(hex).toString() : null;
}

// ---- Coverage summary ------------------------------------------------------
function emptyBucket() {
  return {applicableFields: 0, notApplicableFields: 0, verified: 0, sourceReported: 0, unclassified: 0, missing: 0,
    missingReasons: Object.fromEntries(REASON_CLASSES.map(r => [r, 0])), verifiedSubtiers: {}, sourceReportedSubtiers: {}};
}
function pct(n, d) { return d ? Math.round(n * 10000 / d) / 100 : null; }
function finish(bucket) {
  return {...bucket,
    verifiedPct: pct(bucket.verified, bucket.applicableFields),
    sourceReportedPct: pct(bucket.sourceReported, bucket.applicableFields),
    anyEvidencePct: pct(bucket.verified + bucket.sourceReported + bucket.unclassified, bucket.applicableFields)};
}
function add(bucket, entry) {
  if (entry.applicability === 'NOT_APPLICABLE_BY_REGISTRY') { bucket.notApplicableFields++; return; }
  bucket.applicableFields++;
  if (entry.tier === 'VERIFIED') { bucket.verified++; bucket.verifiedSubtiers[entry.subtier] = (bucket.verifiedSubtiers[entry.subtier] || 0) + 1; }
  else if (entry.tier === 'SOURCE_REPORTED') { bucket.sourceReported++; bucket.sourceReportedSubtiers[entry.subtier] = (bucket.sourceReportedSubtiers[entry.subtier] || 0) + 1; }
  else if (entry.tier === 'UNCLASSIFIED') bucket.unclassified++;
  else { bucket.missing++; bucket.missingReasons[entry.reasonClass]++; }
}
// Field entries for one captured result. A card absent from an older capture
// is NOT_MEASURED (excluded from the summary), never counted as missing data.
function entriesFor(result, schemaKeys) {
  const out = [], notMeasured = [];
  for (const cardId of AUDITED_CARDS) {
    const keys = schemaKeys[cardId] || FALLBACK_SCHEMA[cardId];
    if (result.error) {
      for (const fieldId of keys) out.push({network: result.network, symbol: result.symbol, cardId, fieldId,
        applicability: 'APPLICABLE', tier: 'MISSING', subtier: null, reasonClass: 'REPORT_FAILED', reasonCode: result.error});
      continue;
    }
    const card = result[cardId];
    if (!card || typeof card !== 'object') { notMeasured.push(cardId); continue; }
    for (const fieldId of keys) {
      const field = card[fieldId];
      const app = result.applicability?.[cardId]?.[fieldId]?.state || 'APPLICABLE';
      const {tier, subtier} = tierOf(field);
      // A registry "not applicable" claim never hides a value that was found.
      const effective = app === 'NOT_APPLICABLE_BY_REGISTRY' && tier !== 'MISSING' ? 'APPLICABLE' : app;
      out.push({network: result.network, symbol: result.symbol, cardId, fieldId, applicability: effective, tier, subtier,
        reasonClass: tier === 'MISSING' ? classifyMissing(field) : null, reasonCode: field?.reasonCode || null});
    }
  }
  return {entries: out, notMeasured};
}
function summarize(results, schemaKeys = FALLBACK_SCHEMA) {
  const byNetwork = {}, byNetworkCard = {}, byNetworkCardField = {}, overall = emptyBucket(), notMeasured = [];
  for (const network of NETWORKS) {
    byNetwork[network] = emptyBucket(); byNetworkCard[network] = {}; byNetworkCardField[network] = {};
    for (const cardId of AUDITED_CARDS) {
      byNetworkCard[network][cardId] = emptyBucket(); byNetworkCardField[network][cardId] = {};
      for (const fieldId of schemaKeys[cardId] || FALLBACK_SCHEMA[cardId]) byNetworkCardField[network][cardId][fieldId] = emptyBucket();
    }
  }
  const tokensByNetwork = Object.fromEntries(NETWORKS.map(n => [n, 0]));
  for (const result of results) {
    if (!NETWORKS.includes(result?.network)) continue;
    tokensByNetwork[result.network]++;
    const {entries, notMeasured: absent} = entriesFor(result, schemaKeys);
    for (const cardId of absent) notMeasured.push({network: result.network, symbol: result.symbol, cardId});
    for (const e of entries) {
      add(overall, e); add(byNetwork[e.network], e); add(byNetworkCard[e.network][e.cardId], e);
      add(byNetworkCardField[e.network][e.cardId][e.fieldId], e);
    }
  }
  const map = (obj, fn) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v)]));
  return {
    countingRule: 'verifiedPct = VERIFIED / APPLICABLE fields. SOURCE_REPORTED and UNCLASSIFIED are reported separately and are never VERIFIED. NOT_APPLICABLE_BY_REGISTRY fields leave the denominator only on exact issuer-registry identity. NOT_MEASURED cards (absent from a capture) are excluded and listed.',
    tokensByNetwork,
    overall: finish(overall),
    byNetwork: map(byNetwork, finish),
    byNetworkCard: map(byNetworkCard, cards => map(cards, finish)),
    byNetworkCardField: map(byNetworkCardField, cards => map(cards, fields => map(fields, finish))),
    notMeasured,
    sampleWarning: Object.values(tokensByNetwork).some(n => n < 30) ?
      'Fewer than 30 tokens on at least one network: results describe this cohort only and are not a representative coverage estimate.' : null
  };
}

// ---- Safety: environment and redaction -------------------------------------
function sanitizeEnv(env, mode) {
  if (!['clean', 'production-equivalent'].includes(mode)) throw Error('Unsupported --env mode: ' + mode);
  const keep = new Set([...OS_KEEP, ...(mode === 'production-equivalent' ? PRODUCTION_EQUIVALENT_KEYS : [])]);
  const secrets = [];
  for (const key of Object.keys(env)) {
    if (!keep.has(key) || ALWAYS_REMOVED.includes(key)) { delete env[key]; continue; }
    if (PRODUCTION_EQUIVALENT_KEYS.includes(key) && typeof env[key] === 'string' && env[key].length >= 6) secrets.push(env[key]);
  }
  // Public-deployment provider gates behave exactly as on Vercel.
  env.VERCEL = '1';
  const presence = Object.fromEntries(PRODUCTION_EQUIVALENT_KEYS.map(k => [k, typeof env[k] === 'string' && env[k] !== '']));
  return {mode, presence, removedAlways: [...ALWAYS_REMOVED], secrets};
}
const SECRET_QUERY = /^(api[_-]?key|apikey|key|token|access[_-]?token|secret|signature|auth)$/i;
function redactString(text, secrets) {
  let out = text;
  for (const secret of secrets) if (secret) out = out.split(secret).join('[REDACTED]');
  return out.replace(/https?:\/\/[^\s"'<>]+/g, raw => {
    try {
      const url = new URL(raw);
      let changed = false;
      if (url.username || url.password) { url.username = ''; url.password = ''; changed = true; }
      for (const name of [...url.searchParams.keys()]) if (SECRET_QUERY.test(name)) { url.searchParams.set(name, '[REDACTED]'); changed = true; }
      return changed ? url.toString() : raw;
    } catch { return raw; }
  });
}
function redact(value, secrets = []) {
  if (typeof value === 'string') return redactString(value, secrets);
  if (Array.isArray(value)) return value.map(v => redact(v, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, secrets)]));
  return value;
}

// ---- Run metadata ----------------------------------------------------------
function gitInfo(repo) {
  const git = args => { try { return execFileSync('git', ['-C', repo, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim(); } catch { return null; } };
  const porcelain = git(['status', '--porcelain']);
  return {sha: git(['rev-parse', 'HEAD']), branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    uncommittedChanges: porcelain === null ? null : porcelain.split('\n').filter(Boolean).length};
}
function loadSchemaKeys(repo) {
  try {
    const schema = require(path.join(path.resolve(repo), 'search/server/schema.js'));
    return Object.fromEntries(schema.filter(c => AUDITED_CARDS.includes(c.id)).map(c => [c.id, c.fields.map(([key]) => key)]));
  } catch { return {...FALLBACK_SCHEMA}; }
}
function loadCohort(file) {
  if (!file) return DEFAULT_TOKENS.map(t => [...t]);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const items = Array.isArray(raw) ? raw : raw?.tokens;
  if (!Array.isArray(items) || !items.length) throw Error('Cohort must be a non-empty array of {network,symbol,address}');
  const seen = new Set();
  return items.map(item => {
    const network = item?.network, address = String(item?.address || '').toLowerCase();
    if (!NETWORKS.includes(network) || !/^0x[0-9a-f]{40}$/.test(address)) throw Error('Invalid cohort entry');
    const key = network + ':' + address;
    if (seen.has(key)) throw Error('Duplicate cohort entry ' + key);
    seen.add(key);
    return [network, String(item.symbol || '').slice(0, 30) || address.slice(0, 10), address];
  });
}
function parseArgs(argv) {
  const flags = {}, positional = [];
  for (const arg of argv) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (match) flags[match[1]] = match[2] === undefined ? true : match[2];
    else positional.push(arg);
  }
  return {flags, positional};
}

async function auditToken(service, schemaKeys, [network, symbol, address]) {
  const started = Date.now(), startedAt = new Date(started).toISOString();
  try {
    const report = await service.report({network, address});
    const cards = report.cards || {};
    const result = {network, symbol, address, block: report.block, blockNumber: blockNumber(report.block),
      chainId: report.chainId, startedAt, finishedAt: new Date().toISOString(), ms: Date.now() - started,
      tokenIdentity: report.tokenIdentity ? {status: report.tokenIdentity.status || null, type: report.tokenIdentity.type || null,
        source: report.tokenIdentity.source || null} : null,
      mechanics: compact(cards.mechanics?.fields, schemaKeys.mechanics),
      holders: compact(cards.holders?.fields, schemaKeys.holders),
      supply: compact(cards.supply?.fields, schemaKeys.supply),
      supplyContext: compact(cards.supply?.context)};
    result.applicability = Object.fromEntries(AUDITED_CARDS.map(cardId => [cardId,
      Object.fromEntries((schemaKeys[cardId] || []).map(fieldId => [fieldId, applicability(network, cardId, fieldId, report)]))]));
    return result;
  } catch (error) {
    // Constant category only; exception text may contain provider URLs.
    return {network, symbol, address, startedAt, finishedAt: new Date().toISOString(), ms: Date.now() - started,
      error: error?.code || error?.name || 'ERROR'};
  }
}
function write(output, document, secrets) {
  fs.writeFileSync(output, JSON.stringify(redact(document, secrets), null, 2));
}
async function runAudit(repo, output, {envMode = 'clean', cohortFile = null} = {}) {
  const environment = sanitizeEnv(process.env, envMode);
  const tokens = loadCohort(cohortFile);
  const schemaKeys = loadSchemaKeys(repo);
  const service = require(path.join(path.resolve(repo), 'search/server/lib/multichain-service.js'));
  const run = {startedAt: new Date().toISOString(), finishedAt: null, git: gitInfo(repo), node: process.version,
    environment: {mode: environment.mode, presence: environment.presence, removedAlways: environment.removedAlways},
    cohort: {source: cohortFile ? path.basename(cohortFile) : 'DEFAULT_TOKENS', tokens: tokens.length}};
  const results = [];
  const document = () => ({schemaVersion: 2,
    mode: 'read-only public providers; no write credentials; no deployment; secret values never recorded',
    run, coverage: summarize(results, schemaKeys), results});
  for (let i = 0; i < tokens.length; i += 3) {
    const batch = await Promise.all(tokens.slice(i, i + 3).map(token => auditToken(service, schemaKeys, token)));
    results.push(...batch);
    for (const r of batch) console.log(JSON.stringify({network: r.network, symbol: r.symbol, block: r.block || null, ms: r.ms, error: r.error || null}));
    write(output, document(), environment.secrets);
  }
  run.finishedAt = new Date().toISOString();
  write(output, document(), environment.secrets);
  return document();
}
function summarizeCapture(input, output) {
  const captured = JSON.parse(fs.readFileSync(input, 'utf8'));
  const results = Array.isArray(captured?.results) ? captured.results : [];
  const document = {schemaVersion: 2, mode: 'offline re-summary of a previously captured read-only audit; no network access',
    run: {summarizedAt: new Date().toISOString(), input: path.basename(input), capturedRun: captured.run || null},
    coverage: summarize(results, FALLBACK_SCHEMA)};
  write(output, document, []);
  return document;
}

if (require.main === module) {
  const {flags, positional} = parseArgs(process.argv.slice(2));
  const fail = message => { console.error(message); process.exitCode = 1; };
  if (flags.summarize) {
    const [input, output] = flags.summarize === true ? positional : [flags.summarize, positional[0]];
    if (!input || !output) fail('Usage: node coverage-audit.cjs --summarize <captured.json> <output.json>');
    else { try { summarizeCapture(input, output); } catch (e) { fail(e.name || 'ERROR'); } }
  } else {
    const [repo, output] = positional;
    if (!repo || !output) fail('Usage: node coverage-audit.cjs <repo> <output.json> [--env=clean|production-equivalent] [--cohort=<file>]');
    else runAudit(repo, output, {envMode: flags.env === undefined ? 'clean' : flags.env, cohortFile: flags.cohort || null})
      .catch(error => fail(error?.name || 'ERROR'));
  }
}
module.exports = {DEFAULT_TOKENS, PRODUCTION_EQUIVALENT_KEYS, ALWAYS_REMOVED, VERIFIED_STATUSES, SOURCE_REPORTED_STATUSES,
  REASON_CLASSES, tierOf, classifyMissing, applicability, compact, blockNumber, summarize, sanitizeEnv, redact,
  gitInfo, loadCohort, parseArgs, auditToken, runAudit, summarizeCapture};
