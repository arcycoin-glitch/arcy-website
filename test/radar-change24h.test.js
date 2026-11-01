'use strict';
// Issue #115: 24h change must be parsed per exact pool, recovered only from the SAME pool/provider, and otherwise explained - never invented.
const {test,beforeEach}=require('node:test'),assert=require('node:assert/strict');
const radar=require('../lib/radar-v2'),sources=require('../lib/radar-v2/sources'),gecko=require('../lib/radar-v2/gecko'),verify=require('../lib/radar-v2/verify'),http=require('../lib/radar-v2/http');
const addr=i=>'0x'+i.toString(16).padStart(40,'0');
const T0=Date.UTC(2026,9,30,12,0,0);
const ENV={MARKET_RADAR_PUBLIC_DISPLAY_APPROVED:'true',MARKET_RADAR_JSON_DELIVERY_APPROVED:'true',COINGECKO_DEMO_API_KEY:'demo-key-not-real',VERCEL:'1'};
beforeEach(()=>{http._resetCooldowns();radar._cache.clear();});
function body(net,pools){ // pools: [{i,pool?,change,vol,created}] ; change===undefined => attribute absent
 const id=sources.NETWORKS[net].gecko,included=[],data=[];
 for(const p of pools){
  const a=addr(p.i),tid=id+'_'+a,pool=addr(p.pool||5000+p.i);
  included.push({id:tid,type:'token',attributes:{address:a,name:'Token'+p.i,symbol:'T'+p.i}});
  const attrs={address:pool,pool_created_at:new Date(p.created??T0-3*86400000).toISOString(),base_token_price_usd:'0.002',reserve_in_usd:'3000000',fdv_usd:'2000000',volume_usd:{h24:String(p.vol??2000000)}};
  if(p.pcp!==undefined)attrs.price_change_percentage=p.pcp;else if(p.change!==undefined)attrs.price_change_percentage={h1:'9',h6:'8',h24:p.change};
  data.push({id:id+'_'+pool,type:'pool',attributes:attrs,relationships:{base_token:{data:{id:tid,type:'token'}},quote_token:{data:{id:id+'_'+addr(900),type:'token'}},dex:{data:{id:'dex-'+id,type:'dex'}}}});
 }
 included.push({id:id+'_'+addr(900),type:'token',attributes:{address:addr(900),name:'Quote',symbol:'USDC'}},{id:'dex-'+id,type:'dex',attributes:{name:'Dex'}});
 return {data,included};
}
const resp=b=>({ok:true,status:200,headers:new Headers(),text:async()=>JSON.stringify(b)});
const row=(net,change,extra={})=>gecko.parse(body(net,[{i:1,change,...extra}]),net).rows[0];

