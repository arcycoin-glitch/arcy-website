'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const archive=fs.readFileSync(path.join(__dirname,'../pulse/003.html'),'utf8');
const homepage=fs.readFileSync(path.join(__dirname,'../search-upgrade.js'),'utf8');
const dex=require('../search/server/lib/dex-market');
const goplus=require('../search/server/lib/goplus-evidence');

test('ARC PULSE #003 historical archive has exactly six numbered sections and dated title',()=>{
 assert.match(archive,/<title>ARCY ARC PULSE #003 — 5–11 October 2026/);
 assert.match(archive,/Historical edition — not this week's news/);
 const found=[...archive.matchAll(/<div class="kicker">(\d\d) · /g)].map(m=>m[1]);
 assert.deepEqual(found,['01','02','03','04','05','06']);
 for(const section of ['THIS WEEK','NEW','WATCH','RISK / REALITY CHECK',"WHAT'S UNLOCKING",'ARCY TAKE'])assert.ok(archive.includes(section),section);
});
test('Archived editorial facts cite date-qualifying, primary source URLs',()=>{
 const official=[
  'https://community.arc.io/public/blogs/extended-is-coming-to-arc-2026-10-08',
  'https://www.arc.io/blog/how-pulsar-is-building-a-cross-border-money-experience-with-arc',
  'https://community.arc.io/public/blogs/build-agents-that-pay-for-ai-with-blockrun-2026-10-09'
 ];
 for(const url of official)assert.ok(archive.includes(url),url);
 assert.match(archive,/week of 19 October/);
 assert.match(archive,/not a completed one/);
 assert.match(archive,/no independent|does not claim an independently verified/i);
 assert.doesNotMatch(archive,/<script|onerror=|onload=/i);
});
test('Homepage preserves existing Pulse skeleton while linking working static archive',()=>{
 assert.match(homepage,/getElementById\('pulseArchive'\)/);
 assert.match(homepage,/\/pulse\/003\.html/);
 assert.match(homepage,/MutationObserver\(fixHistoricalLink\)/);
 assert.doesNotMatch(homepage,/\.innerHTML\s*=.*pulseGrid/);
});
test('External DEX Screener and GoPlus production use stays gated by explicit server-side approval',()=>{
 const from=process.env.VERCEL,env=process.env.VERCEL_ENV,dx=process.env.DEXSCREENER_PUBLIC_DISPLAY_APPROVED,gp=process.env.GOPLUS_PUBLIC_DISPLAY_APPROVED;
 try{
  process.env.VERCEL='1';process.env.VERCEL_ENV='production';
  delete process.env.DEXSCREENER_PUBLIC_DISPLAY_APPROVED;
  delete process.env.GOPLUS_PUBLIC_DISPLAY_APPROVED;
  assert.equal(dex.productionDisplayAllowed(),false);
  assert.equal(goplus.productionUseAllowed(),false);
  process.env.VERCEL_ENV='preview';
  assert.equal(dex.productionDisplayAllowed(),false);
  assert.equal(goplus.productionUseAllowed(),false);
  process.env.DEXSCREENER_PUBLIC_DISPLAY_APPROVED='true';
  process.env.GOPLUS_PUBLIC_DISPLAY_APPROVED='true';
  assert.equal(dex.productionDisplayAllowed(),true);
  assert.equal(goplus.productionUseAllowed(),true);
 }finally{
  for(const [k,v] of [['VERCEL',from],['VERCEL_ENV',env],['DEXSCREENER_PUBLIC_DISPLAY_APPROVED',dx],['GOPLUS_PUBLIC_DISPLAY_APPROVED',gp]]){
   if(v===undefined)delete process.env[k];else process.env[k]=v;
  }
 }
});
