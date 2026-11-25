'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const addon=require('../search/radar-info-readable.js');

// Exercise the production optional addon against a controlled DOM.
// The byte-locked market-radar.js renderer is intentionally unchanged.
function mounted(){
 const timers=[],observers=[],clicks=[],listeners=new Map();
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
    constructor(cb){observers.push(cb);}
    observe(target,options){
     assert.equal(target,root);
     assert.equal(options.subtree,true);
     assert(options.attributeFilter.includes('disabled'));
     assert(options.attributeFilter.includes('hidden'));
    }
   },
   setTimeout(fn,ms){const timer={fn,ms};timers.push(timer);return timer;}
  },
  querySelector(selector){return selector==='.arcy-radar-overview'?root:null;},
  addEventListener(type,handler){const set=listeners.get(type)||new Set();set.add(handler);listeners.set(type,set);},
  removeEventListener(type,handler){listeners.get(type)?.delete(handler);},
  createElement(){throw Error('Information popover is not exercised by this suite');}
 };
 addon.install(doc);
 const notify=()=>observers.forEach(cb=>cb());
 const fire=type=>Array.from(listeners.get(type)||[]).forEach(cb=>cb());
 return {cards,doc,notify,fire,timers,clicks,listeners,observers};
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
