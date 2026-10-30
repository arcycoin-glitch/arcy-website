'use strict';
const {test,beforeEach}=require('node:test'),assert=require('node:assert/strict');
const radar=require('../lib/radar-v2'),sources=require('../lib/radar-v2/sources'),gecko=require('../lib/radar-v2/gecko'),dexs=require('../lib/radar-v2/dexscreener'),verify=require('../lib/radar-v2/verify'),pons=require('../lib/radar-v2/pons'),http=require('../lib/radar-v2/http');
const addr=i=>'0x'+i.toString(16).padStart(40,'0'),pad=i=>'0x'+BigInt(i).toString(16).padStart(64,'0');
const APPROVED={MARKET_RADAR_PUBLIC_DISPLAY_APPROVED:'true',MARKET_RADAR_JSON_DELIVERY_APPROVED:'true'};
const DEMO={...APPROVED,COINGECKO_DEMO_API_KEY:'demo-key-not-real',VERCEL:'1'};
const T0=Date.UTC(2026,9,30,12,0,0);
beforeEach(()=>{http._resetCooldowns();radar._cache.clear();});

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────────
function geckoBody(net,{count=14,start=1,volume=i=>2000000-i*1000,created=i=>new Date(T0-i*60000).toISOString(),dup=false}={}){
 const id=sources.NETWORKS[net].gecko,included=[],data=[];
 for(let i=0;i<count;i++){
  const a=addr(dup?Math.floor(i/2)+start:i+start),tokenId=id+'_'+a,pool=addr(5000+i);
  included.push({id:tokenId,type:'token',attributes:{address:a,name:'Token '+i,symbol:'T'+i,image_url:i%5===4?'https://assets.geckoterminal.com/missing.png':'https://coin-images.coingecko.com/coins/images/'+(100+i)+'/large/t'+i+'.png',coingecko_coin_id:'coin-'+i}});
  data.push({id:id+'_'+pool,type:'pool',attributes:{address:pool,pool_created_at:created(i),base_token_price_usd:'0.002',reserve_in_usd:'3000000',fdv_usd:'2000000',market_cap_usd:null,volume_usd:{h24:String(volume(i))},price_change_percentage:{h24:'-3.2'},transactions:{h24:{buys:10,sells:7}}},
   relationships:{base_token:{data:{id:tokenId,type:'token'}},quote_token:{data:{id:id+'_'+addr(900),type:'token'}},dex:{data:{id:'uniswap-v4-'+id,type:'dex'}}}});
 }
 included.push({id:id+'_'+addr(900),type:'token',attributes:{address:addr(900),name:'Quote',symbol:'USDC'}},{id:'uniswap-v4-'+id,type:'dex',attributes:{name:'Uniswap V4'}});
 return {data,included};
}
function dexBody(net,body,{price='0.00205',vol=undefined,liq='2900000',chg=-3.0,created=undefined,chain=undefined}={}){
 return body.data.map((p,i)=>({chainId:chain||sources.NETWORKS[net].dex,dexId:'uniswap',url:'https://dexscreener.com/'+net+'/'+p.attributes.address,pairAddress:p.attributes.address,
  baseToken:{address:p.relationships.base_token.data.id.split('_')[1],symbol:'T'+i},quoteToken:{address:addr(900),symbol:'USDC'},priceUsd:price,volume:{h24:vol??Number(p.attributes.volume_usd.h24)*1.05},liquidity:{usd:Number(liq)},priceChange:{h24:chg},fdv:2100000,pairCreatedAt:created??Date.parse(p.attributes.pool_created_at)+60000}));
}
function multiBody(net,body,{mc=false,liq='3000000',price='0.002'}={}){
 const id=sources.NETWORKS[net].gecko,seen=new Set(),data=[];
 for(const p of body.data){const t=body.included.find(x=>x.id===p.relationships.base_token.data.id),a=t.attributes.address;if(seen.has(a))continue;seen.add(a);
  data.push({id:id+'_'+a,type:'token',attributes:{address:a,name:t.attributes.name,symbol:t.attributes.symbol,image_url:t.attributes.image_url,coingecko_coin_id:t.attributes.coingecko_coin_id,price_usd:price,fdv_usd:'2000000',market_cap_usd:mc?'1800000':null,total_reserve_in_usd:liq,normalized_total_supply:'1000000000',volume_usd:{h24:p.attributes.volume_usd.h24}}});}
 return {data};
}
const CG=(net,body,o)=>[[/tokens\/multi/,()=>resp(multiBody(net,body,o))],[/coingecko\.com/,()=>resp(body)]];
const resp=body=>({ok:true,status:200,headers:new Headers(),text:async()=>JSON.stringify(body)});
function router(routes){const calls=[];const f=async(url,opts={})=>{calls.push({url,opts});for(const [re,fn] of routes)if(re.test(url))return fn(url,opts);throw new Error('unrouted '+url);};f.calls=calls;return f;}
const parseBatch=opts=>JSON.parse(opts.body);

