'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const html=read('transparency.html'),site=read('v8-premium.js');
const contract='0x73e5F588d27d6B5EC89C89c82692D1E7fECBd38b';
test('transparency page exposes independent evidence paths and exact Arc contract',()=>{
 assert.match(html,/Transparency &amp;/);
 assert.ok(html.includes(contract));
 assert.ok(html.includes('Chain ID 5042'));
 assert.ok(html.includes('https://explorer.arc.io/address/'+contract));
 assert.ok(html.includes('https://github.com/arcycoin-glitch/arcy-website/actions'));
 assert.ok(html.includes('https://github.com/arcycoin-glitch/arcy-website/issues'));
 assert.ok(html.includes('https://t.me/arcycommunitychat'));
 assert.ok(fs.existsSync(path.join(root,'search/assets/arcy-neon-owl.svg')));
 assert.match(html,/<meta name="description"/);
 assert.match(html,/https:\/\/www\.arcyusdc\.xyz\/transparency\.html/);
});
test('transparency avoids unsupported audit, profit and data-coverage claims',()=>{
 assert.match(html,/not.*independent audit/i);
 assert.match(html,/up to 20 checks/);
 assert.match(html,/not.*independent source confirmations/i);
 assert.match(html,/disabled until data-display and JSON-delivery permissions/i);
 assert.match(html,/not.*guarantee/i);
 assert.match(html,/The previously linked X account @Arcy_usdc is inactive/);
 assert.doesNotMatch(html,/audited and secure|guaranteed profits|all 20 metrics verified/i);
});
test('site navigation makes evidence accessible without rewriting research UI',()=>{
 assert.match(site,/verify\.href='\/transparency\.html'/);
 assert.match(site,/proof\.href='\/transparency\.html'/);
 assert.match(site,/links\.insertBefore\(verify,github\|\|null\)/);
 assert.match(site,/a\.social-icon\[href="https:\/\/x\.com\/Arcy_usdc"\]/);
 assert.match(site,/const pulse=document\.getElementById\('pulse'\)/);
 assert.match(site,/ensureChainCardArt/);
 assert.match(site,/v8-eth-card-art/);
});
