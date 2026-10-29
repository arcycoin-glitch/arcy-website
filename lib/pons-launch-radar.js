'use strict';
// pons Launch Radar — newly launched tokens on Robinhood Chain (chain id 4663).
// pons is a launch platform on Robinhood Chain, NOT a fourth blockchain. Everything here is read from
// chain RPC: the factory's TokenLaunched event, the launched pool's Uniswap V3 Swap events, and token/factory
// getters. Sources: https://docs.ponsfamily.com/ (contracts + event ABI; topic0 hashes re-verified by keccak in tests).
// This index is independent: it is not operated by, endorsed by, or partnered with pons.
const keccak=require('./keccak');
const onchain=require('./market-radar-onchain');
const {scanRange,makeRpc,block,blocksPerSecond,firstBlockAtOrAfter,chainlink,erc20Meta,emptyStats,summarize,sanitize,classify}=onchain;
const fail=(code,detail)=>Object.assign(Error(code),{code,detail});
const sel=sig=>'0x'+keccak(Buffer.from(sig)).slice(2,10);
const topic=sig=>keccak(Buffer.from(sig)).toLowerCase();
const PONS=Object.freeze({
 network:'pons',chainId:4663,host:'robinhood',label:'Robinhood Chain',
 docs:'https://docs.ponsfamily.com/',app:'https://www.ponsfamily.com/launchpad',
 explorer:'https://robinhoodchain.blockscout.com',
 weth:'0x0bd7d308f8e1639fab988df18a8011f41eacad73',
 // Official addresses from docs.ponsfamily.com (Contracts). New versions ship as new factories: add via PONS_EXTRA_FACTORIES.
 factories:Object.freeze([
  {address:'0xa5aab3f0c6eeadf30ef1d3eb997108e976351feb',startBlock:8991118,label:'active'},
  {address:'0x0c37a24f5d23a486fa692d1500881d698b1f77a4',startBlock:8600612,label:'legacy'}]),
 launchedTopic:topic('TokenLaunched(address,address,address,address,address,uint256,uint256,uint256,uint256,uint256)'),
 swapTopic:topic('Swap(address,address,int256,int256,uint160,uint128,int24)'),
 sel:{getLaunchedToken:sel('getLaunchedToken(address)'),graduationStatus:sel('graduationStatus(address)'),liquidityPool:sel('liquidityPool()')},
 lookbackSeconds:3*3600,maxItems:10,deadlineMs:50000
});
const extraFactories=(env=process.env)=>String(env.PONS_EXTRA_FACTORIES||'').split(',').map(x=>x.trim().toLowerCase()).filter(x=>/^0x[0-9a-f]{40}$/.test(x)).map(address=>({address,startBlock:0,label:'configured'}));
const factoriesOf=(env=process.env)=>[...PONS.factories,...extraFactories(env).filter(f=>!PONS.factories.some(p=>p.address===f.address))];
const word=(d,i)=>d.slice(2+i*64,2+(i+1)*64);
const addrOf=w=>'0x'+w.slice(-40).toLowerCase();
const hex=n=>'0x'+BigInt(n).toString(16);
const abs=v=>v<0n?-v:v;

