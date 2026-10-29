'use strict';
// Issue #89 — first-party onchain Market Radar. A synthetic chain speaks the real
// JSON-RPC / ABI shapes (v4 Swap logs, PositionManager.poolKeys, Chainlink rounds).
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const keccak=require('../lib/keccak');
const onchain=require('../lib/market-radar-onchain');
const {CHAINS,SWAP_TOPIC,SEL}=onchain;

const ZERO='0x'+'0'.repeat(40);
const w=(n)=>(BigInt(n)<0n?(1n<<256n)+BigInt(n):BigInt(n)).toString(16).padStart(64,'0');
const a32=(a)=>a.slice(2).padStart(64,'0');
const tokenAddr=i=>'0x'+i.toString(16).padStart(40,'0');
const b32=(text)=>'0x'+Buffer.from(text).toString('hex').padEnd(64,'0');
const sqrtOf=ratio=>BigInt(Math.floor(Math.sqrt(ratio)*2**96));

// ---- synthetic chain ------------------------------------------------------
function makeChain(network,{head=1000000,blockSeconds=12,tokens={},pools=[],feedAnswers={},staleFeeds=false,failLogsAtSingle=false,
  badLogs=[],chainId,brokenKeys=new Set(),usdc,weth}={}){
 const cfg=CHAINS[network],nowSec=Math.floor(Date.now()/1000);
 const ts=b=>nowSec-(head-b)*blockSeconds;
 const keyOf=p=>'0x'+a32(p.c0)+a32(p.c1)+w(p.fee||3000)+w(p.spacing||60)+a32(p.hooks||ZERO);
 const ids=new Map();for(const p of pools){p.id=keccak(Buffer.from(keyOf(p).slice(2),'hex'));ids.set(p.id.slice(2,52),p);}
 const logs=[];let logIndex=0;
 for(const p of pools)for(const s of p.swaps){
  logs.push({address:cfg.poolManager,topics:[SWAP_TOPIC,p.id,'0x'+a32('0x'+'ab'.repeat(20))],
   data:'0x'+w(s.a0)+w(s.a1)+w(s.sqrt)+w(1000)+w(0)+w(3000),blockNumber:'0x'+s.block.toString(16),logIndex:'0x'+(logIndex++).toString(16),
   transactionHash:'0x'+(logIndex).toString(16).padStart(64,'0'),removed:false});
 }
 logs.push(...badLogs);
 const calls={logs:0,coingecko:0,total:0};
 const feedRound=(ans)=>'0x'+w(1)+w(ans)+w(0)+w(nowSec-(staleFeeds?400000:60))+w(1);
 const feeds={'0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419':feedAnswers.ETH??300000000000n,'0x8fffffd4afb6115b954bd326cbe7b4ba576818f6':feedAnswers.USDC??99990000n};
 return async function fetcher(url,init){
  calls.total++;
  if(String(url).includes('coingecko'))calls.coingecko++;
  const req=JSON.parse(init.body),{method,params}=req;
  const reply=result=>({ok:true,json:async()=>({jsonrpc:'2.0',id:req.id,result})});
  const err=message=>({ok:true,json:async()=>({jsonrpc:'2.0',id:req.id,error:{code:-32000,message}})});
  const isEthSide=String(url).includes('publicnode')&&network!=='ethereum';
  if(method==='eth_chainId')return reply('0x'+(isEthSide?1:(chainId??cfg.chainId)).toString(16));
  if(method==='eth_getBlockByNumber'){
   const b=params[0]==='latest'?head:Number(BigInt(params[0]));
   return reply({number:'0x'+b.toString(16),timestamp:'0x'+ts(b).toString(16)});
  }
  if(method==='eth_getLogs'){
   calls.logs++;
   const f=params[0],from=Number(BigInt(f.fromBlock)),to=Number(BigInt(f.toBlock));
   if(failLogsAtSingle)return err('query returned more than 10000 results');
   return reply(logs.filter(l=>{const b=Number(BigInt(l.blockNumber));return b>=from&&b<=to;}));
  }
  if(method==='eth_call'){
   const {to,data}=params[0],target=String(to).toLowerCase();
   if(feeds[target]!==undefined){
    if(data===SEL.decimals)return reply('0x'+w(8));
    return reply(feedRound(feeds[target]));
   }
   if(target===cfg.positionManager&&data.startsWith(SEL.poolKeys)){
    const p=ids.get(data.slice(10,60));if(!p||brokenKeys.has(p.id))return reply('0x');
    return reply(brokenKeys.has('wrong:'+p.id)?'0x'+w(1).repeat(5):keyOf(p));
   }
   if(cfg.bridgedUsdc&&target===cfg.bridgedUsdc.router&&data.startsWith(SEL.calculateL2TokenAddress))return reply('0x'+a32(usdc));
   const meta=tokens[target]||(weth&&target===weth.address?weth:null)||(usdc&&target===usdc?{decimals:6,symbol:'USDC',name:'USD Coin'}:null);
   if(meta){
    if(data===SEL.decimals)return meta.decimals===null?err('execution reverted'):reply('0x'+w(meta.decimals));
    if(data===SEL.symbol)return meta.symbol===null?err('execution reverted'):reply(b32(meta.symbol));
    if(data===SEL.name)return reply(b32(meta.name||meta.symbol||''));
   }
   if(network==='ethereum'&&(target==='0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'||target==='0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2')){
    const six=target.startsWith('0xa0');
    if(data===SEL.decimals)return reply('0x'+w(six?6:18));
    if(data===SEL.symbol)return reply(b32(six?'USDC':'WETH'));
   }
   return err('execution reverted');
  }
  return err('method not found');
 };
}
const USDC_ETH='0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
// Token (18 dec) priced `price` USDC, token = currency0 (lower address than USDC).
function usdcPool(i,usdcVol,{price=2,swaps=2,usdcAddr=USDC_ETH,block0=999000,tokenIsZero=true}={}){
 const t=tokenAddr(i),half=Math.round(usdcVol/swaps*1e6);
 const sw=[];
 for(let k=0;k<swaps;k++){
  const p=price*(1+k*0.1); // price rises 10% per swap
  const tokenRaw=BigInt(Math.round(half/p/1e6*1e18));
  const ratio=tokenIsZero?(half/Number(tokenRaw)):(Number(tokenRaw)/half);
  sw.push(tokenIsZero?{a0:-tokenRaw,a1:BigInt(half),sqrt:sqrtOf(ratio),block:block0+k*10}:{a0:BigInt(half),a1:-tokenRaw,sqrt:sqrtOf(ratio),block:block0+k*10});
 }
 return tokenIsZero?{c0:t,c1:usdcAddr,swaps:sw}:{c0:usdcAddr,c1:t,swaps:sw};
}
const tokenMeta=(n)=>Object.fromEntries(Array.from({length:n},(_,k)=>[tokenAddr(k+1),{decimals:18,symbol:'TK'+(k+1),name:'Token '+(k+1)}]));