// ── policy / limits ───────────────────────────────────────────────────────────────────────────────────────
test('access policy fails closed: no key on Vercel = off; keyless only outside Vercel; Demo/Pro select the documented host+header',()=>{
 assert.equal(sources.geckoAccess({VERCEL:'1'}).mode,'off');
 const k=sources.geckoAccess({});assert.equal(k.mode,'keyless');assert.equal(k.host,'https://api.geckoterminal.com/api/v2');assert.equal(k.perMinute,5);assert.ok(k.ttlMs>=30*60*1000);
 const d=sources.geckoAccess({COINGECKO_DEMO_API_KEY:'x',VERCEL:'1'});assert.equal(d.mode,'demo');assert.equal(d.host,'https://api.coingecko.com/api/v3/onchain');assert.equal(d.header,'x-cg-demo-api-key');assert.ok(d.ttlMs>=60*60*1000);
 const p=sources.geckoAccess({COINGECKO_PRO_API_KEY:'x',COINGECKO_DEMO_API_KEY:'y',VERCEL:'1'});assert.equal(p.mode,'pro');assert.equal(p.header,'x-cg-pro-api-key');
 assert.equal(sources.geckoAccess({COINGECKO_DEMO_API_KEY:'x',RADAR_V2_TTL_MS:'1000'}).ttlMs,60*60*1000,'TTL cannot be configured below the Demo quota floor');
});
test('Demo plan quota arithmetic: default 60-minute cycle (13 calls: 9 pool pages + 4 token lookups) stays inside 10,000 credits/month; 55 minutes would not',()=>{
 const d=sources.demoBudget(60*60*1000);assert.equal(d.callsPerCycle,13);assert.equal(d.callsPerMonth,9360);assert.equal(d.within10k,true);
 assert.equal(sources.demoBudget(55*60*1000).within10k,false);assert.equal(sources.demoBudget(45*60*1000).within10k,false);assert.equal(sources.demoBudget(10*60*1000).within10k,false);
});
test('publication needs BOTH operator approvals in every environment; DEX Screener stays off on Vercel until its own approval',()=>{
 assert.equal(sources.publicationAllowed({}).ok,false);assert.equal(sources.publicationAllowed({MARKET_RADAR_PUBLIC_DISPLAY_APPROVED:'true'}).ok,false);assert.equal(sources.publicationAllowed(APPROVED).ok,true);
 assert.equal(sources.dexscreenerAllowed({VERCEL:'1'}),false);assert.equal(sources.dexscreenerAllowed({VERCEL:'1',DEXSCREENER_PUBLIC_DISPLAY_APPROVED:'true'}),true);assert.equal(sources.dexscreenerAllowed({}),true);
});
test('registry carries documented limits and attribution for every source',()=>{
 for(const s of Object.values(sources.SOURCES)){assert.ok(s.attribution.text&&s.attribution.url.startsWith('https://'));assert.ok(s.docs.startsWith('https://'));}
 assert.equal(sources.SOURCES.dexscreener.perMinute,300);assert.equal(sources.SOURCES.geckoterminal.access.keyless.perMinute,5);assert.equal(sources.SOURCES.geckoterminal.access.demo.monthlyCredits,10000);
 assert.equal(sources.NETWORKS.pons.chainId,4663,'pons is a launch platform on Robinhood Chain, not a fourth chain');
});

// ── GeckoTerminal parsing ─────────────────────────────────────────────────────────────────────────────────
test('gecko.parse keeps only exact-network, contract-matched base tokens and never repairs bad rows',()=>{
 const body=geckoBody('arc',{count:3});
 body.data[1].id='arc_'+addr(9999);                                   // pool id != pool address
 body.included[2].attributes.address=addr(77);                        // token stated address != id
 const {rows}=gecko.parse(body,'arc');
 assert.deepEqual(rows.map(r=>r.address),[addr(1)]);
 assert.equal(gecko.parse(geckoBody('arc',{count:2}),'ethereum').rows.length,0,'wrong network prefix is dropped');
 assert.throws(()=>gecko.parse({data:null},'arc'),/INVALID_PROVIDER_RESPONSE/);
 assert.throws(()=>gecko.parse({data:[],included:{}},'arc'),/INVALID_PROVIDER_RESPONSE/);
 const row=gecko.parse(geckoBody('robinhood',{count:1}),'robinhood').rows[0];
 assert.equal(row.marketCapUsd,null,'missing stays null, never 0');assert.equal(row.dex,'Uniswap V4');assert.equal(row.buys24h,10);assert.equal(row.fdvUsd,2000000);
});
test('rankTop uses each token\'s single highest-volume pool and never sums pools',()=>{
 const a=gecko.parse(geckoBody('arc',{count:12,dup:true}),'arc'),top=gecko.rankTop([a,a],10);
 assert.equal(new Set(top.tokens.map(t=>t.address)).size,top.tokens.length);assert.ok(top.tokens.length<=10);
 for(let i=1;i<top.tokens.length;i++)assert.ok(top.tokens[i-1].volume24hUsd>=top.tokens[i].volume24hUsd);
});

// ── DEX Screener parsing ──────────────────────────────────────────────────────────────────────────────────
test('dexscreener.parse drops other-chain pairs and malformed numbers',()=>{
 const body=geckoBody('arc',{count:2}),pairs=dexBody('arc',body);
 pairs.push({...pairs[0],chainId:'base'});pairs.push({...pairs[1],priceUsd:'abc',pairAddress:addr(1234)});
 const m=dexs.parse(pairs,'arc');
 assert.equal(m.get(addr(1)).length,1);const odd=m.get(addr(2)).find(p=>p.pair===addr(1234));assert.equal(odd.priceUsd,null);
 assert.throws(()=>dexs.parse({nope:1},'arc'),/INVALID_PROVIDER_RESPONSE/);
});