function parseLaunch(log,factories,from,to){
 if(!log||log.removed)return null;
 const factory=String(log.address).toLowerCase();
 if(!factories.some(f=>f.address===factory))return null;
 const t=log.topics;
 if(!Array.isArray(t)||t.length!==4||String(t[0]).toLowerCase()!==PONS.launchedTopic)return null;
 if(typeof log.data!=='string'||!/^0x[0-9a-f]{448}$/i.test(log.data))return null; // 7 words
 try{
  const blockNumber=Number(BigInt(log.blockNumber)),logIndex=Number(BigInt(log.logIndex));
  if(!Number.isSafeInteger(blockNumber)||blockNumber<from||blockNumber>to||!Number.isSafeInteger(logIndex))return null;
  const d=log.data;
  return {token:addrOf(t[1]),deployer:addrOf(t[2]),dexFactory:addrOf(t[3]),pairToken:addrOf(word(d,0)),pool:addrOf(word(d,1)),
   dexId:Number(BigInt('0x'+word(d,2))),launchConfigId:Number(BigInt('0x'+word(d,3))),positionId:String(BigInt('0x'+word(d,4))),
   restrictionsEndBlock:Number(BigInt('0x'+word(d,5))),initialBuyAmount:String(BigInt('0x'+word(d,6))),
   factory,blockNumber,logIndex,tx:String(log.transactionHash||'').toLowerCase()};
 }catch{return null;}
}
function parseSwap(log,pools,from,to){
 if(!log||log.removed)return null;
 const pool=String(log.address).toLowerCase();
 if(!pools.has(pool))return null;
 const t=log.topics;
 if(!Array.isArray(t)||t.length!==3||String(t[0]).toLowerCase()!==PONS.swapTopic)return null;
 if(typeof log.data!=='string'||!/^0x[0-9a-f]{320}$/i.test(log.data))return null;
 try{
  const blockNumber=Number(BigInt(log.blockNumber)),logIndex=Number(BigInt(log.logIndex));
  if(!Number.isSafeInteger(blockNumber)||blockNumber<from||blockNumber>to||!Number.isSafeInteger(logIndex))return null;
  const d=log.data;
  return {pool,blockNumber,logIndex,tx:String(log.transactionHash||'').toLowerCase(),
   amount0:BigInt.asIntN(256,BigInt('0x'+word(d,0))),amount1:BigInt.asIntN(256,BigInt('0x'+word(d,1))),sqrtPriceX96:BigInt('0x'+word(d,2))};
 }catch{return null;}
}
// Per-pool aggregate. Logs for one tx are adjacent, so distinct transactions = tx changes (also across scan pieces).
function addPoolSwap(aggs,launch,s){
 let a=aggs.get(s.pool);
 if(!a)aggs.set(s.pool,a={pool:s.pool,swaps:0,txs:0,lastTx:null,buys:0,sells:0,pairVolume:0n,first:s,last:s});
 const tokenIsToken0=launch.token<launch.pairToken,pair=tokenIsToken0?s.amount1:s.amount0;
 a.swaps++;a.pairVolume+=abs(pair);if(pair>0n)a.buys++;else if(pair<0n)a.sells++;
 if(s.tx!==a.lastTx){a.txs++;a.lastTx=s.tx;}
 const before=(x,y)=>x.blockNumber<y.blockNumber||(x.blockNumber===y.blockNumber&&x.logIndex<y.logIndex);
 if(before(s,a.first))a.first=s;if(before(a.last,s))a.last=s;
}
const sortNewest=(a,b)=>b.blockNumber-a.blockNumber||b.logIndex-a.logIndex;
// Launches are unique per token; a re-emitted event for the same token keeps the first (earliest).
function dedupeLaunches(list){const m=new Map();for(const l of list){const k=l.token;if(!m.has(k)||sortNewest(l,m.get(k))>0)m.set(k,l);}return [...m.values()];}