// ---- ranking, identity, scope ---------------------------------------------
test('ranks up to 10 unique exact-contract tokens by single highest pool 24h USD volume with real fields',async()=>{
 const pools=Array.from({length:12},(_,k)=>usdcPool(k+1,(13-k)*1000));
 const fetcher=makeChain('ethereum',{pools,tokens:tokenMeta(12)});
 const out=await onchain.inspect('ethereum',{fetcher});
 assert.equal(out.ok,true);assert.equal(out.chainId,1);assert.equal(out.sourceType,'FIRST_PARTY_ONCHAIN');
 assert.equal(out.tokens.length,10);
 assert.equal(new Set(out.tokens.map(t=>t.address)).size,10);
 assert.deepEqual(out.tokens.map(t=>t.rank),[1,2,3,4,5,6,7,8,9,10]);
 out.tokens.forEach((t,i)=>{
  assert.equal(t.address,tokenAddr(i+1));assert.equal(t.symbol,'TK'+(i+1));assert.equal(t.network,'ethereum');
  // USDC volume x Chainlink USDC/USD (0.9999)
  assert.ok(Math.abs(t.volume24hUsd-(13-i)*1000*0.9999)<0.01,'volume '+t.volume24hUsd);
  assert.ok(Math.abs(t.priceUsd-2.2*0.9999)<0.002,'last swap price '+t.priceUsd);
  assert.ok(Math.abs(t.change24hPct-10)<0.2,'change '+t.change24hPct);
  assert.equal(t.liquidityUsd,null);assert.equal(t.liquidityStatus,'NOT_COMPUTED');
  assert.match(t.pool,/^0x[0-9a-f]{64}$/);assert.equal(t.dex,'Uniswap v4');assert.equal(t.swaps24h,2);
  assert.ok(t.poolUrl.includes(t.pool));assert.equal(t.provider,'Onchain · Uniswap v4 PoolManager');
 });
 assert.ok(out.tokens.every((t,i,a)=>i===0||a[i-1].volume24hUsd>=t.volume24hUsd));
 assert.match(out.selection,/single highest-volume Uniswap v4 pool/);assert.match(out.selection,/not whole-chain/);
 assert.equal(out.coverage.complete,false);assert.ok(out.coverage.unsupportedFields.liquidityUsd);
 assert.equal(out.referencePrices.USDC.value,0.9999);
});
test('token paired as currency1 (USDC is currency0) is priced by inversion',async()=>{
 const hi='0xf000000000000000000000000000000000000001';
 const p=usdcPool(1,4000,{usdcAddr:USDC_ETH,tokenIsZero:false});p.c1=hi;
 const fetcher=makeChain('ethereum',{pools:[p],tokens:{[hi]:{decimals:18,symbol:'HI',name:'Hi'}}});
 const out=await onchain.inspect('ethereum',{fetcher});
 assert.equal(out.tokens.length,1);assert.equal(out.tokens[0].address,hi);
 assert.ok(Math.abs(out.tokens[0].priceUsd-2.2*0.9999)<0.002);assert.ok(Math.abs(out.tokens[0].change24hPct-10)<0.2);
});
test('two pools of the same token are never added together: the single highest-volume pool is used',async()=>{
 const a=usdcPool(1,3000),b=usdcPool(1,5000,{price:2});b.fee=500;
 const out=await onchain.inspect('ethereum',{fetcher:makeChain('ethereum',{pools:[a,b],tokens:tokenMeta(1)})});
 assert.equal(out.tokens.length,1);assert.ok(Math.abs(out.tokens[0].volume24hUsd-5000*0.9999)<0.01);
});
test('fewer than 10 real tokens: only those are published, nothing is manufactured',async()=>{
 const pools=[1,2,3].map(i=>usdcPool(i,1000*i));
 const out=await onchain.inspect('ethereum',{fetcher:makeChain('ethereum',{pools,tokens:tokenMeta(3)})});
 assert.equal(out.tokens.length,3);
});
test('pools without a USD anchor, anchor-vs-anchor pools and single-swap pools never rank',async()=>{
 const tokenToken={c0:tokenAddr(5),c1:tokenAddr(6),swaps:usdcPool(5,9000).swaps};
 const anchorAnchor={c0:'0x0000000000000000000000000000000000000000',c1:USDC_ETH,swaps:usdcPool(7,9000).swaps};
 const single=usdcPool(8,9000,{swaps:1});
 const good=usdcPool(1,1000);
 const out=await onchain.inspect('ethereum',{fetcher:makeChain('ethereum',{pools:[tokenToken,anchorAnchor,single,good],tokens:tokenMeta(8)})});
 assert.deepEqual(out.tokens.map(t=>t.address),[tokenAddr(1)]);
 assert.equal(out.coverage.poolsUnpriced,1);assert.equal(out.coverage.referencePoolsExcluded,1);assert.equal(out.coverage.poolsBelowMinSwaps,1);
});
test('a pool id that does not hash from the PositionManager key is rejected and counted, not ranked',async()=>{
 const bad=usdcPool(2,9000),good=usdcPool(1,1000);
 const fetcher=makeChain('ethereum',{pools:[bad,good],tokens:tokenMeta(2),brokenKeys:new Set()});
 // make the manager return a key whose hash differs from the pool id
 const wrapped=async(url,init)=>{const req=JSON.parse(init.body);
  if(req.method==='eth_call'&&req.params[0].data.startsWith(SEL.poolKeys)&&req.params[0].data.slice(10,60)===bad.id.slice(2,52))
   return {ok:true,json:async()=>({id:req.id,result:'0x'+w(1).repeat(5)})};
  return fetcher(url,init);};
 const out=await onchain.inspect('ethereum',{fetcher:wrapped});
 assert.deepEqual(out.tokens.map(t=>t.address),[tokenAddr(1)]);assert.equal(out.coverage.poolsUnresolved,1);
});
test('a token without readable symbol/decimals is skipped, never given invented metadata',async()=>{
 const pools=[usdcPool(1,9000),usdcPool(2,1000)];
 const tokens={...tokenMeta(2),[tokenAddr(1)]:{decimals:18,symbol:null}};
 const out=await onchain.inspect('ethereum',{fetcher:makeChain('ethereum',{pools,tokens})});
 assert.deepEqual(out.tokens.map(t=>t.symbol),['TK2']);assert.equal(out.tokens[0].rank,1);assert.equal(out.coverage.tokensWithoutMetadata,1);
});
test('malformed, removed, wrong-emitter and wrong-topic logs are ignored',async()=>{
 const good=usdcPool(1,1000),cfg=CHAINS.ethereum;
 const base={address:cfg.poolManager,topics:[SWAP_TOPIC,'0x'+'11'.repeat(32),'0x'+'22'.repeat(32)],data:'0x'+w(1)+w(1)+w(1)+w(1)+w(0)+w(3000),blockNumber:'0xf4240',logIndex:'0x1',transactionHash:'0x'+'33'.repeat(32),removed:false};
 const badLogs=[{...base,removed:true},{...base,address:'0x'+'99'.repeat(20)},{...base,topics:[SWAP_TOPIC,base.topics[1]]},{...base,data:'0x1234'},{...base,topics:['0x'+'44'.repeat(32),base.topics[1],base.topics[2]]},{...base,blockNumber:'0xffffffff'}];
 const out=await onchain.inspect('ethereum',{fetcher:makeChain('ethereum',{pools:[good],tokens:tokenMeta(1),badLogs})});
 assert.equal(out.coverage.swapsIndexed,2);
});
test('duplicate log deliveries are counted once',async()=>{
 const p=usdcPool(1,1000),f=makeChain('ethereum',{pools:[p],tokens:tokenMeta(1)});
 const dup=async(url,init)=>{const r=await f(url,init),req=JSON.parse(init.body);if(req.method!=='eth_getLogs')return r;const body=await r.json();return {ok:true,json:async()=>({...body,result:[...body.result,...body.result]})};};
 const out=await onchain.inspect('ethereum',{fetcher:dup});
 assert.equal(out.coverage.swapsIndexed,2);assert.ok(Math.abs(out.tokens[0].volume24hUsd-1000*0.9999)<0.01);
});

