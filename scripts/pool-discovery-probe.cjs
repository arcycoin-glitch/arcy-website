#!/usr/bin/env node
'use strict';
// Read-only real-chain probe: can pools of the fixed cohort tokens be DISCOVERED from the chain itself (no DEX Screener / GeckoTerminal)?
//  V4 (Arc, Robinhood, Ethereum): PoolManager Initialize logs with the token as currency0 / currency1 (topics 2 / 3), full range.
//  V3 (Ethereum, Robinhood): reviewed factory getPool(token, quote, fee) for the registry quotes x 4 fee tiers.
//  V2 (Ethereum): reviewed factory getPair(token, quote).
// Output: PROBE_ROW per token, PROBE_SUMMARY per chain. Nothing is written anywhere.
const fs = require('node:fs'), path = require('node:path');
const rpcs = { ethereum: () => require('../search/server/lib/eth').rpc, robinhood: () => require('../search/server/lib/robinhood-rpc').rpc, arc: () => require('../search/server/lib/arc-rpc').rpc };
const INIT = '0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438';
const PM = { ethereum: '0x000000000004444c5dc75cb358380d2e3de08a90', robinhood: '0x8366a39cc670b4001a1121b8f6a443a643e40951', arc: '0x8366a39cc670b4001a1121b8f6a443a643e40951' };
const V3 = { ethereum: '0x1f98431c8ad98523631ae4a59f267346ea31f984', robinhood: '0x1f7d7550b1b028f7571e69a784071f0205fd2efa' };
const V2 = { ethereum: ['0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f', '0xc0aee478e3658e2610c5f7a4a2e1777ce9e4f2ac'] };
const QUOTE = { ethereum: ['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', '0xdac17f958d2ee523a2206206994597c13d831ec7', '0x6b175474e89094c44da98b954eedeac495271d0f', '0xdc035d45d973e3ec169d2276ddab16f1e407384f'], robinhood: ['0x0bd7d308f8e1639fab988df18a8011f41eacad73'], arc: ['0x3600000000000000000000000000000000000000'] };
const pad = a => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const cohort = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/verified-coverage/radar-cohort-20261121.json'), 'utf8'));
const net = t => t.network === 'robinhood' || t.section === 'pons' ? 'robinhood' : t.network;
(async () => {
  const sum = {};
  for (const t of cohort.tokens) {
    const n = net(t), rpc = rpcs[n](), row = { section: t.section, network: n, symbol: t.symbol, address: t.address, v4: null, v3: [], v2: [], errors: {} };
    const s = sum[n] ||= { tokens: 0, v4Accepted: 0, v4Pools: 0, withV4: 0, withV3: 0, withV2: 0, withAny: 0, v4Errors: {}, ms: [] };
    s.tokens++;
    const t0 = Date.now();
    try {
      let pools = new Set();
      for (const topics of [[INIT, null, '0x' + pad(t.address)], [INIT, null, null, '0x' + pad(t.address)]]) {
        const logs = await rpc('eth_getLogs', [{ address: PM[n], topics, fromBlock: '0x0', toBlock: 'latest' }]);
        for (const l of logs) pools.add(l.topics[1]);
      }
      row.v4 = [...pools]; s.v4Accepted++; s.v4Pools += pools.size; if (pools.size) s.withV4++;
    } catch (e) { const k = String(e.code || e.message).slice(0, 60); row.errors.v4 = k; s.v4Errors[k] = (s.v4Errors[k] || 0) + 1; }
    s.ms.push(Date.now() - t0);
    if (V3[n]) for (const q of QUOTE[n]) for (const fee of [100, 500, 3000, 10000]) {
      try { const r = await rpc('eth_call', [{ to: V3[n], data: '0x1698ee82' + pad(t.address) + pad(q) + fee.toString(16).padStart(64, '0') }, 'latest']); const a = '0x' + r.slice(-40); if (!/^0x0{40}$/.test(a)) row.v3.push({ quote: q, fee, pool: a }); } catch (e) { row.errors.v3 = String(e.code || e.message).slice(0, 40); }
    }
    for (const f of V2[n] || []) for (const q of QUOTE[n]) {
      try { const r = await rpc('eth_call', [{ to: f, data: '0xe6a43905' + pad(t.address) + pad(q) }, 'latest']); const a = '0x' + r.slice(-40); if (!/^0x0{40}$/.test(a)) row.v2.push({ factory: f, quote: q, pair: a }); } catch (e) { row.errors.v2 = String(e.code || e.message).slice(0, 40); }
    }
    if (row.v3.length) s.withV3++; if (row.v2.length) s.withV2++; if ((row.v4 || []).length || row.v3.length || row.v2.length) s.withAny++;
    console.log('PROBE_ROW ' + JSON.stringify({ ...row, v4: row.v4 && row.v4.length }));
  }
  for (const [n, s] of Object.entries(sum)) { const ms = s.ms.sort((a, b) => a - b); console.log('PROBE_SUMMARY ' + JSON.stringify({ network: n, ...s, ms: undefined, medianMs: ms[Math.floor(ms.length / 2)] })); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
