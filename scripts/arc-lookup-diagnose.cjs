'use strict';
// Read-only: which exact step fails for each Arc cohort contract, with timing and error taxonomy.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(process.env.ROOT || path.join(__dirname, '..'));
const cohort = JSON.parse(fs.readFileSync(path.join(root, 'data/verified-coverage/radar-cohort-20261121.json'), 'utf8')).tokens.filter(t => t.network === 'arc');
const core = require(path.join(root, 'lib/core.js')), vs = require(path.join(root, 'lib/verified-source.js')),
  pm = require(path.join(root, 'lib/project-metadata.js')), src = require(path.join(root, 'lib/unlock-sources.js'));
const shape = e => ({ name: e?.name, code: e?.code, httpStatus: e?.httpStatus, rpcCode: e?.rpcCode, msg: String(e?.message || '').slice(0, 90), cause: e?.cause?.code });
async function step(fn) { const t0 = Date.now(); try { const v = await fn(); return { ok: true, ms: Date.now() - t0, v }; } catch (e) { return { ok: false, ms: Date.now() - t0, e: shape(e) }; } }
(async () => {
  const rows = [];
  for (const t of cohort) {
    const r = { symbol: t.symbol, address: t.address };
    const ctx = await step(() => core.context(t.address)); r.context = ctx.ok ? { ok: true, ms: ctx.ms } : ctx;
    if (ctx.ok) {
      const s = await step(() => vs.lookup(t.address, ctx.v.code)); r.sourcify = s.ok ? { ms: s.ms, dataState: s.v.dataState, reasonCode: s.v.reasonCode, httpStatus: s.v.httpStatus, hasAbi: Array.isArray(s.v.abi) } : s;
      const m = await step(() => pm.read(t.address)); r.metadata = m.ok ? { ms: m.ms, dataState: m.v.dataState, reasonCode: m.v.reasonCode, httpStatus: m.v.httpStatus, hasValue: !!m.v.value, keys: m.v.value ? Object.keys(m.v.value).slice(0, 8) : null } : m;
      const v = await step(() => src.vesting(t.address)); r.vesting = v.ok ? { ms: v.ms, dataState: v.v.dataState, reasonCode: v.v.reasonCode, httpStatus: v.v.httpStatus } : v;
      const d = await step(() => src.documentation(t.address)); r.documentation = d.ok ? { ms: d.ms, dataState: d.v.dataState, reasonCode: d.v.reasonCode, httpStatus: d.v.httpStatus } : d;
    }
    rows.push(r);
  }
  console.log(JSON.stringify({ measuredAt: new Date().toISOString(), rows }));
  if (process.env.GITHUB_ACTIONS) {
    const e = s => s.replace(/%/g, '%25').replace(/\r?\n/g, '%0A');
    rows.forEach((r, i) => console.log('::notice title=arc-diag-' + r.symbol + '::' + e(JSON.stringify(r)).slice(0, 3900)));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