// ---- failures publish nothing ---------------------------------------------
test('incomplete log scan publishes no ranking at all',async()=>{
 await assert.rejects(onchain.inspect('ethereum',{fetcher:makeChain('ethereum',{pools:[usdcPool(1,1000)],tokens:tokenMeta(1),failLogsAtSingle:true})}),/RADAR_ONCHAIN_SCAN_INCOMPLETE/);
});
test('stale Chainlink reference price publishes no USD values',async()=>{
 await assert.rejects(onchain.inspect('ethereum',{fetcher:makeChain('ethereum',{pools:[usdcPool(1,1000)],tokens:tokenMeta(1),staleFeeds:true})}),/RADAR_REFERENCE_PRICE_UNAVAILABLE/);
});
test('RPC answering for the wrong chain id is rejected',async()=>{
 await assert.rejects(onchain.inspect('ethereum',{fetcher:makeChain('ethereum',{chainId:56})}),/RADAR_RPC_CHAIN_MISMATCH/);
});
test('transport failure is a source error, never empty zeroes',async()=>{
 await assert.rejects(onchain.inspect('arc',{fetcher:async()=>{throw new TypeError('fetch failed')}}));
});
test('a zero USDC reference price never prices USDC pools; with no usable reference at all nothing publishes',async()=>{
 const zeroUsdc=makeChain('ethereum',{pools:[usdcPool(1,1000)],tokens:tokenMeta(1),feedAnswers:{USDC:0n}});
 const out=await onchain.inspect('ethereum',{fetcher:zeroUsdc});
 assert.equal(out.tokens.length,0);assert.equal(out.coverage.poolsUnpriced,1);assert.equal(out.referencePrices.USDC,undefined);
 const none=makeChain('ethereum',{pools:[usdcPool(1,1000)],tokens:tokenMeta(1),feedAnswers:{USDC:-5n,ETH:0n}});
 await assert.rejects(onchain.inspect('ethereum',{fetcher:none}),/RADAR_REFERENCE_PRICE_UNAVAILABLE/);
});