// ── verification semantics ────────────────────────────────────────────────────────────────────────────────
test('verify: agreement=CROSS_VERIFIED, one source=SOURCE_REPORTED, contradiction/missing=NOT_VERIFIED; FDV is never market cap',()=>{
 const gt={address:addr(1),pool:addr(5000),scopeVolume:'TOKEN',scopeLiquidity:'TOKEN',priceUsd:1,volume24hUsd:1000,liquidityUsd:500,change24hPct:5,fdvUsd:2000,marketCapUsd:null,poolCreatedAt:new Date(T0).toISOString()};
 const pairs=[{pair:addr(5000),token:addr(1),side:'base',priceUsd:1.02,volume24hUsd:600,liquidityUsd:900,change24hPct:6,fdvUsd:2050,marketCapUsd:null,pairCreatedAt:new Date(T0+1000).toISOString(),poolCreatedAt:new Date(T0+1000).toISOString(),logo:null},
  {pair:addr(5001),token:addr(1),side:'quote',priceUsd:null,volume24hUsd:450,liquidityUsd:null,change24hPct:null,fdvUsd:null,marketCapUsd:null,pairCreatedAt:null,logo:null}];
 const ds=verify.summarize(gt,pairs);
 assert.equal(ds.state,'MATCHED');
 const v=verify.verifyRow(gt,ds);
 assert.equal(v.fields.priceUsd.status,'CROSS_VERIFIED');
 assert.equal(v.fields.volume24hUsd.status,'CROSS_VERIFIED','token volume 1000 vs DEX Screener sum 600+450');
 assert.equal(v.fields.liquidityUsd.status,'SOURCE_REPORTED','a pair with unknown liquidity makes that sum incomplete, so it is not used');
 assert.equal(v.fields.fdvUsd.status,'CROSS_VERIFIED');assert.equal(v.fields.change24hPct.status,'CROSS_VERIFIED');
 assert.equal(v.fields.marketCapUsd.status,'NOT_VERIFIED');assert.equal(v.fields.marketCapUsd.reasonCode,'MARKET_CAP_NOT_PROVIDED');assert.equal(v.fields.marketCapUsd.value,null,'FDV is never shown as market cap');
 const mismatched=verify.verifyRow(gt,verify.summarize(gt,[{...pairs[0],pair:addr(7),volume24hUsd:1000,liquidityUsd:500}]));
 assert.equal(mismatched.fields.change24hPct.status,'SOURCE_REPORTED','change is pool-specific: a different pool is not a check');
 assert.equal(mismatched.fields.volume24hUsd.status,'CROSS_VERIFIED');
 const partial=verify.verifyRow({...gt,volume24hUsd:5000},verify.summarize({...gt,volume24hUsd:5000},pairs));
 assert.equal(partial.fields.volume24hUsd.status,'SOURCE_REPORTED','DEX Screener sees fewer pools than GeckoTerminal: partial coverage, not a contradiction');assert.equal(partial.fields.volume24hUsd.crossCheck,'PARTIAL_COVERAGE');assert.equal(partial.fields.volume24hUsd.value,5000);
 const above=verify.verifyRow({...gt,volume24hUsd:100},verify.summarize({...gt,volume24hUsd:100},pairs));
 assert.equal(above.fields.volume24hUsd.status,'NOT_VERIFIED','DEX Screener above the superset figure is a real contradiction');assert.equal(above.fields.volume24hUsd.reasonCode,'SOURCES_DISAGREE');
 const capped=verify.summarize(gt,Array.from({length:30},(_,i)=>({...pairs[0],pair:addr(9000+i)})));
 assert.equal(capped.values.volume24hUsd,null,'at DEX Screener\'s pair cap the sum is a lower bound and is not used');
 const solo=verify.verifyRow(gt,{state:'DISABLED'});
 assert.equal(solo.fields.priceUsd.status,'SOURCE_REPORTED');assert.equal(solo.fields.priceUsd.crossCheck,'DISABLED');
 assert.deepEqual(verify.summarize(gt,[]),{state:'NO_MATCH'});
 const gp={...gt,scopeVolume:'POOL',scopeLiquidity:'POOL'};
 const pool=verify.verifyRow(gp,verify.summarize(gp,pairs));
 assert.equal(pool.fields.volume24hUsd.scope,'POOL');assert.equal(pool.fields.volume24hUsd.status,'NOT_VERIFIED');assert.equal(pool.fields.volume24hUsd.reasonCode,'SOURCES_DISAGREE');
 assert.equal(verify.agree('change24hPct',1,4.5),false);assert.equal(verify.agree('priceUsd',0,0),true);assert.equal(verify.agree('priceUsd',null,1),false);
});

