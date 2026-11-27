'use strict';
/**
 * Read-only per-contract unlock-source discovery for the fixed 40 cohort.
 * Output: JSON to stdout + ::notice lines (CI). Never writes data, never uses keys.
 * For each token: chain identity, bytecode, metadata, top holders, contract
 * holders probed for recognised vesting interfaces, provider/failure taxonomy.
 */
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(process.env.ROOT || path.join(__dirname, '..'));
const on = require(path.join(root, 'lib/unlock-onchain.cjs'));
const cohort = JSON.parse(fs.readFileSync(path.join(root, 'data/verified-coverage/radar-cohort-20261121.json'), 'utf8')).tokens;
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const HOLDERS = Number(process.env.HOLDERS || 40);

const NET = {
  arc: { chainId: 5042, rpcs: ['https://rpc.mainnet.arc.io', 'https://rpc.quicknode.mainnet.arc.io'], explorers: ['https://explorer.arc.io', 'https://arcscan.app'] },
  ethereum: { chainId: 1, rpcs: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org', 'https://rpc.ankr.com/eth'], explorers: ['https://eth.blockscout.com'] },
  robinhood: { chainId: 4663, rpcs: ['https://rpc.mainnet.chain.robinhood.com'], explorers: ['https://robinhoodchain.blockscout.com'] }
};
let id = 0;
async function post(url, body, ms = 9000) {
  const t0 = Date.now(), c = new AbortController(), timer = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: c.signal });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch { /* html */ }
    return { http: r.status, json: j, ms: Date.now() - t0, retryAfter: r.headers.get('retry-after'), htmlLike: !j && /^\s*</.test(text) };
  } catch (e) { return { http: 0, json: null, ms: Date.now() - t0, err: e.name === 'AbortError' ? 'TIMEOUT' : (e.cause?.code || e.code || e.name) }; }
  finally { clearTimeout(timer); }
}
async function get(url, ms = 9000) {
  const t0 = Date.now(), c = new AbortController(), timer = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' }, signal: c.signal });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* html */ }
    return { http: r.status, json: j, ms: Date.now() - t0, retryAfter: r.headers.get('retry-after') };
  } catch (e) { return { http: 0, json: null, ms: Date.now() - t0, err: e.name === 'AbortError' ? 'TIMEOUT' : (e.cause?.code || e.code || e.name) }; }
  finally { clearTimeout(timer); }
}
const providerLog = {};
async function rpc(net, method, params) {
  const errs = [];
  for (const url of NET[net].rpcs) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await post(url, { jsonrpc: '2.0', id: ++id, method, params });
      const host = new URL(url).host; (providerLog[host] ||= { ok: 0, fail: 0, codes: {} });
      if (r.json && r.json.result !== undefined) { providerLog[host].ok++; return { result: r.json.result, provider: host }; }
      providerLog[host].fail++; const code = r.http || r.err || 'RPC_ERR'; providerLog[host].codes[code] = (providerLog[host].codes[code] || 0) + 1;
      if (r.json?.error) { return { error: r.json.error.message?.slice(0, 80) || 'RPC_ERROR', revert: true, provider: host }; } // execution error: not retryable
      errs.push(host + ':' + code);
      if (r.http === 429 || r.http === 403) break; // go to next provider
      await new Promise(s => setTimeout(s, 250 * (attempt + 1)));
    }
  }
  return { error: 'ALL_PROVIDERS_FAILED', providers: errs };
}
const ethCall = async (net, to, data, block = 'latest') => { const r = await rpc(net, 'eth_call', [{ to, data }, block]); return r.result && r.result !== '0x' ? r.result : null; };
const decodeStr = h => { if (!h || !/^0x[0-9a-f]+$/i.test(h)) return null; const b = Buffer.from(h.slice(2), 'hex'); if (b.length === 32) return b.toString('utf8').replace(/\0+$/, ''); if (b.length < 64) return null; const o = Number(BigInt('0x' + b.subarray(0, 32).toString('hex'))); const l = Number(BigInt('0x' + b.subarray(o, o + 32).toString('hex'))); return b.subarray(o + 32, o + 32 + l).toString('utf8'); };