// ---- per-chain anchors ----------------------------------------------------
test('Arc uses only the 6-decimal ERC-20 USDC interface; the zero address is never an anchor',async()=>{
 const arcUsdc='0x3600000000000000000000000000000000000000';
 const p=usdcPool(1,2000,{usdcAddr:arcUsdc});
 const zeroPool={c0:ZERO,c1:tokenAddr(2),swaps:usdcPool(2,9000).swaps};
 const f=makeChain('arc',{pools:[p,zeroPool],tokens:{...tokenMeta(2),[arcUsdc]:{decimals:6,symbol:'USDC',name:'USDC'}}});
 const out=await onchain.inspect('arc',{fetcher:f});
 assert.equal(out.chainId,5042);assert.deepEqual(out.tokens.map(t=>t.address),[tokenAddr(1)]);
 assert.deepEqual(out.anchors.map(a=>a.address),[arcUsdc]);
});
test('Arc USDC anchor with the wrong decimals (18) is dropped instead of mispricing by 1e12',async()=>{
 const arcUsdc='0x3600000000000000000000000000000000000000';
 const f=makeChain('arc',{pools:[usdcPool(1,2000,{usdcAddr:arcUsdc})],tokens:{...tokenMeta(1),[arcUsdc]:{decimals:18,symbol:'USDC'}}});
 await assert.rejects(onchain.inspect('arc',{fetcher:f}),/RADAR_REFERENCE_PRICE_UNAVAILABLE/);
});
test('Robinhood: native ETH and WETH are priced by the Ethereum ETH/USD feed; bridged USDC is derived from the official router',async()=>{
 const weth='0x0bd7d308f8e1639fab988df18a8011f41eacad73',bridged='0x80e0e24718dbfcad49ecaa6f1e6c89a190586ca8';
 // token/ETH pool: 1 token = 0.001 ETH -> $3 at ETH=$3000
 const swaps=[0,1].map(k=>{const eth=BigInt(1e18)*5n,tok=BigInt(5000e18)*BigInt(1+k)/BigInt(1+k)/BigInt(1);const ratio=Number(eth)/Number(tok)*(1+k*0.1);return {a0:-tok,a1:eth,sqrt:sqrtOf(ratio),block:999000+k*10};});
 const ethPool={c0:tokenAddr(1),c1:weth,swaps};
 const usdcP=usdcPool(2,1000,{usdcAddr:bridged});
 const f=makeChain('robinhood',{pools:[ethPool,usdcP],tokens:tokenMeta(2),weth:{address:weth,decimals:18,symbol:'WETH'},usdc:bridged});
 const out=await onchain.inspect('robinhood',{fetcher:f});
 assert.equal(out.chainId,4663);
 const eth=out.tokens.find(t=>t.address===tokenAddr(1)),u=out.tokens.find(t=>t.address===tokenAddr(2));
 assert.ok(eth&&u);assert.ok(Math.abs(eth.volume24hUsd-10*3000)<1,'ETH volume '+eth.volume24hUsd);
 assert.ok(out.anchors.some(a=>a.address===bridged&&a.bridged));
 assert.ok(Math.abs(u.volume24hUsd-1000*0.9999)<0.01);
});
test('Robinhood bridged-USDC derivation that does not verify (wrong symbol) yields no USDC anchor',async()=>{
 const bridged='0x80e0e24718dbfcad49ecaa6f1e6c89a190586ca8';
 const f=makeChain('robinhood',{pools:[usdcPool(2,1000,{usdcAddr:bridged})],tokens:{...tokenMeta(2),[bridged]:{decimals:6,symbol:'SCAM'}},usdc:bridged});
 const out=await onchain.inspect('robinhood',{fetcher:f}).catch(e=>e);
 assert.ok(out instanceof Error||out.tokens.length===0);
});