// ── orchestration: the three ranking sections ─────────────────────────────────────────────────────────────
for(const [net,chainId] of [['arc',5042],['ethereum',1],['robinhood',4663]]){
 test(net+': ranks 10 contract-bound tokens, cross-checks with DEX Screener, reports usage, no indexer calls',async()=>{
  const body=geckoBody(net,{count:14});
  const f=router([...CG(net,body),[/dexscreener\.com/,()=>resp(dexBody(net,body))]]);
  const out=await radar.load(net,{env:{...DEMO,VERCEL:undefined,DEXSCREENER_PUBLIC_DISPLAY_APPROVED:'true'},fetcher:f,now:()=>T0,disableCache:true});
  assert.equal(out.chainId,chainId);assert.equal(out.tokens.length,10);assert.equal(out.version,2);
  const gc=f.calls.filter(c=>/coingecko\.com|dexscreener\.com/.test(c.url));
  assert.equal(gc.length,5,'top + trending + new pages, one token-stats call, one batched cross-check call');
  assert.equal(gc[0].opts.headers['x-cg-demo-api-key'],'demo-key-not-real');
  assert.ok(gc[0].url.startsWith('https://api.coingecko.com/api/v3/onchain/networks/'+sources.NETWORKS[net].gecko+'/pools?page=1&sort=h24_volume_usd_desc'));
  assert.ok(gc[1].url.includes('/trending_pools?page=1&duration=24h'),'trending view');
  assert.ok(gc[2].url.includes('/new_pools?page=1'),'newest view');
  assert.ok(gc[3].url.includes('/tokens/multi/'),'token-level stats for the exact candidate contracts');
  assert.ok(gc[4].url.startsWith('https://api.dexscreener.com/tokens/v1/'+sources.NETWORKS[net].dex+'/'));
  assert.equal(out.usage.geckoterminal,4);assert.equal(out.usage.dexscreener,1);
  const t=out.tokens[0];
  assert.equal(t.fields.priceUsd.status,'CROSS_VERIFIED');assert.equal(t.fields.liquidityUsd.status,'CROSS_VERIFIED');assert.equal(t.fields.volume24hUsd.scope,'TOKEN');
  assert.equal(t.fields.marketCapUsd.status,'NOT_VERIFIED');assert.equal(t.marketCapUsd,null);assert.equal(t.fields.marketCapUsd.reasonCode,'MARKET_CAP_NOT_PROVIDED');assert.equal(t.fdvUsd,2000000,'FDV stays FDV');
  assert.ok(t.logo&&t.logo.url.startsWith('https://coin-images.coingecko.com/')&&t.logo.source==='GeckoTerminal');
  assert.ok(out.tokens.every(x=>!x.logo||x.logo.url.startsWith('https://')),'only https provider-CDN logos');
  assert.ok(out.coverage.logos<out.tokens.length&&out.coverage.logos>0,'tokens whose provider image is a "missing" placeholder get no logo');
  assert.ok(out.attribution.some(a=>/CoinGecko/.test(a.text))&&out.attribution.some(a=>/DEX Screener/.test(a.text)));
  assert.ok(out.coverage.fieldsCrossVerified>0&&out.coverage.fieldsNotVerified>0);
  assert.equal(out.sources.find(s=>s.id==='geckoterminal').monthly,10000);
  assert.match(out.selection,/Not whole-chain/);
 });
}
test('DEX Screener disabled on Vercel without approval: rows stay SOURCE_REPORTED and DEX Screener is never called',async()=>{
 const body=geckoBody('arc',{count:12});const f=router([...CG('arc',body)]);
 const out=await radar.load('arc',{env:DEMO,fetcher:f,now:()=>T0,disableCache:true});
 assert.equal(f.calls.length,4,'top + trending + new pages + token stats; DEX Screener is never called');assert.equal(out.coverage.crossCheckProvider,'DISABLED');
 assert.ok(out.tokens.every(t=>t.fields.priceUsd.status==='SOURCE_REPORTED'));
 assert.equal(out.sources.find(s=>s.id==='dexscreener').mode,'disabled-until-approved');assert.ok(!out.attribution.some(a=>/DEX Screener/.test(a.text)));
});
test('DEX Screener failure or wrong-chain answer degrades to SOURCE_REPORTED, never to invented agreement',async()=>{
 const body=geckoBody('arc',{count:12});
 const down=router([...CG('arc',body),[/dexscreener/,()=>({ok:false,status:503,headers:new Headers(),text:async()=>''})]]);
 const a=await radar.load('arc',{env:{...DEMO,VERCEL:undefined},fetcher:down,now:()=>T0,disableCache:true});
 assert.equal(a.coverage.crossCheckProvider,'RADAR_PROVIDER_HTTP_503');assert.ok(a.tokens.every(t=>t.fields.priceUsd.status==='SOURCE_REPORTED'&&t.fields.priceUsd.crossCheck==='UNAVAILABLE'));
 const wrong=router([...CG('arc',body),[/dexscreener/,()=>resp(dexBody('arc',body,{chain:'ethereum'}))]]);
 const b=await radar.load('arc',{env:{...DEMO,VERCEL:undefined},fetcher:wrong,now:()=>T0,disableCache:true});
 assert.ok(b.tokens.every(t=>t.verification.crossCheck==='NO_MATCH'&&t.fields.priceUsd.status==='SOURCE_REPORTED'));
});
test('a token whose providers contradict on price is NOT_VERIFIED, therefore ineligible for discovery and reported as excluded; others stay',async()=>{
 const body=geckoBody('arc',{count:12});
 const ds=dexBody('arc',body);ds[0].priceUsd='0.5';
 const f=router([...CG('arc',body),[/dexscreener/,()=>resp(ds)]]);
 const out=await radar.load('arc',{env:{...DEMO,VERCEL:undefined,DEXSCREENER_PUBLIC_DISPLAY_APPROVED:'true'},fetcher:f,now:()=>T0,disableCache:true});
 const bad=addr(1);
 assert.ok(!out.tokens.some(t=>t.address===bad),'a price the sources contradict is never ranked');
 const ex=out.excluded.find(x=>x.address===bad);assert.equal(ex.reason,'INELIGIBLE_AFTER_VERIFICATION');assert.match(ex.detail,/PRICE_NOT_VERIFIED/);
 assert.ok(out.tokens.length>=9&&out.tokens.every(t=>t.priceUsd!==null),'ranked tokens always carry a verified price');
});

