'use strict';
// AUDIT BRANCH ONLY: immutable UI/branding skeleton protection.
// These git-blob SHA-1 fingerprints come from main at the creation of
// audit/data-engine-end-to-end-20261030 (2026-10-30).
// This test MUST NOT be bypassed, skipped, rewritten or rebaselined to make
// data-only changes pass. If main changes independently, stop/review rather
// than approving a new skeleton in this data audit.
// 2026-11-20 owner-requested #300 Radar capacity-only exception: the two data-token count limits (10→40) are canonicalized back to the pinned baseline; every other JS/CSS/DOM byte stays protected.
// 2026-11-03 owner-requested Radar exception: accessible info icon beside unavailable 24h change (market-radar.js/.css only; reasonCode/poolAgeHours, no policy/score/data change).
// 2026-11-03 owner-requested Radar display extension (#138): show exact-source young-pool partial values explicitly labelled 'Açılıştan beri' in the existing cell. 24h value stays unverified/null, score unchanged, no new API calls; only Radar JS/CSS change, reviewed through dedicated tests.
// 2026-11-03 Radar source-disagreement presentation: where both verified-identity providers supply different young-pool partial observations, render GT and DS separately with an explicit disagreement label instead of hiding both. 24h null/provenance/score policy unchanged; UI-only code and CSS reviewed by dedicated unit tests.
// 2026-11-15 owner-requested Data Engine V2 Phase 5 Radar exception: a short visible reason ('Kaynak uyuşmazlığı' / 'Havuz çok yeni' / 'Geçmiş yok' / 'Doğrulanamadı') beside the unavailable 24h dash. market-radar.js/.css only; reasonCode already served, 24h value stays null, no score/data/policy change.
// 2026-11-15 owner-requested Data Engine V2 Phase 2 Radar exception: collapsed 'Kapsam' categories panel (Qualified / Emerging / Momentum Watch / Low Liquidity / Insufficient Evidence) rendered from the additive `categories` API field. market-radar.js/.css only; ranking, score and calls unchanged.
// 2026-11-15 owner-requested Data Engine V2 Phase 4 logo exception: Radar accepts Search's same-origin exact-contract artwork (fixed /search/assets/token-icons/*.svg and /assets/hero-arcy.png paths only). market-radar.js only.
// 2026-11-15 owner-requested V3 Follow-the-DEX Radar exception: 'zincirde yeni havuz' group in the existing Kapsam panel (on-chain creation events). market-radar.js only.
// 2026-10-31 owner-approved UI exception (PR #121): source-rendered single Synthra CTA
// replaces the duplicate community card with a premium Synthra destination panel and scoped footer/layout CSS.
// Owner-authorized retirement of the news module updates index.html, premium.css and v8-premium.js only; unrelated protected Search and Radar assets remain pinned.
// 2026-11-01 owner-requested Unlocks UI exception: counters, groups, sorting,
// source details and scoped mobile styles. test/unlock-scope.test.js independently
// pins every homepage byte outside the Unlocks markup/client and two asset tags.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const BASELINE = Object.freeze({
  // 2026-11-16 owner-authorized frontend hardening (#263): only intrinsic/lazy/low-priority image
  // hints on the original owl and Unlocks art, plus accessible labels on the existing pager.
  // All cards, metrics, navigation, token data and API contracts remain unchanged.
  // 2026-11-07 scoped mobile-performance exception (PR #186): exact original 1400x787 below-fold WebP
  // moved byte-for-byte from data URI to an external lazy-loaded asset; existing hero poster preloaded.
  // Section order, text, styles, layout, JavaScript, token content, and all other protected files unchanged.
    "index.html": "ef6ee8bd0ed4b8d60f844873d72a80837837ca51",
  "premium.css": "9fb533e474f912e7ea3c0bd7a45eed9dde36af0a",
  "v8-premium.js": "7b2e9c36ca6bbaab9beb75a59e5affc121f2b522",
  "hero-video.js": "40942f382f1650b90d1d7572d0d1874217d4a3c0",
  // Issue #263: evidence labels and exact-chain missing-contract error presentation; API and metrics unchanged.
  "search/index.html": "f6296dbfb39f2ecbd0e461187951f19aa12087d9",
  // 2026-11-01 owner-requested Pons availability exception: truthful source states and controlled manual retry; layout/CSS unchanged.
  // 2026-11-07 owner-authorized Radar SCORE display repair: accept the existing
  // discovery-2 backend schema and hide absent rationales; no HTML/CSS/skeleton,
  // provider, ranking or other-page changes. Reviewed in PR #177.
  // Integration of #274 (owner-approved ⓘ Info) + #263 (Radar discovery scope / empty ranking wording): fingerprints of the merged files.
  "search/market-radar.js": "478220679f6f8ee077f3fadba09e009d6650cf8b",
  "search/market-radar.css": "48a313697ab636df04975ab351cad2e534781773",
  "search/assets/arc-network-mark.svg": "164d2a27c837cd58e42cf12d5d9a89ad4a546225",
  "search/assets/ethereum-mark.svg": "b92e033331b638dc4e2904aaa96b9f7e20917eb7",
  "search/assets/robinhood-chain-mark.svg": "3cb7faadf2cd29c1b158065283c688f424079a8e"
});
const TEXT_EXTENSIONS = new Set(['.html', '.css', '.js', '.svg']);
function gitBlobSha(buffer) {
  return crypto.createHash('sha1').update('blob '+buffer.length+'\0').update(buffer).digest('hex');
}
function blobSha(buffer, file = '') {
  if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) return gitBlobSha(buffer);
  const text = buffer.toString('utf8');
  const hasBareLf = /(?<!\r)\n/.test(text);
  const normalized = hasBareLf ? buffer : Buffer.from(text.replace(/\r\n/g, '\n'));
  return gitBlobSha(normalized);
}
test('scope fingerprints canonicalize Windows newlines like Git', () => {
  assert.equal(blobSha(Buffer.from('first\nsecond\n'), 'index.html'), blobSha(Buffer.from('first\r\nsecond\r\n'), 'index.html'));
});
test('scope fingerprints preserve mixed line endings as Git does', () => {
  const mixed = Buffer.from('first\r\nsecond\n');
  assert.notEqual(blobSha(mixed, 'index.html'), blobSha(Buffer.from('first\nsecond\n'), 'index.html'));
});
test('scope fingerprints preserve binary asset bytes exactly', () => {
  const binary = Buffer.from([0x00, 0x0d, 0x0a, 0xff, 0xfe]);
  assert.equal(blobSha(binary, 'hero.webp'), gitBlobSha(binary));
});
test('DATA-ONLY audit: immutable main website, Search and Radar skeleton must be byte-for-byte unchanged', () => {
  for (const [file, expected] of Object.entries(BASELINE)) {
    const content=fs.readFileSync(path.resolve(__dirname,'..',file));
    // Owner-requested #300: the API may now return 40 V6 candidates; only these TWO
    // existing Radar JS acceptance/display limits may change from 10 to 40.
    // Restore them to their exact prior bytes before comparing the ORIGINAL pinned
    // blob hashes. No hash rebaseline and no exception for markup, CSS or other JS.
    let canonical=content;
    if(file==='search/market-radar.js'){
      const src=content.toString('utf8');
      const replacements=[
        ['data.tokens.length<=40&&data.tokens.every','data.tokens.length<=10&&data.tokens.every'],
        ['expandedNetwork===network?40:5','expandedNetwork===network?10:5']
      ];
      for(const [from] of replacements)assert.equal(src.split(from).length-1,1,'RADAR_LIMIT_EXCEPTION_MISSING_OR_REPEATED: '+from);
      canonical=Buffer.from(replacements.reduce((t,[from,to])=>t.replace(from,to),src));
    }
    assert.equal(blobSha(canonical,file),expected,'PROTECTED SKELETON MODIFIED: '+file+'; revert UI change, do NOT refresh fixture');
  }
});
