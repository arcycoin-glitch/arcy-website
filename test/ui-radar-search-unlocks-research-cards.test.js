'use strict';
// Owner-requested UI polish (2026-11-21): Radar in-list search, Token Unlocks mobile records, readable Holder & Whale and
// Contract & Mechanics summaries. All three are ADDITIVE: locked HTML / Radar renderer / data engines stay byte-identical.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const RS=require('../search/radar-search.js');
const RC=require('../search/research-cards-readable.js');

test('UI-1 Radar search: name / symbol / FULL contract only; a partial address or a different contract never matches',()=>{
 const row={symbol:'statics',name:'statics',address:'0x2d8d6f4a93acd7a916a5a654ec8b690ba3b3eadd'};
 assert.equal(RS.matches(row,'').match,true,'empty query shows everything');
 assert.equal(RS.matches(row,'STATICS').match,true);
 assert.equal(RS.matches(row,'sta').kind,'SYMBOL');
 assert.equal(RS.matches({...row,symbol:'x'},'tatic').kind,'NAME');
 assert.equal(RS.matches(row,'0x2D8D6F4A93ACD7A916A5A654EC8B690BA3B3EADD').kind,'ADDRESS');
 assert.equal(RS.matches(row,'0x2d8d6f').match,false,'partial address never matches');
 assert.equal(RS.matches(row,'0x2d8d6f').kind,'PARTIAL_ADDRESS');
 assert.equal(RS.matches(row,'0x'+'1'.repeat(40)).match,false,'another contract never matches');
 // a token without a separate name: the shortened address in the name slot is not treated as a name
 assert.equal(RS.matches({symbol:'fobo',name:'',address:'0x000de658153f47f23e92973c8eb1e89762703676'},'0x000de').match,false);
});

