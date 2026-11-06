'use strict';
// SynRoute fixed-pair, noncustodial EVM integration. No ARCY swaps before launch.
// API keys remain server-only. No API endpoint submits transactions.
const ORIGIN = 'https://ghost-trading-api.synthra.org';
const ZERO = '0x0000000000000000000000000000000000000000';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const PAIRS = Object.freeze({
  base_eth_usdc: Object.freeze({ label: 'Base ETH → Base USDC', sourceChainId: 8453, destinationChainId: 8453,
    tokenIn: Object.freeze({ address: ZERO, decimals: 18, symbol: 'ETH' }),
    tokenOut: Object.freeze({ address: USDC_BASE, decimals: 6, symbol: 'USDC' }) }),
  robinhood_eth_base_usdc: Object.freeze({ label: 'Robinhood ETH → Base USDC', sourceChainId: 4663, destinationChainId: 8453,
    tokenIn: Object.freeze({ address: ZERO, decimals: 18, symbol: 'ETH' }),
    tokenOut: Object.freeze({ address: USDC_BASE, decimals: 6, symbol: 'USDC' }) })
});
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ZERO_ADDRESS = /^0x0{40}$/i;
const MAX_INPUT = 1000000000000000000n; // 1 ETH
const MIN_INPUT = 1000000000000000n; // 0.001 ETH
const SLIPPAGE_BPS = 50;
const seen = new Map();