test('parse: zero, negative, positive, numeric and string forms are kept exactly; null/absent/blank/junk stay null (never 0)',()=>{
 for(const net of Object.keys(sources.NETWORKS)){
  assert.equal(row(net,'0').change24hPct,0,net+' zero');
  assert.equal(row(net,'-19.114').change24hPct,-19.114,net+' negative');
  assert.equal(row(net,'250.5').change24hPct,250.5);
  assert.equal(row(net,-4.2).change24hPct,-4.2,'numeric');
  assert.equal(row(net,null).change24hPct,null,net+' null');
  assert.equal(row(net,undefined).change24hPct,null,net+' absent');
  assert.equal(row(net,'').change24hPct,null,'blank');
  assert.equal(row(net,'n/a').change24hPct,null,'junk');
  assert.equal(row(net,'1e12').change24hPct,null,'absurd');
  assert.equal(gecko.parse(body(net,[{i:1,pcp:{h1:'3',h6:'4'}}]),net).rows[0].change24hPct,null,'h1/h6 without h24 is never promoted');
 }
});
test('verify: absent -> explained, never 0; young pool gets its own reason; conflict stays SOURCES_DISAGREE',()=>{
 const old=row('pons',undefined,{created:T0-5*86400000}),young=row('pons',undefined,{created:T0-3*3600000});
 let v=verify.verifyRow(old,{state:'DISABLED'},{now:T0}).fields.change24hPct;
 assert.equal(v.status,'NOT_VERIFIED');assert.equal(v.value,null);assert.equal(v.reasonCode,'SOURCE_24H_CHANGE_UNAVAILABLE');assert.match(v.reason,/tahmin edilmez/);
 v=verify.verifyRow(young,{state:'DISABLED'},{now:T0}).fields.change24hPct;
 assert.equal(v.reasonCode,'POOL_LESS_THAN_24H_OLD');assert.equal(v.poolAgeHours,3);assert.match(v.reason,/24 saatten yeni/);
 const g=row('pons','10'),ds={state:'MATCHED',matched:{},values:{change24hPct:-30,priceUsd:null,marketCapUsd:null,fdvUsd:null,volume24hUsd:null,liquidityUsd:null,poolCreatedAt:null},pair:{},pairCount:1,complete:true};
 const c=verify.verifyRow({...g,pool:g.pool},ds,{now:T0}).fields.change24hPct;
 assert.equal(c.status,'NOT_VERIFIED');assert.equal(c.reasonCode,'SOURCES_DISAGREE');assert.ok(c.reason);
 assert.equal(verify.verifyRow(row('pons','0'),{state:'DISABLED'},{now:T0}).fields.change24hPct.value,0,'a real 0% is a value');
});
function routerFor(net,{top,trending,news}){
 const calls=[];
 const f=async(url)=>{calls.push(url);
  if(/tokens\/multi/.test(url))return resp({data:[]});
  if(/new_pools/.test(url))return resp(news);if(/trending_pools/.test(url))return resp(trending);if(/\/pools\?/.test(url))return resp(top);
  throw new Error('unrouted '+url);};f.calls=calls;return f;
}
test('same exact pool listed by another channel supplies a missing h24 (no extra API call); other pools never do',async()=>{
 const mk=(chg,vol,pool)=>body('arc',Array.from({length:10},(_,k)=>({i:k+1,pool:k===0?pool:undefined,change:k===0?chg:'5',vol:k===0?vol:1000000-k})));
 // top channel: highest volume row for token 1 omits h24; new channel lists the SAME pool with a value
 const top=mk(undefined,9e6,7001),news=mk('-12.5',1e6,7001),trending=mk(undefined,1e6,7001);
 const f=routerFor('arc',{top,trending,news});
 const out=await radar.load('arc',{env:ENV,fetcher:f,now:()=>T0,disableCache:true});
 const t=out.tokens.find(x=>x.address===addr(1));
 assert.ok(t,'token present '+JSON.stringify(out.tokens.map(x=>x.address.slice(-2)))+JSON.stringify(out.excluded&&out.excluded.slice(0,3)));assert.equal(t.change24hPct,-12.5);assert.equal(t.fields.change24hPct.status,'SOURCE_REPORTED');
 assert.equal(t.fields.change24hPct.recovery.from,'new');assert.equal(t.fields.change24hPct.recovery.pool,addr(7001));
 assert.equal(f.calls.length,4,'3 pool pages + 1 token lookup: recovery costs no extra provider call');
 // different pool in the other channel must NOT be borrowed
 const f2=routerFor('arc',{top,trending,news:mk('-12.5',1e6,7002)});radar._cache.clear();
 const t2=(await radar.load('arc',{env:ENV,fetcher:f2,now:()=>T0,disableCache:true})).tokens.find(x=>x.address===addr(1));
 assert.equal(t2.change24hPct,null);assert.equal(t2.fields.change24hPct.status,'NOT_VERIFIED');assert.equal(t2.fields.change24hPct.reasonCode,'SOURCE_24H_CHANGE_UNAVAILABLE');
});

