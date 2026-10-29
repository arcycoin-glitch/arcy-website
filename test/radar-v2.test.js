'use strict';
const {test,beforeEach}=require('node:test'),assert=require('node:assert/strict');
const radar=require('../lib/radar-v2'),sources=require('../lib/radar-v2/sources'),gecko=require('../lib/radar-v2/gecko'),dexs=require('../lib/radar-v2/dexscreener'),verify=require('../lib/radar-v2/verify'),pons=require('../lib/radar-v2/pons'),http=require('../lib/radar-v2/http');
const addr=i=>'0x'+i.toString(16).padStart(40,'0'),pad=i=>'0x'+BigInt(i).toString(16).padStart(64,'0');
const APPROVED={MARKET_RADAR_PUBLIC_DISPLAY_APPROVED:'true',MARKET_RADAR_JSON_DELIVERY_APPROVED:'true'};
const DEMO={...APPROVED,COINGECKO_DEMO_API_KEY:'demo-key-not-real',VERCEL:'1'};
const T0=Date.UTC(2026,9,30,12,0,0);
beforeEach(()=>{http._resetCooldowns();radar._cache.clear();});

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────────
function geckoBody(net,{count=14,start=1,volume=i=>100000-i*100,created=i=>new Date(T0-i*60000).toISOString(),dup=false}={}){
 const id=sources.NETWORKS[net].gecko,included=[],data=[];
 for(let i=0;i<count;i++){
  const a=addr(dup?Math.floor(i/2)+start:i+start),tokenId=id+'_'+a,pool=addr(5000+i);
  included.push({id:tokenId,type:'token',attributes:{address:a,name:'Token '+i,symbol:'T'+i}});
  data.push({id:id+'_'+pool,type:'pool',attributes:{address:pool,pool_created_at:created(i),base_token_price_usd:'0.002',reserve_in_usd:'1500',fdv_usd:'2000000',market_cap_usd:null,volume_usd:{h24:String(volume(i))},price_change_percentage:{h24:'-3.2'},transactions:{h24:{buys:10,sells:7}}},
   relationships:{base_token:{data:{id:tokenId,type:'token'}},quote_token:{data:{id:id+'_'+addr(900),type:'token'}},dex:{data:{id:'uniswap-v4-'+id,type:'dex'}}}});
 }
 included.push({id:id+'_'+addr(900),type:'token',attributes:{address:addr(900),name:'Quote',symbol:'USDC'}},{id:'uniswap-v4-'+id,type:'dex',attributes:{name:'Uniswap V4'}});
 return {data,included};
}
function dexBody(net,body,{price='0.00205',vol=undefined,liq='1450',chg=-3.0,created=undefined,chain=undefined}={}){
 return body.data.map((p,i)=>({chainId:chain||sources.NETWORKS[net].dex,dexId:'uniswap',url:'https://dexscreener.com/'+net+'/'+p.attributes.address,pairAddress:p.attributes.address,
  baseToken:{address:p.relationships.base_token.data.id.split('_')[1],symbol:'T'+i},quoteToken:{address:addr(900),symbol:'USDC'},priceUsd:price,volume:{h24:vol??Number(p.attributes.volume_usd.h24)*1.05},liquidity:{usd:Number(liq)},priceChange:{h24:chg},fdv:2100000,pairCreatedAt:created??Date.parse(p.attributes.pool_created_at)+60000}));
}
const resp=body=>({ok:true,status:200,headers:new Headers(),text:async()=>JSON.stringify(body)});
function router(routes){const calls=[];const f=async(url,opts={})=>{calls.push({url,opts});for(const [re,fn] of routes)if(re.test(url))return fn(url,opts);throw new Error('unrouted '+url);};f.calls=calls;return f;}
const parseBatch=opts=>JSON.parse(opts.body);

