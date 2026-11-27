'use strict';
// Read-only production check of Search Next Unlock: fixed 40 cohort + UNI. Same-origin contract as the website.
const fs = require('node:fs'), path = require('node:path');
const BASE = process.env.BASE || 'https://www.arcyusdc.xyz';
const cohort = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/verified-coverage/radar-cohort-20261121.json'), 'utf8')).tokens;
const extra = [{ symbol: 'UNI', section: 'extra', network: 'ethereum', address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984' }];
function find(o, key, depth = 0) { if (!o || typeof o !== 'object' || depth > 8) return null; if (o[key] && typeof o[key] === 'object' && 'status' in o[key]) return o[key]; for (const v of Object.values(o)) { const r = find(v, key, depth + 1); if (r) return r; } return null; }
(async () => {
  const rows = [];
  for (const t of [...extra, ...cohort]) {
    const t0 = Date.now(); let f = null, err = null, http = 0;
    try { const r = await fetch(`${BASE}/api/search?action=report&chain=${t.network}&address=${t.address}`, { headers: { accept: 'application/json', referer: BASE + '/', 'sec-fetch-site': 'same-origin' }, signal: AbortSignal.timeout(90000) }); http = r.status; const j = await r.json(); f = find(j, 'nextUnlock'); } catch (e) { err = e.name; }
    rows.push({ symbol: t.symbol, section: t.section, http, ms: Date.now() - t0, status: f?.status ?? null, value: f?.value ?? null, blocker: f?.blocker?.category ?? null, amount: f?.evidence?.[0]?.eventAmount ?? null, pct: f?.evidence?.[0]?.percentOfTotalSupply ?? null, err });
    await new Promise(s => setTimeout(s, 2700));
  }
  const cohortRows = rows.filter(r => r.section !== 'extra');
  const by = rows.reduce((m, r) => { const k = r.blocker || r.status || r.err || 'none'; m[k] = (m[k] || 0) + 1; return m; }, {});
  const out = { measuredAt: new Date().toISOString(), base: BASE, cohortVerified: cohortRows.filter(r => r.value).length, cohortTotal: cohortRows.length, uni: rows.find(r => r.symbol === 'UNI' && r.section === 'extra'), by, rows };
  console.log(JSON.stringify(out));
  const e = s => s.replace(/%/g, '%25').replace(/\r?\n/g, '%0A');
  const { rows: _r, ...head } = out;
  console.log('::notice title=unlock-prod-head::' + e(JSON.stringify(head)));
  for (let i = 0; i < rows.length; i += 14) console.log('::notice title=unlock-prod-rows-' + i / 14 + '::' + e(JSON.stringify(rows.slice(i, i + 14).map(r => [r.symbol, r.http, r.status, r.value, r.blocker, r.amount].join('|')))).slice(0, 3900));
})();