async function holdersFor(net, addr) {
  const out = { source: null, status: null, rows: [], note: null };
  for (const base of NET[net].explorers) {
    const r = await get(`${base}/api/v2/tokens/${addr}/holders`);
    out.status = out.status ?? r.http; out.tried = (out.tried || []).concat(`${new URL(base).host}:${r.http || r.err}`);
    const items = r.json?.items;
    if (Array.isArray(items)) {
      out.source = new URL(base).host; out.status = r.http;
      out.rows = items.slice(0, HOLDERS).map(i => ({ address: String(i.address?.hash || '').toLowerCase(), value: i.value, isContract: i.address?.is_contract ?? null, name: i.address?.name || null }));
      return out;
    }
  }
  // Explorer unavailable (403/DNS): derive candidate recipients from recent Transfer logs over RPC (bounded).
  const head = await rpc(net, 'eth_blockNumber', []);
  if (head.result) {
    const latest = parseInt(head.result, 16), TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    for (const span of [200000, 50000, 10000, 2000]) {
      const lg = await rpc(net, 'eth_getLogs', [{ address: addr, topics: [TOPIC], fromBlock: '0x' + Math.max(0, latest - span).toString(16), toBlock: '0x' + latest.toString(16) }]);
      if (Array.isArray(lg.result)) {
        const seen = new Map();
        for (const l of lg.result) { if (l.topics?.length === 3) { const to = '0x' + l.topics[2].slice(26); seen.set(to, (seen.get(to) || 0) + 1); } }
        out.rows = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, HOLDERS).map(([a]) => ({ address: a, value: null, isContract: null, name: null }));
        out.source = 'rpc-transfer-logs'; out.logSpan = span; out.logs = lg.result.length; out.note = 'EXPLORER_UNAVAILABLE_USED_RPC_LOGS';
        return out;
      }
    }
  }
  out.note = 'NO_EXPLORER_HOLDER_LIST';
  return out;
}

async function probeContract(net, token, holder) {
  const g = n => ethCall(net, holder, on.callData.getter(n));
  const [start, duration, end, cliff, releaseTime, unlockTime, beneficiary, owner, tokenAddr, tokenBalance, releasedToken] = await Promise.all([
    g('start'), g('duration'), g('end'), g('cliff'), g('releaseTime'), g('unlockTime'), g('beneficiary'), g('owner'), g('token'),
    ethCall(net, token, on.callData.balanceOf(holder)), ethCall(net, holder, on.callData.releasedToken(token))
  ]);
  const raw = { start, duration, end, cliff, releaseTime, unlockTime, beneficiary, owner, token: tokenAddr, tokenBalance, releasedToken };
  const cls = on.classify(raw, token);
  let vestedAtCliff = null;
  if (cls.kind === 'VESTING_WALLET_CLIFF' && cls.cliff) vestedAtCliff = await ethCall(net, holder, on.callData.vestedAmountToken(token, cls.cliff));
  const sch = on.schedule(cls, Date.now(), vestedAtCliff);
  const ser = o => JSON.parse(JSON.stringify(o, (_, v) => typeof v === 'bigint' ? v.toString() : v));
  return { holder, kind: cls.kind, reason: cls.reason || null, schedule: ser(sch), classification: ser(cls),
    anyGetter: [start, duration, end, cliff, releaseTime, unlockTime, tokenAddr].some(Boolean) };
}

