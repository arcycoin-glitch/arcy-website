'use strict';
// Shared PURE logic for the homepage Token Unlocks calendar. Imported by the Vercel route (api/unlocks.js, ESM syntax) and by the
// Node worker collector (lib/unlock-calendar.js, CJS), so both runtimes parse, validate and sanitise identically (issue #83).
// No I/O, no clock reads except through the explicit `now` arguments. A calendar date is a published PLAN: nothing here marks an
// unlock as executed on-chain, and nothing converts an approximate rule into an exact event.
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
// Hosts whose pages may be linked from an unlock row. Project-confirmed records add their own reviewed `allowedHost`.
const PUBLISHER_HOSTS = Object.freeze(['api.coinbell.in', 'coinbell.in', 'defillama.com', 'www.defillama.com']);

function stripTags(value = '') {
  return String(value).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#39;/g, "'").replace(/&quot;/gi, '"').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ').trim();
}
function isoDate(text = '') {
  const match = String(text).match(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\b/i);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[3]), MONTHS[match[2].toLowerCase()], Number(match[1])));
  return date.getUTCDate() === Number(match[1]) ? date.toISOString().slice(0, 10) : null;
}
const AMOUNT_RE = /^\d+(?:[.,]\d+)*(?:[KMB])?\s+[A-Z0-9._-]+$/;
// Comparable amount key. A suffix (K/M/B) makes the separator a decimal point. Without it, a lone `d{1,3}[.,]d{3}` is ambiguous
// between a thousands group and a decimal fraction; it is never silently resolved. Returns { key, ambiguous }.
function amountKey(text) {
  const m = String(text || '').trim().match(/^(\d+(?:[.,]\d+)*)\s*([KMB])?\s+([A-Z0-9._-]+)$/);
  if (!m) return { key: null, ambiguous: false };
  const [, num, unit, symbol] = m;
  let ambiguous = false, normalised;
  const lastDot = num.lastIndexOf('.'), lastComma = num.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',', thou = dec === '.' ? ',' : '.';
    normalised = num.split(thou).join('').replace(dec, '.');
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',', parts = num.split(sep);
    if (parts.length > 2) normalised = parts.join('');
    else if (!unit && parts[1].length === 3 && parts[0].length <= 3) { ambiguous = true; normalised = parts.join(''); }
    else normalised = parts[0] + '.' + parts[1];
  } else normalised = num;
  const value = Number(normalised) * ({ K: 1e3, M: 1e6, B: 1e9 }[unit] || 1);
  return Number.isFinite(value) && value > 0 ? { key: symbol + ':' + value.toPrecision(12), ambiguous } : { key: null, ambiguous };
}

// Parses one publisher HTML page. Diagnostics let the caller tell "source markup changed" from "no events":
//   dataRows  = table rows that look like calendar rows (numeric rank + >= 6 cells)
//   parsed    = rows that passed every field check
//   drift     = most data rows failed validation (publisher markup/locale/format change) -> feed must not be trusted
function parseFeed(html, sourceUrl, now = Date.now()) {
  const rows = [], rejected = {}, diagnostics = { tableRows: 0, dataRows: 0, parsed: 0, rejected, ambiguousAmounts: 0, drift: false, driftReason: null };
  const reject = reason => { rejected[reason] = (rejected[reason] || 0) + 1; };
  for (const row of String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    diagnostics.tableRows++;
    const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => stripTags(cell[1]));
    if (cells.length < 6 || !/^\d+$/.test(cells[0])) continue;
    diagnostics.dataRows++;
    const date = isoDate(cells[2]), amount = cells[3] || '', symbolMatch = amount.match(/\s([A-Z0-9][A-Z0-9._-]{0,14})\s*$/), symbol = symbolMatch?.[1] || '';
    if (!date) { reject('NO_DATE'); continue; }
    if (!symbol) { reject('NO_SYMBOL'); continue; }
    if (!AMOUNT_RE.test(amount) || !amountKey(amount).key) { reject('BAD_AMOUNT'); continue; }
    if (amountKey(amount).ambiguous) diagnostics.ambiguousAmounts++;
    let name = cells[1] || symbol;
    if (name.toUpperCase().endsWith(symbol)) name = name.slice(0, -symbol.length).trim() || symbol;
    rows.push({ name, symbol, date, amount, percent: cells[5] || '', value: cells[4] || '', allocation: cells[6] || '', source: 'CoinBell / DefiLlama', sourceUrl,
      verification: 'source-published', evidence: [{ url: sourceUrl, kind: 'published-calendar', checkedAt: new Date(now).toISOString() }] });
  }
  diagnostics.parsed = rows.length;
  if (diagnostics.tableRows > 0 && diagnostics.dataRows === 0) { diagnostics.drift = true; diagnostics.driftReason = 'NO_RECOGNISED_DATA_ROWS'; }
  else if (diagnostics.dataRows >= 5 && rows.length / diagnostics.dataRows < 0.6) { diagnostics.drift = true; diagnostics.driftReason = 'MOST_ROWS_FAILED_VALIDATION'; }
  return { rows, diagnostics };
}

