'use strict';
// AUDIT BRANCH ONLY: immutable UI/branding skeleton protection.
// These git-blob SHA-1 fingerprints come from main at the creation of
// audit/data-engine-end-to-end-20261030 (2026-10-30).
// This test MUST NOT be bypassed, skipped, rewritten or rebaselined to make
// data-only changes pass. If main changes independently, stop/review rather
// than approving a new skeleton in this data audit.
// 2026-10-31 owner-approved UI exception (PR #121): source-rendered single Synthra CTA
// replaces the duplicate community card with a premium Synthra destination panel and scoped footer/layout CSS.
// The owner-requested UI redesign changes only index.html; all other protected file hashes remain pinned.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const BASELINE = Object.freeze({
  "index.html": "252e374339219ec29ef2d068aeafaa5ef8ab8db7",
  "premium.css": "d80f98346802e34afd3aa66ac776e5bbf2c9217e",
  "v8-premium.js": "e51587419fb0d785d76149a2551fb1a3ac7e86f9",
  "hero-video.js": "40942f382f1650b90d1d7572d0d1874217d4a3c0",
  "search/index.html": "39cedc0b6f962c1e0755818be077ac9060c1f102",
  "search/market-radar.js": "962d99f585824c899c86334321d962070d9c46b5",
  "search/market-radar.css": "b8884da23b11369d2ccc1176989c2508ce3443f7",
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
