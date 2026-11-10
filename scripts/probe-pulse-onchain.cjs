'use strict';
// Read-only live probe for the Pulse V2 on-chain engine. Public RPC endpoints only, no credentials, nothing is written
// or published. Prints, per network:
//   1. the production-budget scan exactly as /api/pulse?action=onchain would run it (status, window, cost);
//   2. a bounded oldest-first checkpoint-range scan (the Pulse monitor's scan mode);
//   3. a wider measurement scan (more windows, same code path) to show real detected events when the live window is quiet;
//   4. reviewed factory deployments: runtime code present;
//   5. Ethereum positive control: real USDC mint logs and Uniswap V3 PoolCreated logs decoded by the catalogue.
const engine=require('../lib/pulse-onchain/engine'),watchlist=require('../lib/pulse-onchain/watchlist'),catalog=require('../lib/pulse-onchain/catalog'),transport=require('../lib/pulse-onchain/rpc');
const notice=(title,data)=>console.log('::notice title='+title+'::'+JSON.stringify(data).slice(0,3800));
const brief=r=>({status:r.status,complete:r.complete,reasonCode:r.reasonCode||null,window:r.window&&{from:r.window.fromBlock,to:r.window.toBlock,blocks:r.window.blocksCovered,planned:r.window.blocksPlanned,hours:r.window.hoursCovered,narrowed:r.window.spanNarrowed},
 headAgeSeconds:r.head?.ageSeconds??null,confirmation:r.confirmation&&{policy:r.confirmation.policy,lag:r.head?r.head.number-r.confirmation.confirmedHead:null},
 events:(r.events||[]).length,counts:r.counts,diagnostics:r.diagnostics,cost:r.cost&&{rpcCalls:r.cost.rpcCalls,http:r.cost.httpRequests,failovers:r.cost.failovers,providerErrors:r.cost.providerErrors}});
