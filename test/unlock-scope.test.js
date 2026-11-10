'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), crypto = require('node:crypto');
const baseline = require('./fixtures/unlocks-scope-baseline.json');
function outsideUnlocks(html) {
  let text = html.replace(/\r\n/g, '\n').replace('<link rel="stylesheet" href="/unlocks.css">\n', '').replace('<script src="/unlock-view.js"></script>\n', '');
  const start = text.indexOf('<section id="unlocks">'), end = text.indexOf('</section>', start);
  assert.ok(start > 0 && end > start, 'Unlocks section must retain its boundary');
  text = text.slice(0, start) + '<UNLOCKS_SECTION>' + text.slice(end + '</section>'.length);
  const client = text.indexOf('let unlockData ='), clientEnd = text.indexOf('loadUnlocks();', client);
  assert.ok(client > 0 && clientEnd > client, 'Unlocks client must retain its boundary');
  return text.slice(0, client) + '<UNLOCKS_CLIENT>' + text.slice(clientEnd + 'loadUnlocks();'.length);
}
test('Unlocks scope is stable across LF and CRLF checkouts', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  assert.equal(outsideUnlocks(html.replace(/\r\n/g, '\n')), outsideUnlocks(html));
});
test('Unlocks UI exception preserves every unrelated homepage byte from main', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const hash = crypto.createHash('sha256').update(outsideUnlocks(html)).digest('hex');
  assert.equal(hash, baseline.homepageOutsideUnlocksSha256, 'Out-of-scope homepage change: review rather than refresh the scope fingerprint');
});
test('new calendar CSS is exclusively scoped to #unlocks', () => {
  const css = fs.readFileSync(require.resolve('../unlocks.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of css.matchAll(/([^{}]+)\{/g)) {
    const selectors = match[1].trim();
    if (selectors.startsWith('@media')) continue;
    assert.ok(selectors.split(',').every(selector => selector.trim().startsWith('#unlocks ')), selectors);
  }
});
test('Unlocks owl retains the exact original image bytes after extraction from the data URI', () => {
  const bytes = fs.readFileSync(require.resolve('../assets/unlocks-owl.webp'));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), baseline.unlocksOwlSha256);
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const section = html.slice(html.indexOf('<section id="unlocks">'), html.indexOf('<section id="pulse">'));
  assert.match(section, /src="\/assets\/unlocks-owl.webp"/);
});
