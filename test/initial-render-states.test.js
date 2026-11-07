'use strict';
// Phase 5: what non-JavaScript clients (crawlers, AI research tools) and slow first loads see must describe the
// real idle/loading state, never imply that a working module is disconnected or that data exists.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const nav=fs.readFileSync(path.join(__dirname,'..','pulse-chain-navigation.js'),'utf8');
test('static homepage never claims a module is NOT CONNECTED before any scan',()=>{
 assert.doesNotMatch(html,/NOT CONNECTED/);
 const grid=html.slice(html.indexOf('<section class="grid">'),html.indexOf('</section>',html.indexOf('<section class="grid">')));
 const badges=[...grid.matchAll(/<div class="badge"[^>]*>\s*([^<]+?)\s*<\/div>/g)].map(m=>m[1]);
 assert.deepEqual(badges,['NOT SCANNED','NOT SCANNED','NOT SCANNED','NOT SCANNED','NOT SCANNED'],'idle state equals what app.js renders');
 assert.ok([...grid.matchAll(/<b[^>]*>([^<]*)<\/b>/g)].every(m=>m[1]==='—'),'no fabricated live metric in static HTML');
});
test('network Pulse skeleton is a loading state with an honest failure transition',()=>{
 assert.doesNotMatch(nav,/NOT CONNECTED|not been connected|Research not connected/);
 assert.match(nav,/Loading verified research/);assert.match(nav,/aria-busy/);
 assert.match(nav,/addEventListener\('arcy-pulse-networks-failed'/);
 assert.match(nav,/No news has been substituted/);
 assert.equal((html.match(/try\{dispatchEvent\(new CustomEvent\('arcy-pulse-networks-failed'\)\)\}catch\{\}/g)||[]).length,2,'failed request and missing chains both signal failure');
});
test('published editions clear loading state and only loading cards can turn unavailable',()=>{
 assert.match(nav,/card\.dataset\.pulseState='published';card\.removeAttribute\('aria-busy'\)/);
 assert.match(nav,/querySelectorAll\('\.pulse-card\[data-pulse-state="loading"\]'\)/);
});
