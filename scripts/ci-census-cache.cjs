#!/usr/bin/env node
'use strict';
// Safe reuse of a bounded census between CI runs. Only UNSIGNED checkpoints are ever cached. Signed publications are never cached
// (each CI run signs with its own ephemeral key, so an old signature could not be verified); a reused checkpoint set is re-published
// and re-signed by a short top-up census, which also catches up to the current head. Private keys are never written to a cached path.
//   node scripts/ci-census-cache.cjs fingerprint            -> prints the input fingerprint
//   node scripts/ci-census-cache.cjs write <census.log>     -> writes provenance for a bounded-complete census (exit 3 if not complete)
//   node scripts/ci-census-cache.cjs validate               -> exit 0 only for a fresh, matching, secret-free cache
//   node scripts/ci-census-cache.cjs scan                   -> exit 1 if any cached path contains private-key material
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const CHAIN = Number(process.env.HOLDER_CHAIN || 4663);
// Effective wallet budget (default 100,000; a valid ARC_HOLDER_MAX_WALLETS in [100000,250000] raises it) is part of the fingerprint.
const rawBudget = process.env.ARC_HOLDER_MAX_WALLETS, MAX_WALLETS = /^\d{1,7}$/.test(rawBudget || '') && +rawBudget >= 100000 && +rawBudget <= 250000 ? +rawBudget : 100000;
const INDEX = process.env.ARC_INDEX_CACHE_DIR || '/tmp/holder-index', PROV = process.env.CENSUS_PROVENANCE_DIR || '/tmp/census-provenance';
const MAX_AGE_MS = Number(process.env.CENSUS_CACHE_MAX_AGE_MS || 72 * 3600 * 1000);
const COHORT = 'data/verified-coverage/radar-cohort-20261121.json';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
function inputFiles() {
  const out = new Set([COHORT, 'scripts/holder-chain-census.cjs', 'scripts/ci-publication-server.cjs']);
  for (const f of fs.readdirSync(path.join(ROOT, 'lib'))) if (/^holder-.*\.js$/.test(f)) out.add('lib/' + f);
  for (const f of ['holders', 'holder-attribution', 'holder-intelligence', 'holder-snapshot', 'large-holders', 'robinhood-holder-count', 'robinhood-holder-rank', 'chains', 'arc-holder-count', 'arc-holder-publication'])
    out.add('search/server/lib/' + f + '.js');
  return [...out].sort();
}
function fingerprint() {
  const h = crypto.createHash('sha256');
  h.update(JSON.stringify({ chain: CHAIN, maxWallets: MAX_WALLETS, nodeMajor: process.versions.node.split('.')[0], schema: 2 }));
  for (const f of inputFiles()) h.update(f + '\0').update(fs.readFileSync(path.join(ROOT, f))).update('\0');
  return h.digest('hex').slice(0, 24);
}
const KEY = /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/;
function scan(dirs = [INDEX, PROV]) {
  const bad = [];
  const walk = p => { let st; try { st = fs.statSync(p); } catch { return; }
    if (st.isDirectory()) for (const n of fs.readdirSync(p)) walk(path.join(p, n));
    else if (st.size < 64 * 2 ** 20 && KEY.test(fs.readFileSync(p, 'latin1'))) bad.push(p); };
  dirs.forEach(walk); return bad;
}
function terminalComplete(logText) {
  const line = logText.split('\n').find(l => l.startsWith('CENSUS_TOTAL '));
  if (!line) return null;
  const t = JSON.parse(line.slice(13));
  // Bounded-complete: every token COMPLETE or in a deterministic scale-limit terminal state (e.g. PONS over the wallet budget).
  // Never FAILED/BUILDING/unknown. stoppedEarly === !censusPending(...).
  return t.tokens > 0 && t.stoppedEarly === true ? t : null;
}
function write(logPath) {
  const text = fs.readFileSync(logPath, 'utf8'), t = terminalComplete(text);
  if (!t) { console.log('census not bounded-complete; no provenance written'); process.exit(3); }
  const tokens = text.split('\n').filter(l => l.startsWith('CENSUS {')).map(l => JSON.parse(l.slice(7)))
    .map(s => ({ address: s.address, state: s.state, reasonCode: s.reasonCode || null, block: s.block || null, holderCount: s.holderCount ?? null }));
  if (tokens.some(s => s.state !== 'COMPLETE' && !(s.state === 'NOT_VERIFIED' && s.reasonCode === 'BALANCE_RECONCILIATION_BUDGET_EXCEEDED'))) { console.log('non-terminal token state; refusing'); process.exit(3); }
  const bad = scan(); if (bad.length) { console.error('private key material in cache path: ' + bad.join(',')); process.exit(1); }
  fs.mkdirSync(PROV, { recursive: true });
  const manifest = { schema: 2, chainId: CHAIN, fingerprint: fingerprint(), maxWallets: MAX_WALLETS, cohortSha256: sha(fs.readFileSync(path.join(ROOT, COHORT))),
    createdAt: new Date().toISOString(), sourceSha: process.env.GITHUB_SHA || null, runId: process.env.GITHUB_RUN_ID || null, tokens, signedSnapshotsCached: false, privateKeysCached: false };
  fs.writeFileSync(path.join(PROV, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  console.log('provenance written', manifest.fingerprint, tokens.length + ' tokens');
}
function validate() {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(PROV, 'manifest.json'), 'utf8'));
    const age = Date.now() - Date.parse(m.createdAt);
    const checks = { schema: m.schema === 2, chain: m.chainId === CHAIN, fp: m.fingerprint === fingerprint(), cap: m.maxWallets === MAX_WALLETS,
      cohort: m.cohortSha256 === sha(fs.readFileSync(path.join(ROOT, COHORT))), fresh: Number.isFinite(age) && age >= 0 && age <= MAX_AGE_MS,
      noSigned: m.signedSnapshotsCached === false && m.privateKeysCached === false, noKeys: scan().length === 0, hasIndex: fs.existsSync(INDEX) };
    const failed = Object.keys(checks).filter(k => !checks[k]);
    console.log(JSON.stringify({ valid: !failed.length, failed, ageHours: Math.round(age / 36e5), fingerprint: m.fingerprint, sourceSha: m.sourceSha, createdAt: m.createdAt }));
    process.exit(failed.length ? 1 : 0);
  } catch (e) { console.log(JSON.stringify({ valid: false, failed: ['manifest:' + (e.code || e.message)] })); process.exit(1); }
}
if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'fingerprint') console.log(fingerprint());
  else if (cmd === 'write') write(arg);
  else if (cmd === 'validate') validate();
  else if (cmd === 'scan') { const b = scan(); if (b.length) { console.error('PRIVATE KEY MATERIAL: ' + b.join(',')); process.exit(1); } console.log('clean'); }
  else { console.error('usage: fingerprint|write <log>|validate|scan'); process.exit(2); }
}
module.exports = { fingerprint, scan, terminalComplete, inputFiles };
