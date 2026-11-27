const { VERIFIED_EVENTS, COVERAGE_REVIEWS, suppressingReview } = require('./unlock-evidence.cjs');

const SOURCE_URL = 'https://api.coinbell.in/token-unlocks?sort=soonest&window=30';
const SOURCE_URLS = ['soonest', 'impact', 'value'].map(sort => `https://api.coinbell.in/token-unlocks?sort=${sort}&window=30`);
const REFRESH_MS = 6 * 60 * 60 * 1000;

const { stripTags, isoDate, parseFeed, sanitizeEvents } = require('./unlock-core.cjs');

function utcToday(now = Date.now()) { return new Date(now).toISOString().slice(0, 10); }
function dayDiff(date, today) { return Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000); }
function nextRefresh(now = Date.now()) { return new Date(now + REFRESH_MS).toISOString(); }
async function request(fetcher, url, options = {}) { return fetcher(url, { ...options, signal: AbortSignal.timeout(15000) }); }

function parseRows(html, sourceUrl = SOURCE_URL, now = Date.now()) { return parseFeed(html, sourceUrl, now).rows; }

// Additive provenance metadata (no schema removals, no UI change). Several sort orders of ONE publisher's calendar are
// a single source, not corroboration; a calendar date is never proof that tokens were released on-chain.
function publisherOf(url) { try { return new URL(url).hostname.toLowerCase().replace(/^(?:www|api)\./, ''); } catch { return null; } }
function publishers(urls) { return [...new Set(urls.map(publisherOf).filter(Boolean))]; }
function provenance(event) {
  const hosts = publishers([event.sourceUrl, ...(event.evidence || []).map(item => item?.url)]);
  const confirmed = event.verification === 'project-confirmed';
  return { evidenceCategory: confirmed ? 'PROJECT_SCHEDULE_CONFIRMED' : 'THIRD_PARTY_CALENDAR', independentPublishers: hosts.length, publishers: hosts, identityBasis: confirmed && event.tokenVersion ? 'PROJECT_ID_AND_TOKEN_VERSION' : 'NAME_AND_TICKER_ONLY', executionStatus: 'NOT_CHECKED_ONCHAIN' };
}

// A reviewed project-confirmed event carries a tokenVersion, a calendar row does not, so the merge key above never joins them
// and the same unlock could appear twice. Same token (name + symbol) and date: if the calendar amount equals the confirmed
// amount within the calendar's own display precision, the calendar row becomes corroboration of the confirmed event; if it
// differs, the confirmed (primary-source) event is kept and the calendar row is recorded as a conflict, never shown as a
// second event. Different-amount rows for a different allocation are left untouched.
function tokens(amount) {
  const m = String(amount || '').replace(/,/g, '').trim().match(/^(\d+(?:\.(\d+))?)\s*([KMB])?\s+[A-Z0-9._-]+$/);
  if (!m) return null;
  const unit = { K: 1e3, M: 1e6, B: 1e9 }[m[3]] || 1;
  return { value: Number(m[1]) * unit, tolerance: 0.5 * Math.pow(10, -(m[2] || '').length) * unit };
}
function sameAmount(calendar, confirmed) {
  const a = tokens(calendar), b = tokens(confirmed);
  return !!(a && b && Math.abs(a.value - b.value) <= a.tolerance + 1e-9 * b.value);
}
function reconcileConfirmed(events, conflicts) {
  const confirmed = events.filter(e => e.verification === 'project-confirmed');
  if (!confirmed.length) return events;
  const drop = new Set();
  for (const row of events) {
    if (row.verification === 'project-confirmed') continue;
    // A calendar name/ticker is not contract identity. Require a unique matching verified
    // event INCLUDING allocation, not merely same token name and date. Keep ambiguous rows.
    const matches = confirmed.filter(primary =>
      primary.symbol === row.symbol && primary.date === row.date &&
      primary.name.toLowerCase().trim() === row.name.toLowerCase().trim() &&
      primary.allocation.toLowerCase().trim() === row.allocation.toLowerCase().trim());
    if (matches.length !== 1) continue;
    const primary = matches[0];
    if (sameAmount(row.amount, primary.amount)) {
      drop.add(row);
      primary.evidence = [...(primary.evidence || []), ...(row.evidence || []).map(item => ({
        ...item, kind: 'possible-calendar-match', identityMatch: 'NAME_TICKER_DATE_ALLOCATION_AMOUNT_ONLY',
        contractIdentityVerified: false
      }))];
      Object.assign(primary, provenance(primary), {
        calendarMatchIdentity: 'NAME_TICKER_DATE_ALLOCATION_AMOUNT_ONLY',
        calendarMatchContractVerified: false,
        corroboratedBy: [...new Set([...(primary.corroboratedBy || []), row.source])]
      });
    } else {
      drop.add(row);
      conflicts.push({
        identity: [row.name.toLowerCase().trim(), row.symbol, 'calendar-unspecified', row.date, row.allocation.toLowerCase().trim()],
        reason: 'Calendar amount differs from the project-confirmed schedule; the project-confirmed event is shown, but calendar identity is based on name/ticker/allocation only',
        sources: [row.sourceUrl, primary.sourceUrl], evidenceCategory: 'CONFLICTING_SOURCES',
        independentPublishers: publishers([row.sourceUrl, primary.sourceUrl]).length,
        calendarAmount: row.amount, confirmedAmount: primary.amount,
        contractIdentityVerified: false
      });
    }
  }
  return events.filter(e => !drop.has(e));
}

