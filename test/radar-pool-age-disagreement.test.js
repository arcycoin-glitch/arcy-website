'use strict';
// Arc Radar coverage: two providers that place the SAME exact pool more than 24h in the past establish the full-window
// maturity requirement even when they disagree on WHICH old date is correct. Production evidence (2026-11-08, CI probe):
// TOLLY / ARGUS pools reported by GeckoTerminal at 2026-09-14 and by DEX Screener at 2026-08-02 / 2026-09-02 were dropped as
// POOL_AGE_SOURCES_DISAGREE although both dates are 50+ days old. A disagreement whose NEWER date is under 24h, or with no
// newer date at all, still blocks promotion; the field itself stays NOT_VERIFIED and freshness still uses the older date.
const {test,beforeEach}=require('node:test'),assert=require('node:assert/strict');
const radar=require('../lib/radar-v2'),sources=require('../lib/radar-v2/sources'),http=require('../lib/radar-v2/http'),D=require('../lib/radar-v2/discovery');
const addr=i=>'0x'+i.toString(16).padStart(40,'0');
const T0=Date.UTC(2026,10,8,12,0,0),DAY=86400000;
const ENV={MARKET_RADAR_PUBLIC_DISPLAY_APPROVED:'true',MARKET_RADAR_JSON_DELIVERY_APPROVED:'true',COINGECKO_DEMO_API_KEY:'demo-key-not-real',VERCEL:'1',DEXSCREENER_PUBLIC_DISPLAY_APPROVED:'true'};
beforeEach(()=>{http._resetCooldowns();radar._cache.clear();});

test('strict maturity: disagreement blocks only when the newer observation is missing or under 24h',()=>{
 const base={poolCreatedAt:new Date(T0-98*DAY).toISOString(),poolAgeBasis:'SOURCES_DISAGREE_OLDER_USED'};
 assert.equal(D.rankingMaturityIssue({...base,poolAgeNewestIso:new Date(T0-55*DAY).toISOString()},T0,{strict:true}),null);
 assert.equal(D.rankingMaturityIssue({...base,poolAgeNewestIso:new Date(T0-1*DAY).toISOString()},T0,{strict:true}),null,'exactly 24h is a full window');
 assert.equal(D.rankingMaturityIssue({...base,poolAgeNewestIso:new Date(T0-3*3600000).toISOString()},T0,{strict:true})?.reason,'POOL_AGE_SOURCES_DISAGREE');
 assert.equal(D.rankingMaturityIssue({...base,poolAgeNewestIso:null},T0,{strict:true})?.reason,'POOL_AGE_SOURCES_DISAGREE');
 assert.equal(D.rankingMaturityIssue(base,T0,{strict:true})?.reason,'POOL_AGE_SOURCES_DISAGREE','no newer date: unchanged behaviour');
 assert.equal(D.rankingMaturityIssue({...base,poolAgeNewestIso:'junk'},T0,{strict:true})?.reason,'POOL_AGE_SOURCES_DISAGREE');
 // Non-strict (first pass) and the under-24h / unknown-age rules are untouched.
 assert.equal(D.rankingMaturityIssue({poolCreatedAt:new Date(T0-3600000).toISOString()},T0)?.reason,'POOL_UNDER_24H');
 assert.equal(D.rankingMaturityIssue({poolCreatedAt:null},T0)?.reason,'POOL_AGE_NOT_VERIFIED');
});