async function one(t) {
  const net = t.network, row = { symbol: t.symbol, section: t.section, network: net, chainId: t.chainId, address: t.address, steps: {} };
  const cid = await rpc(net, 'eth_chainId', []);
  row.steps.chainId = cid.result ? { ok: Number(BigInt(cid.result)) === NET[net].chainId && t.chainId === NET[net].chainId, got: Number(BigInt(cid.result)), provider: cid.provider } : { ok: false, error: cid.error, providers: cid.providers };
  if (!row.steps.chainId.ok) { row.outcome = 'CHAIN_ID_UNVERIFIED'; return row; }
  const code = await rpc(net, 'eth_getCode', [t.address, 'latest']);
  row.steps.code = code.result ? { bytes: Math.max(0, (code.result.length - 2) / 2) } : { error: code.error };
  if (!code.result || code.result === '0x') { row.outcome = code.result === '0x' ? 'NO_CONTRACT_AT_ADDRESS' : 'CODE_LOOKUP_FAILED'; return row; }
  const [name, symbol, supply, decimals] = await Promise.all(['name()', 'symbol()', 'totalSupply()', 'decimals()'].map(s => ethCall(net, t.address, on.SEL(s))));
  row.token = { name: decodeStr(name), symbol: decodeStr(symbol), totalSupplyRaw: supply ? BigInt(supply).toString() : null, decimals: decimals ? Number(BigInt(decimals)) : null };
  const holders = await holdersFor(net, t.address);
  row.holders = { logSpan: holders.logSpan, logs: holders.logs, source: holders.source, status: holders.status, tried: holders.tried, note: holders.note, sampled: holders.rows.length };
  const contracts = [];
  for (const h of holders.rows) {
    if (!/^0x[0-9a-f]{40}$/.test(h.address)) continue;
    if (h.isContract === false) continue;
    const hc = await rpc(net, 'eth_getCode', [h.address, 'latest']);
    if (hc.result && hc.result !== '0x') contracts.push(h);
  }
  row.holders.contractHolders = contracts.length;
  row.vesting = [];
  for (const h of contracts.slice(0, 15)) row.vesting.push({ ...(await probeContract(net, t.address, h.address)), holderName: h.name });
  const recognised = row.vesting.filter(v => v.kind !== 'UNRECOGNISED');
  row.recognisedVesting = recognised.length;
  row.nextDiscrete = recognised.map(v => v.schedule?.next).filter(Boolean)
    .map(n => ({ ...n, pct: on.percentOfSupply(n.amount, row.token.totalSupplyRaw) })).sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0] || null;
  row.outcome = row.nextDiscrete ? 'ONCHAIN_SCHEDULE_FOUND'
    : recognised.length ? 'VESTING_FOUND_NO_DISCRETE_FUTURE_EVENT'
      : !holders.rows.length ? 'NO_HOLDER_LIST_AVAILABLE'
        : contracts.length ? 'CONTRACT_HOLDERS_NOT_VESTING_INTERFACES' : 'NO_CONTRACT_HOLDERS_IN_SAMPLE';
  return row;
}

(async () => {
  const list = cohort.filter(t => !ONLY.length || ONLY.includes(t.symbol));
  const rows = []; const started = Date.now();
  for (const t of list) { try { rows.push(await one(t)); } catch (e) { rows.push({ symbol: t.symbol, network: t.network, address: t.address, outcome: 'PROBE_ERROR', error: String(e.message).slice(0, 120) }); } }
  const by = rows.reduce((m, r) => (m[r.outcome] = (m[r.outcome] || 0) + 1, m), {});
  const out = { measuredAt: new Date().toISOString(), total: rows.length, byOutcome: by, providers: providerLog, elapsedMs: Date.now() - started, rows };
  console.log(JSON.stringify(out));
  if (process.env.GITHUB_ACTIONS) {
    const e = s => s.replace(/%/g, '%25').replace(/\r?\n/g, '%0A');
    const { rows: _r, ...head } = out;
    console.log('::notice title=discover-head::' + e(JSON.stringify(head)));
    const compact = rows.map(r => [r.symbol, r.network, r.outcome, r.token?.symbol || '', r.holders?.source || r.holders?.tried?.join('/') || '', 'h' + (r.holders?.sampled ?? '-') + '/c' + (r.holders?.contractHolders ?? '-') + '/v' + (r.recognisedVesting ?? '-'), (r.vesting || []).slice(0, 3).map(v => v.holder.slice(0, 10) + ':' + v.kind + (v.anyGetter ? '*' : '')).join(','), r.steps?.chainId?.ok === false ? JSON.stringify(r.steps.chainId).slice(0, 100) : ''].join('|'));
    for (let i = 0; i < compact.length; i += 8) console.log('::notice title=discover-rows-' + i / 8 + '::' + e(JSON.stringify(compact.slice(i, i + 8))).slice(0, 3900));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
