'use strict';

const arc = require('./pulse-edition');
const network = require('./pulse-networks');

const MAX_CANDIDATES = 8;
const MAX_PAGES = 5;
const REQUEST_TIMEOUT_MS = 4500;
const ACHIEVED = 'ACHIEVED';
const UPCOMING = 'UPCOMING';
const RISK = 'RISK_ALERT';
const ALL_CHAINS = ['arc', 'ethereum', 'robinhood'];
const AAVE_AUTHORS = new Map([[5301, 'AaveLabs'], [5071, 'bgdlabs']]);
const MAINNET_ARC_COMPONENT_GROUP = '32lclmtz775v';
const INCIDENT_STATUSES = new Set(['INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'RESOLVED']);
const EVENT_ID = /^[a-z0-9][a-z0-9-]{2,80}$/i;
const SLUG = '[a-z0-9][a-z0-9-]{1,179}';
const arcBlog = arc.SOURCES.find(source => source.type === 'arc-blog');
const ethFeed = network.CONFIG.ethereum.sources.find(source => source.type === 'rss');
const gethFeed = network.CONFIG.ethereum.sources.find(source => source.type === 'releases');
const hoodFeed = network.CONFIG.robinhood.sources.find(source => source.type === 'newsroom');
const uniCommits = network.LIVE_PROJECT_SOURCES.ethereum.find(source => source.repo === 'Uniswap/v4-core');

function described(id, project, publisher, url, chains, categories, read, path, nativeChain = null) {
  return Object.freeze({ id, project, publisher, url, chains: Object.freeze([...chains]),
    categories: Object.freeze([...categories]), hosts: Object.freeze(Object.keys(path)),
    path: Object.freeze(path), nativeChain, read });
}

const SOURCES = Object.freeze([
  described('arc-blog', 'Arc', 'Arc', arcBlog.url, ['arc'], [ACHIEVED, UPCOMING], readBlog,
    { 'www.arc.io': new RegExp(`^/blog/${SLUG}/?$`) }),
  described('arc-incidents', 'Arc', 'Arc Status', 'https://status.arc.io/api/v2/incidents.json', ['arc'], [RISK],
    readArcIncidents, { 'status.arc.io': /^\/incidents\/[a-z0-9]{8,20}$/ }, 'arc'),
  described('arc-maintenance', 'Arc', 'Arc Status', 'https://status.arc.io/api/v2/scheduled-maintenances/upcoming.json',
    ['arc'], [UPCOMING], readArcMaintenance, { 'status.arc.io': /^\/incidents\/[a-z0-9]{8,20}$/ }, 'arc'),
  described('ethereum-foundation', 'Ethereum', 'Ethereum Foundation', ethFeed.url, ['ethereum'], [ACHIEVED, UPCOMING],
    readEthereum, { 'blog.ethereum.org': new RegExp(`^/en/20\\d\\d/\\d\\d/\\d\\d/${SLUG}/?$`) }),
  described('geth-releases', 'Go Ethereum', 'Go Ethereum maintainers', gethFeed.url, ['ethereum'], [ACHIEVED],
    readGeth, { 'github.com': /^\/ethereum\/go-ethereum\/releases\/tag\/v[0-9.]+$/ }, 'ethereum'),
  described('geth-advisories', 'Go Ethereum', 'Go Ethereum maintainers',
    'https://api.github.com/repos/ethereum/go-ethereum/security-advisories?per_page=8', ['ethereum'], [RISK],
    readGethAdvisories, { 'github.com': /^\/ethereum\/go-ethereum\/security\/advisories\/GHSA(?:-[a-z0-9]{4}){3}$/ }, 'ethereum'),
  described('robinhood-newsroom', 'Robinhood Chain', 'Robinhood Newsroom', hoodFeed.url, ['robinhood'], [ACHIEVED, UPCOMING],
    readRobinhood, { 'robinhood.com': new RegExp(`^/(?:us/en/)?newsroom/${SLUG}/?$`) }),
  described('robinhood-incidents', 'Robinhood Chain', 'Robinhood Chain Status',
    'https://status.robinhoodchain.offchain.io/history.rss', ['robinhood'], [RISK], readRobinhoodIncidents,
    { 'status.robinhoodchain.offchain.io': /^\/incident\/[a-z0-9-]{3,80}\/?$/ }, 'robinhood'),
  described('aave-governance', 'Aave', 'Aave Labs and BGD Labs', 'https://governance.aave.com/latest.json',
    ['arc', 'ethereum'], [ACHIEVED, UPCOMING], readAave,
    { 'governance.aave.com': new RegExp(`^/t/${SLUG}/[1-9][0-9]{0,10}$`) }),
  described('morpho-blog', 'Morpho', 'Morpho', 'https://morpho.org/blog', ALL_CHAINS, [ACHIEVED, UPCOMING],
    readBlog, { 'morpho.org': new RegExp(`^/blog/${SLUG}/?$`) }),
  described('uniswap-blog', 'Uniswap', 'Uniswap Labs', 'https://blog.uniswap.org/', ALL_CHAINS, [ACHIEVED, UPCOMING],
    readBlog, { 'blog.uniswap.org': new RegExp(`^/${SLUG}/?$`) }),
  described('uniswap-development', 'Uniswap', 'Uniswap v4 maintainers', uniCommits.url, ALL_CHAINS, [ACHIEVED],
    readUniswapCommits, { 'github.com': /^\/Uniswap\/v4-core\/commit\/[0-9a-f]{40}$/ }),
]);

function reject(code = 'SOURCE_PARSE_FAILURE') {
  throw Object.assign(Error(code), { code });
}

function canonicalSourceUrl(value, source) {
  if (!SOURCES.includes(source) || typeof value !== 'string' || value.length > 360) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !Object.hasOwn(source.path, url.hostname) || !source.path[url.hostname].test(url.pathname)) return null;
    return url.origin + url.pathname;
  } catch {
    return null;
  }
}