// Gecko pages: three tokens, each with ONE pool. created = GeckoTerminal date; dsCreated = DEX Screener date for the SAME pool.
const TOKENS=[
 {i:1,created:T0-55*DAY,dsCreated:T0-98*DAY},   // both old, disagree -> eligible
 {i:2,created:T0-30*DAY,dsCreated:T0-3*3600000}, // newer observation 3h old -> still excluded
 {i:3,created:T0-20*DAY,dsCreated:T0-20*DAY}     // agree -> eligible (control)
];
function pages(){
 const id=sources.NETWORKS.arc.gecko,included=[],data=[];
 for(const t of TOKENS){
  const a=addr(t.i),tid=id+'_'+a,pool=addr(5000+t.i);
  included.push({id:tid,type:'token',attributes:{address:a,name:'Token'+t.i,symbol:'T'+t.i}});
  data.push({id:id+'_'+pool,type:'pool',attributes:{address:pool,pool_created_at:new Date(t.created).toISOString(),base_token_price_usd:'0.002',reserve_in_usd:'300000',fdv_usd:'2000000',volume_usd:{h24:String(200000-t.i)},price_change_percentage:{h24:'4'},transactions:{h24:{buys:120,sells:110}}},
   relationships:{base_token:{data:{id:tid,type:'token'}},quote_token:{data:{id:id+'_'+addr(900),type:'token'}},dex:{data:{id:'dex-arc',type:'dex'}}}});
 }
 included.push({id:id+'_'+addr(900),type:'token',attributes:{address:addr(900),name:'Quote',symbol:'QT'}},{id:'dex-arc',type:'dex',attributes:{name:'Dex'}});
 return {data,included};
}
const dex=()=>TOKENS.map(t=>({chainId:'arc',dexId:'dex',url:'https://dexscreener.com/arc/'+addr(5000+t.i),pairAddress:addr(5000+t.i),baseToken:{address:addr(t.i),symbol:'T'+t.i},quoteToken:{address:addr(900),symbol:'QT'},
 priceUsd:'0.002',volume:{h24:200000-t.i},liquidity:{usd:300000},priceChange:{h24:4},fdv:2000000,pairCreatedAt:t.dsCreated}));
const resp=b=>({ok:true,status:200,headers:new Headers(),text:async()=>JSON.stringify(b)});
function fetcher(){const calls=[];const f=async url=>{calls.push(url);if(/dexscreener/.test(url))return resp(dex());if(/tokens\/multi/.test(url))return resp({data:[]});if(/trending_pools|\/pools\?/.test(url))return resp(pages());throw new Error('unrouted '+url);};f.calls=calls;return f;}

test('Arc build ranks a same-pool disagreement when both dates are older than 24h; a young newer date stays excluded',async()=>{
 const f=fetcher(),out=await radar.load('arc',{env:ENV,fetcher:f,now:()=>T0,disableCache:true});
 const ranked=out.tokens.map(t=>t.address);
 assert.ok(ranked.includes(addr(1)),'old/old disagreement is eligible: '+JSON.stringify(out.excluded));
 assert.ok(ranked.includes(addr(3)),'agreeing control stays eligible');
 assert.ok(!ranked.includes(addr(2)),'newer observation under 24h is not promoted');
 const ex=out.excluded.find(x=>x.address===addr(2));
 assert.equal(ex.reason,'INELIGIBLE_AFTER_VERIFICATION');assert.match(ex.detail,/POOL_AGE_SOURCES_DISAGREE/);
 const t1=out.tokens.find(t=>t.address===addr(1));
 // Nothing is invented: the creation date is still NOT_VERIFIED (shown as N/A), and freshness uses the OLDER date.
 assert.equal(t1.poolCreatedAt,null);assert.equal(t1.fields.poolCreatedAt.status,'NOT_VERIFIED');assert.equal(t1.fields.poolCreatedAt.reasonCode,'SOURCES_DISAGREE');
 assert.equal(t1.discovery.poolAgeBasis,'SOURCES_DISAGREE_OLDER_USED');assert.equal(t1.discovery.poolAgeDays,98);
 assert.equal(t1.fields.priceUsd.status,'CROSS_VERIFIED');assert.equal(t1.fields.volume24hUsd.status,'CROSS_VERIFIED');assert.equal(t1.fields.liquidityUsd.status,'CROSS_VERIFIED');
 assert.equal(out.usage.geckoterminal,4,'no extra provider calls (3 pages + 1 token lookup)');assert.equal(out.usage.dexscreener,1);
});