const eventLine=e=>({category:e.category,type:e.type,subject:e.subject.label,at:e.eventTimestamp,tx:e.transactionHash,verification:e.verification,materiality:e.materiality.level,share:e.materiality.shareOfSupplyPpm??null,state:e.stateCheck?.result||null,headline:e.headline});
async function raw(url,method,params){
 const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(15000)});
 const body=await r.json();if(body.error)throw Error(method+' '+JSON.stringify(body.error).slice(0,160));return body.result;
}
(async()=>{
 const out={generatedAt:new Date().toISOString(),chains:{}};let hardFailure=false;
 for(const chain of Object.keys(watchlist.NETWORKS)){
  const cfg=watchlist.network(chain),entry={};
  const started=Date.now();
  const production=await engine.scan({chain,deadlineMs:6500});
  entry.production={...brief(production),ms:Date.now()-started};
  notice('onchain-'+chain+'-production',entry.production);
  await new Promise(r=>setTimeout(r,chain==='arc'?8000:1500));
  const confirmedHead=production.confirmation?.confirmedHead;
  if(Number.isSafeInteger(confirmedHead)){
   const capacity=cfg.span*cfg.maxWindows,fromBlock=Math.max(0,confirmedHead-capacity+1),rangeStarted=Date.now();
   const ranged=await engine.scan({chain,deadlineMs:15000,maxEvents:500,range:{fromBlock,toBlock:confirmedHead}});
   entry.checkpointRange={...brief(ranged),requested:{from:fromBlock,to:confirmedHead,capacity},ms:Date.now()-rangeStarted};
   notice('onchain-'+chain+'-checkpoint-range',entry.checkpointRange);
  }else entry.checkpointRange={status:'NOT_RUN',reasonCode:'CONFIRMED_HEAD_UNAVAILABLE'};
  await new Promise(r=>setTimeout(r,chain==='arc'?8000:1000));
  const wide=await engine.scan({chain,deadlineMs:150000,maxEvents:12,pace:chain==='arc'?450:120,limits:{maxWindows:cfg.maxWindows*8,maxCalls:cfg.maxCalls*8}});
  entry.wide={...brief(wide),events:wide.events.map(eventLine)};
  notice('onchain-'+chain+'-wide',{...brief(wide),sample:wide.events.slice(0,6).map(eventLine)});
  wide.events.slice(0,12).forEach((e,i)=>notice('onchain-'+chain+'-event'+(i+1),eventLine(e)));
  await new Promise(r=>setTimeout(r,chain==='arc'?8000:1000));
  const url=transport.endpoints(chain)[0];
  entry.factories=[];
  for(const f of cfg.factories){
   await new Promise(r=>setTimeout(r,600));
   try{const code=await raw(url,'eth_getCode',[f.address,'latest']);entry.factories.push({label:f.label,address:f.address,codeBytes:(code.length-2)/2});if(code==='0x')hardFailure=true;}
   catch(e){entry.factories.push({label:f.label,address:f.address,error:String(e.message).slice(0,120)});}
  }
  notice('onchain-'+chain+'-factories',entry.factories);
  out.chains[chain]=entry;
 }
 // Arc query-shape matrix: which eth_getLogs shapes does the public endpoint accept? (paced, single calls)
 try{
  const cfg=watchlist.network('arc'),url=transport.endpoints('arc')[0],T=k=>catalog.EVENTS.find(e=>e.key===k).topic0;
  await new Promise(r=>setTimeout(r,10000));
  const head=Number(BigInt(await raw(url,'eth_blockNumber',[]))),ARCY=cfg.tokens[0].address,two=cfg.tokens.slice(0,2).map(t=>t.address),all=cfg.tokens.map(t=>t.address);
  const range=n=>({fromBlock:'0x'+(head-20-n+1).toString(16),toBlock:'0x'+(head-20).toString(16)});
  const shapes=[['1addr-1topic-1000',{address:ARCY,topics:[T('TRANSFER')],...range(1000)}],['1addr-1topic-latest-1000',{address:ARCY,topics:[T('TRANSFER')],fromBlock:'0x'+(head-999).toString(16),toBlock:'0x'+head.toString(16)}],
   ['1addr-2topicOR-1000',{address:ARCY,topics:[[T('OWNERSHIP_TRANSFERRED'),T('UPGRADED')]],...range(1000)}],['1addr-12topicOR-1000',{address:ARCY,topics:[catalog.EVENTS.filter(e=>e.scope==='token').map(e=>e.topic0)],...range(1000)}],
   ['2addr-1topic-1000',{address:two,topics:[T('OWNERSHIP_TRANSFERRED')],...range(1000)}],['9addr-1topic-1000',{address:all,topics:[T('OWNERSHIP_TRANSFERRED')],...range(1000)}],['9addr-1topic-64',{address:all,topics:[T('OWNERSHIP_TRANSFERRED')],...range(64)}],
   ['1addr-mint-filter-1000',{address:ARCY,topics:[T('TRANSFER'),catalog.ZERO_TOPIC],...range(1000)}],['1addr-burn-filter-1000',{address:ARCY,topics:[T('TRANSFER'),null,catalog.ZERO_TOPIC],...range(1000)}],
   ['manager-initialize-1000',{address:cfg.factories[0].address,topics:[T('V4_INITIALIZE')],...range(1000)}],['1addr-1topic-2000',{address:ARCY,topics:[T('TRANSFER')],...range(2000)}],['noaddr-1topic-200',{topics:[T('OWNERSHIP_TRANSFERRED')],...range(200)}],['noaddr-1topic-2000',{topics:[T('OWNERSHIP_TRANSFERRED')],...range(2000)}]];
  const matrix=[];
  for(const [name,filter] of shapes){await new Promise(r=>setTimeout(r,900));try{const logs=await raw(url,'eth_getLogs',[filter]);matrix.push({name,ok:true,logs:logs.length});}catch(e){matrix.push({name,ok:false,error:transport.sanitize(e.message)});}}
  const t0=await raw(url,'eth_getBlockByNumber',['0x'+(head-10000).toString(16),false]);await new Promise(r=>setTimeout(r,900));const t1=await raw(url,'eth_getBlockByNumber',['0x'+head.toString(16),false]);
  out.arcMatrix={head,secondsPer10000Blocks:Number(BigInt(t1.timestamp)-BigInt(t0.timestamp)),matrix};
  notice('onchain-arc-query-matrix',out.arcMatrix);
 }catch(e){notice('onchain-arc-query-matrix',{error:String(e.message).slice(0,200)});}
 // Positive control on real Ethereum logs: the decoder must accept every genuine log of a known shape.
 try{
  const url=transport.endpoints('ethereum')[0],head=Number(BigInt(await raw(url,'eth_blockNumber',[])));
  const range={fromBlock:'0x'+(head-1500).toString(16),toBlock:'0x'+head.toString(16)};
  const T=k=>catalog.EVENTS.find(e=>e.key===k).topic0,USDC=watchlist.network('ethereum').tokens.find(t=>t.symbol==='USDC').address;
  const mints=await raw(url,'eth_getLogs',[{address:USDC,topics:[T('TRANSFER'),catalog.ZERO_TOPIC],...range}]);
  const pools=await raw(url,'eth_getLogs',[{address:watchlist.NETWORKS.ethereum.factories.find(f=>f.architecture==='v3').address,topics:[T('V3_POOL_CREATED')],...range}]);
  const supply=BigInt(await raw(url,'eth_call',[{to:USDC,data:catalog.SELECTORS.totalSupply},'latest']));
  const decodedMints=mints.map(l=>catalog.decode(l)),decodedPools=pools.map(l=>catalog.decode(l));
  const largest=decodedMints.filter(d=>d.details).map(d=>BigInt(d.details.amountRaw)).sort((a,b)=>a<b?1:-1)[0]||0n;
  out.positiveControl={blocks:1501,usdcMintLogs:mints.length,usdcMintDecoded:decodedMints.filter(d=>d.details?.direction==='MINT').length,largestMintPpmOfSupply:Number(largest*1000000n/supply),
   v3PoolCreatedLogs:pools.length,v3PoolCreatedDecoded:decodedPools.filter(d=>d.details?.architecture==='V3_CONCENTRATED').length,rejected:[...decodedMints,...decodedPools].filter(d=>d.rejected).map(d=>d.rejected)};
  notice('onchain-ethereum-positive-control',out.positiveControl);
  if(out.positiveControl.rejected.length)hardFailure=true;
 }catch(e){out.positiveControl={error:String(e.message).slice(0,200)};notice('onchain-ethereum-positive-control',out.positiveControl);}
 console.log(JSON.stringify(out,null,1));
 // Provider reachability from CI is reported, not asserted. Only a wrong address or a decoder rejection of a genuine log fails the probe.
 if(hardFailure)process.exitCode=1;
})();
