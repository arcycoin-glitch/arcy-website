'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('Radar visible topbar entry is added from the existing unprotected homepage script',()=>{
 const js=read('search-upgrade.js'),css=read('search-upgrade.css');
 assert.match(js,/radar\.href='\/radar'/);
 assert.match(js,/menu\.before\(radar\)/);
 assert.match(css,/\.nav \.nav-radar\{display:inline-flex/);
 assert.match(css,/@media\(max-width:560px\)/);
 assert.doesNotMatch(read('index.html'),/class="nav-radar"/,'immutable homepage remains untouched');
});
test('standalone Radar uses approved current renderer and real permission gate, no token scan',()=>{
 const page=read('radar.html'),js=read('radar-entry.js');
 const cfg=JSON.parse(read('vercel.json'));
 assert.ok(cfg.rewrites.some(r=>r.source==='/radar'&&r.destination==='/radar.html'));
 assert.match(page,/<section id="tokenDetail" aria-label="Market Radar">/);
 assert.match(page,/<script defer src="\/search\/market-radar\.js"><\/script>/);
 assert.match(page,/<script defer src="\/radar-entry\.js"><\/script>/);
 assert.match(js,/if\(opened\|\|radar\?\.disabled\)return/);
 assert.match(js,/radar\.click\(\)/);
 assert.match(js,/window\.location\.assign\('\/#search'\)/);
 assert.doesNotMatch(js,/fetch\(|XMLHttpRequest|scanAddress|activateDetail|Math\.random\(/);
 assert.doesNotThrow(()=>new Function(js));
});
