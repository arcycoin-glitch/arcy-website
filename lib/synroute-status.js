'use strict';
// Read-only Synthra integration diagnostic. Never accepts caller-supplied upstream URLs.
// No swap, signature, payout, token transfer or key disclosure is possible in this route.
const API_ORIGIN = 'https://ghost-trading-api.synthra.org';
const REQUIRED_CHAIN_IDS = Object.freeze([5042, 4663]);
const TIMEOUT_MS = 7500;

function reply(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(status).json(body);
}

async function upstream(path, key, fetcher) {
  const headers = { Accept: 'application/json' };
  if (key) headers['x-api-key'] = key;
  const response = await fetcher(API_ORIGIN + path, {
    method: 'GET', headers, redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // Read body only after verifying status, and never return upstream details publicly.
  if (!response.ok) return { ok: false, status: response.status };
  try {
    const data = await response.json();
    return { ok: true, data };
  } catch (_) {
    return { ok: false, status: 502 };
  }
}

function chainIdsFrom(body) {
  if (!body || !Array.isArray(body.chains)) return [];
  return body.chains.map((item) => Number(item && item.chainId)).filter(Number.isInteger);
}

async function checkSynroute({ key, fetcher = fetch }) {
  if (!key) {
    return { status: 503, body: { state: 'NOT_CONFIGURED', mainnet: false, auth: 'not_checked' } };
  }
  let deployment;
  try { deployment = await upstream('/v1/chains', null, fetcher); }
  catch (_) { return { status: 502, body: { state: 'UPSTREAM_UNAVAILABLE', mainnet: false, auth: 'not_checked' } }; }
  if (!deployment.ok) return { status: 502, body: { state: 'UPSTREAM_UNAVAILABLE', mainnet: false, auth: 'not_checked' } };
  const advertised = chainIdsFrom(deployment.data);
  const mainnet = REQUIRED_CHAIN_IDS.every((id) => advertised.includes(id));
  if (!mainnet) {
    return { status: 424, body: { state: 'MAINNET_NOT_VERIFIED', mainnet: false, auth: 'not_checked' } };
  }
  try {
    const auth = await upstream('/v1/integrator/stats?days=1', key, fetcher);
    if (!auth.ok) {
      return { status: 424, body: { state: 'AUTH_NOT_VERIFIED', mainnet: true, auth: 'not_verified', upstreamStatus: auth.status } };
    }
    return { status: 200, body: { state: 'READY_FOR_QUOTE_TEST', mainnet: true, supportedChainIds: REQUIRED_CHAIN_IDS, auth: 'verified', swapExecutionEnabled: false } };
  } catch (_) {
    return { status: 502, body: { state: 'UPSTREAM_UNAVAILABLE', mainnet: true, auth: 'not_verified' } };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return reply(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  }
  const result = await checkSynroute({ key: process.env.SYNTHRA_API_KEY });
  return reply(res, result.status, result.body);
};
module.exports.checkSynroute = checkSynroute;
module.exports.chainIdsFrom = chainIdsFrom;
