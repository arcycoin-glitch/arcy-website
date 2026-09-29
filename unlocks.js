// ARCY Token Unlocks API — zero-key live feed
// Source page: CoinBell token unlock calendar (unlock schedules attributed there to DefiLlama).
// No API key required. Server-side only. 6-hour cache.

const SOURCE_URL = "https://api.coinbell.in/token-unlocks?sort=soonest&window=30";

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
  return d.toISOString().slice(0,10);
}

function utcToday() {
  return new Date().toISOString().slice(0,10);
}

function dayDiff(dateISO, todayISO) {
  return Math.round((Date.parse(dateISO+"T00:00:00Z") - Date.parse(todayISO+"T00:00:00Z")) / 86400000);
}

function parseRows(html) {
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
      sourceUrl: SOURCE_URL
    });
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=900");

  try {
    const r = await fetch(SOURCE_URL, {
      headers: {
        "accept": "text/html,application/xhtml+xml",
        "user-agent": "ARCY-Research/1.0 (+https://arcyusdc.xyz)"
      }
    });
    if (!r.ok) throw new Error(`Source HTTP ${r.status}`);

    const html = await r.text();
    const all = parseRows(html);
    if (!all.length) throw new Error("No valid unlock rows parsed");

    const today = utcToday();
    const next30 = all
      .map(x => ({...x, daysFromToday: dayDiff(x.date, today)}))
      .filter(x => x.daysFromToday >= 0 && x.daysFromToday <= 30)
      .sort((a,b) => a.date.localeCompare(b.date));

    const payload = {
      ok: true,
      live: true,
      source: "CoinBell calendar; unlock schedules attributed by CoinBell to DefiLlama",
      sourceUrl: SOURCE_URL,
      updatedAt: new Date().toISOString(),
      windows: {
        today: next30.filter(x => x.daysFromToday === 0),
        next7: next30.filter(x => x.daysFromToday >= 1 && x.daysFromToday <= 7),
        days8to30: next30.filter(x => x.daysFromToday >= 8 && x.daysFromToday <= 30)
      },
      events: next30
    };

    return res.status(200).json(payload);
  } catch (e) {
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