// ── policy / limits ───────────────────────────────────────────────────────────────────────────────────────
test('access policy fails closed: no key on Vercel = off; keyless only outside Vercel; Demo/Pro select the documented host+header',()=>{
 assert.equal(sources.geckoAccess({VERCEL:'1'}).mode,'off');
 const k=sources.geckoAccess({});assert.equal(k.mode,'keyless');assert.equal(k.host,'https://api.geckoterminal.com/api/v2');assert.equal(k.perMinute,5);assert.ok(k.ttlMs>=30*60*1000);
 const d=sources.geckoAccess({COINGECKO_DEMO_API_KEY:'x',VERCEL:'1'});assert.equal(d.mode,'demo');assert.equal(d.host,'https://api.coingecko.com/api/v3/onchain');assert.equal(d.header,'x-cg-demo-api-key');assert.ok(d.ttlMs>=20*60*1000);
 const p=sources.geckoAccess({COINGECKO_PRO_API_KEY:'x',COINGECKO_DEMO_API_KEY:'y',VERCEL:'1'});assert.equal(p.mode,'pro');assert.equal(p.header,'x-cg-pro-api-key');
 assert.equal(sources.geckoAccess({COINGECKO_DEMO_API_KEY:'x',RADAR_V2_TTL_MS:'1000'}).ttlMs,20*60*1000,'TTL cannot be configured below the Demo quota floor');
});
test('Demo plan quota arithmetic: default 30-minute cycle stays inside 10,000 credits/month; 10-minute would not',()=>{
 assert.equal(sources.demoBudget(30*60*1000).within10k,true);assert.equal(sources.demoBudget(30*60*1000).callsPerMonth,7200);
 assert.equal(sources.demoBudget(10*60*1000).within10k,false);
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
test('verify: agreement=CROSS_VERIFIED, one source=SOURCE_REPORTED, contradiction/missing=NOT_VERIFIED',()=>{
 const gt={address:addr(1),pool:addr(5000),priceUsd:1,volume24hUsd:1000,liquidityUsd:500,change24hPct:5,fdvUsd:null,marketCapUsd:null,poolCreatedAt:new Date(T0).toISOString()};
 const pair={pair:addr(5000),token:addr(1),priceUsd:1.02,volume24hUsd:1100,liquidityUsd:900,change24hPct:6,fdvUsd:2000,marketCapUsd:null,pairCreatedAt:new Date(T0+1000).toISOString(),poolCreatedAt:new Date(T0+1000).toISOString()};
 const v=verify.verifyRow(gt,{state:'MATCHED',pair});
 assert.equal(v.fields.priceUsd.status,'CROSS_VERIFIED');assert.equal(v.fields.volume24hUsd.status,'CROSS_VERIFIED');
 assert.equal(v.fields.liquidityUsd.status,'NOT_VERIFIED');assert.equal(v.fields.liquidityUsd.reasonCode,'SOURCES_DISAGREE');assert.equal(v.fields.liquidityUsd.value,null);
 assert.equal(v.fields.fdvUsd.status,'SOURCE_REPORTED');assert.equal(v.fields.fdvUsd.value,2000);
 assert.equal(v.fields.marketCapUsd.status,'NOT_VERIFIED');assert.equal(v.fields.marketCapUsd.reasonCode,'FIELD_NOT_PROVIDED');
 const solo=verify.verifyRow(gt,{state:'DISABLED'});
 assert.equal(solo.fields.priceUsd.status,'SOURCE_REPORTED');assert.equal(solo.fields.priceUsd.crossCheck,'DISABLED');
 assert.deepEqual(verify.matchPair(gt,[{...pair,pair:addr(7)}]),{state:'NO_MATCH'},'must be the SAME pool, not just the same token');
 assert.equal(verify.agree('change24hPct',1,4.5),false);assert.equal(verify.agree('priceUsd',0,0),true);assert.equal(verify.agree('priceUsd',null,1),false);
});

// ── orchestration: the three ranking sections ─────────────────────────────────────────────────────────────
for(const [net,chainId] of [['arc',5042],['ethereum',1],['robinhood',4663]]){
 test(net+': ranks 10 contract-bound tokens, cross-checks with DEX Screener, reports usage, no indexer calls',async()=>{
  const body=geckoBody(net,{count:14});
  const f=router([[/coingecko\.com/,()=>resp(body)],[/dexscreener\.com/,()=>resp(dexBody(net,body))]]);
  const out=await radar.load(net,{env:{...DEMO,VERCEL:undefined,DEXSCREENER_PUBLIC_DISPLAY_APPROVED:'true'},fetcher:f,now:()=>T0,disableCache:true});
  assert.equal(out.chainId,chainId);assert.equal(out.tokens.length,10);assert.equal(out.version,2);
  assert.equal(f.calls.length,2,'one ranking page + one batched cross-check call');
  assert.equal(f.calls[0].opts.headers['x-cg-demo-api-key'],'demo-key-not-real');
  assert.ok(f.calls[0].url.startsWith('https://api.coingecko.com/api/v3/onchain/networks/'+sources.NETWORKS[net].gecko+'/pools?page=1&sort=h24_volume_usd_desc'));
  assert.ok(f.calls[1].url.startsWith('https://api.dexscreener.com/tokens/v1/'+sources.NETWORKS[net].dex+'/'));
  assert.deepEqual(out.usage,{geckoterminal:1,dexscreener:1,rpc:0});
  const t=out.tokens[0];
  assert.equal(t.fields.priceUsd.status,'CROSS_VERIFIED');assert.equal(t.fields.liquidityUsd.status,'CROSS_VERIFIED');
  assert.equal(t.fields.marketCapUsd.status,'NOT_VERIFIED');assert.equal(t.marketCapUsd,null);
  assert.ok(out.attribution.some(a=>/CoinGecko/.test(a.text))&&out.attribution.some(a=>/DEX Screener/.test(a.text)));
  assert.ok(out.coverage.fieldsCrossVerified>0&&out.coverage.fieldsNotVerified>0);
  assert.equal(out.sources.find(s=>s.id==='geckoterminal').monthly,10000);
  assert.match(out.selection,/Not whole-chain/);
 });
}
test('DEX Screener disabled on Vercel without approval: rows stay SOURCE_REPORTED and DEX Screener is never called',async()=>{
 const body=geckoBody('arc',{count:12});const f=router([[/coingecko\.com/,()=>resp(body)]]);
 const out=await radar.load('arc',{env:DEMO,fetcher:f,now:()=>T0,disableCache:true});
 assert.equal(f.calls.length,1);assert.equal(out.coverage.crossCheckProvider,'DISABLED');
 assert.ok(out.tokens.every(t=>t.fields.priceUsd.status==='SOURCE_REPORTED'));
 assert.equal(out.sources.find(s=>s.id==='dexscreener').mode,'disabled-until-approved');assert.ok(!out.attribution.some(a=>/DEX Screener/.test(a.text)));
});
test('DEX Screener failure or wrong-chain answer degrades to SOURCE_REPORTED, never to invented agreement',async()=>{
 const body=geckoBody('arc',{count:12});
 const down=router([[/coingecko\.com/,()=>resp(body)],[/dexscreener/,()=>({ok:false,status:503,headers:new Headers(),text:async()=>''})]]);
 const a=await radar.load('arc',{env:{...DEMO,VERCEL:undefined},fetcher:down,now:()=>T0,disableCache:true});
 assert.equal(a.coverage.crossCheckProvider,'RADAR_PROVIDER_HTTP_503');assert.ok(a.tokens.every(t=>t.fields.priceUsd.status==='SOURCE_REPORTED'&&t.fields.priceUsd.crossCheck==='UNAVAILABLE'));
 const wrong=router([[/coingecko\.com/,()=>resp(body)],[/dexscreener/,()=>resp(dexBody('arc',body,{chain:'ethereum'}))]]);
 const b=await radar.load('arc',{env:{...DEMO,VERCEL:undefined},fetcher:wrong,now:()=>T0,disableCache:true});
 assert.ok(b.tokens.every(t=>t.verification.crossCheck==='NO_MATCH'&&t.fields.priceUsd.status==='SOURCE_REPORTED'));
});
test('contradicting providers produce NOT_VERIFIED (null), not a favoured value',async()=>{
 const body=geckoBody('arc',{count:12});const f=router([[/coingecko\.com/,()=>resp(body)],[/dexscreener/,()=>resp(dexBody('arc',body,{price:'0.5'}))]]);
 const out=await radar.load('arc',{env:{...DEMO,VERCEL:undefined,DEXSCREENER_PUBLIC_DISPLAY_APPROVED:'true'},fetcher:f,now:()=>T0,disableCache:true});
 assert.equal(out.tokens[0].priceUsd,null);assert.equal(out.tokens[0].fields.priceUsd.reasonCode,'SOURCES_DISAGREE');assert.equal(out.tokens[0].fields.priceUsd.sources.length,2);
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
 const body=geckoBody('arc',{count:12});let n=0;const f=router([[/coingecko\.com/,()=>{n++;return resp(body);}]]);
 const env={...DEMO};let now=T0;
 const [a,b]=await Promise.all([radar.load('arc',{env,fetcher:f,now:()=>now}),radar.load('arc',{env,fetcher:f,now:()=>now})]);
 assert.equal(n,1);assert.equal(a.tokens.length,b.tokens.length);
 now=T0+19*60000;await radar.load('arc',{env,fetcher:f,now:()=>now});assert.equal(n,1,'still cached at 19 min (Demo floor 20)');
 now=T0+31*60000;await radar.load('arc',{env,fetcher:f,now:()=>now});assert.equal(n,2);
});
test('429 honours Retry-After, enters a cooldown with no further calls, and serves a bounded STALE result labelled as such',async()=>{
 const body=geckoBody('arc',{count:12});let mode='ok',n=0;
 const f=router([[/coingecko\.com/,()=>{n++;return mode==='ok'?resp(body):{ok:false,status:429,headers:new Headers({'retry-after':'120'}),text:async()=>''};}]]);
 const env={...DEMO};let now=T0;
 await radar.load('arc',{env,fetcher:f,now:()=>now});
 mode='limited';now=T0+31*60000;
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
 const f=router([[/coingecko\.com/,()=>resp(body)],[/dexscreener/,()=>resp(dexBody('pons',body))],[/rpc\.example/,rpcRouter({members})]]);
 const out=await radar.load('pons',{env:{...DEMO,VERCEL:undefined,DEXSCREENER_PUBLIC_DISPLAY_APPROVED:'true'},fetcher:f,now:()=>T0,disableCache:true,rpcUrl:'https://rpc.example/'});
 assert.deepEqual(out.tokens.map(t=>t.address),members.map(String));
 assert.deepEqual(out.tokens.map(t=>t.rank),[1,2,3]);
 assert.equal(out.chainId,4663);assert.equal(out.network,'pons');
 const t=out.tokens[0];assert.equal(t.launch.status,'ONCHAIN_VERIFIED');assert.equal(t.launch.factory,sources.PONS.factories[0]);assert.equal(t.graduation.graduated,false);assert.equal(t.graduation.thresholdEth,5);
 assert.equal(t.fields.poolCreatedAt.status,'CROSS_VERIFIED');
 assert.equal(out.coverage.ponsChecked,12);assert.equal(out.coverage.ponsConfirmed,3);
 assert.match(out.selection,/Recent launches only/);
 assert.equal(f.calls.filter(c=>/rpc\.example/.test(c.url)).length,2,'one membership batch + one graduation batch; no log scan');
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
 r=await call(handler,{method:'GET',query:{chain:'arc'}},{...clean,...APPROVED,VERCEL:'1'});assert.equal(r.status,503);assert.equal(r.body.error,'RADAR_SOURCE_KEY_REQUIRED');
});

// ── UI contract (static) ─────────────────────────────────────────────────────────────────────────────────
test('UI: four sections, NOT VERIFIED rendered as N/A, text-only DOM, provider attribution links',()=>{
 const src=require('fs').readFileSync(require('path').join(__dirname,'../search/market-radar.js'),'utf8');
 for(const label of ["'Arc'","'Ethereum'","'Robinhood'","'Pons Launch'"])assert.ok(src.includes(label));
 assert.ok(src.includes("NV='N/A'")&&src.includes('NOT VERIFIED'));
 assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(src),'provider strings are only ever set as textContent');
 assert.ok(src.includes("rel='noopener noreferrer'")&&src.includes('body.attribution'));
 assert.ok(src.includes("pons:4663")&&src.includes("TOKEN_NET"));
});
