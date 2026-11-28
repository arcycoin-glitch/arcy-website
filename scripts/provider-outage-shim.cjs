'use strict';
// Isolated third-party outage simulation. Preload with NODE_OPTIONS="--require ./scripts/provider-outage-shim.cjs" on a LOCAL test
// server only. ARCY_SIM_OUTAGE is a comma list of: dexscreener, geckoterminal, blockscout (or "all"). Requests to those providers fail
// the way a real outage does (network error, no response); every other host (RPC nodes, Chainlink, Sourcify, ...) is untouched.
// It is inert unless ARCY_SIM_OUTAGE is set and never ships in a production start command.
const PROVIDERS = {
  dexscreener: h => /(^|\.)dexscreener\.com$/.test(h),
  geckoterminal: h => /(^|\.)geckoterminal\.com$/.test(h) || /^(pro-)?api\.coingecko\.com$/.test(h),
  blockscout: h => /(^|\.)blockscout\.com$/.test(h) || h === 'arcscan.app' || /(^|\.)arcscan\.app$/.test(h) || h === 'blockscout-content.s3.us-east-1.amazonaws.com'
};
function parse(spec) {
  const names = String(spec || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return names.includes('all') ? Object.keys(PROVIDERS) : names.filter(n => PROVIDERS[n]);
}
function blockedBy(url, names) {
  let host; try { host = new URL(typeof url === 'string' ? url : url?.url || String(url)).hostname.toLowerCase(); } catch { return null; }
  return names.find(n => PROVIDERS[n](host)) || null;
}
function install(spec = process.env.ARCY_SIM_OUTAGE, target = globalThis) {
  const names = parse(spec); if (!names.length || target.__arcyOutageInstalled) return { names, blocked: {} };
  const real = target.fetch.bind(target), blocked = Object.fromEntries(names.map(n => [n, 0]));
  target.__arcyOutageInstalled = true;
  target.fetch = function (input, init) {
    const hit = blockedBy(input instanceof Request ? input.url : input, names);
    if (hit) { blocked[hit]++; const e = new TypeError('fetch failed'); e.cause = Object.assign(new Error('simulated provider outage: ' + hit), { code: 'ECONNREFUSED' }); return Promise.reject(e); }
    return real(input, init);
  };
  const out = process.env.ARCY_SIM_OUTAGE_COUNTS;
  if (out) { const fs = require('node:fs'), write = () => { try { fs.writeFileSync(out, JSON.stringify({ outage: names, blocked, at: new Date().toISOString() })); } catch {} }; setInterval(write, 3000).unref(); process.on('exit', write); }
  return { names, blocked };
}
if (process.env.ARCY_SIM_OUTAGE) install();
module.exports = { install, parse, blockedBy, PROVIDERS };
