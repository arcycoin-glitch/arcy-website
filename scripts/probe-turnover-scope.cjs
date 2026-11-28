#!/usr/bin/env node
'use strict';
// Read-only: for the cohort tokens whose liquidityTurnover24h is not derivable, print how liquidityUsd and volume24h differ in
// source / url / pairs / fetchedAt / scope (the inputs of derived-metrics.comparable). Production GETs only.
const BASE = process.env.ARCY_BASE || 'https://www.arcyusdc.xyz';
const T = [['arc', '0xbc43ce8dec648ea298c4275559b81d6261c90b67'], ...(process.env.EXTRA || '').split(',').filter(Boolean).map(x => x.split(':'))];
const cohort = require('../data/verified-coverage/radar-cohort-20261121.json').tokens;
const want = new Set((process.env.SYMBOLS || 'TOLLY,ARGUS,LONG,KAIRO,HOOKR,HMM').split(','));
const wait = ms => new Promise(r => setTimeout(r, ms));
const short = e => e && ({ source: e.source, provider: e.provider, url: e.url || e.sourceUrl, scope: e.scope, checkedAt: e.checkedAt, fetchedAt: e.fetchedAt, pairs: e.pairs, pools: e.pools, role: e.role, method: e.method });
(async () => {
  for (const t of cohort.filter(t => want.has(t.symbol))) {
    const chain = t.section === 'pons' ? 'robinhood' : t.network;
    const r = await fetch(`${BASE}/api/search?action=report&chain=${chain}&address=${t.address}`, { headers: { accept: 'application/json', referer: BASE + '/', 'sec-fetch-site': 'same-origin' } });
    const j = await r.json(), f = j.cards?.liquidity?.fields || {};
    const pick = k => ({ value: f[k]?.value, status: f[k]?.status, source: f[k]?.source, crossCheck: f[k]?.crossCheck && { state: f[k].crossCheck.state, reasonCode: f[k].crossCheck.reasonCode }, evidence: (f[k]?.evidence || []).map(short) });
    console.log('TURNOVER_DIAG ' + JSON.stringify({ symbol: t.symbol, section: t.section, liquidityUsd: pick('liquidityUsd'), volume24h: pick('volume24h'), turnover: { status: f.liquidityTurnover24h?.status, reasonCode: f.liquidityTurnover24h?.reasonCode } }));
    await wait(3000);
  }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
