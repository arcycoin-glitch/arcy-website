'use strict';

const { createHash } = require('node:crypto');
const { publicationTime } = require('./pulse-networks');
const { SOURCES, MAX_PAGES, discoverSource, canonicalSourceUrl } = require('./pulse-news-sources');

const NETWORKS = Object.freeze({ arc: 5042, ethereum: 1, robinhood: 4663 });
const SLOTS = Object.freeze(['ACHIEVED', 'UPCOMING', 'RISK_ALERT']);
const FRESH_MS = 45 * 60_000;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const MAX_CANDIDATES = 8;
const MAX_EVENTS_PER_SLOT = 6;
const MAX_EVENTS = Object.keys(NETWORKS).length * SLOTS.length * MAX_EVENTS_PER_SLOT;
const MAX_SOURCE_REQUESTS = 1 + MAX_PAGES;
const SCAN_DEADLINE_MS = 30_000;
const SOURCE_BY_ID = new Map(SOURCES.map(source => [source.id, source]));
const GRADE = {
  PUBLISHED_RELEASE: ['ACHIEVED', 'A published software release does not establish that the chain or its operators have installed it.'],
  MERGED_CODE: ['ACHIEVED', 'The repository records the code change. Mainnet deployment and usage have not been verified.'],
  PUBLISHER_REPORTED_COMPLETION: ['ACHIEVED', 'The publisher reports this change. On-chain execution, usage and impact require separate evidence.'],
  OFFICIAL_ANNOUNCEMENT: ['UPCOMING', 'The plan can change. Execution on this network has not been verified.'],
  OFFICIAL_ADVISORY: ['RISK_ALERT', 'The publisher reported this issue. Its full scope, on-chain impact and current conditions require separate verification.'],
};
const TARGET_STATUS = ['ANNOUNCED', 'PROPOSED', 'SCHEDULED'];
const INCIDENT_STATUS = new Set(['INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'RESOLVED', 'ACTIVE', 'POSTMORTEM']);
const SOURCE_STATES = new Set(['CHECKED', 'UNAVAILABLE', 'COOLDOWN']);
const SOURCE_REASONS = new Set(['SOURCE_COOLDOWN', 'SOURCE_HTTP_403', 'SOURCE_HTTP_429', 'SOURCE_HTTP_503', 'SOURCE_UNAVAILABLE', 'SOURCE_PARSE_FAILURE', 'SOURCE_TIMEOUT', 'SOURCE_BUDGET']);
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function iso(ms) { return new Date(ms).toISOString(); }
function canonicalTime(value) {
  const ms = typeof value === 'string' && value.length <= 40 ? publicationTime(value) : NaN;
  return Number.isFinite(ms) && /^\d{4}-/.test(iso(ms)) ? iso(ms) : null;
}
function exactTime(value) { return typeof value === 'string' && canonicalTime(value) === value; }

function cleanText(value, max) {
  if (typeof value !== 'string' || value.length > 4096) return '';
  const text = value.replace(/<[^>]*>|[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return text.slice(0, max - 1).replace(/\s+\S*$/, '').trimEnd() + '…';
}

const NAMES = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const TARGET_DATE = new RegExp('(?:\\b(?:scheduled|planned|targeted|expected)\\s+(?:for|on)|\\b(?:will|plans? to)\\s+[^.!?]{0,80}?\\bon)\\s+(20\\d{2}-\\d{2}-\\d{2}|'+NAMES+'\\s+\\d{1,2},?\\s+20\\d{2})','gi');
const PAST_DATE = new RegExp('\\bon\\s+(20\\d{2}-\\d{2}-\\d{2}|'+NAMES+'\\s+\\d{1,2},?\\s+20\\d{2})','gi');

function claimDates(text, expression) {
  return [...text.matchAll(expression)].map(match => {
    const raw = match[1];
    if (/^20\d{2}-/.test(raw)) return canonicalTime(raw) ? raw : null;
    const parts = /^(\S+)\s+(\d{1,2}),?\s+(20\d{2})$/i.exec(raw);
    const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(parts[1].slice(0, 3).toLowerCase()) + 1;
    const isoDate = parts[3] + '-' + String(month).padStart(2, '0') + '-' + parts[2].padStart(2, '0');
    return canonicalTime(isoDate) ? isoDate : null;
  });
}

function announcedDate(text) {
  const targets = claimDates(text, TARGET_DATE);
  const unique = new Set(targets);
  return { value: targets[0] ?? null, invalid: unique.size > 1 || unique.has(null) };
}

const dateOnly = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && canonicalTime(value);
const targetEnd = value => Date.parse(value) + (dateOnly(value) ? DAY : 0);

function classify(item, title, summary, publishedAt, now) {
  const text = title + '. ' + summary;
  const status = typeof item.status === 'string' ? item.status.toUpperCase().replace(/[^A-Z]+/g, '_').slice(0, 40) : '';
  const uncertain = /\b(?:rumou?rs?|unconfirmed|unverified|reportedly|alleged|allegedly|might|speculation)\b|\b(?:is|are|was|were|have|has)\s+not\s+(?:confirmed|verified)\b/i;
  const promotion = /(?:\b(?:giveaway|airdrop campaign|price prediction|buy now)|\b(?:guaranteed returns?|sign up to win|claim your rewards))\b/i;
  if (uncertain.test(title) || promotion.test(title) || /[?]\s*$/.test(title)) return null;

  if (item.kind === 'ADVISORY' || item.kind === 'INCIDENT') {
    // These kinds are reserved for structured official advisory/incident adapters, never inferred from blog keywords.
    const issue = /\b(?:CVE-20\d{2}-\d+|GHSA-[\w-]+|vulnerab\w*|exploit\w*|outage|disruption|degrad\w*|malicious|service interruption|denial.of.service|data loss|incorrect (?:balances|responses)|chain halt|invalid (?:blocks|proofs))\b/i;
    if (!item.eventRef || !issue.test(text) || (item.kind === 'ADVISORY' && status !== 'PUBLISHED') ||
        (item.kind === 'INCIDENT' && !INCIDENT_STATUS.has(status)) ||
        /\b(?:testnet|drill|exercise|scheduled maintenance|false alarm|no(?: evidence of| confirmed)? (?:exploit|vulnerabilit|outage))/i.test(title)) return null;
    return { grade: 'OFFICIAL_ADVISORY', targetAt: null, targetStatus: null, incidentStatus: status };
  }

  if (item.kind === 'RELEASE') {
    if (/\b(?:pre.release|release candidate|beta|alpha|nightly)\b|\bv?\d+\.\d+(?:\.\d+)?-rc\b/i.test(title)) return null;
    return { grade: 'PUBLISHED_RELEASE', targetAt: null, targetStatus: null, incidentStatus: null };
  }
  if (item.kind === 'COMMIT') return { grade: 'MERGED_CODE', targetAt: null, targetStatus: null, incidentStatus: null };

  const action = '(?:launch|release|deploy|activate|upgrade|enable|roll out|introduce|migrate|deprecat(?:e|ion))';
  const subject = /\b(?:mainnet|protocol|supports?|upgrade|release|market|network|contracts?|feature|version|migration|governance|maintenance|router|client|rollout|integration|(?:v|version\s+)\d+(?:\.\d+)*)\b/i;
  const future = new RegExp('\\b(?:will|plans? to|propos(?:e|es|ed) to|(?:is|are) scheduled to|(?:is|are) expected to)\\s+(?:\\w+\\s+){0,2}'+action+'\\b|\\b'+action+'[^.!?]{0,45}\\b(?:is scheduled for|is planned for|is targeted for)\\b','i');
  const launch = /\b(?:(?:is|are|now|they['’]re|it['’]s) (?:live|available)|(?:has|have) (?:launched|deployed|activated|shipped|released|enabled|onboarded)|(?:we|today we) (?:launched|activated|deployed|released|shipped|enabled|rolled out)|(?:launch(?:es|ed)|goes live|brings|adds) (?:its |the )?[^.!?]{2,70}\b(?:mainnet|support|market|upgrade|network|contracts?|router|client|version|V[2-9])\b|(?:activation|upgrade|migration|deployment|rollout) (?:is|was|has been) (?:complete|completed|activated|executed))\b/i;
  const plans = item.kind === 'PROPOSAL' || future.test(text);
  // Opposing claims or uncertain scope should be routed to review instead of ranking as news.
  if (!subject.test(text) || uncertain.test(summary) || /\b(?:testnet|devnet|sepolia|preview-only|proof of concept)\b/i.test(title) ||
      /\b(?:cancelled|canceled|postponed|pulled back|tentative rumor|(?:will not|won't) (?:launch|deploy|activate|ship))\b/i.test(text)) return null;
  if (plans && (launch.test(title) || item.kind === 'ARTICLE' && launch.test(summary))) return null;
  if (plans) {
    const date = item.targetAt == null ? announcedDate(text) : { value: dateOnly(item.targetAt) ? item.targetAt : canonicalTime(item.targetAt),
      invalid: !canonicalTime(item.targetAt) };
    if (date.invalid || date.value && (targetEnd(date.value) <= Date.parse(publishedAt) || targetEnd(date.value) <= now)) return null;
    const targetStatus = TARGET_STATUS.includes(status) ? status : item.kind === 'PROPOSAL' || /\bpropos/i.test(title) ? 'PROPOSED' :
      /\bscheduled\b/i.test(text) && date.value ? 'SCHEDULED' : 'ANNOUNCED';
    return { grade: 'OFFICIAL_ANNOUNCEMENT', targetAt: date.value, targetStatus, incidentStatus: null };
  }
  const retrospective = /^(?:how\b|why\b|a guide\b|what (?:is|are)\b|introduction to\b)/i;
  const past = claimDates(summary, PAST_DATE);
  if (item.kind === 'ARTICLE' && !retrospective.test(title) && launch.test(summary) &&
      past.every(date => date && Date.parse(date) > now - 28 * DAY && Date.parse(date) <= now) &&
      !/\b(?:not (?:yet )?(?:live|available|deployed|enabled|released)|(?:live|available) (?:only )?(?:on (?:the )?)?(?:testnet|devnet|sepolia|hoodi|holesky))\b/i.test(text)) {
    return { grade: 'PUBLISHER_REPORTED_COMPLETION', targetAt: null, targetStatus: null, incidentStatus: null };
  }
  return null;
}

function reference(value) { return typeof value === 'string' && /^[a-z0-9][a-z0-9_.:/-]{0,119}$/i.test(value) ? value.toLowerCase() : null; }

function normalize(item, source, now) {
  if (!item || !['ARTICLE', 'RELEASE', 'COMMIT', 'ADVISORY', 'INCIDENT', 'PROPOSAL'].includes(item.kind)) return null;
  const title = cleanText(item.title, 150), summary = cleanText(item.summary, 270);
  const url = canonicalSourceUrl(item.url, source), publishedAt = canonicalTime(item.publishedAt);
  const chains = Array.isArray(item.chains) ? [...new Set(item.chains)].filter(chain => source.chains.includes(chain)).sort(cmp) : [];
  if (title.length < 8 || summary.length < 20 || !url || !publishedAt || Date.parse(publishedAt) > now ||
      Date.parse(publishedAt) < now - 28 * DAY || !chains.length) return null;
  const claim = classify(item, title, summary, publishedAt, now);
  if (!claim || !source.categories.includes(GRADE[claim.grade][0])) return null;
  const { grade, targetAt, targetStatus, incidentStatus } = claim;
  const category = GRADE[grade][0];
  if (category === 'RISK_ALERT' && now - Date.parse(publishedAt) >= 14 * DAY) return null;
  const eventRef = reference(item.eventRef);
  if ((item.kind === 'ADVISORY' || item.kind === 'INCIDENT') && !eventRef) return null;
  return { category, sourceId: source.id, project: source.project, publisher: source.publisher, title, summary, url, publishedAt,
    evidenceGrade: grade, targetAt, targetStatus, incidentStatus, eventRef, chains, corroboratingSources: [] };
}

const cleanWords = text => text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim().replace(/\s+/g, ' ');
function duplicate(a, b) {
  if (a.category !== b.category) return false;
  if (a.url === b.url || a.eventRef && b.eventRef && a.eventRef === b.eventRef) return true;
  if (Math.abs(Date.parse(a.publishedAt) - Date.parse(b.publishedAt)) > 3 * DAY) return false;
  const first = cleanWords(a.title), second = cleanWords(b.title);
  if (first === second) return true;
  const words = value => new Set(value.split(' ').filter(word => word.length > 2 && !['the','and','for','with','chain'].includes(word)));
  const x = words(first), y = words(second), overlap = [...x].filter(word => y.has(word)).length;
  return overlap >= 5 && overlap / new Set([...x, ...y]).size >= 0.78;
}

function rank(a, b) {
  const quality = grade => grade === 'PUBLISHER_REPORTED_COMPLETION' || grade === 'MERGED_CODE' ? 0 : 1;
  const planRank = status => status === 'SCHEDULED' ? 2 : status === 'ANNOUNCED' ? 1 : 0;
  return quality(b.evidenceGrade) - quality(a.evidenceGrade) || planRank(b.targetStatus) - planRank(a.targetStatus) ||
    b.corroboratingSources.length - a.corroboratingSources.length || cmp(b.publishedAt, a.publishedAt) || cmp(a.url, b.url) || cmp(a.sourceId, b.sourceId);
}

function dedupe(events) {
  return Object.keys(NETWORKS).flatMap(chain => {
    const rows = events.filter(event => event.chains.includes(chain)).sort(rank);
    const completed = new Set(rows.filter(event => event.category === 'ACHIEVED' && event.eventRef).map(event => event.eventRef));
    const result = [];
    for (const event of rows) {
      if (event.category === 'UPCOMING' && completed.has(event.eventRef)) continue;
      const group = result.find(prior => duplicate(prior, event));
      if (!group) { result.push({ ...event, chains: [chain] }); continue; }
      // Similar headlines are deduplicated, but only matching stable references count as corroboration.
      if (event.eventRef && event.eventRef === group.eventRef && event.sourceId !== group.sourceId &&
          event.publisher !== group.publisher && !group.corroboratingSources.includes(event.sourceId)) {
        group.corroboratingSources = [...group.corroboratingSources, event.sourceId].sort(cmp).slice(0, 3);
      }
    }
    return SLOTS.flatMap(category => result.filter(event => event.category === category).sort(rank).slice(0, MAX_EVENTS_PER_SLOT));
  });
}

function sourceCooldown(response, now) {
  if (![403, 429, 503].includes(response.status)) return 0;
  const retry = response.headers?.get?.('retry-after') || '';
  const explicit = retry.length <= 80 && /^\d+$/.test(retry) ? now + Number(retry) * 1000 : Date.parse(retry);
  const base = response.status === 503 ? 15 * 60_000 : HOUR;
  return Math.max(now + base, Math.min(now + DAY, Number.isFinite(explicit) ? explicit : 0));
}

async function scanNews({ fetcher = fetch, now = Date.now(), cooldowns = {} } = {}) {
  const checkedAt = iso(now), maxDeadline = AbortSignal.timeout(SCAN_DEADLINE_MS);
  const nextCooldowns = {}, hostLimits = new Map(), hostFlights = new Map();
  let requests = 0;
  for (const source of SOURCES) {
    const until = cooldowns[source.id];
    if (Number.isSafeInteger(until) && until > now && until <= now + DAY) {
      nextCooldowns[source.id] = until;
      const host = new URL(source.url).hostname;
      hostLimits.set(host, Math.max(until, hostLimits.get(host) || 0));
    }
  }
  async function check(source) {
    const result = { id: source.id, state: 'CHECKED', reasonCode: null, reviewRequired: 0 };
    if (nextCooldowns[source.id]) return { result: { ...result, state: 'COOLDOWN', reasonCode: 'SOURCE_COOLDOWN' }, events: [] };
    let calls = 0;
    try {
      const discovered = await discoverSource(source, async (url, options = {}) => {
        maxDeadline.throwIfAborted();
        const target = new URL(url), host = target.hostname, feedHost = new URL(source.url).hostname;
        if (target.protocol !== 'https:' || target.port || target.username || target.password ||
            (host !== feedHost && !source.hosts.includes(host) && !(source.id === 'robinhood-newsroom' && host === 'www.robinhood.com'))) {
          throw Object.assign(Error('SOURCE_UNAVAILABLE'), { code: 'SOURCE_UNAVAILABLE' });
        }
        const until = hostLimits.get(host);
        if (until) {
          nextCooldowns[source.id] = until;
          throw Object.assign(Error('SOURCE_COOLDOWN'), { code: 'SOURCE_COOLDOWN' });
        }
        if (++calls > MAX_SOURCE_REQUESTS) throw Object.assign(Error('SOURCE_BUDGET'), { code: 'SOURCE_BUDGET' });
        requests++;
        const signal = options.signal ? AbortSignal.any([maxDeadline, options.signal]) : maxDeadline;
        const response = await fetcher(url, { ...options, signal });
        const retryAt = sourceCooldown(response, now);
        if (retryAt) {
          hostLimits.set(host, retryAt);
          nextCooldowns[source.id] = retryAt;
        }
        return response;
      });
      if (!Array.isArray(discovered)) throw Object.assign(Error('SOURCE_PARSE_FAILURE'), { code: 'SOURCE_PARSE_FAILURE' });
      const candidates = discovered.slice(0, MAX_CANDIDATES);
      const events = candidates.map(item => normalize(item, source, now)).filter(Boolean);
      result.reviewRequired = candidates.length - events.length;
      return { result, events };
    } catch (error) {
      const reason = SOURCE_REASONS.has(error?.code) ? error.code : maxDeadline.aborted ? 'SOURCE_TIMEOUT' : 'SOURCE_UNAVAILABLE';
      return { result: { ...result, state: reason === 'SOURCE_COOLDOWN' ? 'COOLDOWN' : 'UNAVAILABLE', reasonCode: reason }, events: [] };
    }
  }
  // Sources sharing an upstream host run in order, so a 429 can suppress later requests in this scan.
  const outcomes = await Promise.all(SOURCES.map(source => {
    const host = new URL(source.url).hostname;
    const pending = (hostFlights.get(host) || Promise.resolve()).then(() => check(source));
    hostFlights.set(host, pending);
    return pending;
  }));
  const events = dedupe(outcomes.flatMap(item => item.events));
  return { schemaVersion: 2, checkedAt, sources: outcomes.map(item => item.result), cooldowns: nextCooldowns, requests,
    events };
}

function validSnapshot(snapshot) {
  if (snapshot?.schemaVersion !== 2 || !exactTime(snapshot.checkedAt) || !Array.isArray(snapshot.sources) ||
      snapshot.sources.length !== SOURCES.length || !Array.isArray(snapshot.events) || snapshot.events.length > MAX_EVENTS ||
      !Number.isSafeInteger(snapshot.requests) || snapshot.requests < 0 || snapshot.requests > MAX_SOURCE_REQUESTS * SOURCES.length ||
      !snapshot.cooldowns || typeof snapshot.cooldowns !== 'object' || Array.isArray(snapshot.cooldowns)) return false;
  const ids = new Set();
  for (const source of snapshot.sources) {
    if (!SOURCE_BY_ID.has(source?.id) || ids.has(source.id) || !SOURCE_STATES.has(source.state) ||
        !Number.isSafeInteger(source.reviewRequired) || source.reviewRequired < 0 || source.reviewRequired > MAX_CANDIDATES ||
        (source.state === 'CHECKED' ? source.reasonCode !== null : !SOURCE_REASONS.has(source.reasonCode))) return false;
    ids.add(source.id);
  }
  if (Object.entries(snapshot.cooldowns).some(([id, until]) => !ids.has(id) || !Number.isSafeInteger(until) ||
      until <= Date.parse(snapshot.checkedAt) || until > Date.parse(snapshot.checkedAt) + DAY)) return false;
  return snapshot.events.every(event => {
    const source = SOURCE_BY_ID.get(event?.sourceId), grade = Object.hasOwn(GRADE, event?.evidenceGrade) && GRADE[event.evidenceGrade];
    if (!source || snapshot.sources.find(item => item.id === source.id)?.state !== 'CHECKED' || !grade || event.category !== grade[0] ||
        !source.categories.includes(event.category) || event.project !== source.project || event.publisher !== source.publisher ||
        !event.title || !event.summary || cleanText(event.title, 150) !== event.title || cleanText(event.summary, 270) !== event.summary ||
        !event.url || canonicalSourceUrl(event.url, source) !== event.url || !exactTime(event.publishedAt) || event.publishedAt > snapshot.checkedAt ||
        !Array.isArray(event.chains) || event.chains.length !== 1 ||
        !event.chains.every(chain => source.chains.includes(chain)) || !Array.isArray(event.corroboratingSources) || event.corroboratingSources.length > 3 ||
        !event.corroboratingSources.every(id => SOURCE_BY_ID.has(id) && id !== source.id) ||
        event.eventRef !== null && reference(event.eventRef) !== event.eventRef) return false;
    if (event.category === 'UPCOMING') {
      return TARGET_STATUS.includes(event.targetStatus) && event.incidentStatus === null &&
        (event.targetAt === null || (exactTime(event.targetAt) || dateOnly(event.targetAt)) && targetEnd(event.targetAt) > Date.parse(snapshot.checkedAt));
    }
    return event.targetAt === null && event.targetStatus === null &&
      (event.category === 'RISK_ALERT' ? event.eventRef !== null && (INCIDENT_STATUS.has(event.incidentStatus) || event.incidentStatus === 'PUBLISHED') : event.incidentStatus === null);
  });
}

function coverageFor(snapshot, chain, category = null) {
  const scope = (snapshot?.sources || []).filter(item => {
    const source = SOURCE_BY_ID.get(item?.id);
    return source?.chains.includes(chain) && (!category || source.categories.includes(category));
  });
  return { attempted: scope.length, checked: scope.filter(item => item.state === 'CHECKED').length,
    unavailable: scope.filter(item => item.state === 'UNAVAILABLE').length, cooledDown: scope.filter(item => item.state === 'COOLDOWN').length,
    reviewRequired: scope.reduce((sum, item) => sum + item.reviewRequired, 0) };
}

function slot(category, state, reasonCode, event = null) { return { category, state, reasonCode, event }; }

function emptyView(chain, { lastSuccessfulAt = null, checkedAt = null, reasonCode = 'SOURCE_COVERAGE_UNAVAILABLE', freshness = 'UNAVAILABLE', mode = 'UNAVAILABLE' } = {}) {
  if (!Object.hasOwn(NETWORKS, chain)) throw new TypeError('Unsupported Pulse news network');
  return { ok: true, projectSchemaVersion: 2, chain, chainId: NETWORKS[chain], freshness, checkedAt, lastSuccessfulAt,
    expiresAt: null, delivery: mode, sourceCoverage: coverageFor(null, chain),
    projectCards: SLOTS.map(category => slot(category, freshness === 'STALE' ? 'STALE' : 'SOURCE_UNAVAILABLE', reasonCode)) };
}

function eventExpiry(event) {
  return Math.min(Date.parse(event.publishedAt) + (event.category === 'RISK_ALERT' ? 14 : 28) * DAY,
    event.targetAt ? targetEnd(event.targetAt) : Infinity);
}

function chooseEvents(events) {
  const candidates = SLOTS.map(slotName => events.filter(event => event.category === slotName).sort(rank).slice(0, 6));
  let best = null, distinct = -1;
  for (const a of candidates[0].length ? candidates[0] : [null]) {
    for (const b of candidates[1].length ? candidates[1] : [null]) {
      for (const c of candidates[2].length ? candidates[2] : [null]) {
        const selected = [a,b,c], items = selected.filter(Boolean);
        if (items.some((item, index) => items.slice(index + 1).some(other => item.url === other.url))) continue;
        const count = new Set(items.map(event => event.project.toLowerCase())).size;
        if (count > distinct) { distinct = count; best = selected; }
      }
    }
  }
  // If one article is the only candidate for multiple modes, choose its first slot once.
  const used = new Set();
  return best || candidates.map(items => {
    const chosen = items.find(item => !used.has(item.url));
    if (chosen) used.add(chosen.url);
    return chosen || null;
  });
}

function newsView(snapshot, chain, { now = Date.now(), lastSuccessfulAt = null, mode = 'DURABLE' } = {}) {
  const base = emptyView(chain, { mode, lastSuccessfulAt });
  if (!validSnapshot(snapshot) || Date.parse(snapshot.checkedAt) > now) return base;
  const checkedAt = snapshot.checkedAt;
  const sourceCoverage = coverageFor(snapshot, chain);
  if (now >= Date.parse(checkedAt) + FRESH_MS) return { ...emptyView(chain, { mode, checkedAt,
    lastSuccessfulAt: lastSuccessfulAt || (sourceCoverage.checked ? checkedAt : null),
    freshness: 'STALE', reasonCode: 'SNAPSHOT_EXPIRED' }), sourceCoverage };
  if (!sourceCoverage.checked) return { ...base, checkedAt, sourceCoverage };
  const pool = snapshot.events.filter(event => event.chains.includes(chain) && eventExpiry(event) > now);
  const selected = chooseEvents(pool);
  const projectCards = SLOTS.map((category, index) => {
    const event = selected[index];
    if (!event) {
      const coverage = coverageFor(snapshot, chain, category);
      if (!coverage.checked) return slot(category, 'SOURCE_UNAVAILABLE', 'SOURCE_COVERAGE_UNAVAILABLE');
      return slot(category, 'NO_VERIFIED_SIGNAL', coverage.unavailable + coverage.cooledDown ? 'PARTIAL_SOURCE_COVERAGE' :
        coverage.reviewRequired ? 'SOURCE_REVIEW_REQUIRED' : 'NO_ELIGIBLE_EVENT');
    }
    const { title, summary, url, publisher, project, publishedAt, targetAt, targetStatus, evidenceGrade, incidentStatus, eventRef } = event;
    const id = createHash('sha256').update(url).digest('hex').slice(0, 20);
    return slot(category, 'VERIFIED', 'ATTRIBUTED_PUBLICATION', { id, title, summary, url, publisher, project,
      publishedAt, targetAt, targetStatus, incidentStatus, reference: eventRef, evidenceGrade, limitation: GRADE[evidenceGrade][1],
      corroboratingPublishers: event.corroboratingSources.map(sourceId => SOURCE_BY_ID.get(sourceId).publisher) });
  });
  const freshness = sourceCoverage.unavailable + sourceCoverage.cooledDown ? 'PARTIAL' : 'FRESH';
  const expiresAt = iso(Math.min(Date.parse(checkedAt) + FRESH_MS, ...selected.filter(Boolean).map(eventExpiry)));
  return { ...base, freshness, checkedAt, expiresAt, lastSuccessfulAt: lastSuccessfulAt || checkedAt, sourceCoverage, projectCards };
}

module.exports = { NETWORKS, SLOTS, FRESH_MS, scanNews, validSnapshot, newsView, emptyView, coverageFor };