async function readLaunchState(rpc,launch,tag){
 const out={factoryState:false,poolMatchesToken:false,isToken0:null,pairIsWeth:false,graduation:null};
 try{
  const raw=await rpc.call('eth_call',[{to:launch.factory,data:PONS.sel.getLaunchedToken+'0'.repeat(24)+launch.token.slice(2)},tag]);
  if(typeof raw==='string'&&/^0x[0-9a-f]{832}$/i.test(raw)){ // 13 static words
   const exists=BigInt('0x'+word(raw,11))===1n,token=addrOf(word(raw,0)),deployer=addrOf(word(raw,1)),paired=addrOf(word(raw,2));
   out.factoryState=exists&&token===launch.token&&deployer===launch.deployer&&paired===launch.pairToken;
   out.isToken0=BigInt('0x'+word(raw,9))===1n;
   out.supply=String(BigInt('0x'+word(raw,8)));
  }
 }catch{}
 out.pairIsWeth=launch.pairToken===PONS.weth;
 try{
  const raw=await rpc.call('eth_call',[{to:launch.token,data:PONS.sel.liquidityPool},tag]);
  out.poolMatchesToken=typeof raw==='string'&&/^0x[0-9a-f]{64}$/i.test(raw)&&addrOf(word(raw,0))===launch.pool;
 }catch{}
 try{
  const raw=await rpc.call('eth_call',[{to:launch.factory,data:PONS.sel.graduationStatus+'0'.repeat(24)+launch.token.slice(2)},tag]);
  if(typeof raw==='string'&&/^0x[0-9a-f]{192}$/i.test(raw))out.graduation={pairedPrincipalEth:Number(BigInt('0x'+word(raw,0)))/1e18,thresholdEth:Number(BigInt('0x'+word(raw,1)))/1e18,graduated:BigInt('0x'+word(raw,2))===1n};
 }catch{}
 return out;
}
// sqrt price -> price of the launched token in pair token (WETH) using the verified token ordering.
function tokenPriceInPair(sqrtPriceX96,tokenIsToken0,tokenDecimals,pairDecimals=18){
 const s=Number(sqrtPriceX96)/2**96,raw=s*s; // token1 per token0, raw units
 if(!(raw>0)||!Number.isFinite(raw))return null;
 const p=tokenIsToken0?raw*10**(tokenDecimals-pairDecimals):(1/raw)*10**(tokenDecimals-pairDecimals);
 return Number.isFinite(p)&&p>0?p:null;
}
async function buildItems(rpc,launches,aggs,{head,ethUsd,deadline,tag,blockTimes=new Map()}){
 const items=[];
 const timeOf=async n=>{if(blockTimes.has(n))return blockTimes.get(n);const b=await block(rpc,n);blockTimes.set(n,b.timestamp);return b.timestamp;};
 for(const l of launches){
  if(Date.now()>deadline)throw fail('RADAR_ONCHAIN_SCAN_INCOMPLETE',{reason:'time budget',phase:'items'});
  const [meta,state,launchedAt]=await Promise.all([erc20Meta(rpc,l.token,tag),readLaunchState(rpc,l,tag),timeOf(l.blockNumber)]);
  const a=aggs.get(l.pool)||null;
  const tokenIsToken0=state.isToken0!==null?state.isToken0:l.token<l.pairToken;
  const ordered=l.token<l.pairToken===tokenIsToken0;
  const verified={launchEvent:true,factoryState:state.factoryState,poolMatchesToken:state.poolMatchesToken,pairIsWeth:state.pairIsWeth,ordering:ordered,metadata:!!(meta.symbol&&meta.decimals!==null)};
  const evidenceOk=verified.factoryState&&verified.poolMatchesToken&&verified.pairIsWeth&&verified.ordering&&verified.metadata;
  const volumeEth=a?Number(a.pairVolume)/1e18:0;
  const priceEth=a&&meta.decimals!==null?tokenPriceInPair(a.last.sqrtPriceX96,tokenIsToken0,meta.decimals):null;
  const lastAt=a?await timeOf(a.last.blockNumber).catch(()=>null):null;
  items.push({
   network:'pons',chainId:PONS.chainId,address:l.token,symbol:meta.symbol,name:meta.name||meta.symbol,decimals:meta.decimals,
   launchedAt:new Date(launchedAt*1000).toISOString(),launchBlock:l.blockNumber,launchTx:l.tx,deployer:l.deployer,pool:l.pool,
   factory:l.factory,factoryLabel:(factoriesOf().find(f=>f.address===l.factory)||{}).label||null,
   initialBuyEth:Number(BigInt(l.initialBuyAmount))/1e18,
   swaps:a?a.swaps:0,txCount:a?a.txs:0,buys:a?a.buys:0,sells:a?a.sells:0,
   volumeEth,volumeUsd:ethUsd&&evidenceOk?volumeEth*ethUsd.value:null,
   priceEth:evidenceOk?priceEth:null,priceUsd:evidenceOk&&priceEth!==null&&ethUsd?priceEth*ethUsd.value:null,
   graduation:state.graduation,
   lastSwapBlock:a?a.last.blockNumber:null,lastSwapAt:lastAt?new Date(lastAt*1000).toISOString():null,
   freshnessSeconds:Math.max(0,head.timestamp-(lastAt||launchedAt)),
   verification:verified,
   fieldStatus:{
    launchTime:'VERIFIED',contract:'VERIFIED',txCount:'VERIFIED_SINCE_LAUNCH',
    volumeUsd:ethUsd&&evidenceOk?'VERIFIED_SINCE_LAUNCH':'UNAVAILABLE',priceUsd:evidenceOk&&priceEth!==null&&ethUsd?'VERIFIED_LAST_SWAP':'UNAVAILABLE'},
   provenance:{source:'Robinhood Chain RPC',event:'TokenLaunched',topic0:PONS.launchedTopic,factory:l.factory,launchTx:l.tx,
    explorerTx:PONS.explorer+'/tx/'+l.tx,poolUrl:PONS.explorer+'/address/'+l.pool,docs:PONS.docs}
  });
 }
 return items;
}
function envelope(items,{head,ethUsd,window,coverage,extra={}}){
 return {ok:true,network:'pons',chainId:PONS.chainId,asOf:new Date(head.timestamp*1000).toISOString(),
  sourceType:'FIRST_PARTY_ONCHAIN',publicDisplay:true,
  source:'Onchain · pons factory TokenLaunched events + pool Swap events (Robinhood Chain RPC)',
  license:'Public blockchain event and contract data read directly from chain RPC. Independent index; not operated, endorsed or partnered with pons.',
  attribution:{text:'Data: pons factory events on Robinhood Chain · independent index, not operated by pons',url:PONS.app},
  selection:'Newest tokens launched through the official pons factories on Robinhood Chain, newest first. Volume and transaction counts are totals since launch from the launch pool\'s Swap events; USD uses the current Chainlink ETH/USD reference. Launch time is the block timestamp of the TokenLaunched event.',
  referencePrices:ethUsd?{ETH:ethUsd}:{},window,coverage,tokens:items,...extra};
}
const sanitizeErr=e=>sanitize(e?.detail?.reason||e?.message,120);

