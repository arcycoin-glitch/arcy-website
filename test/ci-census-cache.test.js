'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
const lib = require('../scripts/ci-census-cache.cjs'), script = path.join(__dirname, '../scripts/ci-census-cache.cjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'census-'));
const run = (args, env) => cp.spawnSync(process.execPath, [script, ...args], { env: { ...process.env, ...env }, encoding: 'utf8' });
const total = o => 'CENSUS_TOTAL ' + JSON.stringify({ tokens: 3, complete: 2, failed: 1, ...o });
test('PONS-style deterministic scale-limit terminal state counts as bounded-complete; unfinished does not', () => {
  assert.ok(lib.terminalComplete(total({ stoppedEarly: true })));
  assert.equal(lib.terminalComplete(total({ stoppedEarly: false })), null);
  assert.equal(lib.terminalComplete('no total'), null);
});
test('fingerprint is stable, 24 hex, and covers the cohort file and holder code', () => {
  assert.match(lib.fingerprint(), /^[0-9a-f]{24}$/); assert.equal(lib.fingerprint(), lib.fingerprint());
  const f = lib.inputFiles(); assert.ok(f.includes('data/verified-coverage/radar-cohort-20261121.json')); assert.ok(f.some(x => x.startsWith('lib/holder-')));
});
test('scan detects private key material; write refuses it and validate rejects it', () => {
  const index = tmp(), prov = tmp(); fs.writeFileSync(path.join(index, 'a.json'), '{}');
  const env = { ARC_INDEX_CACHE_DIR: index, CENSUS_PROVENANCE_DIR: prov };
  const log = path.join(tmp(), 'c.log');
  const tok = a => 'CENSUS ' + JSON.stringify({ address: a, state: 'NOT_VERIFIED', reasonCode: 'BALANCE_RECONCILIATION_BUDGET_EXCEEDED' });
  fs.writeFileSync(log, tok('0xabc') + '\n' + total({ stoppedEarly: true }) + '\n');
  assert.equal(run(['write', log], env).status, 0);
  assert.equal(run(['validate'], env).status, 0);
  fs.writeFileSync(path.join(index, 'k.pem'), '-----BEGIN PRIVATE KEY-----\nAA\n-----END PRIVATE KEY-----');
  assert.equal(run(['scan'], env).status, 1); assert.equal(run(['validate'], env).status, 1); assert.equal(run(['write', log], env).status, 1);
});
test('validate rejects stale, wrong-fingerprint and tampered-flag manifests; write refuses FAILED tokens', () => {
  const index = tmp(), prov = tmp(), env = { ARC_INDEX_CACHE_DIR: index, CENSUS_PROVENANCE_DIR: prov };
  const log = path.join(tmp(), 'c.log');
  fs.writeFileSync(log, 'CENSUS ' + JSON.stringify({ address: '0x1', state: 'COMPLETE' }) + '\n' + total({ stoppedEarly: true }) + '\n');
  assert.equal(run(['write', log], env).status, 0);
  const mp = path.join(prov, 'manifest.json'), m = JSON.parse(fs.readFileSync(mp, 'utf8'));
  const set = o => fs.writeFileSync(mp, JSON.stringify({ ...m, ...o }));
  set({ createdAt: new Date(Date.now() - 100 * 3600e3).toISOString() }); assert.equal(run(['validate'], env).status, 1);
  set({ fingerprint: 'deadbeef' }); assert.equal(run(['validate'], env).status, 1);
  set({ signedSnapshotsCached: true }); assert.equal(run(['validate'], env).status, 1);
  set({}); assert.equal(run(['validate'], env).status, 0);
  fs.writeFileSync(log, 'CENSUS ' + JSON.stringify({ address: '0x1', state: 'FAILED' }) + '\n' + total({ stoppedEarly: true }) + '\n');
  assert.equal(run(['write', log], env).status, 3);
});
