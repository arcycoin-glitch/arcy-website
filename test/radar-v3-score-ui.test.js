'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const js=fs.readFileSync(path.join(__dirname,'../search/market-radar.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../search/market-radar.css'),'utf8');

class Node{
 constructor(tag='span'){
  this.tag=tag;this._className='';this.classes=new Set();this.attrs={};this.dataset={};this._text='';
  this.children=[];this.parent=null;this.hidden=false;this.events={};this.style={};
  this.classList={
   add:(...c)=>{for(const x of c)this.classes.add(x);},
   remove:(...c)=>{for(const x of c)this.classes.delete(x);},
   toggle:(c,force)=>{const add=force===undefined?!this.classes.has(c):force;add?this.classes.add(c):this.classes.delete(c);return add;},
   contains:c=>this.classes.has(c)
  };
 }
 set className(s){this._className=s;this.classes=new Set(s.split(/\s+/).filter(Boolean));}
 get className(){return [...this.classes].join(' ');}
 set textContent(x){this._text=String(x);this.children=[];}
 get textContent(){return this._text+this.children.map(x=>x.textContent).join('');}
 append(...xs){for(let x of xs){if(typeof x==='string')x=new Text(x);x.parent=this;this.children.push(x);}}
 prepend(...xs){for(let x of [...xs].reverse()){if(typeof x==='string')x=new Text(x);x.parent=this;this.children.unshift(x);}}
 replaceChildren(...xs){this.children=[];this._text='';this.append(...xs);}
 getBoundingClientRect(){return {top:0};}
 setAttribute(k,v){this.attrs[k]=String(v);}
 getAttribute(k){return this.attrs[k]||null;}
 removeAttribute(k){delete this.attrs[k];}
 addEventListener(name,fn){(this.events[name]||(this.events[name]=[])).push(fn);}
 click(){for(const f of this.events.click||[])f();}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);}
 closest(sel){let p=this;while(p){if(p.matches(sel))return p;p=p.parent;}return null;}
 matches(sel){
  if(sel.startsWith('.'))return this.classes.has(sel.slice(1));
  const m=/^\[data-overview="([^"]+)"\]$/.exec(sel);
  return !!(m&&this.dataset.overview===m[1]);
 }
 querySelectorAll(sel){let out=[];for(const c of this.children){if(c.matches(sel))out.push(c);out.push(...c.querySelectorAll(sel));}return out;}
 querySelector(sel){return this.querySelectorAll(sel)[0]||null;}
}
class Text extends Node{constructor(s){super('#text');this._text=s;}}
const address='0x'+'a'.repeat(40);
const token=(score=72.5)=>({
 rank:1,address,symbol:'NOVA',name:'Nova token',
 priceUsd:0.045,change24hPct:12.2,volume24hUsd:55000,
 fields:{priceUsd:{status:'SOURCE_REPORTED'},change24hPct:{status:'SOURCE_REPORTED'},volume24hUsd:{status:'SOURCE_REPORTED',scope:'POOL'}},
 discovery:{version:'arcy-discovery-2',score,weightCoverage:.85,
  reason:'new pool (2 d); 24h volume $55k; liquidity $40k; 128 trades; independently cross-verified',
  flags:[]}
});
const data=(network,{engine='arcy-radar-v3',score=72.5,empty=false}={})=>({
 ok:true,version:2,network,engine,chainId:{arc:5042,ethereum:1,robinhood:4663,pons:4663}[network],
 asOf:'2026-10-30T11:00:00.000Z',freshness:'FRESH',coverage:{poolsInspected:20},
 discovery:engine==='arcy-radar-v3'?{scoreVersion:'arcy-discovery-2'}:undefined,
 tokens:empty?[]:[token(score)],attribution:[]
});
async function mount({overrides={},http={},fetcher}={}){
 const detail=new Node('section');detail.id='tokenDetail';const calls=[];
 const document={
  createElement:tag=>new Node(tag),
  createTextNode:s=>new Text(s),
  getElementById:id=>id==='tokenDetail'?detail:null
 };
 const responses={robinhood:data('robinhood'),arc:data('arc',{engine:'arcy-radar-v2'}),ethereum:data('ethereum',{score:105}),pons:data('pons',{empty:true}),...overrides};
 const ctx={document,Intl,Date,URL,AbortController,setTimeout,clearTimeout,
  window:{scrollY:0,scrollTo(){}},
  fetch:async url=>{const network=new URL(url,'https://example.com').searchParams.get('chain');calls.push(network);return fetcher?fetcher(network):{ok:http[network]!==false,json:async()=>responses[network]};}
 };
 vm.runInNewContext(js,ctx);
 // Wait for all four immediate fetches, JSON reads and Promise.all() callback.
 for(let i=0;i<5;i++)await Promise.resolve();
 return {detail,calls,responses,http};
}
const panel=(detail,net)=>detail.querySelector('[data-overview="'+net+'"]');
test('JS parses and V3 score/rationale use the existing verified API, without extra calls',async()=>{
 assert.doesNotThrow(()=>new Function(js));
 const {detail,calls}=await mount();
 assert.equal(calls.length,4,'only existing per-network readiness calls');
 const rob=panel(detail,'robinhood');
 assert.equal(rob.hidden,false,'single default selected network');
 assert.equal(rob.querySelector('.arcy-radar-overview-score-value').textContent,'72.5');
 assert.equal(rob.querySelector('.arcy-radar-overview-score-unit').textContent,'/100');
 const why=rob.querySelector('.arcy-radar-overview-reason');
 assert.match(why.textContent,/Yeni havuz \(2 gün\)/);
 assert.match(why.textContent,/24s hacim \$55k/);
 assert.match(why.title,/İki bağımsız kaynakla karşılaştırıldı/);
 assert.equal(rob.querySelector('.arcy-radar-discovery-note').hidden,false);
 assert.match(rob.querySelector('.arcy-radar-discovery-note').textContent,/kazanç garantisi değildir/);
 const row=rob.querySelector('.arcy-radar-overview-token');
 assert.equal(row.href,'/search/token/robinhood/'+address);
 assert.equal(rob.querySelector('.arcy-radar-overview-columns').children.length,7);
});
test('V2 or invalid V3 data renders a neutral score placeholder, without fabricating a reason',async()=>{
 const {detail}=await mount();
 const arc=panel(detail,'arc'),eth=panel(detail,'ethereum');
 assert.match(arc.querySelector('.arcy-radar-overview-score').textContent,/—/);
 assert.equal(arc.querySelector('.arcy-radar-discovery-note').hidden,true);
 assert.equal(eth.querySelector('.arcy-radar-overview-reason').textContent,'');
 assert.equal(eth.querySelector('.arcy-radar-overview-reason').style.display,'none');
 assert.match(eth.querySelector('.arcy-radar-overview-score').textContent,/—/);
});
test('network buttons preserve one-card navigation and Pons verified-empty state',async()=>{
 const {detail}=await mount();
 const button=detail.querySelector('[data-network="arc"]');
 // The mock matches arbitrary data-network via an explicit walk:
 const nav=detail.querySelector('.arcy-radar-networks');
 const arc=nav.children.find(c=>c.dataset.network==='arc');
 assert.ok(arc);
 arc.click();
 assert.equal(panel(detail,'arc').hidden,false);
 assert.equal(panel(detail,'robinhood').hidden,true);
 assert.equal(panel(detail,'ethereum').hidden,true);
 assert.equal(panel(detail,'pons').hidden,true);
 const pons=nav.children.find(c=>c.dataset.network==='pons');pons.click();
 assert.match(panel(detail,'pons').querySelector('.arcy-radar-overview-empty').textContent,/factory ile doğrulanmış/);
});
test('Pons network selection syncs detail rows without duplicate API requests',async()=>{
 const ponsResult=data('pons');
 ponsResult.tokens[0].symbol='PNST';
 ponsResult.tokens[0].name='Pons verified token';
 const {detail,calls}=await mount({overrides:{pons:ponsResult}});
 const views=detail.querySelectorAll('.arcy-radar-view-button');
 views[1].click(); // Enter Market Radar while Robinhood is selected.
 await new Promise(setImmediate);
 const rows=detail.querySelector('.arcy-radar-rows');
 assert.match(rows.textContent,/Nova token/);
 const nav=detail.querySelector('.arcy-radar-networks');
 nav.children.find(c=>c.dataset.network==='pons').click();
 await new Promise(setImmediate);
 assert.match(rows.textContent,/Pons verified token/);
 assert.doesNotMatch(rows.textContent,/Nova token/);
 assert.equal(calls.length,4,'switching networks must reuse existing verified data');
 nav.children.find(c=>c.dataset.network==='robinhood').click();
 await new Promise(setImmediate);
 assert.match(rows.textContent,/Nova token/);
 assert.doesNotMatch(rows.textContent,/Pons verified token/);
 assert.equal(calls.length,4);
});
test('young-pool partial source reading is labelled since-launch, never verified 24h',async()=>{
 const young=data('pons');
 young.tokens[0].change24hPct=null;
 young.tokens[0].fields.change24hPct={
  status:'NOT_VERIFIED',value:null,reasonCode:'POOL_LESS_THAN_24H_OLD',poolAgeHours:18,
  window:'PARTIAL_SINCE_POOL_CREATION',
  sources:[{provider:'GeckoTerminal',value:264.9},{provider:'DEX Screener',value:261.0}]
 };
 // These sources differ by >3 points, so partial readings are not shown either.
 const {detail}=await mount({overrides:{pons:young}});
 const p=panel(detail,'pons');
 assert.equal(p.querySelector('.arcy-radar-partial-value'),null);
 assert.match(p.querySelector('.arcy-radar-overview-change').textContent,/—/);
 assert.ok(p.querySelector('.arcy-radar-info'),'missing 24h retains its reason');
 young.tokens[0].fields.change24hPct.sources[1].value=263.1;
 // Mount independently: the new source values agree, but do not establish full 24h.
 const a=await mount({overrides:{pons:young}});
 const card=panel(a.detail,'pons');
 assert.equal(card.querySelector('.arcy-radar-partial-value').textContent,'+264.9%');
 assert.equal(card.querySelector('.arcy-radar-partial-label').textContent,'Açılıştan beri');
 assert.match(card.querySelector('.arcy-radar-partial-metric').title,/Tam 24 saatlik değişim değildir/);
 assert.ok(card.querySelector('.arcy-radar-info'),'reason icon remains visible');
 assert.equal(young.tokens[0].change24hPct,null,'no 24h value is substituted');
 const nav=a.detail.querySelector('.arcy-radar-networks');
 a.detail.querySelectorAll('.arcy-radar-view-button')[1].click();
 nav.children.find(c=>c.dataset.network==='pons').click();
 await new Promise(setImmediate);
 const rows=a.detail.querySelector('.arcy-radar-rows');
 assert.match(rows.textContent,/Açılıştan beri/);
 assert.match(rows.textContent,/264.9%/);
});
test('young Robinhood source disagreement shows both attributed since-launch values without a 24h claim',async()=>{
 const young=data('robinhood');
 young.tokens[0].symbol='CLAUDE';
 young.tokens[0].change24hPct=null;
 young.tokens[0].fields.change24hPct={
  status:'NOT_VERIFIED',value:null,reasonCode:'POOL_LESS_THAN_24H_OLD',
  poolAgeHours:19.6,window:'PARTIAL_SINCE_POOL_CREATION',sourcesDisagree:true,
  sources:[{provider:'GeckoTerminal',value:141.07},{provider:'DEX Screener',value:130}]
 };
 const {detail,calls}=await mount({overrides:{robinhood:young}});
 const card=panel(detail,'robinhood'),cell=card.querySelector('.arcy-radar-overview-change');
 const lines=cell.querySelectorAll('.arcy-radar-partial-source');
 assert.equal(lines.length,2,'both independent observations must remain visible');
 assert.deepEqual(lines.map(n=>n.textContent),['GT+141.1%','DS+130.0%']);
 assert.match(cell.querySelector('.arcy-radar-partial-label').textContent,/Açılıştan beri.*uyuşmazlık/);
 assert.match(cell.querySelector('.arcy-radar-info').dataset.reason,/ayrışıyor/);
 assert.equal(young.tokens[0].change24hPct,null,'24h field must remain null');
 assert.equal(calls.length,4,'no extra API requests');
 detail.querySelectorAll('.arcy-radar-view-button')[1].click();
 await new Promise(setImmediate);
 const rows=detail.querySelector('.arcy-radar-rows');
 assert.match(rows.textContent,/GT.*141.1%/);
 assert.match(rows.textContent,/DS.*130.0%/);
});
test('a young conflict with incomplete source evidence remains unavailable, no single quote chosen',async()=>{
 const young=data('pons');
 young.tokens[0].change24hPct=null;
 young.tokens[0].fields.change24hPct={
  status:'NOT_VERIFIED',value:null,reasonCode:'POOL_LESS_THAN_24H_OLD',
  poolAgeHours:18,window:'PARTIAL_SINCE_POOL_CREATION',sourcesDisagree:true,
  sources:[{provider:'GeckoTerminal',value:264.92}]
 };
 const {detail}=await mount({overrides:{pons:young}});
 const cell=panel(detail,'pons').querySelector('.arcy-radar-overview-change');
 assert.equal(cell.querySelector('.arcy-radar-partial-metric'),null);
 assert.match(cell.textContent,/—/);
});
test('unverified or conflicting 24h observations are never replaced by partial values',async()=>{
 const bad=data('pons');
 bad.tokens[0].change24hPct=null;
 bad.tokens[0].fields.change24hPct={status:'NOT_VERIFIED',value:null,reasonCode:'SOURCES_DISAGREE',
  sources:[{provider:'GeckoTerminal',value:155.7},{provider:'DEX Screener',value:189}]};
 const {detail}=await mount({overrides:{pons:bad}});
 const cell=panel(detail,'pons').querySelector('.arcy-radar-overview-change');
 assert.match(cell.textContent,/—/);
 assert.equal(cell.querySelector('.arcy-radar-partial-metric'),null);
});
test('responsive mobile slots and truthful copy are present',()=>{
 assert.match(css,/grid-template-areas:\s*"token token score"\s*"price change volume"\s*"reason reason reason"/);
 assert.match(css,/@media\(max-width:390px\)/);
 assert.match(css,/\.arcy-radar-overview-columns\{display:none!important\}/);
 assert.match(js,/discovery\.reason|explainDiscovery\(d\.reason\)/);
 assert.doesNotMatch(js,/Math\.random\(/);
});

test('failed Pons response never claims that no launches were found; other networks remain available',async()=>{
 const {detail,calls}=await mount({http:{pons:false}}),p=panel(detail,'pons');
 assert.equal(p.querySelector('.arcy-radar-overview-freshness').textContent,'KAYNAK ERİŞİLEMİYOR');
 assert.match(p.querySelector('.arcy-radar-overview-empty').textContent,/lansman olmadığı anlamına gelmez/);
 assert.doesNotMatch(p.querySelector('.arcy-radar-overview-empty').textContent,/lansmanı bulunamadı/);
 assert.equal(p.querySelector('.arcy-radar-overview-action').textContent,'Yeniden Dene ↻');
 detail.querySelector('.arcy-radar-networks').children.find(c=>c.dataset.network==='pons').click();
 assert.equal(p.querySelector('.arcy-radar-overview-action').textContent,'Yeniden Dene ↻','selecting an unavailable network must not restore an expansion label');
 assert.equal(panel(detail,'robinhood').querySelectorAll('.arcy-radar-overview-token').length,1);
 assert.equal(calls.length,4,'no automatic extra request on failure');
});
test('a valid empty Pons ranking is distinct from a source failure and does not claim full coverage',async()=>{
 const {detail}=await mount(),p=panel(detail,'pons');
 assert.equal(p.querySelector('.arcy-radar-overview-freshness').textContent,'PENCERE BOŞ');
 assert.match(p.querySelector('.arcy-radar-overview-empty').textContent,/Liste tüm lansmanları kapsamaz/);
 assert.equal(p.querySelector('.arcy-radar-overview-action').disabled,true);
});
test('wrong-network and malformed successful results cannot masquerade as verified Pons data',async()=>{
 for(const wrong of [data('arc'),{...data('pons'),tokens:null},{...data('pons'),chainId:1}]){
  const {detail}=await mount({overrides:{pons:wrong}}),p=panel(detail,'pons');
  assert.equal(p.querySelector('.arcy-radar-overview-freshness').textContent,'KAYNAK ERİŞİLEMİYOR');
  assert.equal(p.querySelectorAll('.arcy-radar-overview-token').length,0);
 }
});
test('manual retry fetches only failed Pons and can recover without refetching healthy networks',async()=>{
 const {detail,calls,http,responses}=await mount({http:{pons:false}}),p=panel(detail,'pons');
 http.pons=true;responses.pons=data('pons');
 detail.querySelector('.arcy-radar-networks').children.find(c=>c.dataset.network==='pons').click();
 p.querySelector('.arcy-radar-overview-action').click();
 await new Promise(setImmediate);
 assert.deepEqual(calls,['arc','ethereum','robinhood','pons','pons']);
 assert.equal(p.querySelector('.arcy-radar-overview-freshness').textContent,'DOĞRULANDI');
 assert.equal(p.querySelectorAll('.arcy-radar-overview-token').length,1);
 p.querySelector('.arcy-radar-overview-action').click();
 assert.equal(calls.length,5,'expansion after recovery never fetches again');
});
test('repeated manual clicks coalesce while a Pons retry is pending',async()=>{
 let attempt=0,finish;
 const {detail,calls}=await mount({fetcher:async network=>{
  if(network!=='pons')return {ok:true,json:async()=>data(network)};
  if(attempt++===0)return {ok:false};
  return new Promise(resolve=>{finish=()=>resolve({ok:true,json:async()=>data('pons')});});
 }});
 const p=panel(detail,'pons'),action=p.querySelector('.arcy-radar-overview-action');
 action.click();action.click();
 assert.equal(calls.filter(n=>n==='pons').length,2);
 assert.equal(action.disabled,true);
 assert.equal(p.querySelector('.arcy-radar-overview-freshness').textContent,'KONTROL EDİLİYOR');
 finish();await new Promise(setImmediate);
 assert.equal(action.disabled,false);
 assert.equal(p.querySelector('.arcy-radar-overview-freshness').textContent,'DOĞRULANDI');
});
test('Retry-After disables manual retry without scheduling another provider request',async()=>{
 const {detail,calls}=await mount({fetcher:async network=>network==='pons'?{ok:false,headers:{get:key=>key==='retry-after'?'60':null}}:{ok:true,json:async()=>data(network)}});
 const p=panel(detail,'pons'),action=p.querySelector('.arcy-radar-overview-action');
 assert.equal(action.disabled,true);
 assert.equal(action.textContent,'Kaynak bekleme süresinde');
 action.click();await new Promise(setImmediate);
 assert.equal(calls.length,4);
 assert.doesNotMatch(p.querySelector('.arcy-radar-overview-empty').textContent,/lansmanı bulunamadı/);
});