// ---- live (on-demand) ---------------------------------------------------------------------------
async function inspect({fetcher=fetch,env=process.env,now=Date.now(),ethRpc,lookbackSeconds=PONS.lookbackSeconds}={}){
 const t0=Date.now(),deadline=now+PONS.deadlineMs,rpc=makeRpc('robinhood',{fetcher,env}),stats=emptyStats(),diag={network:'pons',phase:'chain',timings:{}};
 const cfg=onchain.CHAINS.robinhood,learn={cap:Infinity},factories=factoriesOf(env);
 try{
  const chainId=Number(BigInt(await rpc.call('eth_chainId',[])));diag.rpcChainId=chainId;
  if(chainId!==PONS.chainId)throw fail('RADAR_RPC_CHAIN_MISMATCH',{expected:PONS.chainId,got:chainId});
  diag.phase='head';const latest=await block(rpc,'latest'),nowSec=Math.floor(now/1000);
  if(latest.timestamp>nowSec+300||nowSec-latest.timestamp>900)throw fail('RADAR_RPC_HEAD_STALE');
  const head=latest.number>cfg.confirmations+10?await block(rpc,latest.number-cfg.confirmations):latest;
  diag.phase='window';
  const bps=await blocksPerSecond(rpc,head).catch(()=>null);
  const startBlock=await firstBlockAtOrAfter(rpc,head,head.timestamp-lookbackSeconds,{bps});
  const from=Math.max(startBlock.number,Math.min(...factories.map(f=>f.startBlock||0)));
  if(from>head.number)throw fail('RADAR_ONCHAIN_SCAN_INCOMPLETE',{reason:'factory start block is after the chain head'});
  diag.window={fromBlock:from,toBlock:head.number,blocks:head.number-from+1};
  diag.phase='launches';
  const found=[];
  await scanRange(rpc,cfg,from,head.number,{deadline,stats,learn,live:true,filter:{address:factories.map(f=>f.address),topics:[PONS.launchedTopic]},
   parse:(log,f,t)=>parseLaunch(log,factories,f,t),sink:l=>found.push(l)});
  const launches=dedupeLaunches(found).sort(sortNewest).slice(0,PONS.maxItems);
  diag.launchesFound=found.length;diag.scan=summarize(stats);
  const tag=hex(head.number),aggs=new Map();
  diag.phase='swaps';
  if(launches.length){
   const byPool=new Map(launches.map(l=>[l.pool,l])),minBlock=Math.min(...launches.map(l=>l.blockNumber));
   await scanRange(rpc,cfg,minBlock,head.number,{deadline,stats:emptyStats(),learn,live:true,filter:{address:[...byPool.keys()],topics:[PONS.swapTopic]},
    parse:(log,f,t)=>{const s=parseSwap(log,byPool,f,t);return s&&s.blockNumber>=byPool.get(s.pool).blockNumber?s:null;},sink:s=>addPoolSwap(aggs,byPool.get(s.pool),s)});
  }
  diag.phase='references';
  const eth=ethRpc||makeRpc('ethereum',{fetcher,env});
  const ethUsd=await chainlink(eth,'ETH',nowSec).catch(e=>{diag.chainlinkEthError=e.code||sanitize(e.message,60);return null;});
  diag.phase='items';
  const items=await buildItems(rpc,launches,aggs,{head,ethUsd,deadline,tag});
  diag.phase='done';diag.elapsedMs=Date.now()-t0;diag.rpcCalls=rpc.calls;
  const out=envelope(items.map((x,i)=>({rank:i+1,...x})),{head,ethUsd,
   window:{fromBlock:from,toBlock:head.number,from:new Date(startBlock.timestamp*1000).toISOString(),to:new Date(head.timestamp*1000).toISOString(),seconds:head.timestamp-startBlock.timestamp,lookbackHours:lookbackSeconds/3600},
   coverage:{launchesInWindow:found.length,shown:items.length,factories:factories.map(f=>({address:f.address,label:f.label,startBlock:f.startBlock})),logCalls:stats.calls,
    windowScanComplete:true,notes:items.length===0?'No launches from the official pons factories were observed in the window.':null}});
  return {...out,_diagnostics:diag};
 }catch(error){
  diag.elapsedMs=Date.now()-t0;diag.rpcCalls=rpc.calls;if(!diag.scan&&stats.calls)diag.scan=summarize(stats);
  const e=error instanceof Error?error:new Error(String(error));if(!e.code)e.code='RADAR_SOURCE_UNAVAILABLE';
  e.diagnostics={...diag,errorCode:e.code,reason:sanitizeErr(e),failedClass:classify(e)};throw e;
 }
}
const cache=new Map(),inflight=new Map();
async function load(options={}){
 const now=options.now??Date.now(),hit=cache.get('pons');
 if(!options.disableCache&&hit&&hit.expires>now){if(hit.error)throw hit.error;return structuredClone(hit.data);}
 if(!options.disableCache&&inflight.has('pons'))return structuredClone(await inflight.get('pons'));
 const task=inspect(options);if(options.disableCache)return task;
 inflight.set('pons',task);
 try{const data=await task;cache.set('pons',{data,expires:now+300000});return structuredClone(data);}
 catch(error){cache.set('pons',{error,expires:now+60000});throw error;}
 finally{inflight.delete('pons');}
}
// ---- snapshot validation (Railway indexer output) ------------------------------------------------
function validateSnapshot(snap,{now=Date.now(),maxAgeSec=Number(process.env.ARC_RADAR_MAX_AGE_SEC)||1200}={}){
 if(!snap||snap.ok!==true||snap.network!=='pons'||snap.chainId!==PONS.chainId||snap.snapshot?.network!=='pons')throw fail('RADAR_SNAPSHOT_CHAIN_MISMATCH');
 const head=Number(snap.snapshot?.headTimestamp);if(!Number.isFinite(head))throw fail('RADAR_SNAPSHOT_INVALID');
 const age=Math.floor(now/1000)-head;if(age>maxAgeSec||age<-300)throw fail('RADAR_SNAPSHOT_STALE',{ageSeconds:age,maxAgeSec});
 if(!Array.isArray(snap.tokens)||snap.tokens.length>PONS.maxItems)throw fail('RADAR_SNAPSHOT_INVALID');
 const seen=new Set();
 for(const t of snap.tokens){
  if(!/^0x[0-9a-f]{40}$/.test(t?.address||'')||seen.has(t.address)||!t.symbol||!Number.isFinite(Date.parse(t.launchedAt))||!Number.isInteger(t.launchBlock)||!/^0x[0-9a-f]{64}$/.test(t.launchTx||''))throw fail('RADAR_SNAPSHOT_INVALID');
  seen.add(t.address);
 }
 return {...snap,servedFrom:'signed-snapshot',snapshotAgeSeconds:age};
}
module.exports={PONS,factoriesOf,parseLaunch,parseSwap,addPoolSwap,dedupeLaunches,sortNewest,readLaunchState,tokenPriceInPair,buildItems,envelope,inspect,load,validateSnapshot,_cache:cache};
