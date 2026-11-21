'use strict';
// Owner-requested homepage-only order change: Token Unlocks above Buyback & Burn.
// Do not modify the pinned index.html, the two sections or their data engines.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const script=fs.readFileSync(path.join(__dirname,'../site-refresh.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');

function mount(ids){
 const children=[];
 const parent={
  children,
  insertBefore(node,anchor){
   if(!children.includes(node)||!children.includes(anchor))throw new Error('not siblings');
   children.splice(children.indexOf(node),1);
   children.splice(children.indexOf(anchor),0,node);
   calls.push([node.id,anchor.id]);
  }
 };
 const nodes=ids.map(id=>({id,parentElement:parent,get nextElementSibling(){
  return children[children.indexOf(this)+1]||null;
 }}));
 children.push(...nodes);
 const byId=Object.fromEntries(nodes.map(n=>[n.id,n]));
 const calls=[],listeners=[];
 const document={getElementById:id=>byId[id]||null,visibilityState:'hidden',
  addEventListener:(kind,fn)=>listeners.push(kind)};
 const window={addEventListener:(kind,fn)=>listeners.push(kind)};
 const ctx={document,window,setInterval:()=>1,Date,Promise};
 vm.runInNewContext(script,ctx);
 return {children,parent,nodes,byId,calls,window,listeners,ctx};
}

test('the original sections remain byte-identical in HTML and are anchored by stable IDs',()=>{
 const a=html.indexOf('<section id="burn">'),b=html.indexOf('<section id="unlocks">'),c=html.indexOf('<section id="buy">');
 assert.ok(a>=0&&a<b&&b<c,'original locked markup remains in original source order');
 assert.equal((html.match(/<section id="burn">/g)||[]).length,1);
 assert.equal((html.match(/<section id="unlocks">/g)||[]).length,1);
 assert.match(html,/id="burned"/);
 assert.match(html,/id="unlockRows"/);
 assert.match(html,/id="unlockPrev"/);
 assert.match(html,/id="unlockNext"/);
});

test('swap moves exactly the existing Unlocks section above Burn and never touches other sections',()=>{
 const m=mount(['search','burn','unlocks','buy']);
 assert.deepEqual(m.children.map(x=>x.id),['search','unlocks','burn','buy']);
 assert.deepEqual(m.calls,[['unlocks','burn']]);
 assert.equal(m.children[1],m.byId.unlocks,'original section object remains intact');
 assert.equal(m.children[2],m.byId.burn,'original Burn section is retained');
 assert.deepEqual(Object.keys(m.window.ARCY_AUTO_REFRESH.status()),['burn','market','unlocks'],'refresh data sources stay configured');
});

test('reordering is idempotent; a missing section leaves the page untouched',()=>{
 const m=mount(['search','burn','unlocks','buy']);
 vm.runInNewContext(script,m.ctx);
 assert.deepEqual(m.children.map(x=>x.id),['search','unlocks','burn','buy']);
 assert.equal(m.calls.length,1);
 const withoutBurn=mount(['search','unlocks','buy']);
 assert.equal(withoutBurn.calls.length,0);
 assert.deepEqual(withoutBurn.children.map(x=>x.id),['search','unlocks','buy']);
 const nonAdjacent=mount(['burn','search','unlocks','buy']);
 assert.equal(nonAdjacent.calls.length,0,'no unrelated section is moved');
});

test('swap does not issue requests, replace markup or modify unlock/burn loaders',()=>{
 assert.doesNotMatch(script,/innerHTML\s*=|outerHTML\s*=|\.remove\(\)|fetch\s*\(/);
 assert.match(script,/insertBefore\(unlockSection,burnSection\)/);
 assert.match(script,/key:'burn',fn:'loadBurn',interval:2\*60\*1000/);
 assert.match(script,/key:'unlocks',fn:'loadUnlocks',interval:10\*60\*1000/);
});