test('UI-2 Radar search is local-only: no request, no ranking/score/Info code, separate scoped asset loaded additively',()=>{
 const js=read('search/radar-search.js'),css=read('search/radar-search.css').replace(/\/\*[\s\S]*?\*\//g,'');
 assert.doesNotMatch(js,/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/,'no network');
 assert.doesNotMatch(js,/\.sort\(|researchScore|discovery\.score|infoV4|dataset\.reason\s*=/,'no re-ranking or Info/score change');
 assert.match(js,/row\.hidden=!m\.match/,'rows are only shown or hidden in place');
 for(const m of css.matchAll(/([^{}]+)\{/g)){const sel=m[1].trim();if(sel.startsWith('@media'))continue;
  assert.ok(sel.split(',').every(x=>/arcy-radar-search|arcy-radar-overview-token\[hidden\]/.test(x)),sel);}
 assert.match(css,/#tokenDetail \.arcy-radar-overview-list \.arcy-radar-overview-token\[hidden\][^{]*\{display:none!important\}/,'hidden must beat the renderer display:grid!important');
 for(const f of ['radar-entry.js','search/report-navigation.js'])assert.match(read(f),/\/search\/radar-search\.js/);
});

test('UI-3 Token Unlocks phones: compact records, no forced 690 px table, nothing hidden, scoped to #unlocks',()=>{
 const css=read('unlocks.css').replace(/\/\*[\s\S]*?\*\//g,'');
 const phone=css.slice(css.indexOf('@media(max-width:560px)'),css.indexOf('@media(max-width:359px)'));
 assert.doesNotMatch(phone,/min-width:690px/);
 assert.doesNotMatch(phone,/overflow-x:auto/);
 assert.match(phone,/#unlocks tbody tr\{display:grid/);
 assert.match(phone,/td:nth-child\(3\)::before\{content:"Unlock date"\}/);
 assert.match(phone,/td:nth-child\(4\)::before\{content:"Unlock amount"\}/);
 assert.match(phone,/td:nth-child\(5\)::before\{content:"% Circ\. supply"\}/);
 assert.doesNotMatch(phone,/display:none/,'no cell is hidden');
 assert.match(phone,/#unlocks thead\{position:absolute;[^}]*clip-path:inset\(50%\)/,'headers stay available to screen readers');
 assert.match(css,/@media\(min-width:561px\) and \(max-width:860px\)\{\s*#unlocks table\{min-width:0;width:100%\}/,'768 px tablets fit');
});

const f=(value,status='VERIFIED_SOURCE',extra={})=>({value,dataState:value===null?'NOT_VERIFIED':'DATA_FOUND',status:value===null?'NOT_VERIFIED':status,...extra});
test('UI-4 Mechanics: CONFIRMED, NOT DETECTED and NOT VERIFIED stay distinct; unreviewed is never described as safe',()=>{
 assert.equal(RC.stateOf(f('Buy 0% · Sell 0% · Transfer 0%')),'CONFIRMED');
 assert.equal(RC.stateOf(f(false,'NOT_DETECTED')),'NOT_DETECTED');
 assert.equal(RC.stateOf(f(null)),'NOT_VERIFIED');
 assert.equal(RC.stateOf(undefined),'NOT_VERIFIED');
 assert.equal(RC.stateOf(f('x','GETTER_REPORTED')),'GETTER_REPORTED');
 assert.equal(RC.stateOf(f('x','VERIFIED_SOURCE',{freshness:{state:'LAST_VERIFIED',observedAt:'2026-10-01T00:00:00Z'}})),'HISTORICAL');
 for(const fn of [RC.taxes,RC.mint,RC.owner]){const [st,t]=fn(f(null));assert.equal(st,'NOT_VERIFIED');assert.match(t,/anlamına gelmez|bilinmiyor/,'explicit: unreviewed ≠ safe');assert.doesNotMatch(t,/risksiz|güvenlidir/i);}
 assert.match(RC.taxes(f(null))[1],/vergi olmadığı anlamına gelmez/);
 assert.match(RC.taxes(f('Buy 3% · Sell 5% · Transfer 0%'))[1],/Alış %3, Satış %5 vergi/);
 assert.match(RC.taxes(f('Transfer 0% · DEX/hook fees NOT VERIFIED'))[1],/Alış, Satış vergisi raporlanmadı.*DEX \/ hook ücretleri doğrulanmadı/);
 assert.match(RC.mint(f('NONE DETECTED ✓'))[1],/aktif bir mint yolu bulunmadı/);
 assert.match(RC.mint(f('No current minter · admin can grant MINTER_ROLE'))[1],/yönetici bu yetkiyi verebilir/);
 assert.match(RC.mint(f('Role-gated mint (MINTER_ROLE)'))[1],/Yeni token basılabilir/);
 assert.match(RC.owner(f('Ownership renounced · owner 0x0'))[1],/tespit edilmedi.*renounce/);
 assert.match(RC.owner(f('Proxy admin: 0xabc'))[1],/yönetebilen bir yetki var/);
});

test('UI-5 Proxy and pause are reported only from engine evidence; otherwise NOT VERIFIED',()=>{
 assert.match(RC.proxy(f('NON-PROXY · runtime verified'),null,null)[1],/yükseltilemez/);
 assert.match(RC.proxy(f('EIP-1967 proxy · delegation proven','ONCHAIN_VERIFIED'),null,null)[1],/Yükseltilebilir \(proxy\)/);
 assert.equal(RC.proxy(f(null),f('Proxy admin: 0xabc'),null)[0],'CONFIRMED');
 assert.equal(RC.proxy(f(null),f(null),f(null))[0],'NOT_VERIFIED');
 assert.equal(RC.pause(f('Owner-governed (pause, blacklist) · 0xabc'),[])[0],'CONFIRMED');
 assert.match(RC.pause(f('Owner-governed (pause, blacklist) · 0xabc'),[])[1],/transferleri geçici olarak durdurabilir/);
 assert.equal(RC.pause(f('NONE DETECTED ✓'),['Reviewed source: … no pause, blacklist or fee control exists.'])[0],'NOTE');
 const [st,t]=RC.pause(f('Role-gated'),[]);assert.equal(st,'NOT_VERIFIED');assert.match(t,/Yetki olmadığı anlamına gelmez/);
});

test('UI-6 Holder roles: verified pools and burn addresses are never counted as ordinary wallets',()=>{
 assert.match(RC.roleLabel('BURN_ADDRESS'),/Yakım adresi/);
 assert.match(RC.roleLabel('LIQUIDITY_POOL'),/likidite havuzu \(cüzdan değil\)/);
 assert.match(RC.roleLabel('UNKNOWN'),/Rolü doğrulanmamış/);
 assert.equal(RC.concentrationText(null),null,'no concentration statement without data');
 assert.match(RC.concentrationText(56.3),/yüksek yoğunlaşma/);
 assert.match(RC.concentrationText(12),/dağınık/);
});

test('UI-7 Research layer reads only rendered card data, makes no request and is scoped to the report page',()=>{
 const js=read('search/research-cards-readable.js'),css=read('search/research-cards-readable.css').replace(/\/\*[\s\S]*?\*\//g,'');
 assert.doesNotMatch(js,/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/);
 assert.match(js,/details\.advanced-proof pre/,'source = the card JSON already on the page');
 assert.doesNotMatch(js,/\.metric\b[^'"]*\)\.remove|replaceChildren\(/,'original metrics are never removed');
 for(const m of css.matchAll(/([^{}]+)\{/g)){const sel=m[1].trim();if(sel.startsWith('@media'))continue;assert.ok(sel.split(',').every(x=>x.trim().startsWith('.arcy-rc-')),sel);}
 assert.match(read('search/report-navigation.js'),/\^\\\/search\\\/token\\\/[\s\S]*research-cards-readable\.js/);
});

test('UI-8 locked skeleton files are untouched by this change set',()=>{
 // the immutable fingerprints live in test/data-engine-ui-lock.test.js; this guards the additive loaders only
 for(const f of ['index.html','search/index.html','search/market-radar.js','search/market-radar.css','radar.html'])
  assert.doesNotMatch(read(f),/radar-search|research-cards-readable/,f);
});
