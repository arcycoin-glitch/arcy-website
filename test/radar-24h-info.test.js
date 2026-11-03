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
 getBoundingClientRect(){return {top:0,bottom:10,left:0,width:14};}
 get offsetHeight(){return 40;}
 focus(){this.focused=true;}
 get style(){return this._style||(this._style={});}
 set style(v){}
 setAttribute(k,v){this.attrs[k]=String(v);}
 getAttribute(k){return this.attrs[k]||null;}
 removeAttribute(k){delete this.attrs[k];}
 addEventListener(name,fn){(this.events[name]||(this.events[name]=[])).push(fn);}
 click(){this.fire('click');}
 fire(name,extra={}){const e={type:name,key:extra.key,target:this,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;}};for(const f of this.events[name]||[])f(e);return e;}
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

const address='0x'+'b'.repeat(40);
const mk=(code,extra={})=>({rank:1,address,symbol:'YNG',name:'Young',priceUsd:1,change24hPct:null,volume24hUsd:5,
 fields:{priceUsd:{status:'SOURCE_REPORTED'},volume24hUsd:{status:'SOURCE_REPORTED',scope:'POOL'},change24hPct:{status:'NOT_VERIFIED',reasonCode:code,...extra}}});
const payload=tokens=>({ok:true,version:2,network:'robinhood',engine:'arcy-radar-v3',chainId:4663,asOf:'2026-10-30T11:00:00.000Z',freshness:'FRESH',coverage:{poolsInspected:1},discovery:{scoreVersion:'arcy-discovery-1'},tokens,attribution:[]});
async function mount(tokens){
 const detail=new Node('section');detail.id='tokenDetail';const body=new Node('body');const docListeners={};let calls=0;
 const document={createElement:t=>new Node(t),createTextNode:s=>new Text(s),getElementById:id=>id==='tokenDetail'?detail:null,body,documentElement:{clientWidth:390},
  addEventListener:(n,f)=>{(docListeners[n]||(docListeners[n]=[])).push(f);}};
 const ctx={document,Intl,Date,URL,AbortController,setTimeout,clearTimeout,window:{scrollY:0,innerHeight:800,scrollTo(){},addEventListener(){}},
  fetch:async()=>{calls++;return {ok:true,json:async()=>payload(tokens)};}};
 vm.runInNewContext(js,ctx);
 for(let i=0;i<5;i++)await Promise.resolve();
 return {detail,body,docListeners,calls:()=>calls};
}
const infoOf=d=>d.querySelector('[data-overview="robinhood"]').querySelector('.arcy-radar-info');
test('young pool: icon explains the partial window with the API poolAgeHours; no extra API call',async()=>{
 const {detail,calls}=await mount([mk('POOL_LESS_THAN_24H_OLD',{poolAgeHours:3.5})]);
 assert.equal(calls(),4);
 const i=infoOf(detail);
 assert.ok(i);assert.equal(i.getAttribute('role'),'button');assert.equal(i.tabIndex,0);
 assert.match(i.dataset.reason,/3\.5 saatlik/);assert.match(i.dataset.reason,/kısmi/);
 assert.match(i.getAttribute('aria-label'),/3\.5 saatlik/);
});
test('source disagreement and unavailable data get their own explanations; unknown code falls back',async()=>{
 for(const [code,re] of [['SOURCES_DISAGREE',/birbirini doğrulamıyor/],['SOURCE_24H_CHANGE_UNAVAILABLE',/Hiçbir kaynak/],['SOMETHING_NEW',/doğrulanamadı/]]){
  const {detail}=await mount([mk(code)]);
  assert.match(infoOf(detail).dataset.reason,re,code);
 }
});
test('verified 24h change shows no icon and keeps its value',async()=>{
 const t=mk('X');t.change24hPct=4.2;t.fields.change24hPct={status:'SOURCE_REPORTED'};
 const {detail}=await mount([t]);
 const p=detail.querySelector('[data-overview="robinhood"]');
 assert.equal(p.querySelector('.arcy-radar-info'),null);
 assert.match(p.querySelector('.arcy-radar-overview-change').textContent,/4/);
});
test('tap toggles, hover shows, keyboard Enter/Space toggles, Escape closes; click never navigates',async()=>{
 const {detail,body,docListeners}=await mount([mk('POOL_LESS_THAN_24H_OLD',{poolAgeHours:2})]);
 const i=infoOf(detail);
 i.fire('mouseenter');
 const pop=body.children[0];
 assert.equal(pop.hidden,false);assert.equal(pop.getAttribute('role'),'tooltip');assert.equal(i.getAttribute('aria-expanded'),'true');
 i.fire('mouseleave');assert.equal(pop.hidden,true);assert.equal(i.getAttribute('aria-expanded'),'false');
 const tap=i.fire('click');assert.equal(tap.defaultPrevented,true,'must not follow the surrounding link');assert.equal(pop.hidden,false);
 i.fire('mouseleave');assert.equal(pop.hidden,false,'tap-opened popup stays until dismissed');
 i.fire('click');assert.equal(pop.hidden,true);
 const k=i.fire('keydown',{key:'Enter'});assert.equal(k.defaultPrevented,true);assert.equal(pop.hidden,false);assert.equal(i.getAttribute('aria-describedby'),pop.id);
 for(const f of docListeners.keydown)f({key:'Escape'});
 assert.equal(pop.hidden,true);assert.equal(i.focused,true);
 i.fire('keydown',{key:' '});assert.equal(pop.hidden,false);
 for(const f of docListeners.click)f({target:new Node('div')});
 assert.equal(pop.hidden,true,'outside tap closes');
});
