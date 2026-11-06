'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ui = fs.readFileSync('search/market-radar.js', 'utf8');
const server = require('../lib/radar-v2/discovery');
const overview = ui.split('function renderOverview(')[1].split('for(const [id,name] of chains)')[0];

test('Radar frontend score schema matches the active V3 backend discovery schema', () => {
  assert.equal(server.SCORE_VERSION, 'arcy-discovery-2');
  assert.match(overview, /data\?\.discovery\?\.scoreVersion==='arcy-discovery-2'/);
  assert.match(overview, /d\?\.version===data\.discovery\.scoreVersion/);
  assert.doesNotMatch(overview, /scoreVersion==='arcy-discovery-1'/);
});
test('display requires a finite bounded score and nonzero verified weight coverage', () => {
  assert.match(overview, /typeof d\.score==='number'&&Number\.isFinite\(d\.score\)/);
  assert.match(overview, /d\.score>=0&&d\.score<=100/);
  assert.match(overview, /Number\.isFinite\(d\.weightCoverage\)&&d\.weightCoverage>0&&d\.weightCoverage<=1/);
});
test('do not show empty explanations or repeated unverified placeholders', () => {
  assert.match(overview, /scoreCell\.append\(el\('span','arcy-radar-overview-score-missing','—'\)\)/);
  assert.match(overview, /hasReason=scoreOk&&typeof d\.reason==='string'&&!!d\.reason\.trim\(\)/);
  assert.match(overview, /reasonCell\.style\.display='none'/);
  assert.doesNotMatch(overview, /score-missing','NOT VERIFIED'/);
});
test('Radar's identity, financial metrics, links, 24h source-disagreement warning remain intact', () => {
  assert.match(overview, /row\.href='\/search\/token\/'/);
  assert.match(overview, /fieldOk\(item,'volume24hUsd'\)/);
  assert.match(overview, /fieldOk\(item,'priceUsd'\)/);
  assert.match(overview, /fieldOk\(item,'change24hPct'\)/);
  assert.match(overview, /else withInfo\(change,item\)/);
});