test('tokens/multi include=top_pools: pool-level h24 kept per exact pool; foreign/mismatched/junk entries ignored; plain call has no include',async()=>{
 const net='pons',id=sources.NETWORKS.robinhood.gecko,a=addr(77),pool=addr(8001),other=addr(8002);
 const mk=(pid,addrv,h24)=>({id:id+'_'+pid,type:'pool',attributes:{address:addrv,price_change_percentage:{h24}}});
 const bodyMulti={data:[{id:id+'_'+a,type:'token',relationships:{top_pools:{data:[{id:id+'_'+pool,type:'pool'}]}},attributes:{address:a,symbol:'X',name:'X',price_usd:'1',total_reserve_in_usd:'5',volume_usd:{h24:'9'}}}],
  included:[mk(pool,pool,'-3.5'),mk(other,other,'oops'),mk(addr(8003),addr(8004),'9'),{id:'x',type:'dex',attributes:{}}]};
 const urls=[];const fetcher=async u=>{urls.push(u);return resp(bodyMulti);};
 const withInc=await gecko.fetchMulti({host:'https://h',header:null,key:null},net,[a],{fetcher,now:()=>T0,includePools:true});
 assert.match(urls[0],/\?include=top_pools$/);
 const m=withInc.get(a).poolChange24h;assert.equal(m.get(pool),-3.5);assert.deepEqual(withInc.get(a).topPools,[pool]);assert.equal(m.has(other),false,'junk value ignored');assert.equal(m.has(addr(8004)),false,'id/address mismatch ignored');
 http._resetCooldowns();
 const plain=await gecko.fetchMulti({host:'https://h',header:null,key:null},net,[a],{fetcher,now:()=>T0});
 assert.ok(!/include/.test(urls[1]));assert.equal(plain.get(a).poolChange24h,undefined);
});

