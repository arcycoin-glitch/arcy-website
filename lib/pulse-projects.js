'use strict';

const { request } = require('./pulse-networks');
const { PROJECTS } = require('./pulse-project-catalog');
const NETWORKS = Object.freeze({ arc: 5042, ethereum: 1, robinhood: 4663 });
const HOUR = 3_600_000;
const WINDOW_MS = 28 * 24 * HOUR;
const SLOTS = 3;
const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function normalize(text) {
  return text.replace(/<!--[\s\S]*?-->|<(head|script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

function reviewedPublication(text, event) {
  if (event.discourseAuthor) {
    let thread;
    try { thread = JSON.parse(text); } catch { return false; }
    const post = thread?.post_stream?.posts?.[0];
    return thread?.title === event.title && post?.post_number === 1 && post.username === event.discourseAuthor &&
      typeof post.created_at === 'string' && post.created_at.slice(0, 10) === event.date &&
      typeof post.cooked === 'string' && normalize(post.cooked).includes(normalize(event.marker));
  }
  const content = normalize(text), title = normalize(event.title);
  if (!content.includes(normalize(event.marker))) return false;
  const date = new Date(event.date + 'T00:00:00Z');
  const day = date.getUTCDate(), year = date.getUTCFullYear();
  const months = [dateFormat, monthFormat].map(format => format.formatToParts(date).find(part => part.type === 'month').value);
  const labels = [event.date, dateFormat.format(date), monthFormat.format(date), ...months.flatMap(month =>
    [`${day} ${month} ${year}`, `${String(day).padStart(2, '0')} ${month} ${year}`, `${day} ${month}, ${year}`])];
  for (let anchor = content.indexOf(title); anchor >= 0; anchor = content.indexOf(title, anchor + title.length)) {
    const nearby = content.slice(Math.max(0, anchor - 500), anchor + title.length + 500);
    if (labels.some(label => nearby.includes(label.toLowerCase()))) return true;
  }
  return false;
}

function createProjectCollector({ fetcher = (...args) => fetch(...args), now = Date.now, catalog = PROJECTS } = {}) {
  // Both maps are keyed only by the finite checked-in catalog. No request can add a URL.
  const cache = new Map(), inflight = new Map(), cooldown = new Map();

  async function check(event) {
    const { url } = event;
    const host = new URL(url).hostname;
    const started = now();
    const hit = cache.get(url);
    if (hit?.until > started) return hit;
    if (inflight.has(url)) return inflight.get(url);
    if (cooldown.get(host) > started) return { state: 'SOURCE_UNAVAILABLE', reason: 'SOURCE_COOLDOWN' };
    const pending = (async () => {
      let retryUntil = 0;
      try {
        const body = await request(event.discourseAuthor ? url + '.json' : url, async (...args) => {
          const response = await fetcher(...args);
          const retry = response.headers?.get?.('retry-after');
          if (retry && retry.length <= 100) retryUntil = /^\d+$/.test(retry) ? now() + Number(retry) * 1000 : Date.parse(retry);
          return response;
        }, { timeoutMs: 3000 });
        const value = { state: 'CHECKED', text: body, until: now() + 6 * HOUR };
        cache.set(url, value);
        return value;
      } catch (error) {
        const rateLimited = error?.code === 'SOURCE_HTTP_429', blocked = error?.code === 'SOURCE_HTTP_403';
        const finished = now();
        const until = rateLimited || blocked ? Math.max(finished + HOUR, Math.min(retryUntil || 0, finished + 24 * HOUR)) : finished + HOUR / 4;
        const value = { state: 'SOURCE_UNAVAILABLE', reason: rateLimited ? 'RATE_LIMITED' : blocked ? 'SOURCE_BLOCKED' : 'SOURCE_UNREACHABLE', until };
        cache.set(url, value);
        if (rateLimited || blocked) cooldown.set(host, until);
        return value;
      }
    })().finally(() => inflight.delete(url));
    inflight.set(url, pending);
    return pending;
  }

  async function project(item, at) {
    let lastFailure = null;
    const developments = [...item.developments].filter(event => Date.parse(event.date) <= at)
      .sort((a, b) => b.date.localeCompare(a.date) || a.url.localeCompare(b.url));
    for (const event of developments.slice(0, 2)) {
      const result = await check(event);
      if (result.state !== 'CHECKED' || !reviewedPublication(result.text, event)) {
        lastFailure ??= result.state === 'CHECKED' ? { state: 'UNVERIFIED', reason: 'PUBLICATION_MISMATCH' } : result;
        continue;
      }
      const recent = at - Date.parse(event.date) < WINDOW_MS;
      return { contentType: recent ? 'DATED_DEVELOPMENT' : 'PROJECT_PROFILE', developmentStatus: recent ? 'RECENT' : 'HISTORICAL',
        projectId: item.id, name: item.name, purpose: item.purpose, identityUrl: item.identityUrl,
        change: event.change, implication: event.implication, limitation: item.limitation,
        source: { url: event.url, publisher: event.publisher, date: event.date, evidence: 'SOURCE_VERIFIED_PUBLICATION' } };
    }
    return { contentType: 'PROJECT_PROFILE', developmentStatus: lastFailure?.state || 'UNVERIFIED', reason: lastFailure?.reason || 'NO_DATED_SOURCE',
      projectId: item.id, name: item.name, purpose: item.purpose, identityUrl: item.identityUrl,
      change: lastFailure?.state === 'SOURCE_UNAVAILABLE' ? 'The primary publication could not be checked.' : 'No dated development could be verified.',
      implication: item.profileImplication, limitation: item.limitation,
      source: { url: item.identityUrl, publisher: 'Reviewed project reference', date: null, evidence: 'PROJECT_IDENTITY' } };
  }

  return async function collect(chain) {
    if (!Object.hasOwn(NETWORKS, chain)) throw new TypeError('Unsupported Pulse project network');
    const at = now();
    const identities = new Map();
    for (const item of catalog[chain] || []) {
      const prior = identities.get(item.id);
      identities.set(item.id, prior ? { ...prior, developments: [...prior.developments, ...item.developments] } : item);
    }
    const cards = await Promise.all([...identities.values()].slice(0, 6).map(item => project(item, at)));
    cards.sort((a, b) => Number(b.developmentStatus === 'RECENT') - Number(a.developmentStatus === 'RECENT') ||
      (b.source.date || '').localeCompare(a.source.date || '') || a.projectId.localeCompare(b.projectId));
    const projectCards = cards.slice(0, SLOTS);
    while (projectCards.length < SLOTS) projectCards.push({ contentType: 'COVERAGE_EMPTY', reason: 'INSUFFICIENT_REVIEWED_PROJECTS' });
    return { ok: true, projectSchemaVersion: 1, chain, chainId: NETWORKS[chain], projectCards };
  };
}

module.exports = { NETWORKS, createProjectCollector, collectProjects: createProjectCollector() };
