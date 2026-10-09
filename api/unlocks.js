import { VERIFIED_EVENTS, COVERAGE_REVIEWS } from '../lib/unlock-evidence.js';

const SOURCE_URL = 'https://api.coinbell.in/token-unlocks?sort=soonest&window=30';
const SOURCE_URLS = ['soonest', 'impact', 'value'].map(sort => `https://api.coinbell.in/token-unlocks?sort=${sort}&window=30`);
const SIX_HOURS = 6 * 60 * 60 * 1000;
async function fetchWithTimeout(url, options = {}) { return fetch(url, { ...options, signal: AbortSignal.timeout(15000) }); }
function stripTags(value = '') { return String(value).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#39;/g, "'").replace(/&quot;/gi, '"').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+/g, ' ').trim(); }
function isoDate(text = '') { const match = String(text).match(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\b/i); if (!match) return null; const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }, date = new Date(Date.UTC(Number(match[3]), months[match[2].toLowerCase()], Number(match[1]))); return date.getUTCDate() === Number(match[1]) ? date.toISOString().slice(0, 10) : null; }
function utcToday() { return new Date().toISOString().slice(0, 10); }
function dayDiff(date, today) { return Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000); }

function parseRows(html, sourceUrl = SOURCE_URL) {
  const rows = [];
  for (const row of String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => stripTags(cell[1]));
    if (cells.length < 6 || !/^\d+$/.test(cells[0])) continue;
    const date = isoDate(cells[2]), amount = cells[3] || '', symbol = amount.match(/\s([A-Z0-9][A-Z0-9._-]{0,14})\s*$/)?.[1] || '';
    if (!date || !symbol || !/^\d+(?:[.,]\d+)*(?:[KMB])?\s+[A-Z0-9._-]+$/.test(amount)) continue;
    let name = cells[1] || symbol;
    if (name.toUpperCase().endsWith(symbol)) name = name.slice(0, -symbol.length).trim() || symbol;
    rows.push({ name, symbol, date, amount, percent: cells[5] || '', value: cells[4] || '', allocation: cells[6] || '', source: 'CoinBell / DefiLlama', sourceUrl, verification: 'source-published', evidence: [{ url: sourceUrl, kind: 'published-calendar', checkedAt: new Date().toISOString() }] });
  }
  return rows;
}

