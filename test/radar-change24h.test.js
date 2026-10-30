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
