import { VERIFIED_EVENTS, COVERAGE_REVIEWS } from "../lib/unlock-evidence.js";

async function fetchWithTimeout(url,options={}){return fetch(url,{...options,signal:AbortSignal.timeout(15000)});}

// ARCY Token Unlocks API — zero-key live feed
// Source page: CoinBell token unlock calendar (unlock schedules attributed there to DefiLlama).
// No API key required. Server-side only. 6-hour cache.

const SOURCE_URL = "https://api.coinbell.in/token-unlocks?sort=soonest&window=30";
const SOURCE_URLS = ["soonest","impact","value"].map(sort=>`https://api.coinbell.in/token-unlocks?sort=${sort}&window=30`);

function stripTags(s = "") {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function isoDate(text) {
  const m = text.match(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\b/i);
  if (!m) return null;
  const months = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
  const d = new Date(Date.UTC(+m[3], months[m[2].toLowerCase()], +m[1]));
  if(d.getUTCDate()!==+m[1])return null;
  return d.toISOString().slice(0,10);
}

function utcToday() {
  return new Date().toISOString().slice(0,10);
}

function dayDiff(dateISO, todayISO) {
  return Math.round((Date.parse(dateISO+"T00:00:00Z") - Date.parse(todayISO+"T00:00:00Z")) / 86400000);
}

function parseRows(html, sourceUrl = SOURCE_URL) {
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  const out = [];

  for (const row of rows) {
    const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(x => stripTags(x[1]));

    // Expected: # | Token | Unlock date | Amount | Value | % circulating | Allocation
    if (cells.length < 6 || !/^\d+$/.test(cells[0])) continue;

    const date = isoDate(cells[2]);
    if (!date) continue;

    const amount = cells[3] || "";
    const pct = cells[5] || "";
    const allocation = cells[6] || "";
    const symbolMatch = amount.match(/\s([A-Z0-9][A-Z0-9._-]{0,14})\s*$/);
    const symbol = symbolMatch ? symbolMatch[1] : "";
    if(!symbol || !/^\d+(?:[.,]\d+)*(?:[KMB])?\s+[A-Z0-9._-]+$/.test(amount))continue;
    let name = cells[1] || symbol || "Unknown";
    if (symbol && name.toUpperCase().endsWith(symbol.toUpperCase())) {
      name = name.slice(0, -symbol.length).trim() || symbol;
    }

    out.push({
      name,
      symbol,
      date,
      amount,
      percent: pct,
      value: cells[4] || "",
      allocation,
      source: "CoinBell / DefiLlama",
      sourceUrl,
      verification: "source-published",
      evidence: [{url:sourceUrl,kind:"published-calendar",checkedAt:new Date().toISOString()}]
    });
  }
  return out;
}


async function fetchCmcLogos(events) {
  const symbols = [...new Set(events.map(x => x.symbol).filter(Boolean))];
  if (!symbols.length) return {};
  const qs = new URLSearchParams({symbol:symbols.join(","), aux:"logo", skip_invalid:"true"});
  const key = process.env.CMC_API_KEY;
  const base = key ? "https://pro-api.coinmarketcap.com" : "https://pro-api.coinmarketcap.com/public-api";
  const headers = {"accept":"application/json"};
  if (key) headers["X-CMC_PRO_API_KEY"] = key;
  const r = await fetchWithTimeout(`${base}/v2/cryptocurrency/info?${qs}`, {headers});
  if (!r.ok) return {};
  const j = await r.json(), result = {};
  for (const symbol of symbols) {
    const raw = j?.data?.[symbol];
    const candidates = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    const names = events.filter(x=>x.symbol===symbol).map(x=>String(x.name||"").toLowerCase());
    const chosen = candidates.find(c=>names.includes(String(c.name||"").toLowerCase())) || (candidates.length===1 ? candidates[0] : null);
    if (chosen?.logo) result[symbol] = chosen.logo;
  }
  return result;
}

function mergeEvents(rows) {
  const groups=new Map(), conflicts=[];
  for(const row of rows){
    // A ticker alone is not a project identity; allocations remain separate.
    const review=COVERAGE_REVIEWS.find(r=>r.symbols.includes(row.symbol));
    if(review && row.verification!=="project-confirmed")continue;
    const key=JSON.stringify([row.name.toLowerCase().trim(),row.symbol,row.tokenVersion||"calendar-unspecified",row.date,row.allocation.toLowerCase().trim()]);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(row);
  }
  const events=[];
  for(const [key,group] of groups){
    const amounts=new Set(group.map(r=>r.amount.replace(/,/g,"").replace(/\s+/g," ").trim()));
    if(amounts.size!==1){conflicts.push({identity:JSON.parse(key),reason:"Conflicting published amounts",sources:[...new Set(group.map(r=>r.sourceUrl))]});continue;}
    const event={...group[0],evidence:group.flatMap(r=>r.evidence||[])};
    // Market-based percentages can change between requests; never pick one arbitrarily.
    if(new Set(group.map(r=>r.percent)).size>1)event.percent="";
    events.push(event);
  }
  return {events,conflicts};
}

async function collectVerifiedEvents(records) {
  const events=[],rejected=[];
  await Promise.all(records.map(async record=>{
    try{
      const url=new URL(record.sourceUrl);
      if(url.protocol!=="https:" || !record.allowedHost || url.hostname!==record.allowedHost)throw Error("Invalid official source");
      const validDate=/^\d{4}-\d{2}-\d{2}$/.test(record.date) && new Date(record.date+"T00:00:00Z").toISOString().slice(0,10)===record.date;
      if(!validDate || !record.projectId || !record.tokenVersion || !record.allocation || !record.name || !/^[A-Z0-9._-]+$/.test(record.symbol))throw Error("Incomplete event identity");
      if(!/^\d+(?:\.\d+)?$/.test(record.amountTokens) || !/[1-9]/.test(record.amountTokens))throw Error("Missing exact amount");
      // The reviewed quotation must explicitly contain the published date and amount.
      if(/\b(?:estimated|approximately|proposed|forecast|assume)\b/i.test(record.evidenceText||""))throw Error("Speculative evidence");
      if(!record.evidenceText || !record.evidenceText.includes(record.publishedDateText) || !record.evidenceText.includes(record.publishedAmountText) || !record.publishedDateText || !record.publishedAmountText)throw Error("Incomplete evidence");
      if(Date.parse(record.publishedDateText+" UTC")!==Date.parse(record.date+"T00:00:00Z"))throw Error("Evidence date mismatch");
      if(record.publishedAmountText.replace(/,/g,"").trim()!==record.amountTokens)throw Error("Evidence amount mismatch");
      const reviewed=Date.parse(record.reviewedAt),expires=Date.parse(record.reviewExpiresAt);
      if(!Number.isFinite(reviewed)||!Number.isFinite(expires)||reviewed>Date.now()||expires<=Date.now()||expires-reviewed>30*86400000)throw Error("Expired evidence review");
      const r=await fetchWithTimeout(record.sourceUrl);
      if(!r.ok || (r.url && new URL(r.url).hostname!==record.allowedHost))throw Error("Evidence unavailable");
      const text=stripTags(await r.text());
      if(!text.includes(stripTags(record.evidenceText)))throw Error("Evidence changed");
      events.push({name:record.name,symbol:record.symbol,projectId:record.projectId,tokenVersion:record.tokenVersion,date:record.date,amount:record.amountTokens+" "+record.symbol,percent:"",value:"",allocation:record.allocation,source:record.name+" official schedule",sourceUrl:record.sourceUrl,verification:"project-confirmed",evidence:[{url:record.sourceUrl,kind:"explicit-event",checkedAt:new Date().toISOString(),reviewedAt:record.reviewedAt}]});
    }catch(_){rejected.push({projectId:record.projectId||"unknown",status:"evidence-unavailable-or-invalid"});}
  }));
  return {events,rejected};
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  const secondsToMidnight=Math.max(1,Math.floor((Date.parse(utcToday()+"T00:00:00Z")+86400000-Date.now())/1000));
  res.setHeader("Cache-Control", `public, s-maxage=${Math.min(21600,secondsToMidnight)}, must-revalidate`);

  try {
    const collected = await Promise.all(SOURCE_URLS.map(async url=>{
      try{
        const r=await fetchWithTimeout(url,{headers:{accept:"text/html,application/xhtml+xml","user-agent":"ARCY-Research/1.0 (+https://arcyusdc.xyz)"}});
        if(!r.ok)throw new Error("Source HTTP "+r.status);
        const rows=parseRows(await r.text(),url);
        if(!rows.length)throw new Error("No valid rows");
        return {url,status:"available",rows};
      }catch(_){return {url,status:"unavailable",rows:[]};}
    }));
    const supplemental = await collectVerifiedEvents(VERIFIED_EVENTS);
    if(!collected.some(s=>s.status==="available") && !supplemental.events.length)throw new Error("All sources unavailable");
    const today=utcToday();
    const merged=mergeEvents([...collected.flatMap(s=>s.rows),...supplemental.events]);
    const next30=merged.events
      .map(x=>({...x,daysFromToday:dayDiff(x.date,today)}))
      .filter(x=>x.daysFromToday>=0 && x.daysFromToday<=30)
      .sort((a,b)=>a.date.localeCompare(b.date)||a.name.localeCompare(b.name)||a.allocation.localeCompare(b.allocation));
    const partial=collected.some(s=>s.status!=="available") || supplemental.rejected.length>0 || merged.conflicts.length>0;
    if(partial)res.setHeader("Cache-Control","no-store");

    let logos = {};
    try { logos = await fetchCmcLogos(next30); } catch (_) {}
    const enriched = next30.map(x => ({...x, logo: logos[x.symbol] || ""}));

    const payload = {
      ok: true,
      live: true,
      source: "CoinBell published calendar (DefiLlama attribution); project-confirmed supplements when available",
      partial,
      coverage: {complete:false, sources:collected.map(({url,status,rows})=>({url,status,rowCount:rows.length})), reviews:COVERAGE_REVIEWS, conflicts:merged.conflicts, rejectedSupplements:supplemental.rejected},
      sourceUrl: SOURCE_URL,
      updatedAt: new Date().toISOString(),
      windowTimeZone: "UTC",
      refreshAt: new Date(Date.parse(utcToday()+"T00:00:00Z")+86400000).toISOString(),
      windows: {
        today: enriched.filter(x => x.daysFromToday === 0),
        next7: enriched.filter(x => x.daysFromToday >= 1 && x.daysFromToday <= 7),
        days8to30: enriched.filter(x => x.daysFromToday >= 8 && x.daysFromToday <= 30)
      },
      events: enriched
    };

    return res.status(200).json(payload);
  } catch (e) {
    res.setHeader("Cache-Control","no-store");
    return res.status(503).json({
      ok: false,
      live: false,
      updatedAt: new Date().toISOString(),
      message: "Live unlock feed temporarily unavailable. ARCY will not display guessed or stale unlock data.",
      events: [],
      windows: { today: [], next7: [], days8to30: [] }
    });
  }
}