// ---- Robinhood: same-pool recovery from the token lookup's included pools (PR #123) ----
function multiBody(net,tokens){ // tokens: [{i,pools:[{pool,h24}]}]
 const id=sources.NETWORKS[net].gecko,data=[],included=[];
 for(const t of tokens){
  const a=addr(t.i);
  data.push({id:id+'_'+a,type:'token',attributes:{address:a,symbol:'T'+t.i,name:'Token'+t.i,price_usd:'0.002',total_reserve_in_usd:'3000000',volume_usd:{h24:'2000000'}},
   relationships:{top_pools:{data:t.pools.map(p=>({id:id+'_'+addr(p.pool),type:'pool'}))}}});
  for(const p of t.pools)included.push({id:id+'_'+addr(p.pool),type:'pool',attributes:{address:addr(p.pool),...(p.h24===undefined?{}:{price_change_percentage:{h24:p.h24}})}});
 }
 return {data,included};
}
function rhRouter(net,{top,multi}){
 const calls=[];
 const f=async url=>{calls.push(url);
  if(/tokens\/multi/.test(url))return resp(multi);
  if(/new_pools|trending_pools|\/pools\?/.test(url))return resp(top);
  throw new Error('unrouted '+url);};f.calls=calls;return f;
}
const gt=f=>f.calls.filter(u=>/\/api\/v3\/onchain\//.test(u));
const pools10=(net,first)=>body(net,Array.from({length:10},(_,k)=>({i:k+1,pool:5000+k+1,change:k===0?first:'5',vol:2000000-k})));
const loadRow=async(net,fetcher,i=1)=>{radar._cache.clear();http._resetCooldowns();return (await radar.load(net,{env:ENV,fetcher,now:()=>T0,disableCache:true})).tokens.find(x=>x.address===addr(i))};
const multiFor=(net,h24,pool=5001)=>multiBody(net,[{i:1,pools:[{pool,h24}]},...Array.from({length:9},(_,k)=>({i:k+2,pools:[{pool:5000+k+2,h24:'5'}]}))]);

test('Robinhood: a missing pool-level h24 is recovered from the SAME exact pool in the token lookup, at no extra provider request',async()=>{
 const f=rhRouter('robinhood',{top:pools10('robinhood',undefined),multi:multiFor('robinhood','-13.25')});
 const t=await loadRow('robinhood',f);
 assert.ok(t);assert.equal(t.change24hPct,-13.25);assert.equal(t.fields.change24hPct.status,'SOURCE_REPORTED');
 assert.equal(t.fields.change24hPct.recovery.from,'tokens/multi include=top_pools');assert.equal(t.fields.change24hPct.recovery.pool,addr(5001));
 const multi=gt(f).filter(u=>/tokens\/multi/.test(u));
 assert.equal(multi.length,1,'exactly one token lookup');assert.match(multi[0],/include=top_pools/);
 assert.equal(gt(f).length,4,'3 pool pages + 1 token lookup: same GeckoTerminal request count as without the include');
});
test('Robinhood: wrong pool is never borrowed; exactly 0% is kept as 0; absent stays NOT_VERIFIED with its reason',async()=>{
 const top=pools10('robinhood',undefined);
 let t=await loadRow('robinhood',rhRouter('robinhood',{top,multi:multiFor('robinhood','42',9999)})); // value belongs to ANOTHER pool
 assert.equal(t.change24hPct,null);assert.equal(t.fields.change24hPct.status,'NOT_VERIFIED');assert.equal(t.fields.change24hPct.reasonCode,'SOURCE_24H_CHANGE_UNAVAILABLE');
 t=await loadRow('robinhood',rhRouter('robinhood',{top,multi:multiFor('robinhood','0')}));
 assert.strictEqual(t.change24hPct,0);assert.equal(t.fields.change24hPct.status,'SOURCE_REPORTED');
 t=await loadRow('robinhood',rhRouter('robinhood',{top,multi:multiFor('robinhood',undefined)}));
 assert.equal(t.change24hPct,null);assert.equal(t.fields.change24hPct.reasonCode,'SOURCE_24H_CHANGE_UNAVAILABLE');
});
test('Robinhood: a pool younger than 24 h keeps its own reason and is never filled from a shorter window',async()=>{
 const top=body('robinhood',Array.from({length:10},(_,k)=>({i:k+1,pool:5000+k+1,change:k===0?undefined:'5',pcp:k===0?{h1:'9',h6:'8'}:undefined,created:k===0?T0-3*3600000:undefined,vol:2000000-k})));
 const t=await loadRow('robinhood',rhRouter('robinhood',{top,multi:multiFor('robinhood',undefined)}));
 assert.equal(t.change24hPct,null);assert.equal(t.fields.change24hPct.reasonCode,'POOL_LESS_THAN_24H_OLD');
});
test('request shape: no missing value => plain token lookup (no include) on Robinhood; Arc and Ethereum never request the include',async()=>{
 let f=rhRouter('robinhood',{top:pools10('robinhood','7'),multi:multiFor('robinhood','7')});
 await loadRow('robinhood',f);
 assert.ok(gt(f).filter(u=>/tokens\/multi/.test(u)).every(u=>!/include/.test(u)));
 for(const net of ['arc','ethereum']){
  f=rhRouter(net,{top:pools10(net,undefined),multi:multiFor(net,'-1')});
  await loadRow(net,f);
  assert.ok(gt(f).filter(u=>/tokens\/multi/.test(u)).every(u=>!/include/.test(u)),net+' unchanged');
 }
});
test('verify: two sources that disagree on a Robinhood pool stay NOT_VERIFIED (tolerance is not widened; no value is forced)',()=>{
 const ds=c=>({state:'MATCHED',matched:{},values:{change24hPct:c,priceUsd:null,marketCapUsd:null,fdvUsd:null,volume24hUsd:null,liquidityUsd:null,poolCreatedAt:null},pair:{},pairCount:1,complete:true});
 let f=verify.verifyRow(row('robinhood','748.678'),ds(609),{now:T0}).fields.change24hPct;
 assert.equal(f.status,'NOT_VERIFIED');assert.equal(f.reasonCode,'SOURCES_DISAGREE');assert.equal(f.value,null);
 f=verify.verifyRow(row('robinhood','744.951'),ds(753),{now:T0}).fields.change24hPct; // 8.05 points apart: beyond the 3-point rule
 assert.equal(f.status,'NOT_VERIFIED');assert.equal(f.reasonCode,'SOURCES_DISAGREE');
 f=verify.verifyRow(row('robinhood','45.669'),ds(45.1),{now:T0}).fields.change24hPct;
 assert.notEqual(f.status,'NOT_VERIFIED');
 assert.equal(verify.TOLERANCE.change24hPct.abs,3);
});
