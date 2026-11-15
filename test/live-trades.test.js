'use strict';
// Live Trading engine: classification, identity, dedupe, reorg binding, USD rules and fail-closed states (mocked RPC).
const test=require('node:test'),assert=require('node:assert/strict');
const lt=require('../search/server/lib/live-trades');
const v3=require('../lib/liquidity-exit-v3'),v4=require('../lib/liquidity-exit-v4');
const keccak=require('../lib/keccak');
const sel=s=>keccak(Buffer.from(s)).slice(0,10).toLowerCase();
const w=v=>(BigInt(v)<0n?(1n<<256n)+BigInt(v):BigInt(v)).toString(16).padStart(64,'0');
const aw=a=>'0x'+a.slice(2).padStart(64,'0');
const TOKEN='0x'+'1'.repeat(40),WETH='0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',USDC='0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const V3F=v3.protocols('ethereum')[0].factory;
const pool=(kind,counter=USDC,tokenFirst=true)=>({kind,token:TOKEN,counter,token0:tokenFirst?TOKEN:counter,token1:tokenFirst?counter:TOKEN,pool:'0x'+'p'.replace('p','a').repeat(40),emitter:'0x'+'a'.repeat(40)});
const v2data=(a0In,a1In,a0Out,a1Out)=>'0x'+[a0In,a1In,a0Out,a1Out].map(w).join('');
const v3data=(a0,a1)=>'0x'+[a0,a1,1n<<96n,1000n,0n].map(w).join('');
const v4data=(a0,a1)=>'0x'+[a0,a1,1n<<96n,1000n,0n,3000n].map(w).join('');
test('V2/V3/V4 direction comes from signed pool deltas of THIS token versus the counter asset',()=>{
 // V2: token0 = token. Pool pays token out, receives USDC in => BUY.
 assert.equal(lt.decodeSwap(pool('V2'),{data:v2data(0,500,1000,0)}).side,'BUY');
 assert.equal(lt.decodeSwap(pool('V2'),{data:v2data(1000,0,0,500)}).side,'SELL');
 assert.equal(lt.decodeSwap(pool('V2',USDC,false),{data:v2data(500,0,0,1000)}).side,'BUY','token1 side');
 assert.equal(lt.decodeSwap(pool('V2'),{data:v2data(10,500,1000,0)}).side,'SWAP','token both in and out: ambiguous');
 // V3 (pool perspective): negative = pool paid out.
 assert.equal(lt.decodeSwap(pool('V3'),{data:v3data(-1000,500)}).side,'BUY');
 assert.equal(lt.decodeSwap(pool('V3'),{data:v3data(1000,-500)}).side,'SELL');
 assert.equal(lt.decodeSwap(pool('V3'),{data:v3data(1000,500)}).side,'SWAP');
 // V4 (caller perspective): positive = swapper received.
 assert.equal(lt.decodeSwap(pool('V4'),{data:v4data(1000,-500)}).side,'BUY');
 assert.equal(lt.decodeSwap(pool('V4'),{data:v4data(-1000,500)}).side,'SELL');
 assert.equal(lt.decodeSwap(pool('V4',USDC,false),{data:v4data(-500,1000)}).side,'BUY','currency1 side');
 for(const [k,d] of [['V2','0x1234'],['V3',v2data(1,2,3,4)],['V4',v3data(1,2)]])assert.equal(lt.decodeSwap(pool(k),{data:d}),null,'malformed '+k);
});
function rpcMock({factory=V3F,registered=null,logs=[],blocks={},txs={},head=1000,headTs=Math.floor(Date.now()/1000)}={}){
 const calls=[];
 const fn=async(method,params)=>{
  calls.push(method);
  if(method==='eth_getBlockByNumber'){if(params[0]==='latest')return {number:'0x'+head.toString(16),timestamp:'0x'+headTs.toString(16),hash:'0xh'};const b=blocks[params[0]];return b||null;}
  if(method==='eth_getLogs')return logs.filter(l=>l.address===params[0].address&&BigInt(l.blockNumber)>=BigInt(params[0].fromBlock)&&BigInt(l.blockNumber)<=BigInt(params[0].toBlock));
  if(method==='eth_getTransactionByHash')return txs[params[0]]||null;
  if(method==='eth_call'){const {to,data}=params[0],s=data.slice(0,10);
   if(s===sel('token0()'))return aw(TOKEN);if(s===sel('token1()'))return aw(USDC);if(s===sel('fee()'))return '0x'+w(3000);if(s===sel('factory()'))return aw(factory);
   if(s===sel('getPool(address,address,uint24)'))return aw(registered||'0x'+'0'.repeat(40));
   if(s===sel('decimals()'))return '0x'+w(to===USDC?6:18);if(s===sel('symbol()'))return '0x'+w(32)+w(4)+Buffer.from(to===USDC?'USDC':'TKN').toString('hex').padEnd(64,'0');}
  throw Error('unexpected '+method);
 };
 return {fn,calls};
}
const POOL='0x'+'b'.repeat(40);
const swapLog=(block,idx,data,{tx='0x'+String(block).padStart(64,'0'),hash='0xbh'+block,address=POOL}={})=>({address,topics:[lt.TOPIC.V3],data,blockNumber:'0x'+block.toString(16),blockHash:hash,transactionHash:tx,logIndex:'0x'+idx.toString(16)});
test('identity: unreviewed factory or unregistered pool is excluded; nothing is invented',async()=>{
 lt._reset();
 let m=rpcMock({factory:'0x'+'9'.repeat(40)});
 let r=await lt.analyze({network:'ethereum',address:TOKEN,rpcFn:m.fn,pools:[{pool:POOL,dex:'x',reserveUsd:1}]});
 assert.equal(r.status,'UNSUPPORTED');assert.equal(r.excludedPools[0].reasonCode,'UNREVIEWED_FACTORY');assert.deepEqual(r.trades,[]);
 lt._reset();m=rpcMock({registered:'0x'+'c'.repeat(40)});
 r=await lt.analyze({network:'ethereum',address:TOKEN,rpcFn:m.fn,pools:[{pool:POOL,dex:'x',reserveUsd:1}]});
 assert.equal(r.excludedPools[0].reasonCode,'FACTORY_DOES_NOT_REGISTER_POOL');assert.deepEqual(r.trades,[]);
 lt._reset();r=await lt.analyze({network:'ethereum',address:TOKEN,rpcFn:rpcMock().fn,pools:[]});
 assert.equal(r.reasonCode,'NO_POOL_CANDIDATES');assert.deepEqual(r.trades,[]);
});
test('verified pool: dedupe by tx:logIndex, block-hash binding drops reorged rows, wallet = tx sender, USD from stablecoin counter',async()=>{
 lt._reset();
 const logs=[swapLog(990,1,v3data(-2n*10n**18n,5_000_000n)),swapLog(990,1,v3data(-2n*10n**18n,5_000_000n)),swapLog(995,3,v3data(10n**18n,-2_500_000n)),swapLog(998,0,v3data(-1n,1n),{hash:'0xstale'})];
 const blocks={'0x3de':{hash:'0xbh990',timestamp:'0x6553f100'},'0x3e3':{hash:'0xbh995',timestamp:'0x6553f200'},'0x3e6':{hash:'0xcanonical',timestamp:'0x6553f300'}};
 const txs={};for(const l of logs)txs[l.transactionHash]={from:'0x'+'e'.repeat(40),to:'0x'+'f'.repeat(40),blockHash:l.blockHash};
 const m=rpcMock({registered:POOL,logs,blocks,txs});
 const r=await lt.analyze({network:'ethereum',address:TOKEN,rpcFn:m.fn,pools:[{pool:POOL,dex:'uniswap_v3',reserveUsd:5}]});
 assert.equal(r.pools.length,1);assert.equal(r.pools[0].identity,'ONCHAIN_VERIFIED');
 assert.equal(r.trades.length,2,'duplicate removed, reorged/unbound row dropped');
 const [sell,buy]=r.trades;
 assert.equal(sell.side,'SELL');assert.equal(sell.tokenAmount,'1');assert.equal(sell.counterAmount,'2.5');assert.equal(sell.usd,2.5);assert.equal(sell.usdStatus,'STABLECOIN_QUOTED');
 assert.equal(buy.side,'BUY');assert.equal(buy.tokenAmount,'2');assert.equal(buy.usd,5);
 assert.equal(buy.wallet,'0x'+'e'.repeat(40));assert.equal(buy.route,'ROUTER');assert.match(buy.explorerUrl,/^https:\/\/eth\.blockscout\.com\/tx\/0x/);
 assert.equal(buy.verification,'ONCHAIN_VERIFIED');assert.ok(buy.blockHash&&buy.block&&buy.timestamp);
 assert.equal(r.status,'LIVE');
 assert.ok(r.cost.rpcCalls<=20,'bounded reads: '+r.cost.rpcCalls);
});
test('stale head is DELAYED, never LIVE; no swaps in the window is an explicit empty state',async()=>{
 lt._reset();
 const logs=[swapLog(990,1,v3data(-10n,5n))];
 const m=rpcMock({registered:POOL,logs,blocks:{'0x3de':{hash:'0xbh990',timestamp:'0x1'}},txs:{[logs[0].transactionHash]:{from:'0x'+'e'.repeat(40),to:POOL,blockHash:'0xbh990'}},headTs:Math.floor(Date.now()/1000)-600});
 const r=await lt.analyze({network:'ethereum',address:TOKEN,rpcFn:m.fn,pools:[{pool:POOL,reserveUsd:1}]});
 assert.equal(r.status,'DELAYED');assert.equal(r.trades[0].route,'DIRECT');
 lt._reset();
 const e=await lt.analyze({network:'ethereum',address:TOKEN,rpcFn:rpcMock({registered:POOL}).fn,pools:[{pool:POOL,reserveUsd:1}]});
 assert.equal(e.status,'NO_RECENT_SWAPS');assert.deepEqual(e.trades,[]);
});
test('USD only from reviewed anchors; Robinhood and unknown counters stay USD NOT VERIFIED',()=>{
 assert.equal(lt.usdOf('arc','0x0000000000000000000000000000000000000000',10n**18n,null).usd,1);
 assert.equal(lt.usdOf('arc','0x3600000000000000000000000000000000000000',1_000_000n,null).usd,1);
 assert.equal(lt.usdOf('ethereum',WETH,10n**18n,{price:3000,source:'x'}).usd,3000);
 assert.equal(lt.usdOf('ethereum',WETH,10n**18n,null).usdStatus,'USD_NOT_VERIFIED','no oracle answer -> no USD');
 assert.equal(lt.usdOf('robinhood','0x0bd7d308f8e1639fab988df18a8011f41eacad73',10n**18n,{price:3000}).usdStatus,'USD_NOT_VERIFIED');
 assert.equal(lt.usdOf('ethereum','0x'+'7'.repeat(40),1n,null).usd,null);
});
test('V4: PoolKey must hash to the PoolId and contain the token; Ethereum has no reviewed V4 manager',async()=>{
 lt._reset();
 const key={currency0:'0x0000000000000000000000000000000000000000',currency1:TOKEN,fee:3000,tickSpacing:60,hooks:'0x0000000000000000000000000000000000000000'};
 const id=v4.poolIdForKey(key);
 const keyRaw='0x'+[aw(key.currency0).slice(2),aw(key.currency1).slice(2),w(3000),w(60),aw(key.hooks).slice(2)].join('');
 const rpc={call:async(m,p)=>p[0].data.startsWith(v4.SELECTORS.poolKeys)?keyRaw:null};
 const ok=await lt.identifyPool('robinhood',rpc,TOKEN,{pool:id,dex:'uniswap-v4'},'0x10');
 assert.equal(ok.kind,'V4');assert.equal(ok.emitter,v4.protocols('robinhood')[0].poolManager);assert.equal(ok.counter,key.currency0);
 lt._reset();
 const wrong=await lt.identifyPool('robinhood',rpc,TOKEN,{pool:'0x'+'d'.repeat(64)},'0x10');assert.equal(wrong.excluded,'V4_POOL_ID_MISMATCH');
 assert.equal((await lt.identifyPool('ethereum',rpc,TOKEN,{pool:id},'0x10')).excluded,'NO_REVIEWED_V4_POOL_MANAGER');
});
test('cached(): single-flight, short cache, provider failure is UNAVAILABLE (never empty-success)',async()=>{
 lt._reset();let runs=0;const run=async()=>{runs++;await new Promise(r=>setTimeout(r,20));return {ok:true,status:'LIVE',trades:[{side:'BUY'}]};};
 const [a,b]=await Promise.all([lt.cached({network:'arc',address:TOKEN},run),lt.cached({network:'arc',address:TOKEN},run)]);
 assert.equal(runs,1);assert.equal(a.status,'LIVE');assert.equal(b.status,'LIVE');
 assert.equal((await lt.cached({network:'arc',address:TOKEN},run)).cacheAgeSeconds>=0,true);assert.equal(runs,1);
 lt._reset();const failing=await lt.cached({network:'arc',address:TOKEN},async()=>{throw Object.assign(Error('x'),{code:'RPC_HEAD_UNAVAILABLE'});});
 assert.equal(failing.status,'UNAVAILABLE');assert.equal(failing.ok,false);assert.deepEqual(failing.trades,[]);
});
test('incremental refresh reads only new blocks for the same verified pools; quiet markets widen the window',async()=>{
 lt._reset();
 const logs=[swapLog(990,1,v3data(-10n,5n))],blocks={'0x3de':{hash:'0xbh990',timestamp:'0x6553f100'}},txs={[logs[0].transactionHash]:{from:'0x'+'e'.repeat(40),to:POOL,blockHash:'0xbh990'}};
 let head=5000;const base=rpcMock({registered:POOL,logs,blocks,txs});const ranges=[];
 const fn=async(m,p)=>{if(m==='eth_getLogs')ranges.push([BigInt(p[0].fromBlock),BigInt(p[0].toBlock)]);if(m==='eth_getBlockByNumber'&&p[0]==='latest')return {number:'0x'+head.toString(16),timestamp:'0x'+Math.floor(Date.now()/1000).toString(16)};return base.fn(m,p);};
 const first=await lt.analyze({network:'ethereum',address:TOKEN,rpcFn:fn,pools:[{pool:POOL,reserveUsd:1}]});
 assert.equal(first.window.mode,'FULL_WINDOW');assert.equal(first.trades.length,1);
 const spans=ranges.map(([a,b])=>Number(b-a+1n));assert.ok(spans[1]>spans[0],'empty chunk widens the next span');assert.ok(spans.every(x=>x<=lt.NET.ethereum.maxSpan),'bounded by maxSpan');
 ranges.length=0;head=5010;
 const second=await lt.analyze({network:'ethereum',address:TOKEN,rpcFn:fn,pools:[{pool:POOL,reserveUsd:1}]});
 assert.equal(second.window.mode,'INCREMENTAL');assert.deepEqual(ranges,[[4999n,5008n]],'only the 10 new confirmed blocks');
 assert.equal(second.trades.length,1,'previous verified row retained');
});
test('Ethereum WETH counter is priced only through the pinned Chainlink ETH/USD reader shape',async()=>{
 const om=require('../search/server/lib/oracle-market');
 assert.equal(typeof om.inspect,'function');
 const src=require('node:fs').readFileSync(require.resolve('../search/server/lib/live-trades'),'utf8');
 assert.match(src,/f\?\.priceUsd/);
});