// ── gates, errors, cache, rate limits ─────────────────────────────────────────────────────────────────────
test('no approval or no source key: provider is never contacted',async()=>{
 const f=router([]);
 await assert.rejects(radar.load('arc',{env:{COINGECKO_DEMO_API_KEY:'x',VERCEL:'1'},fetcher:f}),{code:'RADAR_NOT_CONFIGURED'});
 await assert.rejects(radar.load('arc',{env:{...APPROVED,VERCEL:'1'},fetcher:f}),{code:'RADAR_SOURCE_KEY_REQUIRED'});
 await assert.rejects(radar.load('bsc',{env:DEMO,fetcher:f}),{code:'RADAR_INVALID_NETWORK'});
 assert.equal(f.calls.length,0);
});
test('responses are cached for the tier TTL and concurrent loads coalesce into one upstream call',async()=>{
 const body=geckoBody('arc',{count:12});let n=0;const f=router([[/tokens\/multi/,()=>resp(multiBody('arc',body))],[/coingecko\.com/,(u)=>{if(/sort=h24_volume/.test(u))n++;return resp(body);}]]);
 const env={...DEMO};let now=T0;
 const [a,b]=await Promise.all([radar.load('arc',{env,fetcher:f,now:()=>now}),radar.load('arc',{env,fetcher:f,now:()=>now})]);
 assert.equal(n,1);assert.equal(a.tokens.length,b.tokens.length);
 now=T0+59*60000;await radar.load('arc',{env,fetcher:f,now:()=>now});assert.equal(n,1,'still cached at 59 min (Demo TTL 60)');
 now=T0+61*60000;await radar.load('arc',{env,fetcher:f,now:()=>now});assert.equal(n,2);
});
test('429 honours Retry-After, enters a cooldown with no further calls, and serves a bounded STALE result labelled as such',async()=>{
 const body=geckoBody('arc',{count:12});let mode='ok',n=0;
 const f=router([[/coingecko\.com/,(u)=>{n++;return mode==='ok'?resp(/tokens\/multi/.test(u)?multiBody('arc',body):body):{ok:false,status:429,headers:new Headers({'retry-after':'120'}),text:async()=>''};}]]);
 const env={...DEMO};let now=T0;
 await radar.load('arc',{env,fetcher:f,now:()=>now});
 mode='limited';now=T0+61*60000;
 const stale=await radar.load('arc',{env,fetcher:f,now:()=>now});
 assert.equal(stale.freshness,'STALE');assert.equal(stale.staleReason,'RADAR_PROVIDER_RATE_LIMITED');assert.equal(stale.asOf,new Date(T0).toISOString());
 const calls=n;now+=60000;await radar.load('arc',{env,fetcher:f,now:()=>now});assert.equal(n,calls,'cooldown: no request while the provider asked us to wait');
 now=T0+4*3600*1000;http._resetCooldowns();await assert.rejects(radar.load('arc',{env,fetcher:f,now:()=>now}),{code:'RADAR_PROVIDER_RATE_LIMITED'});
});
test('invalid JSON, oversize bodies, redirects and wrong shapes fail closed',async()=>{
 const env={...DEMO};
 await assert.rejects(radar.load('arc',{env,fetcher:router([[/./,()=>({ok:true,status:200,headers:new Headers(),text:async()=>'<html>'})]]),disableCache:true}),{code:'RADAR_PROVIDER_INVALID_JSON'});
 http._resetCooldowns();
 await assert.rejects(radar.load('arc',{env,fetcher:router([[/./,()=>resp({data:[],included:[]})]]),disableCache:true}),{code:'RADAR_NO_VERIFIED_TOKENS'});
 await assert.rejects(radar.load('arc',{env,fetcher:router([[/./,()=>({ok:true,status:200,headers:new Headers(),text:async()=>'x'.repeat(http.MAX_BYTES+1)})]]),disableCache:true}),{code:'RADAR_PROVIDER_RESPONSE_TOO_LARGE'});
 const seen=router([[/./,(u,o)=>resp(geckoBody('arc'))]]);await radar.load('arc',{env,fetcher:seen,disableCache:true});
 assert.equal(seen.calls[0].opts.redirect,'error');
});

// ── Pons Launch ───────────────────────────────────────────────────────────────────────────────────────────
function launchWord(token,{exists=true,deployer=addr(0xd0)}={}){
 const w=[pad(BigInt(token)),pad(BigInt(deployer)),pad(BigInt(sources.PONS.weth)),...Array.from({length:8},()=>pad(0)),pad(exists?1:0),pad(0)];
 return '0x'+w.map(x=>x.slice(2)).join('');
}
const gradWord='0x'+[pad(2n*10n**18n),pad(5n*10n**18n),pad(0)].map(x=>x.slice(2)).join('');
function rpcRouter({members=[],chainId=4663,fail=false}={}){
 return (u,o)=>{
  if(fail)return {ok:true,status:200,headers:new Headers(),text:async()=>'{"error":"x"}'};
  const batch=parseBatch(o);
  return resp(batch.map(c=>{
   if(c.method==='eth_chainId')return {jsonrpc:'2.0',id:c.id,result:'0x'+chainId.toString(16)};
   if(c.method==='eth_blockNumber')return {jsonrpc:'2.0',id:c.id,result:'0x5e0c4bd'};
   const {to,data}=c.params[0];const token='0x'+data.slice(-40);
   if(data.startsWith(pons.SEL.getLaunchedToken)){
    const ok=members.includes(token)&&to===sources.PONS.factories[0];
    return {jsonrpc:'2.0',id:c.id,result:ok?launchWord(token):'0x'+'0'.repeat(832)};
   }
   if(data.startsWith(pons.SEL.graduationStatus))return {jsonrpc:'2.0',id:c.id,result:gradWord};
   return {jsonrpc:'2.0',id:c.id,error:{code:-32601,message:'x'}};
  }));
 };
}
test('pons: only tokens confirmed by an official factory are listed, newest first, with onchain launch + graduation evidence',async()=>{
 const body=geckoBody('pons',{count:12});
 const members=[addr(2),addr(5),addr(9)];
 const f=router([...CG('pons',body),[/dexscreener/,()=>resp(dexBody('pons',body))],[/rpc\.example/,rpcRouter({members})]]);
 const out=await radar.load('pons',{env:{...DEMO,VERCEL:undefined,DEXSCREENER_PUBLIC_DISPLAY_APPROVED:'true'},fetcher:f,now:()=>T0,disableCache:true,rpcUrl:'https://rpc.example/'});
 assert.deepEqual(out.tokens.map(t=>t.address),members.map(String));
 assert.deepEqual(out.tokens.map(t=>t.rank),[1,2,3]);
 assert.equal(out.chainId,4663);assert.equal(out.network,'pons');
 const t=out.tokens[0];assert.equal(t.launch.status,'ONCHAIN_VERIFIED');assert.equal(t.launch.factory,sources.PONS.factories[0]);assert.equal(t.graduation.graduated,false);assert.equal(t.graduation.thresholdEth,5);
 assert.equal(t.fields.poolCreatedAt.status,'CROSS_VERIFIED');
 assert.equal(out.coverage.ponsChecked,12,'duplicate pools across the two provider windows collapse to unique tokens');assert.equal(out.coverage.ponsConfirmed,3);
 assert.match(out.selection,/Pons-launched tokens only/);
 assert.equal(f.calls.filter(c=>/rpc\.example/.test(c.url)).length,3,'12 candidates = two membership batches of <=10 (public RPC batch limit) + one graduation batch; no log scan');
 assert.ok(!f.calls.some(c=>/eth_getLogs/.test(String(c.opts.body))));
 assert.ok(out.sources.some(s=>s.id==='pons'));
});
test('pons: zero confirmed launches is an honest empty result; RPC trouble or wrong chain is an error, never unverified tokens',async()=>{
 const body=geckoBody('pons',{count:5});
 const env={...DEMO,VERCEL:undefined};
 const none=await radar.load('pons',{env,fetcher:router([[/coingecko/,()=>resp(body)],[/dexscreener/,()=>resp([])],[/rpc\.example/,rpcRouter({members:[]})]]),now:()=>T0,disableCache:true,rpcUrl:'https://rpc.example/'});
 assert.equal(none.tokens.length,0);assert.equal(none.coverage.ponsConfirmed,0);
 for(const opts of [{fail:true},{chainId:1}])
  await assert.rejects(radar.load('pons',{env,fetcher:router([[/coingecko/,()=>resp(body)],[/rpc\.example/,rpcRouter(opts)]]),now:()=>T0,disableCache:true,rpcUrl:'https://rpc.example/'}),{code:'RADAR_PONS_MEMBERSHIP_UNAVAILABLE'});
});
test('pons decoders reject malformed or non-existing launches',()=>{
 assert.equal(pons.decodeLaunch('0x'+'0'.repeat(832),addr(1)),null);
 assert.equal(pons.decodeLaunch(launchWord(addr(1),{exists:false}),addr(1)),null);
 assert.equal(pons.decodeLaunch(launchWord(addr(2)),addr(1)),null,'a different token returned by the factory is not a match');
 assert.ok(pons.decodeLaunch(launchWord(addr(1)),addr(1)));
 assert.equal(pons.decodeGraduation('0x12'),null);
 assert.equal(pons.SEL.getLaunchedToken.length,10);
});