function stamp(value) {
  // Permit ISO date/timestamp or an RFC-822 feed date with a zone. Refuse relative or ambiguous dates.
  if (typeof value !== 'string' || !/^(?:20\d\d-\d\d-\d\d(?:T\d\d:\d\d(?::\d\d(?:\.\d{1,9})?)?(?:Z|[+-]\d\d:\d\d))?|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{1,2} [A-Z][a-z]{2} 20\d\d \d\d:\d\d:\d\d (?:GMT|[+-]\d{4}))$/.test(value)) return null;
  const ms = network.publicationTime(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function readable(value, max) {
  if (typeof value !== 'string') return '';
  const text = network.clean(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max).replace(/\s+\S*$/, '').trim() + '…' : text;
}

const CHAIN_LIST = '(?:(?:base|ethereum(?: mainnet)?|arc(?: mainnet)?|robinhood chain|arbitrum|optimism|polygon|avalanche|bsc|unichain)(?:,\\s*(?:and\\s+)?|\\s+and\\s+)){0,6}';
const chainMarkers = {
  arc: new RegExp(`\\b(?:arc (?:mainnet|network|chain|ecosystem)|(?:on|for|to|across|including) ${CHAIN_LIST}arc\\b)(?!\\s*(?:testnet|#|proposal|[0-9]))`, 'i'),
  ethereum: new RegExp(`\\b(?:ethereum mainnet|ethereum l1|(?:on|to|for|across|including) ${CHAIN_LIST}ethereum\\b)(?!\\s*(?:testnet|layer|l2|compatib|sepolia|hoodi|holesky))`, 'i'),
  robinhood: /\brobinhood chain\b(?!\s*testnet)/i,
};

function claimChains(text) {
  if (/\btestnet[- ]only\b/i.test(text)) return [];
  return ALL_CHAINS.filter(chain => chainMarkers[chain].test(text) &&
    (chain !== 'robinhood' || !/\brobinhood chain\b[^.!?]{0,28}\btestnet\b/i.test(text) || /\bmainnet\b/i.test(text)));
}

function attest(source, raw) {
  const title = readable(raw.title, 175);
  const summary = readable(raw.summary, 420);
  const url = canonicalSourceUrl(raw.url, source);
  const publishedAt = stamp(raw.publishedAt);
  const chains = (raw.chains ?? (source.nativeChain ? [source.nativeChain] : claimChains(`${title}. ${summary}`)))
    .filter(chain => source.chains.includes(chain));
  if (!title || !summary || !url || !publishedAt || !chains.length) return null;
  return { title, summary, url, publishedAt, kind: raw.kind ?? 'ARTICLE', chains,
    ...(raw.targetAt ? { targetAt: raw.targetAt } : {}), ...(raw.status ? { status: raw.status } : {}),
    ...(raw.eventRef ? { eventRef: raw.eventRef } : {}) };
}

function request(url, fetcher, redirectHosts = null) {
  return network.request(url, fetcher, { timeoutMs: REQUEST_TIMEOUT_MS, redirectHosts });
}

async function json(url, fetcher) {
  const text = await request(url, fetcher);
  try { return JSON.parse(text); } catch { return reject(); }
}

function rows(value) {
  if (!Array.isArray(value)) return reject();
  return value.slice(0, MAX_CANDIDATES);
}

async function readEthereum(source, fetcher) {
  const feed = await request(source.url, fetcher);
  const articles = network.rss(feed, ethFeed);
  const items = rssBlocks(feed);
  return articles.map((item, index) => {
    const text = readable(rssDescription(items[index]), 1600);
    const chainProtocol = /\b(?:eip-[0-9]+|glamsterdam|amsterdam|hegota|ethereum (?:mainnet|protocol|network))\b/i.test(item.title);
    const testnetTitle = /\b(?:sepolia|hoodi|holesky|testnet)\b/i.test(item.title) && !/\bmainnet\b/i.test(item.title);
    const clause = text.split(/(?<=[.!?])\s+(?=[A-Z])/).find(part => /\b(?:scheduled|proposed|decided to delay|activation|activated|has shipped)\b/i.test(part));
    return { ...item, summary: chainProtocol && clause ? clause : readable(rssDescription(items[index]), 420),
      chains: testnetTitle ? [] : chainProtocol ? ['ethereum'] : claimChains(`${item.title}. ${text}`) };
  });
}

async function readRobinhood(source, fetcher) {
  return network.newsroom(await request(source.url, fetcher, hoodFeed.redirectHosts), hoodFeed);
}

async function readGeth(source, fetcher) {
  const stable = rows(await json(source.url, fetcher)).filter(item => item?.draft === false && item.prerelease === false &&
    typeof item.tag_name === 'string' && /^v\d+\.\d+\.\d+$/.test(item.tag_name) &&
    !/\b(?:hoodi|holesky|sepolia|testnet)\b/i.test(network.clean(item.body).slice(0, 260)));
  return network.releases(stable, gethFeed).map((item, i) => ({ ...item, kind: 'RELEASE', status: 'PUBLISHED',
    summary: item.summary || `The Go Ethereum maintainers published client release ${stable[i].tag_name}.`,
    eventRef: `geth:${stable[i].tag_name}` }));
}

async function readGethAdvisories(source, fetcher) {
  return rows(await json(source.url, fetcher)).filter(item => item?.state === 'published' && item.withdrawn_at === null &&
    /^GHSA(?:-[a-z0-9]{4}){3}$/.test(item.ghsa_id) && item.html_url?.endsWith(`/${item.ghsa_id}`)).map(item => ({
    title: item.summary, summary: item.description, url: item.html_url, publishedAt: item.published_at,
    kind: 'ADVISORY', eventRef: item.ghsa_id, status: 'PUBLISHED'
  }));
}

async function readUniswapCommits(source, fetcher) {
  const data = await json(source.url, fetcher);
  if (!Array.isArray(data)) return reject();
  return network.commits(data, uniCommits).map(item => ({ ...item, chains: claimChains(item.title), kind: 'COMMIT',
    eventRef: item.url?.split('/').at(-1), status: 'PUBLISHED' }));
}

function arcStatusRows(data, field) {
  if (data?.page?.id !== 'p89dljhsd44w' || data.page.url !== 'https://status.arc.io') return reject();
  return rows(data[field]).filter(item => item?.page_id === data.page.id && EVENT_ID.test(item.id ?? '') &&
    item.components?.some(component => component?.id === MAINNET_ARC_COMPONENT_GROUP || component?.group_id === MAINNET_ARC_COMPONENT_GROUP));
}

function arcStatusFields(item) {
  const body = item.incident_updates?.find(update => update?.status === item.status && update.body)?.body;
  const components = item.components.filter(component => component?.id === MAINNET_ARC_COMPONENT_GROUP ||
    component?.group_id === MAINNET_ARC_COMPONENT_GROUP).map(component => readable(component.name, 50)).filter(Boolean);
  return { title: item.name, summary: body && `${body} Affected Arc mainnet components: ${components.join(', ')}.`,
    url: `https://status.arc.io/incidents/${item.id}`, publishedAt: item.created_at, eventRef: `arc:${item.id}` };
}

async function readArcIncidents(source, fetcher) {
  return arcStatusRows(await json(source.url, fetcher), 'incidents').filter(item =>
    INCIDENT_STATUSES.has(item.status?.toUpperCase()) && ['minor', 'major', 'critical'].includes(item.impact) &&
    !/\b(?:drill|test notification|simulation|maintenance)\b/i.test(item.name)).map(item => ({
    ...arcStatusFields(item), kind: 'INCIDENT', status: item.status.toUpperCase()
  }));
}

async function readArcMaintenance(source, fetcher) {
  return arcStatusRows(await json(source.url, fetcher), 'scheduled_maintenances').filter(item =>
    item.status === 'scheduled' && stamp(item.scheduled_for)).map(item => ({
    ...arcStatusFields(item), kind: 'PROPOSAL', status: 'SCHEDULED', targetAt: stamp(item.scheduled_for)
  }));
}

function rssBlocks(feed) {
  return [...feed.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 30).map(match => match[1]);
}

function rssDescription(item) {
  return item?.match(/<description>([\s\S]*?)<\/description>/i)?.[1] ?? '';
}

async function readRobinhoodIncidents(source, fetcher) {
  const feed = await request(source.url, fetcher);
  if (!/<title>\s*Robinhood Chain Status - Incident history\s*<\/title>/i.test(feed)) return reject();
  const items = network.rss(feed, { owner: source.publisher });
  const fields = rssBlocks(feed);
  return items.flatMap((item, index) => {
    const desc = rssDescription(fields[index]);
    const components = desc.match(/Affected Components:\s*([^\r\n]+)/i)?.[1];
    const status = desc.match(/GMT[+-]\d+\s*-\s*(Resolved|Monitoring|Identified|Investigating)\s*-/i)?.[1]?.toUpperCase();
    const detail = desc.match(/GMT[+-]\d+\s*-\s*(?:Resolved|Monitoring|Identified|Investigating)\s*-\s*([^\r\n]+?)(?:\s+[A-Z][a-z]{2} \d{1,2},|[\r\n]|$)/i)?.[1];
    if (!/^\s*(?:<!\[CDATA\[\s*)?Type:\s*Incident\b/i.test(desc) || !components || !/\brobinhood chain(?: mainnet)?\b/i.test(components) ||
        /\b(?:testnet|maintenance|drill|simulation|test notification)\b/i.test(components + ' ' + item.title) || !status || !detail) return [];
    return [{ ...item, kind: 'INCIDENT', status, eventRef: `robinhood:${item.url.split('/').filter(Boolean).at(-1)}`,
      summary: `${detail.trim()} Affected components: ${components.trim()}.` }];
  });
}

function arcMastheadDate(html) {
  const raw = html.match(/<[^>]*\bclass=["'][^"']*\bblog_date-time\b[^"']*["'][^>]*>([\s\S]*?)<\//i)?.[1];
  const date = readable(raw, 50).match(/^(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (20\d{2})$/);
  if (!date) return null;
  const parsed = new Date(`${date[1]} ${date[2]}, ${date[3]} UTC`);
  return parsed.getUTCDate() === Number(date[2]) ? parsed.toISOString() : null;
}

function articleMeta(html, url, source) {
  // The Arc CMS migration repopulated JSON-LD datePublished on older posts. Use the displayed dateline.
  const original = source.id === 'arc-blog' ? arcMastheadDate(html) : null;
  if (source.id === 'arc-blog' && !original) return null;
  for (const [, body] of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(body); } catch { continue; }
    const nodes = Array.isArray(data) ? data : data?.['@graph'] ?? [data];
    if (!Array.isArray(nodes)) continue;
    const post = nodes.find(node => [node?.['@type']].flat().some(type => ['Article', 'BlogPosting', 'NewsArticle'].includes(type)) &&
      typeof node.headline === 'string' && stamp(node.datePublished));
    if (post) return { title: post.headline, publishedAt: original ?? post.datePublished, url };
  }
  const meta = arc.articleFromMeta(html, url);
  return meta && { ...meta, publishedAt: original ?? meta.publishedAt };
}

function articleClaims(html, meta, source) {
  const body = html.replace(/<(script|style|nav|aside|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  const primary = body.match(/<article\b[^>]*>[\s\S]*?<\/article>/i)?.[0] ??
    body.match(/<main\b[^>]*>[\s\S]*?<\/main>/i)?.[0] ?? body;
  const main = primary.split(/<h[1-6]\b[^>]*>\s*(?:related (?:posts|articles|stories)|you (?:may|might) also like|more from the blog)\s*<\//i)[0];
  const blocks = [...main.matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)].slice(0, 160);
  const snippets = [arc.articleExcerpt(html), ...blocks.map(match => match[2])].filter(Boolean).flatMap(block =>
    readable(block, 900).split(/(?<=[.!?])\s+(?=[A-Z])/));
  // Tie the excerpt to the chain-bearing clause. A sidebar link or a bare name is not attribution.
  const byChain = new Map();
  for (const snippet of snippets) {
    if (snippet.length < 36 || !/\b(?:launch|deploy|releas|upgrade|add|enabl|integrat|propos|plan|schedul|live|activat|support|onboard|introduc|expand|test)\w*\b/i.test(snippet)) continue;
    if (/\b(?:all rights reserved|arc network services llc|permissioned validator set|terms of use|not investment advice|regulatory authority)\b/i.test(snippet)) continue;
    for (const chain of claimChains(snippet).filter(chain => source.chains.includes(chain))) {
      if (!byChain.has(chain)) byChain.set(chain, snippet);
    }
  }
  // On a chain-specific article headline, a development excerpt can inherit that exact scope.
  if (!byChain.size) for (const chain of claimChains(meta.title).filter(chain => source.chains.includes(chain))) {
    const description = arc.articleExcerpt(html);
    if (description && !/\b(?:testnet|permissioned validator set)\b/i.test(description)) byChain.set(chain, description);
  }
  return [...byChain].map(([chain, summary]) => ({ ...meta, summary, chains: [chain] }));
}

async function readBlog(source, fetcher) {
  const index = await request(source.url, fetcher);
  const urls = new Set();
  for (const [, href] of index.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
    let absolute;
    try { absolute = new URL(href, source.url).href; } catch { continue; }
    const url = canonicalSourceUrl(absolute, source);
    if (url && !/^\/(?:latest-updates|guides|faq|blog|about)\/?$/i.test(new URL(url).pathname)) urls.add(url);
    if (urls.size === MAX_PAGES) break;
  }
  if (!urls.size) return reject();
  const pages = [];
  for (const url of urls) {
    const html = await request(url, fetcher);
    const meta = articleMeta(html, url, source);
    if (meta) pages.push(...articleClaims(html, meta, source));
  }
  return pages;
}

async function readAave(source, fetcher) {
  const data = await json(source.url, fetcher);
  const topics = data?.topic_list?.topics;
  if (!Array.isArray(topics) || !Array.isArray(data.users)) return reject();
  const proposals = topics.filter(topic => Number.isSafeInteger(topic?.id) && topic.id > 0 &&
    new RegExp(`^${SLUG}$`).test(topic.slug ?? '') && topic.visible === true && topic.archetype === 'regular' &&
    topic.posters?.some(poster => poster?.description?.includes('Original Poster') && AAVE_AUTHORS.has(poster.user_id) &&
      data.users.some(user => user.id === poster.user_id && AAVE_AUTHORS.get(user.id) === user.username))).slice(0, MAX_PAGES);
  const pages = [];
  for (const topic of proposals) {
    const data = await json(`https://governance.aave.com/t/${topic.id}.json`, fetcher);
    const post = data?.post_stream?.posts?.find(item => item?.post_number === 1);
    if (data?.id !== topic.id || !post || AAVE_AUTHORS.get(post.user_id) !== post.username ||
        !AAVE_AUTHORS.has(post.user_id) || typeof post.cooked !== 'string') return reject();
    pages.push(...articleClaims(post.cooked, { title: data.title, publishedAt: post.created_at,
      url: `https://governance.aave.com/t/${topic.slug}/${topic.id}` }, source));
  }
  return pages;
}

async function discoverSource(source, fetcher = fetch) {
  if (!SOURCES.includes(source)) return reject('SOURCE_NOT_ALLOWED');
  const candidates = await source.read(source, fetcher);
  return candidates.map(item => attest(source, item)).filter(Boolean).slice(0, MAX_CANDIDATES);
}

module.exports = { SOURCES, MAX_CANDIDATES, MAX_PAGES, canonicalSourceUrl, discoverSource };
