'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const addon=require('../search/radar-info-readable.js');

// Exercise the production optional addon against a controlled DOM.
// The byte-locked market-radar.js renderer is intentionally unchanged.
function mounted({lateOverview=false}={}){
 const timers=[],observers=[],clicks=[],listeners=new Map();
 let rootReady=!lateOverview;
 const cards=new Map();
 for(const id of ['arc','ethereum','robinhood','pons']){
  const button={disabled:false,textContent:'Yeniden Dene ↻',click(){clicks.push(id);}};
  const card={dataset:{overview:id},hidden:id!=='robinhood',
   querySelector(selector){return selector==='.arcy-radar-overview-action'?button:null;}};
  cards.set(id,{card,button});
 }
 const root={querySelectorAll(selector){
  assert.equal(selector,'[data-overview]');
  return Array.from(cards.values(),x=>x.card);
 }};
 const doc={
  visibilityState:'visible',defaultView:{
   MutationObserver:class{
    constructor(cb){this.cb=cb;this.connected=false;observers.push(this);}
    observe(target,options){
     this.connected=true;this.target=target;
     assert.equal(options.subtree,true);
     if(target===root){
      assert(options.attributeFilter.includes('disabled'));
      assert(options.attributeFilter.includes('hidden'));
     }else assert.equal(target,doc.documentElement,'late-init observer must watch DOM insertion only');
    }
    disconnect(){this.connected=false;}
   },
   setTimeout(fn,ms){const timer={fn,ms};timers.push(timer);return timer;}
  },
  documentElement:{},
  querySelector(selector){return selector==='.arcy-radar-overview'&&rootReady?root:null;},
  addEventListener(type,handler){const set=listeners.get(type)||new Set();set.add(handler);listeners.set(type,set);},
  removeEventListener(type,handler){listeners.get(type)?.delete(handler);},
  createElement(){throw Error('Information popover is not exercised by this suite');}
 };
 addon.install(doc);
 const notify=()=>observers.filter(o=>o.connected).forEach(o=>o.cb());
 const fire=type=>Array.from(listeners.get(type)||[]).forEach(cb=>cb());
 const mountOverview=()=>{rootReady=true;notify();};
 return {cards,doc,notify,fire,mountOverview,timers,clicks,listeners,observers};
}

test('one recovered network request only after previously observed cooldown expires',()=>{
 const x=mounted(),{card,button}=x.cards.get('robinhood');
 x.notify();
 assert.equal(x.timers.length,0,'an ordinary enabled manual control never auto-clicks');
 button.disabled=true;button.textContent='Kaynak bekleme süresinde';x.notify();
 button.disabled=false;button.textContent='Yeniden Dene ↻';x.notify();
 assert.equal(x.timers.length,1);
 assert.equal(x.timers[0].ms,4000,'Robinhood retry is staggered');
 assert.deepEqual(x.clicks,[]);
 x.timers[0].fn();
 assert.deepEqual(x.clicks,['robinhood']);
 button.disabled=true;button.textContent='Kaynak bekleme süresinde';x.notify();
 button.disabled=false;button.textContent='Yeniden Dene ↻';x.notify();
 assert.equal(x.timers.length,1,'subsequent rate limits do not schedule retry storms');
 assert.deepEqual(x.clicks,['robinhood']);
 assert.equal(card.hidden,false);
});

test('Pons cooldown recovers when its previously hidden card becomes visible',()=>{
 const x=mounted(),{card,button}=x.cards.get('pons');
 button.disabled=true;button.textContent='Kaynak bekleme süresinde';x.notify();
 button.disabled=false;button.textContent='Yeniden Dene ↻';x.notify();
 assert.equal(x.timers.length,0,'hidden network cards must not consume the retry quota');
 card.hidden=false;x.notify();
 assert.equal(x.timers.length,1);
 assert.equal(x.timers[0].ms,6000);
 x.timers[0].fn();
 assert.deepEqual(x.clicks,['pons']);
});

test('background tabs do not send an additional request until visible',()=>{
 const x=mounted(),{button}=x.cards.get('robinhood');
 button.disabled=true;button.textContent='Kaynak bekleme süresinde';x.notify();
 button.disabled=false;button.textContent='Yeniden Dene ↻';x.notify();
 x.doc.visibilityState='hidden';x.timers[0].fn();
 assert.deepEqual(x.clicks,[]);
 assert.equal(x.listeners.get('visibilitychange')?.size,1);
 x.doc.visibilityState='visible';x.fire('visibilitychange');
 assert.deepEqual(x.clicks,['robinhood']);
 assert.equal(x.listeners.get('visibilitychange')?.size,0);
});

test('bad or non-cooldown source states never trigger retries or false data',()=>{
 const x=mounted(),{button}=x.cards.get('robinhood');
 button.disabled=true;button.textContent='KONTROL EDİLİYOR';x.notify();
 button.disabled=false;button.textContent='Yeniden Dene ↻';x.notify();
 assert.equal(x.timers.length,0);
 button.disabled=true;button.textContent='Kaynak bekleme süresinde';x.notify();
 button.disabled=false;button.textContent='Bu pencerede liste boş';x.notify();
 assert.equal(x.timers.length,0);
 assert.deepEqual(x.clicks,[]);
});

test('async addon installs its observer after Radar overview mounts',()=>{
 const x=mounted({lateOverview:true});
 assert.equal(x.observers.length,2,'one root observer and one late mount watcher');
 assert.equal(x.observers.some(o=>o.connected&&o.target===x.doc.documentElement),true);
 x.mountOverview();
 assert.equal(x.observers.filter(o=>o.connected&&o.target===x.doc.documentElement).length,0,'bootstrap observer removed');
 assert.equal(x.observers.filter(o=>o.connected).length,1,'only Radar observer remains');
 const {button}=x.cards.get('robinhood');
 button.disabled=true;button.textContent='Kaynak bekleme süresinde';x.notify();
 button.disabled=false;button.textContent='Yeniden Dene ↻';x.notify();
 assert.equal(x.timers.length,1);
 x.timers[0].fn();
 assert.deepEqual(x.clicks,['robinhood']);
});

test('changing selected network while a retry is queued does not spend the only recovery',()=>{
 const x=mounted(),{card,button}=x.cards.get('robinhood');
 button.disabled=true;button.textContent='Kaynak bekleme süresinde';x.notify();
 button.disabled=false;button.textContent='Yeniden Dene ↻';x.notify();
 assert.equal(x.timers.length,1);
 card.hidden=true;x.notify();
 x.timers[0].fn();
 assert.deepEqual(x.clicks,[]);
 card.hidden=false;x.notify();
 assert.equal(x.timers.length,2);
 x.timers[1].fn();
 assert.deepEqual(x.clicks,['robinhood']);
});

test('manual refresh during pending cooldown recovery cancels extra automatic request',()=>{
 const x=mounted(),{button}=x.cards.get('robinhood');
 button.disabled=true;button.textContent='Kaynak bekleme süresinde';x.notify();
 button.disabled=false;button.textContent='Yeniden Dene ↻';x.notify();
 assert.equal(x.timers.length,1);
 button.disabled=true;button.textContent='Kontrol ediliyor…';x.notify();
 x.timers[0].fn();
 assert.deepEqual(x.clicks,[],'only the manually initiated fetch is allowed');
 button.disabled=false;button.textContent='Yeniden Dene ↻';x.notify();
 assert.equal(x.timers.length,1,'automatic attempt quota was consumed');
});
