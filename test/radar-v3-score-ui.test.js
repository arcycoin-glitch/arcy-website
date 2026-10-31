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
  this.children=[];this.parent=null;this.hidden=false;this.events={};
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
 discovery:{version:'arcy-discovery-1',score,weightCoverage:.85,
  reason:'new pool (2 d); 24h volume $55k; liquidity $40k; 128 trades; independently cross-verified',
  flags:[]}
});
const data=(network,{engine='arcy-radar-v3',score=72.5,empty=false}={})=>({
 ok:true,version:2,network,engine,chainId:{arc:5042,ethereum:1,robinhood:4663,pons:4663}[network],
 asOf:'2026-10-30T11:00:00.000Z',freshness:'FRESH',coverage:{poolsInspected:20},
 discovery:engine==='arcy-radar-v3'?{scoreVersion:'arcy-discovery-1'}:undefined,
 tokens:empty?[]:[token(score)],attribution:[]
});
async function mount(){
 const detail=new Node('section');detail.id='tokenDetail';const calls=[];
 const document={
  createElement:tag=>new Node(tag),
  createTextNode:s=>new Text(s),
  getElementById:id=>id==='tokenDetail'?detail:null
 };
 const responses={robinhood:data('robinhood'),arc:data('arc',{engine:'arcy-radar-v2'}),ethereum:data('ethereum',{score:105}),pons:data('pons',{empty:true})};
 const ctx={document,Intl,Date,URL,AbortController,setTimeout,clearTimeout,
  window:{scrollY:0,scrollTo(){}},
  fetch:async url=>{const network=new URL(url,'https://example.com').searchParams.get('chain');calls.push(network);return {ok:true,json:async()=>responses[network]};}
 };
 vm.runInNewContext(js,ctx);
 // Wait for all four immediate fetches, JSON reads and Promise.all() callback.
 for(let i=0;i<5;i++)await Promise.resolve();
 return {detail,calls};
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
test('V2 or invalid V3 data renders NOT VERIFIED, not a fabricated score',async()=>{
 const {detail}=await mount();
 const arc=panel(detail,'arc'),eth=panel(detail,'ethereum');
 assert.match(arc.querySelector('.arcy-radar-overview-score').textContent,/NOT VERIFIED/);
 assert.equal(arc.querySelector('.arcy-radar-discovery-note').hidden,true);
 assert.match(eth.querySelector('.arcy-radar-overview-reason').textContent,/NOT VERIFIED/);
 assert.match(eth.querySelector('.arcy-radar-overview-score').textContent,/NOT VERIFIED/);
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
test('responsive mobile slots and truthful copy are present',()=>{
 assert.match(css,/grid-template-areas:\s*"token token score"\s*"price change volume"\s*"reason reason reason"/);
 assert.match(css,/@media\(max-width:390px\)/);
 assert.match(css,/\.arcy-radar-overview-columns\{display:none!important\}/);
 assert.match(js,/discovery\.reason|explainDiscovery\(d\.reason\)/);
 assert.doesNotMatch(js,/Math\.random\(/);
});
