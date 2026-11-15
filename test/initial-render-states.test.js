'use strict';
// Phase 5: what non-JavaScript clients (crawlers, AI research tools) and slow first loads see must describe the
// real idle/loading state, never imply that a working module is disconnected or that data exists.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
test('static homepage never claims a module is NOT CONNECTED before any scan',()=>{
 assert.doesNotMatch(html,/NOT CONNECTED/);
 const grid=html.slice(html.indexOf('<section class="grid">'),html.indexOf('</section>',html.indexOf('<section class="grid">')));
 const badges=[...grid.matchAll(/<div class="badge"[^>]*>\s*([^<]+?)\s*<\/div>/g)].map(m=>m[1]);
 assert.deepEqual(badges,['NOT SCANNED','NOT SCANNED','NOT SCANNED','NOT SCANNED','NOT SCANNED'],'idle state equals what app.js renders');
 assert.ok([...grid.matchAll(/<b[^>]*>([^<]*)<\/b>/g)].every(m=>m[1]==='—'),'no fabricated live metric in static HTML');
});