// ---- cache ----------------------------------------------------------------
test('server cache serves within 600s, and failures are negatively cached briefly, never published',async()=>{
 onchain._cache.clear();
 let n=0;const inner=makeChain('ethereum',{pools:[usdcPool(1,1000)],tokens:tokenMeta(1)});
 const counting=async(u,i)=>{n++;return inner(u,i);};
 const t0=Date.now();
 await onchain.load('ethereum',{fetcher:counting,now:t0});const first=n;
 await onchain.load('ethereum',{fetcher:counting,now:t0+599000});assert.equal(n,first);
 await onchain.load('ethereum',{fetcher:counting,now:t0+601000});assert.ok(n>first);
 onchain._cache.clear();
 await assert.rejects(onchain.load('ethereum',{fetcher:async()=>{throw new TypeError('down')},now:t0}));
 const failed=n;await assert.rejects(onchain.load('ethereum',{fetcher:counting,now:t0+1000}));assert.equal(n,failed);
 onchain._cache.clear();
});

// ---- API: gates, no key, no third party -----------------------------------
function call(handler,query,env={}){
 const saved={};for(const k of ['MARKET_RADAR_ONCHAIN_ENABLED','MARKET_RADAR_PROVIDER','MARKET_RADAR_PUBLIC_DISPLAY_APPROVED','MARKET_RADAR_JSON_DELIVERY_APPROVED','COINGECKO_PRO_API_KEY'])saved[k]=process.env[k],delete process.env[k];
 Object.assign(process.env,env);
 let status=0,body=null;const headers={};
 const res={setHeader(k,v){headers[k]=v;return this},status(c){status=c;return this},json(v){body=v;return this}};
 return Promise.resolve(handler({method:'GET',query},res)).then(()=>({status,body,headers})).finally(()=>{for(const [k,v] of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
}
test('API onchain source (explicitly enabled): no licence flag or key is needed and no CoinGecko host is contacted',async()=>{
 onchain._cache.clear();
 const handler=require('../search/server/api/radar'),real=global.fetch;
 const f=makeChain('ethereum',{pools:[usdcPool(1,1000)],tokens:tokenMeta(1)}),hosts=[];
 global.fetch=async(u,i)=>{hosts.push(new URL(u).hostname);return f(u,i);};
 try{
  const off=await call(handler,{chain:'ethereum'});
  assert.equal(off.status,503);assert.equal(off.body.error,'RADAR_NOT_ENABLED');assert.equal(hosts.length,0,'disabled Radar must not touch any RPC');
  const r=await call(handler,{chain:'ethereum'},{MARKET_RADAR_ONCHAIN_ENABLED:'true'});
  assert.equal(r.status,200);assert.equal(r.body.sourceType,'FIRST_PARTY_ONCHAIN');assert.equal(r.body.tokens.length,1);
  assert.equal(r.headers['Cache-Control'],'public, max-age=0, s-maxage=600');assert.equal(r.headers['X-Content-Type-Options'],'nosniff');
  assert.ok(hosts.every(h=>!/coingecko|geckoterminal|dexscreener/.test(h)),hosts.join());
  assert.ok(!JSON.stringify(r.body).toLowerCase().includes('api_key'));
 }finally{global.fetch=real;onchain._cache.clear();}
});
test('API failure is a no-store 503 with a reason code and never a fake ranking',async()=>{
 onchain._cache.clear();
 const handler=require('../search/server/api/radar'),real=global.fetch;
 global.fetch=async()=>{throw new TypeError('offline')};
 try{
  const r=await call(handler,{chain:'arc'},{MARKET_RADAR_ONCHAIN_ENABLED:'true'});
  assert.equal(r.status,503);assert.equal(r.body.ok,false);assert.equal(r.headers['Cache-Control'],'no-store');assert.equal(r.body.tokens,undefined);
 }finally{global.fetch=real;onchain._cache.clear();}
});
test('CoinGecko provider stays fail-closed without BOTH operator approvals and a server key; invalid input rejected',async()=>{
 const handler=require('../search/server/api/radar');
 let r=await call(handler,{chain:'arc'},{MARKET_RADAR_PROVIDER:'coingecko'});
 assert.equal(r.status,503);assert.equal(r.body.error,'RADAR_NOT_CONFIGURED');assert.equal(r.headers['Cache-Control'],'no-store');
 r=await call(handler,{chain:'arc'},{MARKET_RADAR_PROVIDER:'coingecko',MARKET_RADAR_PUBLIC_DISPLAY_APPROVED:'true',COINGECKO_PRO_API_KEY:'k'});
 assert.equal(r.body.error,'RADAR_NOT_CONFIGURED','display approval alone is not JSON-delivery approval');
 r=await call(handler,{chain:'bsc'});assert.equal(r.status,400);
 let status=0;await handler({method:'POST',query:{chain:'arc'}},{setHeader(){},status(c){status=c;return this},json(){return this}});assert.equal(status,405);
});
test('no provider key, no secret and no third-party host is present in the browser bundle or the onchain module',()=>{
 const client=fs.readFileSync('search/market-radar.js','utf8'),server=fs.readFileSync('lib/market-radar-onchain.js','utf8');
 for(const s of [client,server]){assert.ok(!/COINGECKO_PRO_API_KEY|x-cg-pro-api-key|api\.geckoterminal|api\.dexscreener/i.test(s));}
 assert.ok(!/coingecko/i.test(client),'client no longer credits a provider it does not use');
});
test('single-function constraint: Radar is routed through the existing /api/search function',()=>{
 assert.match(fs.readFileSync('api/search/index.js','utf8'),/radar:\(req,res\)=>require\('\.\.\/\.\.\/search\/server\/api\/radar'\)/);
 assert.ok(!fs.existsSync('api/radar.js'));
});
test('official deployment addresses and the Swap topic are the documented constants',()=>{
 assert.equal(CHAINS.ethereum.poolManager,'0x000000000004444c5dc75cb358380d2e3de08a90');
 assert.equal(CHAINS.robinhood.poolManager,'0x8366a39cc670b4001a1121b8f6a443a643e40951');
 assert.equal(CHAINS.arc.poolManager,'0x8366a39cc670b4001a1121b8f6a443a643e40951');
 assert.equal(keccak(Buffer.from('Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)')),SWAP_TOPIC);
 assert.equal(keccak(Buffer.from('poolKeys(bytes25)')).slice(0,10),SEL.poolKeys);
});

// ---- frontend: pager, partial coverage, N/A, source line -------------------
class El{
 constructor(tag,doc){this.tag=tag;this.doc=doc;this.children=[];this.listeners={};this.attrs={};this.dataset={};this.hidden=false;this._text='';this.className='';this.disabled=false;
  this.classList={toggle:()=>{},add:()=>{},remove:()=>{}};}
 set id(v){this._id=v;this.doc.byId.set(v,this);} get id(){return this._id;}
 set textContent(v){this._text=String(v);this.children=[];} get textContent(){return this._text;}
 append(...n){this.children.push(...n);} prepend(n){this.children.unshift(n);} replaceChildren(...n){this.children=n;}
 replaceWith(){} setAttribute(k,v){this.attrs[k]=v;} addEventListener(t,f){(this.listeners[t]??=[]).push(f);}
 async click(){for(const f of this.listeners.click||[])await f({});}
 find(pred,out=[]){if(pred(this))out.push(this);for(const c of this.children)c.find?.(pred,out);return out;}
}
async function mountRadar(responses){
 const doc={byId:new Map()};doc.createElement=t=>new El(t,doc);
 const detail=new El('div',doc);detail.id='tokenDetail';doc.getElementById=id=>doc.byId.get(id)||null;
 const requests=[];
 const fetch=async(url)=>{requests.push(url);const net=new URL(url,'https://x.test').searchParams.get('chain'),r=responses[net];
  if(!r)return {ok:false,status:503,json:async()=>({ok:false,error:'RADAR_SOURCE_UNAVAILABLE'})};
  return {ok:true,status:200,json:async()=>r};};
 const ctx=vm.createContext({document:doc,fetch,AbortController,setTimeout,clearTimeout,Intl,Number,String,Math,Promise,Error,Set,Map,Date,console});
 vm.runInContext(fs.readFileSync('search/market-radar.js','utf8'),ctx);
 for(let i=0;i<30;i++)await new Promise(r=>setImmediate(r));
 const q=(cls)=>detail.find(n=>(n.className||'').split(' ').includes(cls))[0];
 return {doc,detail,requests,q,rows:()=>doc.byId.get('marketRadarRows'),switcher:()=>doc.byId.get('marketRadarSwitcher')};
}
function apiBody(network,n,extra={}){
 return {ok:true,network,chainId:({arc:5042,ethereum:1,robinhood:4663})[network],asOf:'2026-10-29T10:00:00.000Z',sourceType:'FIRST_PARTY_ONCHAIN',
  selection:'Up to 10 tokens ranked by 24h USD volume of their single highest-volume Uniswap v4 pool. Uniswap v4 only — not whole-chain.',
  attribution:{text:'Source: Uniswap v4 PoolManager events on Test · Chainlink USD reference',url:'https://explorer.example/address/0x1'},
  coverage:{poolsResolved:40,swapsIndexed:900},poolsInspected:40,
  tokens:Array.from({length:n},(_,i)=>({rank:i+1,network,chainId:({arc:5042,ethereum:1,robinhood:4663})[network],address:tokenAddr(i+1),symbol:'T'+(i+1),name:'Token '+(i+1),
   logo:i===0?'/assets/hero-arcy.png':null,priceUsd:i===1?null:1.5,volume24hUsd:1000-i,liquidityUsd:null,change24hPct:i===2?null:-1.2,dex:'Uniswap v4',swaps24h:9})),...extra};
}
test('Radar UI: 10 tokens page 5 at a time, N/A for missing fields, contract shown, scope and source credit displayed',async()=>{
 const m=await mountRadar({arc:apiBody('arc',10),ethereum:apiBody('ethereum',10),robinhood:apiBody('robinhood',10)});
 assert.equal(m.switcher().hidden,false);
 const [researchBtn,radarBtn]=m.switcher().children;await radarBtn.click();
 for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));
 assert.equal(m.rows().children.length,5);
 const text=n=>[n._text,...n.children.map(text)].join(' ');
 const first=text(m.rows());
 assert.match(first,/N\/A/);assert.match(first,/0x0000…0001/);assert.match(first,/Liq N\/A/);
 const pager=m.q('arcy-radar-pager'),[prev,status,next]=pager.children;
 assert.equal(prev.disabled,true);assert.equal(next.disabled,false);assert.equal(status.textContent,'Showing 1–5 of 10');
 await next.click();assert.equal(m.rows().children.length,5);assert.equal(status.textContent,'Showing 6–10 of 10');assert.equal(next.disabled,true);
 await prev.click();assert.equal(status.textContent,'Showing 1–5 of 10');
 assert.match(m.doc.byId.get('marketRadarScope').textContent,/Uniswap v4 only/);
 const credit=m.q('arcy-radar-credit');assert.equal(credit.hidden,false);assert.match(credit.textContent,/Uniswap v4 PoolManager/);assert.equal(credit.href,'https://explorer.example/address/0x1');
 assert.ok(m.q('arcy-radar-logo'));
 void researchBtn;
});
test('Radar UI: partial coverage — one network failing neither hides the switcher nor the other networks, and no 10th row is invented',async()=>{
 const m=await mountRadar({arc:apiBody('arc',3)});
 assert.equal(m.switcher().hidden,false);
 const [,radarBtn]=m.switcher().children;await radarBtn.click();
 for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));
 assert.equal(m.rows().children.length,3);
 assert.match(m.doc.byId.get('marketRadarStatus').textContent,/3 of up to 10 verified tokens/);
 const pager=m.q('arcy-radar-pager');assert.equal(pager.hidden,true);
 const [arcBtn,ethBtn]=m.q('arcy-radar-networks').children;
 await ethBtn.click();for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));
 assert.equal(m.rows().children.length,0);
 assert.match(m.doc.byId.get('marketRadarStatus').textContent,/cannot verify current results/);
 await arcBtn.click();for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));
 assert.equal(m.rows().children.length,3);
});
test('Radar UI: when no network has verified rows the switcher stays hidden',async()=>{
 const m=await mountRadar({});assert.equal(m.switcher().hidden,true);
});
test('Radar UI: wrong-chain, wrong-address or zero-volume rows from a malformed response are discarded',async()=>{
 const body=apiBody('arc',4);body.tokens[0].network='ethereum';body.tokens[1].address='0x123';body.tokens[2].volume24hUsd=0;
 const m=await mountRadar({arc:body});
 const [,radarBtn]=m.switcher().children;await radarBtn.click();for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));
 assert.equal(m.rows().children.length,1);
});
test('Radar UI keeps the existing structure: same classes, 5 per page, mobile breakpoint and research tab intact',()=>{
 const css=fs.readFileSync('search/market-radar.css','utf8'),js=fs.readFileSync('search/market-radar.js','utf8');
 assert.match(css,/@media\(max-width:640px\)/);assert.match(css,/grid-template-columns:25px minmax\(115px,1\.1fr\)/);
 assert.match(js,/page\*5/);assert.match(js,/Token Research/);assert.match(js,/Market Radar/);
});