// Link safety: https only, no credentials, default port, a host on the allowlist (never a punycode look-alike or an IP literal).
function safeSourceUrl(value, extraHosts = []) {
  try {
    const url = new URL(String(value));
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
    if (/(^|\.)xn--/.test(host) || /^[\d.]+$/.test(host) || host.includes(':')) return null;
    return new Set([...PUBLISHER_HOSTS, ...extraHosts.map(h => String(h).toLowerCase())]).has(host) ? url.href : null;
  } catch { return null; }
}
function safeLogoUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && !url.username && !url.password && !/^[\d.]+$/.test(url.hostname) && !url.hostname.includes(':') ? url.href : '';
  } catch { return ''; }
}

// Schedule type is taken ONLY from explicit words in the published allocation text. No text, no type: never inferred from the
// shape of the dates (a monthly series is not proof of linear vesting) and never promoted to an exact event.
function scheduleBasis(allocation) {
  const text = String(allocation || '').toLowerCase();
  if (/\b(?:estimated|approx(?:imate|imately)?|projected|forecast|assumed?)\b/.test(text)) return 'ESTIMATED';
  const cliff = /\bcliff\b/.test(text), linear = /\b(?:linear|continuous|daily|streaming)\b/.test(text);
  if (cliff && linear) return 'CLIFF_AND_LINEAR_TEXT';
  if (cliff) return 'CLIFF_TEXT';
  if (linear) return 'LINEAR_TEXT';
  return 'UNSPECIFIED';
}

// A calendar or project-published schedule is NOT proof of on-chain execution.
// A tx hash, chain ID and block that look valid can be fabricated by an upstream feed.
// This calendar collector has no trusted receipt/event verification step; fail closed.
// A future independently verified receipt pipeline must supply a separate attested state.
function executionVerification(_event) {
  return 'NOT_VERIFIED';
}
const norm = value => String(value || '').toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();
const identityGroup = e => JSON.stringify([norm(e.name), String(e.symbol || ''), norm(e.tokenVersion), String(e.date || ''), norm(e.allocation)]);

// Final defensive pass over events about to be served (also over a signed edition produced by an older worker). Pure.
//  * conflicting amounts for the SAME name+symbol+version+date+allocation are quarantined, never shown as two events
//  * namesake tickers with different names stay separate (the group key includes the name)
//  * links and logos are re-validated; a blocked link is removed with a status instead of being rendered
function sanitizeEvents(events, { extraHosts = [] } = {}) {
  const groups = new Map();
  for (const e of events) { const k = identityGroup(e); (groups.get(k) || groups.set(k, []).get(k)).push(e); }
  const conflicts = [], out = [];
  for (const [key, group] of groups) {
    const keys = new Set(group.map(e => amountKey(e.amount).key || 'unparseable:' + e.amount));
    if (keys.size > 1) { conflicts.push({ identity: JSON.parse(key), reason: 'Conflicting amounts for one event identity', amounts: group.map(e => e.amount), evidenceCategory: 'CONFLICTING_SOURCES' }); continue; }
    const first = group[0];
    const hosts = first.verification === 'project-confirmed' ? (first.evidence || []).map(x => { try { return new URL(x?.url).hostname; } catch { return null; } }).filter(Boolean) : [];
    const link = safeSourceUrl(first.sourceUrl, hosts);
    const evidence = (Array.isArray(first.evidence) ? first.evidence : []).map(x => ({ ...x, url: safeSourceUrl(x?.url, hosts) })).filter(x => x.url);
    out.push({ ...first, sourceUrl: link || '', sourceLinkStatus: link ? 'ALLOWLISTED_HTTPS' : 'BLOCKED_OR_ABSENT', evidence,
      ...(first.logo !== undefined ? { logo: safeLogoUrl(first.logo) } : {}), scheduleBasis: scheduleBasis(first.allocation), scheduleStatus: 'SCHEDULED', executionVerification: executionVerification(first),
      amountFormat: amountKey(first.amount).ambiguous ? 'AMBIGUOUS_SEPARATORS' : 'OK' });
  }
  return { events: out, conflicts };
}


