'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const D = require('../search/server/lib/derived-metrics');
const A = '0x' + '1'.repeat(40), ctx = { network: 'robinhood', chainId: 4663, address: A };
const AT = '2026-11-28T08:00:00.000Z', URL = 'https://dexscreener.com/robinhood/0xaaaa';
const ev = (extra) => [{ network: 'robinhood', chainId: 4663, address: A, provider: 'DEX Screener', sourceUrl: URL, scope: 'x', checkedAt: AT, ...extra }];
const liqF = (over = {}, e = {}) => ({ value: 400, status: 'SOURCE_REPORTED', dataState: 'DATA_FOUND', source: 'DEX Screener', network: 'robinhood', chainId: 4663,
  evidence: ev({ pairs: ['p1', 'p2'], pairLiquidityUsd: [100, 300], method: 'sum(liquidity.usd)', ...e }), ...over });
const volF = (over = {}, e = {}) => ({ value: 540, status: 'SOURCE_REPORTED', dataState: 'DATA_FOUND', source: 'DEX Screener', network: 'robinhood', chainId: 4663,
  evidence: ev({ pairs: ['p1', 'p2', 'p3'], pairVolumeUsd: [10, 30, 500], method: 'sum(volume.h24)', ...e }), ...over });
test('same provider response, differing pool lists: turnover over the liquidity-reporting pools only', () => {
  const r = D.liquidity({ liquidityUsd: liqF(), volume24h: volF() }, ctx);
  assert.equal(r.dataState, 'DATA_FOUND'); assert.equal(r.value, 10); // (10+30)/(100+300)*100
  assert.equal(r.evidence[0].volumeOnlyPoolsExcluded, 1); assert.equal(r.evidence[0].volumeOnlyUsdExcluded, 500);
  assert.equal(r.status, 'SOURCE_REPORTED'); assert.match(r.evidence[0].scope, /excluded/);
});
test('fails closed: other retrieval, other URL, mismatched total, missing per-pool values, pool without volume', () => {
  const bad = [
    [liqF(), volF({}, { checkedAt: '2026-11-28T08:00:01.000Z' })],
    [liqF(), volF({}, { sourceUrl: 'https://dexscreener.com/robinhood/0xbbbb' })],
    [liqF({ value: 401 }), volF()],
    [liqF({}, { pairLiquidityUsd: undefined }), volF()],
    [liqF(), volF({}, { pairVolumeUsd: undefined })],
    [liqF({}, { pairs: ['p1', 'p9'] }), volF()],
    [liqF({}, { pairLiquidityUsd: [100, -300] }), volF()],
    [liqF({ source: 'GeckoTerminal' }), volF()]
  ];
  for (const [a, b] of bad) { const r = D.liquidity({ liquidityUsd: a, volume24h: b }, ctx); assert.equal(r.dataState, 'NOT_VERIFIED'); assert.equal(r.reasonCode, 'LIQUIDITY_VOLUME_NOT_COMPARABLE'); }
});
test('identical pair lists keep the original total-based path', () => {
  const a = liqF({}, { pairs: ['p1', 'p2'] }), b = volF({ value: 40 }, { pairs: ['p1', 'p2'], pairVolumeUsd: [10, 30] });
  const r = D.liquidity({ liquidityUsd: a, volume24h: b }, ctx); assert.equal(r.value, 10); assert.equal(r.evidence[0].volumeOnlyPoolsExcluded, undefined);
});
const oc = (pools, method = 'arcy-market-onchain-1') => ({ source: 'Robinhood Chain RPC pool state', role: 'cross-check', method, pools: pools.map(([pool, usd]) => ({ pool, usd })), pairs: pools.map(p => p[0]) });
test('same on-chain pool set for liquidity and volume: on-chain turnover; different sets or missing AGREE: none', () => {
  const l = { ...liqF({}, { pairs: ['x'], pairLiquidityUsd: [1] }), source: 'DexScreener', crossCheck: { state: 'AGREE' }, evidence: [...liqF().evidence, oc([['0xp1', 1000], ['0xp2', 3000]])] };
  const v = { ...volF(), crossCheck: { state: 'AGREE' }, evidence: [...volF().evidence, oc([['0xp2', 200], ['0xp1', 200]], 'arcy-market-volume-1')] };
  const r = D.liquidity({ liquidityUsd: l, volume24h: v }, ctx);
  assert.equal(r.dataState, 'DATA_FOUND'); assert.equal(r.value, 10); assert.equal(r.evidence[0].pools, 2);
  const v2 = { ...v, evidence: [...volF().evidence, oc([['0xp1', 200]], 'arcy-market-volume-1')] };
  assert.equal(D.liquidity({ liquidityUsd: l, volume24h: v2 }, ctx).dataState, 'NOT_VERIFIED');
  assert.equal(D.liquidity({ liquidityUsd: { ...l, crossCheck: { state: 'UNAVAILABLE' } }, volume24h: v }, ctx).dataState, 'NOT_VERIFIED');
});

test('a volume cross-check labelled with the liquidity method is not accepted (methods must match their metric)', () => {
  const l = { ...liqF({}, { pairs: ['x'], pairLiquidityUsd: [1] }), crossCheck: { state: 'AGREE' }, evidence: [...liqF().evidence, oc([['0xp1', 1000]])] };
  const v = { ...volF({ source: 'Other' }), crossCheck: { state: 'AGREE' }, evidence: [...volF().evidence, oc([['0xp1', 100]])] };
  assert.equal(D.liquidity({ liquidityUsd: l, volume24h: v }, ctx).dataState, 'NOT_VERIFIED');
});
const sv = (pools, over = {}) => ({ value: 1, status: 'ON_CHAIN_DERIVED', dataState: 'DATA_FOUND', source: 'Arc RPC pool state', evidence: [{ source: 'Arc RPC pool state', method: 'arcy-market-volume-1', fromBlockHash: '0x' + 'a'.repeat(64), toBlockHash: '0x' + 'b'.repeat(64), toBlock: 10, pools, ...over }] });
test('self-scoped on-chain turnover: volume and same-block TVL from one pool list; any missing TVL or duplicate pool => none', () => {
  const none = { liquidityUsd: { dataState: 'NOT_VERIFIED' } };
  const ok = D.liquidity({ ...none, volume24h: sv([{ pool: '0xp1', usd: 30, liquidityUsd: 100 }, { pool: '0xp2', usd: 10, liquidityUsd: 300 }]) }, ctx);
  assert.equal(ok.dataState, 'DATA_FOUND'); assert.equal(ok.value, 10); assert.equal(ok.evidence[0].pools, 2);
  for (const pools of [[{ pool: '0xp1', usd: 30 }], [{ pool: '0xp1', usd: 3, liquidityUsd: 10 }, { pool: '0xP1', usd: 3, liquidityUsd: 10 }], [{ pool: '0xp1', usd: 3, liquidityUsd: 0 }]]) {
    assert.equal(D.liquidity({ ...none, volume24h: sv(pools) }, ctx).dataState, 'NOT_VERIFIED');
  }
  assert.equal(D.liquidity({ ...none, volume24h: sv([{ pool: '0xp1', usd: 3, liquidityUsd: 10 }], { toBlockHash: undefined }) }, ctx).dataState, 'NOT_VERIFIED');
});