async function fetchCmcLogos(events) {
  const symbols = [...new Set(events.map(event => event.symbol).filter(Boolean))]; if (!symbols.length) return {};
  const key = process.env.CMC_API_KEY, query = new URLSearchParams({ symbol: symbols.join(','), aux: 'logo', skip_invalid: 'true' });
  const response = await fetchWithTimeout(`https://pro-api.coinmarketcap.com/v2/cryptocurrency/info?${query}`, { headers: { accept: 'application/json', ...(key ? { 'X-CMC_PRO_API_KEY': key } : {}) } });
  if (!response.ok) return {};
  const data = await response.json(), logos = {};
  for (const symbol of symbols) { const raw = data?.data?.[symbol], candidates = Array.isArray(raw) ? raw : raw ? [raw] : [], names = events.filter(event => event.symbol === symbol).map(event => String(event.name || '').toLowerCase()), chosen = candidates.find(item => names.includes(String(item.name || '').toLowerCase())) || (candidates.length === 1 ? candidates[0] : null); if (chosen?.logo && /^https:\/\//i.test(chosen.logo)) logos[symbol] = chosen.logo; }
  return logos;
}

function mergeEvents(rows) {
  const groups = new Map(), conflicts = [];
  for (const row of rows) { if (COVERAGE_REVIEWS.find(item => item.symbols.includes(row.symbol)) && row.verification !== 'project-confirmed') continue; const key = JSON.stringify([row.name.toLowerCase().trim(), row.symbol, row.tokenVersion || 'calendar-unspecified', row.date, row.allocation.toLowerCase().trim()]); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); }
  const events = [];
  for (const [key, group] of groups) { const amounts = new Set(group.map(row => row.amount.replace(/,/g, '').replace(/\s+/g, ' ').trim())); if (amounts.size !== 1) { conflicts.push({ identity: JSON.parse(key), reason: 'Conflicting published amounts', sources: [...new Set(group.map(row => row.sourceUrl))] }); continue; } const event = { ...group[0], evidence: group.flatMap(row => row.evidence || []) }; if (new Set(group.map(row => row.percent)).size > 1) event.percent = ''; events.push(event); }
  return { events, conflicts };
}

async function collectVerifiedEvents(records) {
  const events = [], rejected = [];
  await Promise.all(records.map(async record => { try { const url = new URL(record.sourceUrl), validDate = /^\d{4}-\d{2}-\d{2}$/.test(record.date) && new Date(record.date + 'T00:00:00Z').toISOString().slice(0, 10) === record.date, reviewed = Date.parse(record.reviewedAt), expires = Date.parse(record.reviewExpiresAt); if (url.protocol !== 'https:' || url.hostname !== record.allowedHost || !validDate || !record.projectId || !record.tokenVersion || !record.allocation || !record.name || !/^[A-Z0-9._-]+$/.test(record.symbol) || !/^\d+(?:\.\d+)?$/.test(record.amountTokens) || !/[1-9]/.test(record.amountTokens) || /\b(?:estimated|approximately|proposed|forecast|assume)\b/i.test(record.evidenceText || '') || !record.evidenceText?.includes(record.publishedDateText) || !record.evidenceText?.includes(record.publishedAmountText) || Date.parse(record.publishedDateText + ' UTC') !== Date.parse(record.date + 'T00:00:00Z') || record.publishedAmountText.replace(/,/g, '').trim() !== record.amountTokens || !Number.isFinite(reviewed) || !Number.isFinite(expires) || reviewed > Date.now() || expires <= Date.now() || expires - reviewed > 30 * 86400000) throw Error('INVALID_EVIDENCE'); const response = await fetchWithTimeout(record.sourceUrl); if (!response.ok || (response.url && new URL(response.url).hostname !== record.allowedHost) || !stripTags(await response.text()).includes(stripTags(record.evidenceText))) throw Error('EVIDENCE_UNAVAILABLE'); events.push({ name: record.name, symbol: record.symbol, projectId: record.projectId, tokenVersion: record.tokenVersion, date: record.date, amount: record.amountTokens + ' ' + record.symbol, percent: '', value: '', allocation: record.allocation, source: record.name + ' official schedule', sourceUrl: record.sourceUrl, verification: 'project-confirmed', evidence: [{ url: record.sourceUrl, kind: 'explicit-event', checkedAt: new Date().toISOString(), reviewedAt: record.reviewedAt }] }); } catch { rejected.push({ projectId: record.projectId || 'unknown', status: 'evidence-unavailable-or-invalid' }); } }));
  return { events, rejected };
}

function validEdition(value) { return !!(value && value.schemaVersion === 1 && value.success === true && Array.isArray(value.events) && value.windows && ['today', 'next7', 'days8to30'].every(name => Array.isArray(value.windows[name]))); }
function base64(value) { return Uint8Array.from(atob(value), char => char.charCodeAt(0)); }
function pem(value) { return Uint8Array.from(atob(String(value).replace(/-----[^-]+-----|\s/g, '')), char => char.charCodeAt(0)); }
async function savedEdition() {
  const base = process.env.ARC_UNLOCK_PUBLISHED_URL || process.env.ARC_HOLDER_PUBLISHED_URL || process.env.ARC_HOLDER_QUEUE_URL, key = process.env.ARC_UNLOCK_PUBLIC_KEY || process.env.ARC_HOLDER_PUBLIC_KEY;
  if (!base || !key || !globalThis.crypto?.subtle) return null;
  try { const response = await fetch(new URL('/unlocks/latest', base), { cache: 'no-store', signal: AbortSignal.timeout(5000) }); if (!response.ok) return null; const envelope = await response.json(), payload = new TextEncoder().encode(envelope.payload), imported = await crypto.subtle.importKey('spki', pem(key), { name: 'Ed25519' }, false, ['verify']); if (!envelope.signature || !await crypto.subtle.verify('Ed25519', imported, base64(envelope.signature), payload)) return null; const edition = JSON.parse(envelope.payload); return validEdition(edition) ? edition : null; } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const saved = await savedEdition();
  if (saved) { res.setHeader('Cache-Control', 'no-store'); return res.status(200).json({ ok: true, ...saved, audit: { lastSuccessful: { generatedAt: saved.generatedAt, trigger: saved.trigger, eventCount: saved.events.length }, nextScheduledAt: saved.refreshAt } }); }
  const secondsToMidnight = Math.max(1, Math.floor((Date.parse(utcToday() + 'T00:00:00Z') + 86400000 - Date.now()) / 1000));
  res.setHeader('Cache-Control', `public, s-maxage=${Math.min(21600, secondsToMidnight)}, must-revalidate`);
  try {
    const collected = await Promise.all(SOURCE_URLS.map(async url => { try { const response = await fetchWithTimeout(url, { headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'ARCY-Research/1.0 (+https://arcyusdc.xyz)' } }); if (!response.ok) throw Error(); const rows = parseRows(await response.text(), url); if (!rows.length) throw Error(); return { url, status: 'available', rows }; } catch { return { url, status: 'unavailable', rows: [] }; } }));
    const supplemental = await collectVerifiedEvents(VERIFIED_EVENTS);
    if (!collected.some(source => source.status === 'available') && !supplemental.events.length) throw Error();
    const today = utcToday(), merged = mergeEvents([...collected.flatMap(source => source.rows), ...supplemental.events]), events = merged.events.map(event => ({ ...event, daysFromToday: dayDiff(event.date, today) })).filter(event => event.daysFromToday >= 0 && event.daysFromToday <= 30).sort((left, right) => left.date.localeCompare(right.date) || left.name.localeCompare(right.name) || left.allocation.localeCompare(right.allocation)), partial = collected.some(source => source.status !== 'available') || supplemental.rejected.length > 0 || merged.conflicts.length > 0;
    if (partial) res.setHeader('Cache-Control', 'no-store');
    let logos = {}; try { logos = await fetchCmcLogos(events); } catch {}
    const enriched = events.map(event => ({ ...event, logo: logos[event.symbol] || '' }));
    return res.status(200).json({ ok: true, live: true, source: 'CoinBell published calendar (DefiLlama attribution); project-confirmed supplements when available', partial, coverage: { complete: false, sources: collected.map(({ url, status, rows }) => ({ url, status, rowCount: rows.length })), reviews: COVERAGE_REVIEWS, conflicts: merged.conflicts, rejectedSupplements: supplemental.rejected }, sourceUrl: SOURCE_URL, updatedAt: new Date().toISOString(), windowTimeZone: 'UTC', refreshAt: new Date(Date.parse(utcToday() + 'T00:00:00Z') + 86400000).toISOString(), windows: { today: enriched.filter(event => event.daysFromToday === 0), next7: enriched.filter(event => event.daysFromToday >= 1 && event.daysFromToday <= 7), days8to30: enriched.filter(event => event.daysFromToday >= 8 && event.daysFromToday <= 30) }, events: enriched });
  } catch { res.setHeader('Cache-Control', 'no-store'); return res.status(503).json({ ok: false, live: false, updatedAt: new Date().toISOString(), message: 'Live unlock feed temporarily unavailable. ARCY will not display guessed or stale unlock data.', events: [], windows: { today: [], next7: [], days8to30: [] } }); }
}
