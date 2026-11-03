'use strict';
// AUDIT BRANCH ONLY: immutable UI/branding skeleton protection.
// These git-blob SHA-1 fingerprints come from main at the creation of
// audit/data-engine-end-to-end-20261030 (2026-10-30).
// This test MUST NOT be bypassed, skipped, rewritten or rebaselined to make
// data-only changes pass. If main changes independently, stop/review rather
// than approving a new skeleton in this data audit.
// 2026-11-03 owner-requested Radar exception: accessible info icon beside unavailable 24h change (market-radar.js/.css only; reasonCode/poolAgeHours, no policy/score/data change).
// 2026-11-03 owner-requested Radar display extension (#138): show exact-source young-pool partial values explicitly labelled 'Açılıştan beri' in the existing cell. 24h value stays unverified/null, score unchanged, no new API calls; only Radar JS/CSS change, reviewed through dedicated tests.
// 2026-10-31 owner-approved UI exception (PR #121): source-rendered single Synthra CTA
// replaces the duplicate community card with a premium Synthra destination panel and scoped footer/layout CSS.
// The owner-requested UI redesign changes only index.html; all other protected file hashes remain pinned.
// 2026-11-01 owner-requested Unlocks UI exception: counters, groups, sorting,
// source details and scoped mobile styles. test/unlock-scope.test.js independently
// pins every homepage byte outside the Unlocks markup/client and two asset tags.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const BASELINE = Object.freeze({
  "index.html": "83720f2fdf2c0afe3ab6734bf075a544f83c897f",
  "premium.css": "d80f98346802e34afd3aa66ac776e5bbf2c9217e",
  "v8-premium.js": "e51587419fb0d785d76149a2551fb1a3ac7e86f9",
  "hero-video.js": "40942f382f1650b90d1d7572d0d1874217d4a3c0",
  "search/index.html": "39cedc0b6f962c1e0755818be077ac9060c1f102",
  // 2026-11-01 owner-requested Pons availability exception: truthful source states and controlled manual retry; layout/CSS unchanged.
  "search/market-radar.js": "af463f952f193319f9f1968d972fe8c8fa04a0b0",
  "search/market-radar.css": "b52159cdbe6178b182e8002da86ecbaa117a59e7",
  "search/assets/arc-network-mark.svg": "164d2a27c837cd58e42cf12d5d9a89ad4a546225",
  "search/assets/ethereum-mark.svg": "b92e033331b638dc4e2904aaa96b9f7e20917eb7",
  "search/assets/robinhood-chain-mark.svg": "3cb7faadf2cd29c1b158065283c688f424079a8e"
});
function blobSha(buffer) {
  return crypto.createHash('sha1').update('blob '+buffer.length+'\0').update(buffer).digest('hex');
}
test('DATA-ONLY audit: immutable main website, Search and Radar skeleton must be byte-for-byte unchanged', () => {
  for (const [file, expected] of Object.entries(BASELINE)) {
    const content=fs.readFileSync(path.resolve(__dirname,'..',file));
    assert.equal(blobSha(content),expected,'PROTECTED SKELETON MODIFIED: '+file+'; revert UI change, do NOT refresh fixture');
  }
});
