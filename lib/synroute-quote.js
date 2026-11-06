'use strict';
// Quote-only SynRoute integration for the EXISTING #buy panel. No wallet signing or trade execution.
// Keep all credentials server-side. Only Arc native USDC (ERC20 view) -> verified Arc ARCY is supported.
const HOST = 'https://ghost-trading-api.synthra.org';
const CHAIN_ID = 5042;
const USDC = '0x3600000000000000000000000000000000000000';
const ARCY = '0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b';
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const MAX_AMOUNT = 1000000000n; // 1,000 USDC
const MIN_AMOUNT = 100000n; // 0.10 USDC
const SLIPPAGE_BPS = 50;
const LIMIT_INTERVAL_MS = 60 * 1000;
const MAX_CALLS = 4;
const attempts = new Map();

function parseAmount(input) {
  if (typeof input !== 'string' || !/^(?:0|[1-9]\d{0,3})(?:\.\d{1,6})?$/.test(input)) return null;
  const [whole, fraction = ''] = input.split('.');
  const units = BigInt(whole) * 1000000n + BigInt((fraction + '000000').slice(0, 6));
  return units >= MIN_AMOUNT && units <= MAX_AMOUNT ? units.toString() : null;
}
function validate(wallet, amount) {
  if (typeof wallet !== 'string' || !ADDRESS.test(wallet) || /^0x0{40}$/i.test(wallet)) return null;
  const raw = parseAmount(amount);
  return raw ? { wallet, raw } : null;
}
function quota(ip, clock = Date.now()) {
  // Best-effort per-instance throttle; upstream API enforces project-key limits globally.
  const fingerprint = typeof ip === 'string' ? ip.slice(0, 120) : '';
  const id = fingerprint || 'unknown';
  if (attempts.size > 2000) attempts.clear();
  const prev = attempts.get(id);
  if (!prev || clock - prev.at >= LIMIT_INTERVAL_MS) {
    attempts.set(id, { at: clock, count: 1 });
    return true;
  }
  prev.count++;
  return prev.count <= MAX_CALLS;
}
function result(res, status, value) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(status).json(value);
}
function validIntegerString(x) { return typeof x === 'string' && /^\d{1,80}$/.test(x); }
function safeDecimal(raw, decimals) {
  if (!validIntegerString(raw)) return null;
  const v = BigInt(raw), factor = 10n ** BigInt(decimals);
  const whole = v / factor, frac = (v % factor).toString().padStart(decimals, '0').replace(/0+$/, '');
  return whole.toString() + (frac ? '.' + frac : '');
}
function sanitizeQuote(data, input) {
  if (data?.state !== 'Success' || typeof data.quoteId !== 'string' || !/^tq_[\w-]{10,100}$/.test(data.quoteId))
    return { ok: false, code: 'NO_VERIFIED_ROUTE' };
  const q = data.quote;
  if (q?.state !== 'Success' || !validIntegerString(q.amountOut) || !validIntegerString(q.minimumAmountOut) || BigInt(q.minimumAmountOut) > BigInt(q.amountOut))
    return { ok: false, code: 'NO_VERIFIED_ROUTE' };
  // Never show a quote belonging to a different wallet, pair, token deployment or chain.
  const req = data.request;
  if (!req || String(req.user).toLowerCase() !== input.wallet.toLowerCase() ||
    Number(req.sourceChainId) !== CHAIN_ID || Number(req.destinationChainId) !== CHAIN_ID ||
    String(req.tokenIn?.address).toLowerCase() !== USDC.toLowerCase() ||
    String(req.tokenOut?.address).toLowerCase() !== ARCY.toLowerCase() ||
    String(req.amount) !== input.raw) return { ok: false, code: 'QUOTE_IDENTITY_MISMATCH' };
  const expiresAt = Number(data.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 15 * 60_000)
    return { ok: false, code: 'STALE_OR_INVALID_QUOTE' };
  return {
    ok: true, network: 'Arc', chainId: CHAIN_ID, tokenIn: 'USDC', tokenOut: 'ARCY',
    amountIn: safeDecimal(input.raw, 6),
    estimatedAmountOut: safeDecimal(q.amountOut, 18),
    minimumAmountOut: safeDecimal(q.minimumAmountOut, 18),
    route: data.chosen === 'external' ? 'external' : 'synthra-internal',
    quoteId: data.quoteId, expiresAt,
    executionEnabled: false,
    note: 'Indicative quote only. ARCY SEARCH does not submit or sign transactions. A quote is not an executed trade.'
  };
}
async function fetchQuote(input, { key = process.env.SYNTHRA_API_KEY, fetcher = fetch } = {}) {
  if (!key || !key.startsWith('sk_live_')) return { status: 503, body: { ok: false, code: 'API_NOT_CONFIGURED' } };
  const request = {
    user: input.wallet, recipient: input.wallet,
    sourceChainId: CHAIN_ID, destinationChainId: CHAIN_ID,
    tokenIn: { address: USDC, decimals: 6, symbol: 'USDC' },
    tokenOut: { address: ARCY, decimals: 18, symbol: 'ARCY' },
    amount: input.raw, tradeType: 'EXACT_INPUT', slippageBps: SLIPPAGE_BPS,
    allowInternalExecution: true, allowExternalExecution: true
  };
  try {
    const response = await fetcher(HOST + '/v1/swap/quote', {
      method: 'POST', headers: { 'content-type': 'application/json', 'accept': 'application/json', 'x-api-key': key },
      redirect: 'error', signal: AbortSignal.timeout(10000), body: JSON.stringify(request)
    });
    if (!response.ok) {
      // Upstream errors and payloads are not exposed (credentials, routing implementation).
      return { status: response.status === 429 ? 429 : 502, body: { ok: false, code: response.status === 429 ? 'RATE_LIMITED' : 'QUOTE_UPSTREAM_UNAVAILABLE' } };
    }
    const data = await response.json();
    const clean = sanitizeQuote(data, input);
    return { status: clean.ok ? 200 : 422, body: clean };
  } catch (_) {
    return { status: 502, body: { ok: false, code: 'QUOTE_UPSTREAM_UNAVAILABLE' } };
  }
}
async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return result(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
  }
  const origin = req.headers?.origin;
  if (origin) {
    try {
      const host = new URL(origin).hostname;
      if (!(host === 'arcyusdc.xyz' || host === 'www.arcyusdc.xyz' || (host.endsWith('-arcy3.vercel.app') && host.startsWith('arcy-official-')))) {
        return result(res, 403, { ok: false, code: 'FOREIGN_ORIGIN' });
      }
    } catch (_) { return result(res, 403, { ok: false, code: 'FOREIGN_ORIGIN' }); }
  }
  // Vercel normally parses JSON into req.body; no fall-through to other action routes.
  let body = req.body;
  if (typeof body === 'string') {
    if (body.length > 1024) return result(res, 413, { ok: false, code: 'BODY_TOO_LARGE' });
    try { body = JSON.parse(body); } catch (_) { body = null; }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'amount,wallet')
    return result(res, 400, { ok: false, code: 'INVALID_QUOTE_REQUEST' });
  const input = validate(body.wallet, body.amount);
  if (!input) return result(res, 400, { ok: false, code: 'INVALID_WALLET_OR_AMOUNT' });
  const ip = String(req.headers?.['x-real-ip'] || req.headers?.['x-forwarded-for'] || 'unknown');
  if (!quota(ip)) return result(res, 429, { ok: false, code: 'RATE_LIMITED' });
  const quote = await fetchQuote(input);
  return result(res, quote.status, quote.body);
}
module.exports = handler;
module.exports.parseAmount = parseAmount;
module.exports.validate = validate;
module.exports.quota = quota;
module.exports.fetchQuote = fetchQuote;
module.exports.sanitizeQuote = sanitizeQuote;
module.exports.USDC = USDC;
module.exports.ARCY = ARCY;
