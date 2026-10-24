const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../research/unlock-supply-lab.html'),'utf8');
const inline=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
const model=require('../ui-model');

function harness({burned='0',next='2099-02-01'}={}){
 const elements=Object.create(null),handlers=Object.create(null),urls=[];
 function el(id){return elements[id]||(elements[id]={textContent:'',value:'',disabled:false,className:'',addEventListener(event,fn){handlers[id+':'+event]=fn}});}
 const unknown={value:null,status:'NOT_VERIFIED',reasonCode:'COMPLETE_COVERAGE_REQUIRED'};
 const response={
 '/api/unlock':{ok:true,lockedSupply:unknown,unlockedSupply:unknown,verifiedBurned:burned===null?unknown:{value:burned,status:'ONCHAIN_VERIFIED',dataState:'DATA_FOUND',evidence:[{source:'Exact runtime proof'}]},nextUnlock:{date:next,status:'ONCHAIN_VERIFIED',amount:'250000',evidence:[{source:'Verified vesting contract'}],coverage:'SOURCE_SCOPED'},attempts:[{source:'Funded vesting getters',status:'ONCHAIN_VERIFIED'}]},
 '/api/supply':{ok:true,totalSupply:{amount:'1000000000'},burnAddressBalance:{amount:'20000000'}},
 '/api/mechanics':{ok:true,burnMechanism:{value:true,status:'DETECTED'},buybackAndBurn:{value:null,status:'NOT_VERIFIED'}}
 };
 const fetch=async url=>{urls.push(url);return {ok:true,json:async()=>response[url.split('?')[0]]}};
 vm.runInNewContext(inline,{window:{ARCYModel:model},document:{getElementById:el},fetch,console});
 el('token').value='0x'+'a'.repeat(40);
 return {el,handlers,urls};
}

test('isolated prototype has four indicators and parseable JavaScript',()=>{
 assert.ok(inline);
 assert.doesNotThrow(()=>new vm.Script(inline));
 assert.match(html,/PREVIEW ONLY/);
 for(const name of ['Locked Supply','Unlocked Supply','Verified Burned','Next Unlock'])assert.ok(html.includes(name));
 assert.match(html,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(html,/src="\/ui-model\.js"/);
});

test('data proof stays separate from burn-address custody and optional mechanics',async()=>{
 const h=harness();
 await h.handlers['lookup:submit']({preventDefault(){}});
 assert.equal(h.el('locked-value').textContent,'NOT VERIFIED');
 assert.equal(h.el('unlocked-value').textContent,'NOT VERIFIED');
 assert.equal(h.el('burned-value').textContent,'0');
 assert.equal(h.el('dead-holdings').textContent,'20M');
 assert.equal(h.el('total-supply').textContent,'1B');
 assert.equal(h.el('next-value').textContent,'2099-02-01');
 assert.match(h.el('next-status').textContent,/250K tokens/);
 assert.equal(h.urls.filter(x=>x.startsWith('/api/mechanics')).length,0);
});

test('no burn history cannot be manufactured from dead-address balances',async()=>{
 const h=harness({burned:null,next:null});
 await h.handlers['lookup:submit']({preventDefault(){}});
 assert.equal(h.el('burned-value').textContent,'NOT VERIFIED');
 assert.equal(h.el('dead-holdings').textContent,'20M');
 assert.equal(h.el('next-value').textContent,'NO SOURCE-REPORTED SCHEDULE');
});

test('invalid token address triggers zero requests',async()=>{
 const h=harness();h.el('token').value='POLL';
 await h.handlers['lookup:submit']({preventDefault(){}});
 assert.equal(h.urls.length,0);
 assert.match(h.el('status').textContent,/complete 0x/);
});
