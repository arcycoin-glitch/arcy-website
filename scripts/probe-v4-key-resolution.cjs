#!/usr/bin/env node
'use strict';
// Read-only real-chain probe: resolve Uniswap v4 PoolKeys for the pools of the fixed cohort (Arc, Robinhood) by
//  (a) the existing resolver (PositionManager.poolKeys, full-range Initialize log) and (b) historical StateView bisection
//  + single-block Initialize log (v4-creation.js), proven by keccak256(abi.encode(PoolKey)) == poolId. Production report GETs + public RPC.
const O = require('../search/server/lib/market-onchain'), C = require('../search/server/lib/v4-creation');
const cohort = require('../data/verified-coverage/radar-cohort-20261121.json').tokens.filter(t => t.network === 'arc' || t.network === 'robinhood');
const BASE = process.env.ARCY_BASE || 'https://www.arcyusdc.xyz', wait = ms => new Promise(r => setTimeout(r, ms));
const INIT = '0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438';
const words = h => h.slice(2).match(/.{64}/g).map(w => BigInt('0x' + w));
const signed = (x, bits) => { const m = 1n << BigInt(bits); x &= m - 1n; return x >= m >> 1n ? x - m : x; };
(async () => {
  const sum = {};
  for (const t of cohort) {
    const n = t.network, rpc = O.rpcFor(n), v = O.V4[n], s = sum[n] ||= { pools: 0, existing: 0, bisect: 0, bisectFail: {}, calls: [], ms: [] };
    let ids = new Set();
    try { const r = await fetch(`${BASE}/api/search?action=report&chain=${n}&address=${t.address}`, { headers: { accept: 'application/json', referer: BASE + '/', 'sec-fetch-site': 'same-origin' } }); const j = await r.json();
      for (const k of ['volume24h', 'liquidityUsd']) for (const e of j.cards?.liquidity?.fields?.[k]?.evidence || []) for (const p of e.pairs || []) if (/^0x[0-9a-f]{64}$/i.test(p)) ids.add(p.toLowerCase()); } catch (e) { console.log('REPORT_FAIL ' + t.symbol + ' ' + e.message); }
    await wait(2500);
    for (const id of ids) {
      s.pools++;
      const block = await rpc('eth_blockNumber', []), call = (to, data) => rpc('eth_call', [{ to, data }, block]);
      let existing = null; O._reset?.();
      try { existing = await O.v4Key(id, { network: n, rpc, call, block }); s.existing++; } catch (e) { existing = String(e.code || e.message).slice(0, 40); }
      const t0 = Date.now(); let calls = 0;
      const counted = async (m, p) => { calls++; return rpc(m, p); };
      let res;
      try {
        const head = parseInt(block, 16), L = require('../search/server/lib/market-volume').LIMITS[n];
        const key = await C.resolveKey(counted, { stateView: v.stateView, poolManager: v.poolManager, poolId: id, head, chunk: Math.min(L.span, 1000000), windows: 6, hash: O.poolId });
        const cb = key.bisectedBlock; res = { ok: true, creationBlock: cb, initializeOffset: key.initializeBlock - cb };
        s.bisect++;
      } catch (e) { const c = String(e.code || e.message).slice(0, 40); s.bisectFail[c] = (s.bisectFail[c] || 0) + 1; res = { ok: false, code: c, diag: e.diag }; if (e.diag && (s.diagShown = (s.diagShown || 0) + 1) <= 6) console.log('V4_DIAG ' + JSON.stringify({ network: n, symbol: t.symbol, id: id.slice(0, 14), ...e.diag })); }
      s.calls.push(calls); s.ms.push(Date.now() - t0);
      if (res.ok || !res.diag) console.log('V4_ROW_SHORT ' + JSON.stringify({ network: n, symbol: t.symbol, id: id.slice(0, 14), existing: typeof existing === 'string' ? existing : 'OK:' + existing.resolvedVia, bisect: res, calls, ms: Date.now() - t0 }));
      await wait(500);
    }
  }
  for (const [n, s] of Object.entries(sum)) { const c = s.calls.sort((a, b) => a - b), m = s.ms.sort((a, b) => a - b); console.log('V4_SUMMARY ' + JSON.stringify({ network: n, pools: s.pools, existingResolved: s.existing, bisectResolved: s.bisect, bisectFail: s.bisectFail, medianCalls: c[Math.floor(c.length / 2)], maxCalls: c[c.length - 1], medianMs: m[Math.floor(m.length / 2)] })); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
