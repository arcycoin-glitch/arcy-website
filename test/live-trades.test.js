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
  if(method==='eth_getLogs')return logs.filter(l=>[].concat(params[0].address).includes(l.address)&&BigInt(l.blockNumber)>=BigInt(params[0].fromBlock)&&BigInt(l.blockNumber)<=BigInt(params[0].toBlock));
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
 // Final Engine: Robinhood ETH/WETH is valued with the Ethereum Chainlink ETH/USD reference and labelled as such.
 assert.equal(lt.usdOf('robinhood','0x0bd7d308f8e1639fab988df18a8011f41eacad73',10n**18n,{price:3000}).usdStatus,'ORACLE_PRICED_ETH_REFERENCE');
 assert.equal(lt.usdOf('ethereum','0x'+'7'.repeat(40),1n,null).usd,null);
});
test('V4: PoolKey must hash to the PoolId and contain the token; Ethereum uses the reviewed official deployment',async()=>{
 lt._reset();
 const key={currency0:'0x0000000000000000000000000000000000000000',currency1:TOKEN,fee:3000,tickSpacing:60,hooks:'0x0000000000000000000000000000000000000000'};
 const id=v4.poolIdForKey(key);
 const keyRaw='0x'+[aw(key.currency0).slice(2),aw(key.currency1).slice(2),w(3000),w(60),aw(key.hooks).slice(2)].join('');
 const rpc={call:async(m,p)=>p[0].data.startsWith(v4.SELECTORS.poolKeys)?keyRaw:null};
 const ok=await lt.identifyPool('robinhood',rpc,TOKEN,{pool:id,dex:'uniswap-v4'},'0x10');
 assert.equal(ok.kind,'V4');assert.equal(ok.emitter,v4.protocols('robinhood')[0].poolManager);assert.equal(ok.counter,key.currency0);
 lt._reset();
 const wrong=await lt.identifyPool('robinhood',rpc,TOKEN,{pool:'0x'+'d'.repeat(64)},'0x10');assert.equal(wrong.excluded,'V4_POOL_ID_MISMATCH');
 // #262: Ethereum now has the reviewed official V4 deployment; the same PoolKey/PoolId proof applies.
 lt._reset();const eth=await lt.identifyPool('ethereum',rpc,TOKEN,{pool:id,dex:'uniswap-v4-ethereum'},'0x10');
 assert.equal(eth.kind,'V4');assert.equal(eth.emitter,'0x000000000004444c5dc75cb358380d2e3de08a90');
 // a hook with swap return-delta permissions is excluded on Ethereum (bit 3 set in the hook address)
 const hooked={...key,hooks:'0x0000000000000000000000000000000000000008'},hid=v4.poolIdForKey(hooked);
 const hraw='0x'+[aw(hooked.currency0).slice(2),aw(hooked.currency1).slice(2),w(3000),w(60),aw(hooked.hooks).slice(2)].join('');
 lt._reset();assert.equal((await lt.identifyPool('ethereum',{call:async()=>hraw},TOKEN,{pool:hid},'0x10')).excluded,'V4_HOOK_RETURNS_DELTA_UNREVIEWED');
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
test('USD rules: stablecoin-quoted, same-chain oracle, labelled Ethereum reference for Robinhood ETH/WETH, otherwise NOT VERIFIED',()=>{
 const one=10n**18n,p={price:3000,source:'Chainlink ETH/USD on Ethereum (pinned block)'};
 assert.deepEqual(lt.usdOf('ethereum',WETH,one,{...p,crossChain:false}).usdStatus,'ORACLE_PRICED');
 const rh=lt.usdOf('robinhood','0x0bd7d308f8e1639fab988df18a8011f41eacad73',one,{...p,crossChain:true});
 assert.equal(rh.usd,3000);assert.equal(rh.usdStatus,'ORACLE_PRICED_ETH_REFERENCE');assert.match(rh.usdBasis,/cross-chain reference/);
 assert.equal(lt.usdOf('robinhood','0x'+'7'.repeat(40),one,{...p,crossChain:true}).usdStatus,'USD_NOT_VERIFIED','unknown counter asset');
 assert.equal(lt.usdOf('robinhood','0x0bd7d308f8e1639fab988df18a8011f41eacad73',one,null).usdStatus,'USD_NOT_VERIFIED','no oracle answer: no value');
 assert.equal(lt.usdOf('arc','0x3600000000000000000000000000000000000000',2500000n,null).usd,2.5);
 assert.equal(lt.usdOf('arc','0x'+'8'.repeat(40),one,p).usdStatus,'USD_NOT_VERIFIED','Arc has no ETH reference');
});
test('Data Engine V2: an active pool on an unreviewed DEX makes the result COVERAGE_INCOMPLETE, never "no swaps"',async()=>{
 lt._reset();
 const m=rpcMock({factory:'0x'+'9'.repeat(40)});
 const r=await lt.analyze({network:'ethereum',address:TOKEN,rpcFn:m.fn,pools:[{pool:POOL,dex:'synthra',reserveUsd:30000,trades24h:45,volume24hUsd:4900}]});
 assert.equal(r.status,'COVERAGE_INCOMPLETE');assert.equal(r.reasonCode,'ACTIVE_POOLS_UNSUPPORTED');assert.deepEqual(r.trades,[]);
 assert.equal(r.coverage.complete,false);assert.equal(r.coverage.excludedActivePools,1);assert.equal(r.excludedPools[0].providerTrades24h,45);
 lt._reset();
 const quiet=await lt.analyze({network:'ethereum',address:TOKEN,rpcFn:rpcMock({factory:'0x'+'9'.repeat(40)}).fn,pools:[{pool:POOL,dex:'x',reserveUsd:5,trades24h:0}]});
 assert.equal(quiet.status,'UNSUPPORTED','an excluded pool without reported activity is plain unsupported');
});
test('Data Engine V2: the reported window is the oldest block actually scanned, with its timestamp; budget exhaustion is disclosed',async()=>{
 lt._reset();
 const blocks={};for(let b=0;b<=9000;b+=1)if(b%500===0||b===8998)blocks['0x'+b.toString(16)]={hash:'0xh'+b,timestamp:'0x'+(1700000000+b*12).toString(16)};
 const m=rpcMock({registered:POOL,logs:[],head:9000});
 const fn=async(meth,p)=>meth==='eth_getBlockByNumber'&&p[0]!=='latest'?(blocks[p[0]]||{hash:'0xh',timestamp:'0x6553f100'}):m.fn(meth,p);
 const r=await lt.analyze({network:'ethereum',address:TOKEN,rpcFn:fn,pools:[{pool:POOL,reserveUsd:1}]});
 assert.equal(r.status,'NO_RECENT_SWAPS');
 assert.ok(BigInt(r.window.scannedFromBlock)>=BigInt(r.window.fromBlock));
 assert.equal(r.window.lookbackComplete,BigInt(r.window.scannedFromBlock)<=BigInt(r.window.fromBlock));
 assert.ok(r.window.logCalls<=10);assert.match(r.window.scannedSince||'',/^\d{4}-/);
});
test('Data Engine V2: concurrent row reads keep newest-first order and share block reads',async()=>{
 lt._reset();
 const logs=[swapLog(990,1,'0x'+[-10n,5n,1n<<96n,1000n,0n].map(w).join('')),swapLog(990,2,'0x'+[10n,-5n,1n<<96n,1000n,0n].map(w).join(''),{tx:'0x'+'2'.repeat(64)}),swapLog(980,1,'0x'+[-1n,1n,1n<<96n,1000n,0n].map(w).join(''))];
 const blocks={'0x3de':{hash:'0xbh990',timestamp:'0x6553f100'},'0x3d4':{hash:'0xbh980',timestamp:'0x6553f000'}};
 const txs={};for(const l of logs)txs[l.transactionHash]={from:'0x'+'e'.repeat(40),to:POOL,blockHash:l.blockHash};
 const m=rpcMock({registered:POOL,logs,blocks,txs});let blockReads=0;
 const fn=async(meth,p)=>{if(meth==='eth_getBlockByNumber'&&p[0]!=='latest')blockReads++;return m.fn(meth,p);};
 const r=await lt.analyze({network:'ethereum',address:TOKEN,rpcFn:fn,pools:[{pool:POOL,reserveUsd:1}]});
 assert.deepEqual(r.trades.map(t=>t.block+':'+t.logIndex),['990:2','990:1','980:1']);
 assert.equal(blockReads,2,'one read per distinct block');assert.equal(r.lastTradeAt,r.trades[0].timestamp);
});
test('Data Engine V2 venues: ShibaSwap getPair and Ramses tickSpacing registration; unregistered pools excluded',async()=>{
 const P='0x'+'c'.repeat(40);
 const venueRpc=({factory,registered,tickSpacing=null})=>({call:async(m,p)=>{const d=p[0].data,s=d.slice(0,10);
  if(s===sel('token0()'))return aw(TOKEN);if(s===sel('token1()'))return aw(WETH);if(s===sel('factory()'))return aw(factory);
  if(s===sel('fee()'))return tickSpacing===null?null:'0x'+w(3000);if(s===sel('tickSpacing()'))return '0x'+w(tickSpacing);
  if(s===sel('getPair(address,address)'))return aw(registered);
  if(s===sel('getPool(address,address,int24)')){assert.equal(d.slice(-64),w(tickSpacing),'registration keyed by tickSpacing');return aw(registered);}
  return null;}});
 lt._reset();
 const shiba=await lt.identifyPool('ethereum',venueRpc({factory:'0x115934131916c8b277dd010ee02de363c09d037c',registered:P}),TOKEN,{pool:P,dex:'shibaswap'},'0x10');
 assert.equal(shiba.kind,'V2');assert.equal(shiba.protocol,'shibaswap');
 lt._reset();
 const ramses=await lt.identifyPool('robinhood',venueRpc({factory:'0xe0c4ceb92d08ca985bb70fe0a22feb121a9854a8',registered:P,tickSpacing:60}),TOKEN,{pool:P},'0x10');
 assert.equal(ramses.kind,'V3');assert.equal(ramses.protocol,'ramses-v3');
 lt._reset();
 const fake=await lt.identifyPool('robinhood',venueRpc({factory:'0xe0c4ceb92d08ca985bb70fe0a22feb121a9854a8',registered:'0x'+'d'.repeat(40),tickSpacing:60}),TOKEN,{pool:P},'0x10');
 assert.equal(fake.excluded,'FACTORY_DOES_NOT_REGISTER_POOL');
 lt._reset();
 assert.equal((await lt.identifyPool('ethereum',venueRpc({factory:'0xe0c4ceb92d08ca985bb70fe0a22feb121a9854a8',registered:P,tickSpacing:60}),TOKEN,{pool:P},'0x10')).excluded,'UNREVIEWED_FACTORY','venues are chain-specific');
});
test('Data Engine V2: unreviewed-factory pool accepted only if its runtime equals the verified canonical UniswapV3Pool (immutables masked)',async()=>{
 const REF=lt.CANONICAL_V3.reference.arc,P='0x'+'c'.repeat(40);
 const base='60806040'+'00'.repeat(40)+'aa'.repeat(32)+'5b'.repeat(8),refCode='0x'+base.replace('aa'.repeat(32),'11'.repeat(32)),same='0x'+base.replace('aa'.repeat(32),'22'.repeat(32)),other='0x'+base.replace('5b'.repeat(8),'5c'.repeat(8));
 const record=(digestOk=true)=>({chainId:'5042',address:REF,runtimeMatch:'exact_match',abi:[],sources:{'UniswapV3Pool.sol':{content:digestOk?'canonical':'tampered'}},compilation:{},
  runtimeBytecode:{onchainBytecode:refCode,immutableReferences:{'1':[{start:44,length:32}]}}});
 const deep=require('../search/server/lib/mechanics-deep');const realDigest=deep.digest;
 const saved=global.fetch;
 const rpcFor=code=>({call:async(m,p)=>{if(m==='eth_getCode')return p[0]===REF?refCode:code;const s=p[0].data.slice(0,10);
  if(s===sel('token0()'))return aw(TOKEN);if(s===sel('token1()'))return aw(WETH);if(s===sel('factory()'))return aw('0x'+'f'.repeat(40));if(s===sel('fee()'))return '0x'+w(3000);return null;}});
 try{
  // digest of the mocked record is not the canonical digest -> rejected (fail closed)
  global.fetch=async()=>new Response(JSON.stringify(record()),{status:200});lt._reset();
  assert.equal((await lt.identifyPool('arc',rpcFor(same),TOKEN,{pool:P},'0x10')).excluded,'UNREVIEWED_FACTORY','non-canonical digest');
  // with the canonical digest the masked runtime decides
  const canonical=lt.CANONICAL_V3.digest;
  const v=require('../search/server/lib/mechanics-deep');const orig=v.validateSource;
  v.validateSource=(d,ctx)=>({...orig(d,ctx),digest:canonical});
  try{
   lt._reset();const ok=await lt.identifyPool('arc',rpcFor(same),TOKEN,{pool:P},'0x10');
   assert.equal(ok.kind,'V3');assert.equal(ok.protocol,'uniswap-v3-canonical-runtime');assert.match(ok.method,/factory is not reviewed/);
   lt._reset();assert.equal((await lt.identifyPool('arc',rpcFor(other),TOKEN,{pool:P},'0x10')).excluded,'UNREVIEWED_FACTORY','different code');
   global.fetch=async()=>new Response('{}',{status:404});lt._reset();
   assert.equal((await lt.identifyPool('arc',rpcFor(same),TOKEN,{pool:P},'0x10')).excluded,'UNREVIEWED_FACTORY','reference unavailable: fail closed');
  }finally{v.validateSource=orig;}
 }finally{global.fetch=saved;}
 assert.equal(lt.maskCode('0xzz',[]),null);assert.equal(typeof realDigest,'function');
});

test('V2: pools are verified in order of provider-reported activity, reserve only breaks ties', async()=>{
 lt._reset();
 const P=i=>'0x'+String(i).repeat(40);
 const r=await lt.analyze({network:'ethereum',address:TOKEN,rpcFn:rpcMock({factory:'0x'+'9'.repeat(40)}).fn,
  pools:[{pool:P(1),reserveUsd:9e6,trades24h:3},{pool:P(2),reserveUsd:1e4,trades24h:491},{pool:P(3),reserveUsd:5e4,trades24h:3}]});
 assert.deepEqual(r.excludedPools.map(x=>x.pool),[P(2),P(1),P(3)]);
 assert.ok(r.excludedPools.every(x=>x.reasonCode),'each uncovered pool carries its reason code');
});

test('V3 RPC: log blockTimestamp + tx.blockHash bind rows without block reads; a tx placed in another block is dropped',async()=>{
 lt._reset();
 const ts='0x6553f100';
 const logs=[swapLog(990,1,v3data(-2n*10n**18n,5_000_000n)),swapLog(995,3,v3data(10n**18n,-2_500_000n)),swapLog(997,2,v3data(10n**18n,-1_000_000n))].map(l=>({...l,blockTimestamp:ts}));
 const txs={};for(const l of logs)txs[l.transactionHash]={from:'0x'+'e'.repeat(40),to:POOL,blockHash:l.blockHash};
 txs[logs[2].transactionHash].blockHash='0xreorged';
 const m=rpcMock({registered:POOL,logs,txs});
 const r=await lt.analyze({network:'ethereum',address:TOKEN,rpcFn:m.fn,pools:[{pool:POOL,dex:'uniswap_v3',reserveUsd:5}]});
 assert.equal(r.trades.length,2,'row whose tx sits in another block is never shown');
 assert.equal(m.calls.filter(c=>c==='eth_getBlockByNumber').length,1,'only the head read; no per-row block reads');
 assert.equal(r.trades[0].timestamp,new Date(Number(BigInt(ts))*1000).toISOString());
});
test('V3 RPC: V2/V3 pools share one grouped eth_getLogs filter; V4 pools group per PoolManager',async()=>{
 lt._reset();
 const P2='0x'+'d'.repeat(40);
 const logs=[swapLog(990,1,v3data(-2n*10n**18n,5_000_000n)),swapLog(995,3,v3data(10n**18n,-2_500_000n),{address:P2})];
 const txs={};for(const l of logs)txs[l.transactionHash]={from:'0x'+'e'.repeat(40),to:POOL,blockHash:l.blockHash};
 const blocks={'0x3de':{hash:'0xbh990',timestamp:'0x6553f100'},'0x3e3':{hash:'0xbh995',timestamp:'0x6553f200'}};
 const base=rpcMock({registered:POOL,logs,txs,blocks});
 const r=await lt.analyze({network:'ethereum',address:TOKEN,rpcFn:base.fn,pools:[{pool:POOL,dex:'uniswap_v3',reserveUsd:5}]});
 assert.equal(r.trades.length,1);
 // direct check of the grouping helper
 const g=lt._groupsOf([{kind:'V3',emitter:POOL,pool:POOL},{kind:'V2',emitter:P2,pool:P2},{kind:'V4',emitter:'0x'+'4'.repeat(40),pool:'0x'+'1'.repeat(64)},{kind:'V4',emitter:'0x'+'4'.repeat(40),pool:'0x'+'2'.repeat(64)}]);
 assert.equal(g.length,2,'one V2/V3 group + one per PoolManager');
 assert.deepEqual(g[0].filter.address,[POOL,P2]);assert.deepEqual(g[0].filter.topics[0].sort(),[lt.TOPIC.V2,lt.TOPIC.V3].sort());
 assert.deepEqual(g[1].filter.topics[1],['0x'+'1'.repeat(64),'0x'+'2'.repeat(64)]);
});
test('V3: provider 429 gets a bounded retry; persistent rate limiting still surfaces as RPC_RATE_LIMITED',async()=>{
 lt._reset();
 const logs=[swapLog(990,1,v3data(-2n*10n**18n,5_000_000n))];const blocks={'0x3de':{hash:'0xbh990',timestamp:'0x6553f100'}};
 const txs={[logs[0].transactionHash]:{from:'0x'+'e'.repeat(40),to:POOL,blockHash:'0xbh990'}};
 const base=rpcMock({registered:POOL,logs,blocks,txs});let fails=1;
 const flaky=async(m,p)=>{if(m==='eth_getLogs'&&fails-->0)throw Error('HTTP 429 Too Many Requests');return base.fn(m,p);};
 const r=await lt.analyze({network:'ethereum',address:TOKEN,rpcFn:flaky,pools:[{pool:POOL,dex:'uniswap_v3',reserveUsd:5}]});
 assert.equal(r.trades.length,1,'one 429 is absorbed');
 lt._reset();
 const dead=async(m,p)=>{if(m==='eth_getBlockByNumber')throw Error('HTTP 429');return base.fn(m,p);};
 const c=await lt.cached({network:'ethereum',address:TOKEN},()=>lt.analyze({network:'ethereum',address:TOKEN,rpcFn:dead,pools:[{pool:POOL,dex:'uniswap_v3',reserveUsd:5}]}));
 assert.equal(c.status,'UNAVAILABLE');assert.equal(c.reasonCode,'RPC_RATE_LIMITED','never presented as success');
});
test('V3 Synthra-style adapter: unreviewed V3-interface pool proven by factory registry; rows shown ONLY when token Transfers reconcile exactly',async()=>{
 lt._reset();
 const T='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',U='0x'+'9'.repeat(40),pt=a=>'0x'+'0'.repeat(24)+a.slice(2);
 const good=swapLog(990,1,v3data(-2n*10n**18n,5_000_000n)),bad=swapLog(995,3,v3data(10n**18n,-2_500_000n));
 const xfer=(tx,token,from,to,v,b)=>({address:token,topics:[T,pt(from),pt(to)],data:'0x'+v.toString(16).padStart(64,'0'),transactionHash:tx,blockNumber:'0x'+b.toString(16)});
 const transfers=[xfer(good.transactionHash,TOKEN,POOL,U,2n*10n**18n,990),xfer(good.transactionHash,USDC,U,POOL,5_000_000n,990),
  xfer(bad.transactionHash,TOKEN,U,POOL,10n**18n,995),xfer(bad.transactionHash,USDC,POOL,U,2_400_000n,995)];   // USDC leg does not match the Swap
 const blocks={'0x3de':{hash:'0xbh990',timestamp:'0x6553f100'},'0x3e3':{hash:'0xbh995',timestamp:'0x6553f200'}};
 const txs={};for(const l of [good,bad])txs[l.transactionHash]={from:U,to:'0x'+'f'.repeat(40),blockHash:l.blockHash};
 const base=rpcMock({factory:'0x'+'7'.repeat(40),registered:POOL,logs:[good,bad],blocks,txs});
 const fn=async(m,p)=>{
  if(m==='eth_getLogs'&&p[0].topics?.[0]===T){const [,from,to]=p[0].topics;
   return transfers.filter(x=>p[0].address.includes(x.address)&&(!from||from.includes(x.topics[1]))&&(!to||to.includes(x.topics[2]))&&BigInt(x.blockNumber)>=BigInt(p[0].fromBlock)&&BigInt(x.blockNumber)<=BigInt(p[0].toBlock));}
  return base.fn(m,p);};
 const r=await lt.analyze({network:'ethereum',address:TOKEN,rpcFn:fn,pools:[{pool:POOL,dex:'synthra',reserveUsd:5,trades24h:45}]});
 assert.equal(r.pools[0].protocol,'v3-interface-transfer-reconciled');assert.equal(r.pools[0].identity,'REGISTRY_PROVEN_TRANSFER_RECONCILED');
 assert.equal(r.trades.length,1,'only the reconciled swap is shown');
 assert.equal(r.trades[0].side,'BUY');assert.equal(r.trades[0].verification,'ONCHAIN_TRANSFER_RECONCILED');
 assert.deepEqual({checked:r.reconciliation.checked,matched:r.reconciliation.matched},{checked:2,matched:1});
 // factory that does NOT register the pool stays excluded
 lt._reset();
 const r2=await lt.analyze({network:'ethereum',address:TOKEN,rpcFn:rpcMock({factory:'0x'+'7'.repeat(40)}).fn,pools:[{pool:POOL,dex:'synthra',reserveUsd:5,trades24h:45}]});
 assert.equal(r2.pools.length,0);assert.equal(r2.excludedPools[0].reasonCode,'UNREVIEWED_FACTORY');
});
test('V3 honesty: unreconcilable swaps or a short scan window with provider activity are COVERAGE_INCOMPLETE, never "no swaps"',async()=>{
 lt._reset();
 const T='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
 const good=swapLog(990,1,v3data(-2n*10n**18n,5_000_000n));
 const txs={[good.transactionHash]:{from:'0x'+'e'.repeat(40),to:POOL,blockHash:good.blockHash}};
 const base=rpcMock({factory:'0x'+'7'.repeat(40),registered:POOL,logs:[good],blocks:{'0x3de':{hash:'0xbh990',timestamp:'0x6553f100'}},txs});
 const fn=async(m,p)=>{if(m==='eth_getLogs'&&p[0].topics?.[0]===T)throw Error('filter not supported');return base.fn(m,p);};
 const r=await lt.analyze({network:'ethereum',address:TOKEN,rpcFn:fn,pools:[{pool:POOL,dex:'synthra',reserveUsd:5,trades24h:45}]});
 assert.equal(r.trades.length,0);assert.equal(r.status,'COVERAGE_INCOMPLETE');assert.equal(r.reasonCode,'RECONCILIATION_UNAVAILABLE');
 assert.equal(r.reconciliation.status,'TRANSFER_LOGS_UNAVAILABLE');assert.match(r.reconciliation.error,/filter not supported/);
 assert.equal(lt.classify(Error('GeckoTerminal HTTP 429')).reasonCode,'POOL_SOURCE_RATE_LIMITED');
 assert.equal(lt.classify(Error('HTTP 429')).reasonCode,'RPC_RATE_LIMITED');
});
test('V3 Synthra real-trade reconciliation (Arc tx 0x5a01…): fee-skim transfer allowed; both swap legs must match individual transfers',async()=>{
 lt._reset();
 const T='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',U='0x'+'9'.repeat(40),FEE='0x'+'8'.repeat(40),pt=a=>'0x'+'0'.repeat(24)+a.slice(2);
 // POLL is token1 here (USDC token0), exactly like the Synthra pool: amount0=-16541436 USDC, amount1=+119700e18 POLL (a sell)
 const POLLT=TOKEN,USDCT='0x'+'0'.repeat(39)+'1';
 const sell=swapLog(990,1,v3data(-16541436n,119700n*10n**18n));
 const x=(token,from,to,v)=>({address:token,topics:[T,pt(from),pt(to)],data:'0x'+v.toString(16).padStart(64,'0'),transactionHash:sell.transactionHash,blockNumber:'0x3de'});
 const transfers=[x(POLLT,POOL,FEE,399n*10n**18n),x(USDCT,POOL,U,16541436n),x(POLLT,U,POOL,119700n*10n**18n)];
 const txs={[sell.transactionHash]:{from:U,to:'0x'+'f'.repeat(40),blockHash:sell.blockHash}};
 const base=rpcMock({factory:'0x'+'7'.repeat(40),registered:POOL,logs:[sell],blocks:{'0x3de':{hash:'0xbh990',timestamp:'0x6553f100'}},txs});
 const fn=async(m,p)=>{
  if(m==='eth_call'&&p[0].to===POOL&&p[0].data==='0x0dfe1681')return '0x'+'0'.repeat(24)+USDCT.slice(2);
  if(m==='eth_call'&&p[0].to===POOL&&p[0].data==='0xd21220a7')return '0x'+'0'.repeat(24)+POLLT.slice(2);
  if(m==='eth_getLogs'&&p[0].topics?.[0]===T)return transfers.filter(t=>p[0].address.includes(t.address));
  return base.fn(m,p);};
 const r=await lt.analyze({network:'ethereum',address:POLLT,rpcFn:fn,pools:[{pool:POOL,dex:'synthra-arc',reserveUsd:5,trades24h:45}]});
 assert.equal(r.reconciliation.matched,1,'fee skim does not break exact leg matching');assert.equal(r.trades.length,1);assert.equal(r.trades[0].side,'SELL');
 lt._reset();
 const missingOut=transfers.filter(t=>t.topics[2]!==pt(U));
 const fn2=async(m,p)=>{if(m==='eth_getLogs'&&p[0].topics?.[0]===T)return missingOut.filter(t=>p[0].address.includes(t.address));return fn(m,p);};
 const r2=await lt.analyze({network:'ethereum',address:POLLT,rpcFn:fn2,pools:[{pool:POOL,dex:'synthra-arc',reserveUsd:5,trades24h:45}]});
 assert.equal(r2.trades.length,0,'a swap whose payout transfer is missing is never shown');assert.equal(r2.status,'COVERAGE_INCOMPLETE');
});