// ---- On-chain scheduled events (reviewed vesting contracts) -------------------------------------------------------
// A contract-state schedule is a SCHEDULED release (never an executed transaction). It enters the 30-day calendar only
// when verified live; failures never produce an event and never block the third-party calendar.
function groupDigits(decimal) { const [w, f] = String(decimal).split('.'); return w.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? '.' + f : ''); }
function onchainEvent(rec, result, now) {
  const e = result?.evidence?.[0];
  if (!result || result.dataState !== 'DATA_FOUND' || result.status !== 'ONCHAIN_VERIFIED' || !e) return null;
  if (e.token !== rec.token || e.vestingContract !== rec.vestingContract || e.chainId !== rec.chainId) return null;
  if (!/^\d{4}-\d{2}-\d{2}T00:00:00Z$/.test(result.value)) return null;
  const date = result.value.slice(0, 10), today = new Date(now).toISOString().slice(0, 10), end = new Date(Date.parse(today + 'T00:00:00Z') + 30 * 86400000).toISOString().slice(0, 10);
  if (date < today || date > end) return null; // outside the calendar window: not shown (no stale/early rows)
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(e.eventAmount) || !/[1-9]/.test(e.eventAmount)) return null;
  return {
    name: rec.projectName || rec.symbol, symbol: rec.symbol, projectId: rec.projectId, tokenVersion: 'ethereum:' + rec.token,
    date, amount: groupDigits(e.eventAmount) + ' ' + rec.symbol, percent: '', value: '', allocation: rec.allocationCategory,
    source: 'On-chain vesting contract + official governance record', sourceUrl: rec.sourceUrl, verification: 'project-confirmed',
    scheduleType: 'periodic-onchain-release', onchainSchedule: { chainId: rec.chainId, vestingContract: rec.vestingContract, block: e.block, scheduled: true, executed: false, revocable: true, percentOfTotalSupply: e.percentOfTotalSupply },
    evidence: [{ url: rec.sourceUrl, kind: 'onchain-contract-state', checkedAt: new Date(now).toISOString(), reviewedAt: rec.reviewedAt }]
  };
}
async function onchainEvents({ now = Date.now(), inspect, records } = {}) {
  const regs = records || require('../search/server/data/onchain-vesting.json'), run = inspect || require('../search/server/lib/onchain-vesting').inspect;
  const events = [], rejected = [];
  await Promise.all(regs.map(async rec => {
    try {
      const result = await Promise.race([run(rec.token, { now, chainId: rec.chainId }), new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), 7000))]);
      const ev = onchainEvent(rec, result, now);
      if (ev) events.push(ev); else if (result?.dataState !== 'DATA_FOUND') rejected.push({ projectId: rec.projectId, status: 'onchain-evidence-unavailable', reason: result?.reasonCode || 'UNKNOWN' });
    } catch (err) { rejected.push({ projectId: rec.projectId, status: 'onchain-evidence-unavailable', reason: String(err.message || 'ERROR').slice(0, 40) }); }
  }));
  return { events, rejected };
}
// Third-party rows describing the same release (same name, symbol, date and amount) are duplicates of a contract-verified event.
function dropOnchainDuplicates(rows, onchain) {
  if (!onchain.length) return rows;
  const norm = a => String(a || '').replace(/,/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return rows.filter(r => !onchain.some(o => r.symbol === o.symbol && r.date === o.date && String(r.name).toLowerCase().trim() === String(o.name).toLowerCase().trim() && norm(r.amount) === norm(o.amount)));
}

module.exports = { onchainEvent, onchainEvents, dropOnchainDuplicates, groupDigits, PUBLISHER_HOSTS, stripTags, isoDate, amountKey, parseFeed, safeSourceUrl, safeLogoUrl, scheduleBasis, executionVerification, sanitizeEvents, identityGroup, AMOUNT_RE };