// ── API handler ───────────────────────────────────────────────────────────────────────────────────────────
function call(handler,req,env){
 const saved={};for(const [k,v] of Object.entries(env)){saved[k]=process.env[k];if(v===undefined)delete process.env[k];else process.env[k]=v;}
 const out={headers:{},status:0,body:null};
 const res={setHeader(k,v){out.headers[k]=v;return this;},status(c){out.status=c;return this;},json(v){out.body=v;return this;}};
 return Promise.resolve(handler(req,res)).then(()=>out).finally(()=>{for(const [k,v] of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
}
test('API: fail-closed 503 without approvals; 400 for unknown chain; 405 for non-GET; four sections accepted',async()=>{
 const handler=require('../search/server/api/radar'),clean={MARKET_RADAR_PUBLIC_DISPLAY_APPROVED:undefined,MARKET_RADAR_JSON_DELIVERY_APPROVED:undefined,COINGECKO_DEMO_API_KEY:undefined,COINGECKO_PRO_API_KEY:undefined};
 let r=await call(handler,{method:'GET',query:{chain:'arc'}},clean);assert.equal(r.status,503);assert.equal(r.body.error,'RADAR_NOT_CONFIGURED');assert.equal(r.headers['Cache-Control'],'no-store');
 r=await call(handler,{method:'GET',query:{chain:'pons'}},clean);assert.equal(r.status,503);
 r=await call(handler,{method:'GET',query:{chain:'bsc'}},clean);assert.equal(r.status,400);
 r=await call(handler,{method:'POST',query:{chain:'arc'}},clean);assert.equal(r.status,405);
 const own={method:'GET',query:{chain:'arc'},headers:{'sec-fetch-site':'same-origin',host:'www.arcyusdc.xyz'}};
 r=await call(handler,own,{...clean,...APPROVED,VERCEL:'1'});assert.equal(r.status,503);assert.equal(r.body.error,'RADAR_SOURCE_KEY_REQUIRED');
 // approved but called from outside the ARCY page (curl, another site): not served as a public feed
 for(const headers of [{},{'sec-fetch-site':'cross-site'},{origin:'https://evil.example',host:'www.arcyusdc.xyz'}]){
  r=await call(handler,{method:'GET',query:{chain:'arc'},headers},{...clean,...APPROVED,VERCEL:'1',COINGECKO_DEMO_API_KEY:'k'});assert.equal(r.status,403);assert.equal(r.body.error,'RADAR_SITE_ONLY');assert.match(r.headers.Vary,/Sec-Fetch-Site/);
 }
 r=await call(handler,{method:'GET',query:{chain:'arc'},headers:{origin:'https://www.arcyusdc.xyz',host:'www.arcyusdc.xyz'}},{...clean,...APPROVED,VERCEL:'1'});assert.equal(r.status,503,'same-origin Origin header is accepted');
});

// ── UI contract (static) ─────────────────────────────────────────────────────────────────────────────────
test('UI: four sections, NOT VERIFIED rendered as N/A, text-only DOM, provider attribution links',()=>{
 const src=require('fs').readFileSync(require('path').join(__dirname,'../search/market-radar.js'),'utf8');
 for(const label of ["'Arc'","'Ethereum'","'Robinhood'","'Pons Launch'"])assert.ok(src.includes(label));
 assert.ok(src.includes("NV='N/A'")&&src.includes('NOT VERIFIED'));
 assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(src),'provider strings are only ever set as textContent');
 assert.ok(src.includes("rel='noopener noreferrer'")&&src.includes('body.attribution'));
 assert.ok(src.includes("pons:4663")&&src.includes("TOKEN_NET"));
 assert.ok(src.includes('translate=false')&&src.includes('Same ticker as another listed token')&&src.includes('Volume far above liquidity'));
 assert.ok(src.includes('native ETH'),'zero-address rows are not linked to a research page');
});

test('attribution follows the CoinGecko attribution guide and sits next to the data',async()=>{
 const body=geckoBody('arc',{count:12});const f=router([...CG('arc',body)]);
 const demo=await radar.load('arc',{env:DEMO,fetcher:f,now:()=>T0,disableCache:true});
 assert.deepEqual(demo.attribution[0],{text:'Powered by CoinGecko API',url:'https://www.coingecko.com/en/api'});
 http._resetCooldowns();
 const key=await radar.load('arc',{env:{...APPROVED},fetcher:router([[/geckoterminal\.com/,()=>resp(body)],[/dexscreener/,()=>resp([])]]),now:()=>T0,disableCache:true});
 assert.deepEqual(key.attribution[0],{text:'On-chain data provided by GeckoTerminal',url:'https://www.geckoterminal.com/'});
 const css=require('fs').readFileSync(require('path').join(__dirname,'../search/market-radar.css'),'utf8');
 assert.ok(/arcy-radar-credit\{font-size:1[2-9]px/.test(css),'credit text is at least 12px (terms: no smaller than 10)');
});

// ── logos, token-level stats, ranking, shared pages ──────────────────────────────────────────────────────
test('logo URLs: only https provider CDNs, never "missing" placeholders, never other hosts',()=>{
 const ok='https://coin-images.coingecko.com/coins/images/1/large/a.png?123';
 assert.equal(gecko.logoUrl(ok),ok);assert.equal(gecko.logoUrl('https://assets.geckoterminal.com/abc'),'https://assets.geckoterminal.com/abc');assert.ok(gecko.logoUrl('https://cdn.dexscreener.com/cms/images/x'));
 for(const bad of ['http://coin-images.coingecko.com/a.png','https://evil.example/a.png','https://coin-images.coingecko.com.evil.example/a.png','https://assets.geckoterminal.com/missing.png','javascript:alert(1)','https://user:pw@assets.geckoterminal.com/a','https://assets.geckoterminal.com/a b',null,42,'https://assets.geckoterminal.com/"onerror=x'])assert.equal(gecko.logoUrl(bad),null,String(bad));
});
test('tokens/multi is contract-keyed, strict, and never turns FDV into market cap',async()=>{
 const body=geckoBody('arc',{count:3});const m=multiBody('arc',body);
 m.data.push({id:'arc_'+addr(77),type:'token',attributes:{address:addr(78),price_usd:'1'}});          // id != stated address
 m.data.push({id:'arc_'+addr(900),type:'token',attributes:{address:addr(900),price_usd:'1'}});        // not requested
 const f=router([[/./,()=>resp(m)]]);
 const out=await gecko.fetchMulti({host:'https://api.coingecko.com/api/v3/onchain',key:'k',header:'x-cg-demo-api-key'},'arc',[addr(1),addr(2),addr(3),addr(77)],{fetcher:f,now:()=>T0});
 assert.deepEqual([...out.keys()].sort(),[addr(1),addr(2),addr(3)].sort());
 assert.equal(out.get(addr(1)).marketCapUsd,null);assert.equal(out.get(addr(1)).fdvUsd,2000000);
 assert.ok(f.calls[0].url.endsWith('/tokens/multi/'+[addr(1),addr(2),addr(3),addr(77)].join(',')));
 await assert.rejects(gecko.fetchMulti({host:'https://x',key:null},'arc',[addr(1)],{fetcher:router([[/./,()=>resp({data:'x'})]]),now:()=>T0}),/INVALID_PROVIDER_RESPONSE|RADAR_/);
});
test('ranking uses token-level 24h volume across all pools; each row says which scope it carries',async()=>{
 const body=geckoBody('arc',{count:14,volume:i=>200000-i*1000});
 const m=multiBody('arc',body);m.data.find(d=>d.attributes.address===addr(14)).attributes.volume_usd.h24='900000';   // last candidate has most volume over all its pools
 const f=router([[/tokens\/multi/,()=>resp(m)],[/coingecko\.com/,()=>resp(body)]]);
 const out=await radar.load('arc',{env:DEMO,fetcher:f,now:()=>T0,disableCache:true});
 assert.equal(out.tokens[0].address,addr(14));assert.equal(out.tokens[0].volume24hUsd,900000);assert.equal(out.tokens[0].fields.volume24hUsd.scope,'TOKEN');
 assert.match(out.selection,/Discovery Score/);
});
test('tokens/multi failure degrades to pool-level numbers labelled scope POOL; the section still renders',async()=>{
 const body=geckoBody('arc',{count:12});
 const f=router([[/tokens\/multi/,()=>({ok:false,status:500,headers:new Headers(),text:async()=>''})],[/coingecko\.com/,()=>resp(body)]]);
 const out=await radar.load('arc',{env:DEMO,fetcher:f,now:()=>T0,disableCache:true});
 assert.equal(out.coverage.tokenStats,'RADAR_PROVIDER_HTTP_500');assert.equal(out.tokens.length,10);
 assert.ok(out.tokens.every(t=>t.fields.volume24hUsd.scope==='POOL'));
 assert.ok(out.tokens.some(t=>t.logo),'pool payload still carries token images');
});
test('DEX Screener supplies a logo only when GeckoTerminal has none, keyed by the exact base-token contract',async()=>{
 const body=geckoBody('arc',{count:12});
 for(const t of body.included)if(t.type==='token')t.attributes.image_url=null;
 const ds=dexBody('arc',body).map((p,i)=>({...p,info:{imageUrl:i===0?'https://cdn.dexscreener.com/cms/images/abc':'https://evil.example/x.png'}}));
 const f=router([...CG('arc',body),[/dexscreener/,()=>resp(ds)]]);
 const out=await radar.load('arc',{env:{...DEMO,VERCEL:undefined,DEXSCREENER_PUBLIC_DISPLAY_APPROVED:'true'},fetcher:f,now:()=>T0,disableCache:true});
 const withLogo=out.tokens.filter(t=>t.logo);
 assert.ok(withLogo.length<=1);if(withLogo[0])assert.equal(withLogo[0].logo.source,'DEX Screener');
});
test('a logo shared by several tokens (copy-cat clones) is kept only for the CoinGecko-curated one; no logo is ever invented',async()=>{
 const body=geckoBody('robinhood',{count:12});
 const same='https://coin-images.coingecko.com/coins/images/9/large/same.png';
 for(const t of body.included)if(t.type==='token'){t.attributes.image_url=same;if(!['0x'+(1).toString(16).padStart(40,'0')].includes(t.attributes.address))t.attributes.coingecko_coin_id=null;}
 const m=multiBody('robinhood',body);
 const f=router([[/tokens\/multi/,()=>resp(m)],[/coingecko\.com/,()=>resp(body)]]);
 const out=await radar.load('robinhood',{env:DEMO,fetcher:f,now:()=>T0,disableCache:true});
 const logos=out.tokens.filter(t=>t.logo);
 assert.equal(logos.length,1);assert.equal(logos[0].address,addr(1));
});
test('Pons Launch reuses the cached Robinhood top-volume page instead of spending another provider call',async()=>{
 const body=geckoBody('robinhood',{count:14});let top=0;
 const f=router([[/tokens\/multi/,()=>resp(multiBody('robinhood',body))],[/coingecko\.com\/.*sort=h24_volume/,()=>{top++;return resp(body);}],[/coingecko\.com/,()=>resp(body)],[/rpc\.example/,rpcRouter({members:[addr(2)]})]]);
 const env={...DEMO};
 await radar.load('robinhood',{env,fetcher:f,now:()=>T0,rpcUrl:'https://rpc.example/'});
 const rpcBefore=f.calls.filter(c=>/rpc\.example/.test(c.url)).length;
 const out=await radar.load('pons',{env,fetcher:f,now:()=>T0,rpcUrl:'https://rpc.example/'});
 assert.equal(top,1,'top-volume page fetched once for both sections');assert.equal(out.tokens.length,1);
 assert.equal(f.calls.filter(c=>/trending_pools/.test(c.url)).length,1,'trending page shared as well');assert.equal(f.calls.filter(c=>/new_pools/.test(c.url)).length,1,'new-pools page shared as well');
 assert.equal(out.usage.geckoterminal,1,'only the token-stats call was spent');
 assert.equal(f.calls.filter(c=>/rpc\.example/.test(c.url)).length,rpcBefore,'factory membership of the same addresses is read once per TTL for both sections');
});

test('token-level totals smaller than their own top pool are provider errors: that field falls back to the pool figure and is labelled POOL',async()=>{
 const body=geckoBody('arc',{count:12});
 const m=multiBody('arc',body,{liq:'4.04'});                       // total_reserve_in_usd 4.04 while the pool holds 1,500 (real Arc anomaly)
 const f=router([[/tokens\/multi/,()=>resp(m)],[/coingecko\.com/,()=>resp(body)]]);
 const out=await radar.load('arc',{env:DEMO,fetcher:f,now:()=>T0,disableCache:true});
 const t=out.tokens[0];
 assert.equal(t.fields.liquidityUsd.scope,'POOL');assert.equal(t.liquidityUsd,3000000,'pool reserve, not the impossible total');assert.equal(t.fields.volume24hUsd.scope,'TOKEN');
});
test('a zero market cap or FDV is "not stated", not a value',async()=>{
 const body=geckoBody('arc',{count:3});const m=multiBody('arc',body,{mc:false});for(const d of m.data){d.attributes.market_cap_usd='0';d.attributes.fdv_usd='0';}
 const out=await gecko.fetchMulti({host:'https://x',key:null},'arc',m.data.map(d=>d.attributes.address),{fetcher:router([[/./,()=>resp(m)]]),now:()=>T0});
 for(const v of out.values()){assert.equal(v.marketCapUsd,null);assert.equal(v.fdvUsd,null);}
});

test('HTML-escaped provider names are decoded to plain text',()=>{
 const body=geckoBody('arc',{count:1});body.included.find(x=>x.type==='token'&&x.attributes.symbol==='T0').attributes.name='SPDR S&amp;P 500 &lt;ETF&gt; &quot;Trust&quot;';
 assert.equal(gecko.parse(body,'arc').rows[0].name,'SPDR S&P 500 <ETF> "Trust"');
});

test('Preview-only diagnostics name missing configuration items, never values, and never appear on Production',async()=>{
 const handler=require('../search/server/api/radar'),own={method:'GET',query:{chain:'arc'},headers:{'sec-fetch-site':'same-origin',host:'x'}};
 const clean={MARKET_RADAR_PUBLIC_DISPLAY_APPROVED:undefined,MARKET_RADAR_JSON_DELIVERY_APPROVED:undefined,COINGECKO_DEMO_API_KEY:undefined,COINGECKO_PRO_API_KEY:undefined,DEXSCREENER_PUBLIC_DISPLAY_APPROVED:undefined};
 let r=await call(handler,own,{...clean,VERCEL_ENV:'preview'});
 assert.deepEqual(r.body.previewDiagnostics.missing.slice(0,3),['MARKET_RADAR_PUBLIC_DISPLAY_APPROVED','MARKET_RADAR_JSON_DELIVERY_APPROVED','COINGECKO_DEMO_API_KEY']);
 r=await call(handler,own,{...clean,VERCEL_ENV:'preview',MARKET_RADAR_PUBLIC_DISPLAY_APPROVED:'true',MARKET_RADAR_JSON_DELIVERY_APPROVED:'true',VERCEL:'1',COINGECKO_DEMO_API_KEY:'secret-value-123'});
 assert.ok(!JSON.stringify(r.body).includes('secret-value-123'));
 r=await call(handler,own,{...clean,VERCEL_ENV:'production'});assert.equal(r.status,503);assert.equal(r.body.previewDiagnostics,undefined);
 r=await call(handler,own,{...clean,VERCEL_ENV:undefined});assert.equal(r.body.previewDiagnostics,undefined);
});
