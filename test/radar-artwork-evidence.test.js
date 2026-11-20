'use strict';
// No remote images are fetched in these tests. Artwork never implies official issuer verification.
const test=require('node:test');
const assert=require('node:assert/strict');
const A=require('../lib/radar-v2/artwork-evidence');
// V4-level selection semantics (research:false). The V5 research layer can only move rows from the main list to WATCH_ONLY,
// never add one, so every exclusion/ordering guarantee tested here still holds in production; the layer itself is covered by
// test/radar-v5-quality.test.js.
const E0=require('../lib/radar-v2/intel/engine'),E={...E0,selectDisplay:(r,o={})=>E0.selectDisplay(r,{research:false,...o}),run:(a={})=>E0.run({...a,limits:{research:false,...(a.limits||{})}})};
const S=require('../lib/radar-v2/v4-snapshot');
const F=require('../lib/radar-v2/intel/fetch');
const ADDR=n=>'0x'+n.toString(16).padStart(40,'0'),NOW=Date.parse('2026-11-18T16:00:00Z');
const geckoImage='https://coin-images.coingecko.com/coins/images/10001/large/legitimate.png';
const dexImage='https://cdn.dexscreener.com/cms/images/legitimate-art?width=800';
const sectionRow=(address,logo)=>({address,symbol:'TEST',name:'Test candidate',logo,reason:'INELIGIBLE_AFTER_VERIFICATION',
 detail:'VOLUME_BELOW_NETWORK_FLOOR',priceUsd:0.5,volume24hUsd:90000,liquidityUsd:240000,change24hPct:5,
 poolCreatedAt:'2026-11-14T00:00:00Z',buys24h:32,sells24h:31,
 verification:{crossCheck:'MATCHED',fields:{priceUsd:'CROSS_VERIFIED',liquidityUsd:'CROSS_VERIFIED',volume24hUsd:'CROSS_VERIFIED'},sourcesDisagree:false}});
test('source artwork: direct Gecko pool image and finalized DEX image preserve exact contract',()=>{
 assert.deepEqual(A.candidateArtwork({network:'ethereum',address:ADDR(100),logo:geckoImage}),{url:geckoImage,source:'GeckoTerminal'});
 assert.deepEqual(A.candidateArtwork({network:'ethereum',address:ADDR(101),logo:{url:dexImage,source:'DEX Screener'}}),{url:dexImage,source:'DEX Screener'});
 assert.equal(A.candidateArtwork({network:'ethereum',address:ADDR(102),logo:'https://unsafe.example/logo.png'}),null);
 assert.equal(A.candidateArtwork({network:'ethereum',address:ADDR(103),logo:{url:dexImage,source:'Official Project'}}),null,'untrusted issuer source must not be invented');
 assert.equal(A.candidateArtwork({network:'ethereum',address:'invalid',logo:geckoImage}),null);
 assert.equal(A.candidateArtwork({network:'ethereum',address:ADDR(105),logo:'http://coin-images.coingecko.com/coins/1.png'}),null);
});
test('decorative artwork cannot be reused across two exact contracts in the same section',()=>{
 const rows=[{chainId:1,address:ADDR(10),logo:{url:geckoImage}},{chainId:1,address:ADDR(11),logo:{url:geckoImage}},{chainId:1,address:ADDR(12),logo:{url:dexImage}}];
 const out=A.removeSharedArtwork(rows);
 assert.equal(out[0].logo,null);assert.equal(out[1].logo,null);
 assert.equal(out[2].logo.url,dexImage);
});
test('V4 near-match snapshot retains only contract-matched allowed artwork without moving rankings',async()=>{
 const addr=ADDR(30),s={ok:true,network:'ethereum',chainId:1,asOf:new Date(NOW-60000).toISOString(),freshness:'FRESH',tokens:[],nearMiss:[],
  excluded:[sectionRow(addr,{url:geckoImage,source:'GeckoTerminal'})],discovery:{uniqueCandidates:1}};
 F._reset();E._clearCache();
 const r=await E.run({sections:{ethereum:s},now:NOW,env:{},fetcher:async()=>{throw Error('NO_NETWORK')},rpc:{},
  registryDoc:{schema:'arcy-radar-project-registry/1',version:'test',projects:[]},limits:{concurrency:1,pace:false}});
 const snap=S.build(r,{ethereum:s},{now:NOW});
 assert.equal(S.validate(snap).ok,true);
 assert.equal(snap.sections.ethereum.rows.length,1);
 const row=snap.sections.ethereum.rows[0];
 assert.equal(row.address,addr);assert.equal(row.logo.url,geckoImage);assert.equal(row.logo.source,'GeckoTerminal');
 assert.equal(row.opportunity.discoveryClass,'NEAR_MATCH');
 const spoof={...s,excluded:[sectionRow(addr,{url:'https://bad.invalid/icon.png',source:'GeckoTerminal'})]};
 const spoofSnap=S.build(await E.run({sections:{ethereum:spoof},now:NOW,env:{},fetcher:async()=>{throw Error('NO_NETWORK')},rpc:{},
  registryDoc:{schema:'arcy-radar-project-registry/1',version:'test',projects:[]},limits:{concurrency:1,pace:false}}),{ethereum:spoof},{now:NOW});
 // V5 (#279): an untrusted image is dropped (never shown, never borrowed), but artwork is decorative, not evidence:
 // the corroborated contract stays and the UI uses its existing placeholder.
 assert.equal(spoofSnap.sections.ethereum.rows.length,1);
 assert.equal(spoofSnap.sections.ethereum.rows[0].logo,null,'unverified artwork is never published');
 assert.equal(spoofSnap.sections.ethereum.rows[0].address,addr);
});