function mergeEvents(rows) {
  const groups = new Map(), conflicts = [], quarantined = new Map();
  for (const row of rows) {
    const review = suppressingReview(row); if (review && row.verification !== 'project-confirmed') { const key = JSON.stringify([row.name,row.symbol,row.date,row.amount,review.projectId]); quarantined.set(key,{projectId:review.projectId,name:row.name,symbol:row.symbol,date:row.date,amount:row.amount,status:review.status,reason:review.reason}); continue; }
    const key = JSON.stringify([row.name.toLowerCase().trim(), row.symbol, row.tokenVersion || 'calendar-unspecified', row.date, row.allocation.toLowerCase().trim()]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const events = [];
  for (const [key, group] of groups) {
    const amounts = new Set(group.map(row => row.amount.replace(/,/g, '').replace(/\s+/g, ' ').trim()));
    if (amounts.size !== 1) { const sources = [...new Set(group.map(row => row.sourceUrl))]; conflicts.push({ identity: JSON.parse(key), reason: 'Conflicting published amounts', sources, evidenceCategory: 'CONFLICTING_SOURCES', independentPublishers: publishers(sources).length }); continue; }
    const event = { ...group[0], evidence: group.flatMap(row => row.evidence || []) };
    Object.assign(event, provenance(event));
    if (new Set(group.map(row => row.percent)).size > 1 || (event.verification !== 'project-confirmed' && COVERAGE_REVIEWS.some(r => r.status === 'cross-source-float-percent-conflict' && r.symbols.includes(event.symbol) && r.date === event.date && r.name.toLowerCase() === event.name.toLowerCase()))) event.percent = '';
    events.push(event);
  }
  return { events: reconcileConfirmed(events, conflicts), conflicts, quarantined: [...quarantined.values()] };
}

async function collectVerifiedEvents(records, fetcher, now) {
  const events = [], rejected = [];
  await Promise.all(records.map(async record => {
    try {
      const url = new URL(record.sourceUrl);
      const validDate = /^\d{4}-\d{2}-\d{2}$/.test(record.date) && new Date(record.date + 'T00:00:00Z').toISOString().slice(0, 10) === record.date;
      if (url.protocol !== 'https:' || url.hostname !== record.allowedHost || !validDate || !record.projectId || !record.tokenVersion || !record.allocation || !record.name || !/^[A-Z0-9._-]+$/.test(record.symbol) || !/^\d+(?:\.\d+)?$/.test(record.amountTokens) || !/[1-9]/.test(record.amountTokens)) throw Error('INVALID_SUPPLEMENT');
      if (/\b(?:estimated|approximately|proposed|forecast|assume)\b/i.test(record.evidenceText || '') || !record.evidenceText?.includes(record.publishedDateText) || !record.evidenceText?.includes(record.publishedAmountText)) throw Error('INCOMPLETE_EVIDENCE');
      const reviewed = Date.parse(record.reviewedAt), expires = Date.parse(record.reviewExpiresAt);
      if (!Number.isFinite(reviewed) || !Number.isFinite(expires) || reviewed > now || expires <= now || expires - reviewed > 30 * 86400000) throw Error('EXPIRED_REVIEW');
      const response = await request(fetcher, record.sourceUrl);
      if (!response.ok || new URL(response.url || record.sourceUrl).hostname !== record.allowedHost || !stripTags(await response.text()).includes(stripTags(record.evidenceText))) throw Error('EVIDENCE_UNAVAILABLE');
      events.push({ name: record.name, symbol: record.symbol, projectId: record.projectId, tokenVersion: record.tokenVersion, date: record.date, amount: record.amountTokens + ' ' + record.symbol, percent: '', value: '', allocation: record.allocation, source: record.name + ' official schedule', sourceUrl: record.sourceUrl, verification: 'project-confirmed', evidence: [{ url: record.sourceUrl, kind: 'explicit-event', checkedAt: new Date(now).toISOString(), reviewedAt: record.reviewedAt }] });
    } catch { rejected.push({ projectId: record.projectId || 'unknown', status: 'evidence-unavailable-or-invalid' }); }
  }));
  return { events, rejected };
}

async function fetchLogos(events, fetcher) {
  // Skip unlicensed/unauthenticated calls to the CoinMarketCap Pro endpoint.
  if (!process.env.CMC_API_KEY) return {};
  const symbols = [...new Set(events.map(event => event.symbol).filter(Boolean))];
  if (!symbols.length) return {};
  const key = process.env.CMC_API_KEY, query = new URLSearchParams({ symbol: symbols.join(','), aux: 'logo', skip_invalid: 'true' });
  try {
    const response = await request(fetcher, `https://pro-api.coinmarketcap.com/v2/cryptocurrency/info?${query}`, { headers: { accept: 'application/json', ...(key ? { 'X-CMC_PRO_API_KEY': key } : {}) } });
    if (!response.ok) return {};
    const data = await response.json(), logos = {};
    for (const symbol of symbols) {
      const raw = data?.data?.[symbol], candidates = Array.isArray(raw) ? raw : raw ? [raw] : [];
      const names = events.filter(event => event.symbol === symbol).map(event => String(event.name || '').toLowerCase());
      const chosen = candidates.find(item => names.includes(String(item.name || '').toLowerCase())) || (candidates.length === 1 ? candidates[0] : null);
      if (chosen?.logo && /^https:\/\//i.test(chosen.logo)) logos[symbol] = chosen.logo;
    }
    return logos;
  } catch { return {}; }
}

async function generate({ now = Date.now(), fetcher = fetch, trigger = 'worker' } = {}) {
  const collected = await Promise.all(SOURCE_URLS.map(async url => {
    try {
      const response = await request(fetcher, url, { headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'ARCY-Unlocks/2.0 (+https://arcyusdc.xyz)' } });
      if (!response.ok) throw Object.assign(Error('SOURCE_HTTP_' + response.status), { retryAfter: response.headers?.get?.('retry-after') });
      const { rows, diagnostics } = parseFeed(await response.text(), url, now);
      // A publisher markup/locale change that invalidates most rows is a SOURCE problem, not "no unlocks": the feed is dropped whole.
      if (diagnostics.drift) throw Object.assign(Error('SOURCE_MARKUP_DRIFT'), { diagnostics });
      if (!rows.length) throw Object.assign(Error('SOURCE_EMPTY'), { diagnostics });
      return { url, status: 'available', rows, diagnostics };
    } catch (error) {
      const retry = Number(error?.retryAfter);
      return { url, status: 'unavailable', rows: [], reason: String(error?.message || 'SOURCE_FAILED').slice(0, 60), diagnostics: error?.diagnostics || null, ...(Number.isFinite(retry) ? { retryAfterSeconds: retry } : {}) };
    }
  }));
  const supplemental = await collectVerifiedEvents(VERIFIED_EVENTS, fetcher, now);
  if (!collected.some(source => source.status === 'available') && !supplemental.events.length) throw Object.assign(Error('UNLOCK_DISCOVERY_UNAVAILABLE'), { code: 'UNLOCK_DISCOVERY_UNAVAILABLE' });
  const today = utcToday(now), merged = mergeEvents([...collected.flatMap(source => source.rows), ...supplemental.events]);
  const events = merged.events.map(event => ({ ...event, daysFromToday: dayDiff(event.date, today) })).filter(event => event.daysFromToday >= 0 && event.daysFromToday <= 30).sort((left, right) => left.date.localeCompare(right.date) || left.name.localeCompare(right.name) || left.allocation.localeCompare(right.allocation));
  const logos = await fetchLogos(events, fetcher), guarded = sanitizeEvents(events.map(event => ({ ...event, logo: logos[event.symbol] || '' })));
  const enriched = guarded.events;
  merged.conflicts.push(...guarded.conflicts);
  const partial = collected.some(source => source.status !== 'available') || supplemental.rejected.length > 0 || merged.conflicts.length > 0 || merged.quarantined.length > 0;
  return { schemaVersion: 1, success: true, trigger, generatedAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), refreshAt: nextRefresh(now), live: true, source: 'CoinBell published calendar (DefiLlama attribution); project-confirmed supplements when available', sourceUrl: SOURCE_URL, partial, coverage: { complete: false, sources: collected.map(({ url, status, rows, reason, diagnostics, retryAfterSeconds }) => ({ url, status, rowCount: rows.length, ...(reason ? { reason } : {}), ...(diagnostics ? { parse: { dataRows: diagnostics.dataRows, parsed: diagnostics.parsed, rejected: diagnostics.rejected, ambiguousAmounts: diagnostics.ambiguousAmounts } } : {}), ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}) })), reviews: COVERAGE_REVIEWS, conflicts: merged.conflicts, quarantined: merged.quarantined, rejectedSupplements: supplemental.rejected }, windowTimeZone: 'UTC', windows: { today: enriched.filter(event => event.daysFromToday === 0), next7: enriched.filter(event => event.daysFromToday >= 1 && event.daysFromToday <= 7), days8to30: enriched.filter(event => event.daysFromToday >= 8 && event.daysFromToday <= 30) }, events: enriched };
}

module.exports = { SOURCE_URL, SOURCE_URLS, REFRESH_MS, parseRows, mergeEvents, generate, nextRefresh, provenance, publishers, reconcileConfirmed, sameAmount };