function rawAmount(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,1})(\.\d{1,18})?$/.test(value)) return null;
  const [w, f = ''] = value.split('.');
  const raw = BigInt(w) * 10n ** 18n + BigInt((f + '0'.repeat(18)).slice(0, 18));
  return raw >= MIN_INPUT && raw <= MAX_INPUT ? raw.toString() : null;
}
function limit(ip, now = Date.now()) {
  // Ephemeral, defensive limiter; Synthra additionally rate-limits per key.
  if (seen.size > 1500) seen.clear();
  const key = typeof ip === 'string' ? ip.slice(0, 128) : 'unknown';
  const state = seen.get(key);
  if (!state || now - state.start >= 60000) { seen.set(key, {start: now, n: 1}); return true; }
  state.n += 1;
  return state.n <= 6;
}
function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(status).json(body);
}
function addressMatches(a, b) { return typeof a === 'string' && a.toLowerCase() === b.toLowerCase(); }
function digits(v) { return typeof v === 'string' && /^\d{1,90}$/.test(v); }
function formatUnits(value, decimals) {
  if (!digits(value)) return null;
  const divisor = 10n ** BigInt(decimals), n = BigInt(value);
  const fraction = (n % divisor).toString().padStart(decimals, '0').replace(/0+$/, '');
  return (n / divisor).toString() + (fraction ? '.' + fraction : '');
}
function validTransaction(tx, wallet, pair, amountRaw) {
  if (!tx || typeof tx !== 'object' || !ADDRESS.test(tx.to) || ZERO_ADDRESS.test(tx.to) ||
      !addressMatches(tx.from, wallet) || Number(tx.chainId) !== pair.sourceChainId ||
      typeof tx.data !== 'string' || !/^0x([a-fA-F0-9]{2}){0,14000}$/.test(tx.data) ||
      !digits(String(tx.value ?? '0')) || BigInt(String(tx.value ?? '0')) > BigInt(amountRaw)) return false;
  return true;
}
function inspectQuote(data, input) {
  const { wallet, pair, raw } = input;
  const request = data?.request, quote = data?.quote;
  if (data?.state !== 'Success' || quote?.state !== 'Success' || !request || !quote)
    return { ok: false, code: 'NO_AVAILABLE_ROUTE' };
  // All principal identifiers must be tied to the specific wallet, chain and contract.
  if (!addressMatches(request.user, wallet) || !addressMatches(request.recipient, wallet) ||
      Number(request.sourceChainId) !== pair.sourceChainId ||
      Number(request.destinationChainId) !== pair.destinationChainId ||
      !addressMatches(request.tokenIn?.address, pair.tokenIn.address) ||
      !addressMatches(request.tokenOut?.address, pair.tokenOut.address) ||
      Number(request.tokenIn?.decimals) !== pair.tokenIn.decimals ||
      Number(request.tokenOut?.decimals) !== pair.tokenOut.decimals ||
      request.amount !== raw || request.tradeType !== 'EXACT_INPUT')
    return { ok: false, code: 'ROUTE_IDENTITY_MISMATCH' };
  if (!digits(quote.amountOut) || !digits(quote.minimumAmountOut) ||
      BigInt(quote.amountOut) <= 0n || BigInt(quote.minimumAmountOut) <= 0n ||
      BigInt(quote.minimumAmountOut) > BigInt(quote.amountOut))
    return { ok: false, code: 'INVALID_ROUTE_AMOUNTS' };
  const expiresAt = Number(data.expiresAt);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() ||
      expiresAt > Date.now() + 15 * 60000)
    return { ok: false, code: 'QUOTE_EXPIRED' };
  if (typeof data.quoteId !== 'string' || !/^tq_[a-zA-Z0-9-]{8,100}$/.test(data.quoteId))
    return { ok: false, code: 'INVALID_QUOTE_ID' };
  // Pilot supports exactly one EVM source transaction. No blind signatures or approvals.
  const steps = quote.steps;
  const step = Array.isArray(steps) && steps.length === 1 ? steps[0] : null;
  const item = step && step.kind === 'transaction' && Array.isArray(step.items) && step.items.length === 1 ? step.items[0] : null;
  const tx = item?.data;
  if (!item || item.kind !== 'transaction' || !validTransaction(tx, wallet, pair, raw))
    return { ok: false, code: 'ROUTE_REQUIRES_ADDITIONAL_STEPS' };
  const requestId = HASH.test(quote.executionRequestId || '') ? quote.executionRequestId : null;
  // Enforce traceable cross-chain settlement before enabling a cross-chain EVM send.
  if (pair.sourceChainId !== pair.destinationChainId && (!requestId || !item.check))
    return { ok: false, code: 'CROSS_CHAIN_STATUS_UNAVAILABLE' };
  if (item.check && (!requestId || item.check.method !== 'GET' ||
      typeof item.check.endpoint !== 'string' ||
      item.check.endpoint !== '/v1/swap/status?requestId=' + requestId))
    return { ok: false, code: 'INVALID_SETTLEMENT_CHECK' };
  const route = data.chosen === 'external' ? 'External SynRoute' :
    data.chosen === 'synthra-internal' ? 'Synthra V3' : null;
  if (!route) return { ok: false, code: 'UNKNOWN_ROUTE' };
  return {
    ok: true, pairId: input.pairId, label: pair.label,
    sourceChainId: pair.sourceChainId, destinationChainId: pair.destinationChainId,
    fromSymbol: pair.tokenIn.symbol, toSymbol: pair.tokenOut.symbol,
    amountIn: formatUnits(raw, 18), estimatedOut: formatUnits(quote.amountOut, 6),
    minimumOut: formatUnits(quote.minimumAmountOut, 6),
    route, revenueEligibleRoute: data.chosen === 'external',
    slippageBps: SLIPPAGE_BPS, expiresAt, quoteId: data.quoteId, requestId,
    // Wallet receives calldata only after the server has verified the quote identity and safety limits.
    transaction: { from: wallet, to: tx.to, data: tx.data, value: String(tx.value ?? '0'),
      chainId: pair.sourceChainId },
    warnings: Array.isArray(quote.warnings) ? quote.warnings.filter(x => typeof x === 'string').slice(0, 3).map(x => x.slice(0, 140)) : [],
    feeEstimateUsd: Number.isFinite(quote.gasEstimateUsd) ? quote.gasEstimateUsd : null,
    note: 'User-signed onchain swap. No funds are held by ARCY SEARCH; cross-chain settlement may take time.'
  };
}
async function requestQuote(input, { fetcher = fetch, key = process.env.SYNTHRA_API_KEY } = {}) {
  if (!key?.startsWith('sk_live_')) return {status: 503, body: {ok: false, code: 'NOT_CONFIGURED'}};
  const request = {
    user: input.wallet, recipient: input.wallet,
    sourceChainId: input.pair.sourceChainId, destinationChainId: input.pair.destinationChainId,
    tokenIn: input.pair.tokenIn, tokenOut: input.pair.tokenOut,
    amount: input.raw, tradeType: 'EXACT_INPUT', slippageBps: SLIPPAGE_BPS,
    allowInternalExecution: true, allowExternalExecution: true
  };
  try {
    const r = await fetcher(ORIGIN + '/v1/swap/quote', {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', 'x-api-key': key },
      redirect: 'error', signal: AbortSignal.timeout(10000), body: JSON.stringify(request)
    });
    if (!r.ok) return {status: r.status === 429 ? 429 : 502, body: {ok:false, code:r.status === 429 ? 'RATE_LIMITED' : 'QUOTE_UNAVAILABLE'}};
    const response = await r.json();
    const body = inspectQuote(response, input);
    return {status: body.ok ? 200 : 422, body};
  } catch (_) { return {status:502, body:{ok:false, code:'QUOTE_UNAVAILABLE'}}; }
}
async function requestStatus(requestId, { fetcher = fetch, key = process.env.SYNTHRA_API_KEY } = {}) {
  if (!HASH.test(requestId) || !key?.startsWith('sk_live_'))
    return {status:400, body:{ok:false, code:'INVALID_STATUS_REQUEST'}};
  try {
    const r = await fetcher(ORIGIN + '/v1/swap/status?requestId=' + requestId, {
      method:'GET', headers:{accept:'application/json','x-api-key':key}, redirect:'error',
      signal:AbortSignal.timeout(7500)
    });
    if (!r.ok) return {status:502,body:{ok:false,code:'STATUS_UNAVAILABLE'}};
    const s = await r.json();
    // Never convert pending source-chain confirmation into a completed destination trade.
    const state = String(s.status || s.state || 'pending').toLowerCase();
    const destinationTxHash = HASH.test(s.destinationTxHash || '') ? s.destinationTxHash : null;
    const completed = ['completed','success','settled'].includes(state) && !!destinationTxHash;
    const failed = ['failed','refunded','expired','reverted'].includes(state);
    return {status:200,body:{ok:true,state:completed?'settled':failed?'failed':'pending',
      destinationTxHash:completed?destinationTxHash:null}};
  } catch (_) { return {status:502,body:{ok:false,code:'STATUS_UNAVAILABLE'}}; }
}
function firstIp(req) {
  const ip = req.headers?.['x-real-ip'] || req.headers?.['x-forwarded-for'] || 'unknown';
  return String(ip).split(',')[0].trim();
}
module.exports = async function handler(req, res) {
  const origin = req.headers?.origin;
  if (origin) {
    let allowed = false;
    try {
      const u = new URL(origin);
      allowed = u.protocol === 'https:' && (u.hostname === 'www.arcyusdc.xyz' ||
        u.hostname === 'arcyusdc.xyz' ||
        /^arcy-official-[a-z0-9-]+-arcy3\.vercel\.app$/.test(u.hostname));
    } catch (_) {}
    if (!allowed) return send(res,403,{ok:false,code:'ORIGIN_FORBIDDEN'});
  }
  if (req.method === 'GET') {
    if (!limit(firstIp(req))) return send(res,429,{ok:false,code:'RATE_LIMITED'});
    const requestId = req.query?.requestId;
    const status = await requestStatus(requestId);
    return send(res,status.status,status.body);
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow','GET, POST');
    return send(res,405,{ok:false,code:'METHOD_NOT_ALLOWED'});
  }
  const b = req.body;
  if (!b || typeof b !== 'object' || Array.isArray(b) ||
      Object.keys(b).sort().join(',') !== 'amount,pairId,wallet')
    return send(res,400,{ok:false,code:'INVALID_INPUT'});
  const pair = Object.hasOwn(PAIRS,b.pairId) ? PAIRS[b.pairId] : null;
  const raw = rawAmount(b.amount);
  if (!pair || !ADDRESS.test(b.wallet || '') || ZERO_ADDRESS.test(b.wallet) || !raw)
    return send(res,400,{ok:false,code:'INVALID_PAIR_WALLET_OR_AMOUNT'});
  if (!limit(firstIp(req))) return send(res,429,{ok:false,code:'RATE_LIMITED'});
  const input = {wallet:b.wallet,pairId:b.pairId,pair,raw};
  const quote = await requestQuote(input);
  return send(res,quote.status,quote.body);
};
module.exports.PAIRS=PAIRS;
module.exports.rawAmount=rawAmount;
module.exports.inspectQuote=inspectQuote;
module.exports.requestQuote=requestQuote;
module.exports.requestStatus=requestStatus;
