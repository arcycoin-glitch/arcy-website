/* Presentation only: preserve source amounts, dates and evidence; never infer a release cadence. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ARCYUnlockView = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const text = value => typeof value === 'string' ? value.trim() : '';
  const normalized = value => text(value).normalize('NFKC').toLowerCase();

  function tokenKey(event) {
    // A name/ticker group is not a verified contract identity. Keep documented
    // versions and networks separate, including assets that share a ticker.
    return JSON.stringify([text(event.projectId) || normalized(event.name),
      normalized(event.symbol || event.token), text(event.tokenVersion),
      normalized(event.network), normalized(event.contract || event.address)]);
  }
  function eventKey(event) {
    return JSON.stringify([tokenKey(event), text(event.date), text(event.amount),
      normalized(event.allocation), text(event.scheduleType)]);
  }
  function uniqueEvents(rows) {
    const seen = new Set();
    return (Array.isArray(rows) ? rows : []).filter(event => {
      if (!event || typeof event !== 'object') return false;
      const key = eventKey(event);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  function validWindows(windows) {
    return !!windows && ['today', 'next7', 'days8to30'].every(key =>
      Array.isArray(windows[key]) && windows[key].every(event => event &&
        text(event.name) && text(event.symbol) && text(event.amount) &&
        /^\d{4}-\d{2}-\d{2}$/.test(text(event.date))));
  }
  function summarize(rows) {
    const events = uniqueEvents(rows);
    return { tokenEntries: new Set(events.map(tokenKey)).size, events: events.length };
  }
  function coverage(windows) {
    if (!validWindows(windows)) return null;
    return { ...summarize(Object.values(windows).flat()),
      today: summarize(windows.today), next7: summarize(windows.next7),
      days8to30: summarize(windows.days8to30) };
  }
  function metric(value, kind) {
    // Sort published values only. Missing, rounded-zero percentages and
    // ambiguous number formats are not converted to a measured zero.
    let raw = text(value);
    if (kind === 'value') {
      if (!raw.startsWith('$')) return null;
      raw = raw.slice(1).trim();
    } else {
      if (!raw.endsWith('%')) return null;
      raw = raw.slice(0, -1).trim();
      if (/^\d+,\d{1,2}$/.test(raw)) raw = raw.replace(',', '.');
    }
    const match = raw.match(/^((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)([KMB])?$/i);
    if (!match || (kind !== 'value' && match[2])) return null;
    const number = Number(match[1].replace(/,/g, '')) * ({ K: 1e3, M: 1e6, B: 1e9 }[String(match[2] || '').toUpperCase()] || 1);
    return Number.isFinite(number) && (kind === 'value' ? number >= 0 : number > 0) ? number : null;
  }
  function compareEvents(left, right) {
    return text(left.date).localeCompare(text(right.date)) ||
      normalized(left.allocation).localeCompare(normalized(right.allocation)) ||
      text(left.amount).localeCompare(text(right.amount));
  }
  function groupEvents(rows, sort = 'value', query = '') {
    const groups = new Map(), needle = normalized(query);
    for (const event of uniqueEvents(rows)) {
      if (needle && !normalized(`${event.symbol || event.token || ''} ${event.name || ''}`).includes(needle)) continue;
      const key = tokenKey(event);
      if (!groups.has(key)) groups.set(key, { key, events: [] });
      groups.get(key).events.push(event);
    }
    const field = sort === 'impact' ? 'percent' : 'value';
    const result = [...groups.values()].map(group => {
      group.events.sort(compareEvents);
      group.representative = group.events[0];
      group.score = null;
      for (const event of group.events) {
        const score = metric(event[field], field);
        if (score !== null && (group.score === null || score > group.score)) {
          group.score = score;
          if (sort !== 'soonest') group.representative = event;
        }
      }
      group.dateCount = new Set(group.events.map(event => event.date)).size;
      return group;
    });
    return result.sort((left, right) => {
      if (sort !== 'soonest') {
        if (left.score === null && right.score !== null) return 1;
        if (right.score === null && left.score !== null) return -1;
        if (left.score !== right.score) return right.score - left.score;
      }
      return compareEvents(left.events[0], right.events[0]) || left.key.localeCompare(right.key);
    });
  }
  function sourceUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
        ['api.coinbell.in', 'defillama.com'].includes(url.hostname) ? url.href : '';
    } catch { return ''; }
  }
  function scheduleLabel(event) {
    const url = sourceUrl(event.sourceUrl);
    const proof = Array.isArray(event.evidence) && event.evidence.some(item =>
      item?.kind === 'explicit-schedule-type' && sourceUrl(item.url) === url && url);
    if (!proof) return 'Type not supplied';
    return { cliff: 'Cliff unlock', linear: 'Linear release', emission: 'Emission / rewards' }[event.scheduleType] || 'Type not supplied';
  }
  return { tokenKey, uniqueEvents, validWindows, summarize, coverage, metric, groupEvents, sourceUrl, scheduleLabel };
});
