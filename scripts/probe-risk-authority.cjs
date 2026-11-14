'use strict';
// Read-only real-network acceptance probe for Risk Engine V4 (issues #226, #234): all reviewed producers, the background
// worker with a durable local store, and the Search request path. Public endpoints only; eth_call / eth_getCode /
// headers only; nothing is signed or sent. Production flags are untouched (set only inside this process).
//
// Hard failures (exit 1):
//  * NOT_CONFIRMED for any rule other than low-pool-liquidity (the only rule with a reviewed negative measurement)
//  * a CONFIRMED / NOT_CONFIRMED finding whose record is not VERIFIED_ONCHAIN from >= 2 operators at one block hash
//  * an authority confirmation outside the reviewed registry routes (same review id of the same capability on every
//    operator, Ethereum only)
//  * a concentration confirmation below 5000 bps, or any producer record failing the strict MetricEvidence contract
//  * a pool-scoped record on a network without a reviewed USD anchor
//  * worker: the job does not complete, the snapshot is missing after a store re-open, or a restarted worker re-runs a
//    job that is not due
//  * Search with the engine flag ON: any producer RPC in the request path, a changed report shape, or riskFindings
//    attached without the public flag
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const shadow=require('../lib/risk-engine/analyze');
const reviewed=require('../lib/risk-engine/reviewed-code');
const evidence=require('../lib/verification/metric-evidence');
const observer=require('../lib/verification/onchain-observer');
const notice=(title,data)=>console.log('::notice title='+title+'::'+JSON.stringify(data).slice(0,3800));
const COHORT=[
 {network:'ethereum',name:'AAVE',address:'0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9'},
 {network:'ethereum',name:'USDC',address:'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'},
 {network:'ethereum',name:'USDT',address:'0xdac17f958d2ee523a2206206994597c13d831ec7'},
 {network:'ethereum',name:'PYUSD',address:'0x6c3ea9036406852006290770bedfcaba0e23a0e8'},
 {network:'ethereum',name:'ONDO',address:'0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3'},
 {network:'ethereum',name:'UNI',address:'0x1f9840a85d5af5bf1d1762f925bdaddc4201f984'},
 {network:'ethereum',name:'USDY',address:'0x96f6ef951840721adbf46ac996b59e0235cb985c'},
 {network:'ethereum',name:'OUSG',address:'0x1b19c19393e2d034d8ff31ff34c81252fcbbee92'},
 {network:'ethereum',name:'USDon',address:'0xace8e719899f6e91831b18ae746c9a965c2119f1'},
 {network:'ethereum',name:'PEPE',address:'0x6982508145454ce325ddbe47a25d4ec3d2311933'},
 {network:'ethereum',name:'SHIB',address:'0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce'},
 {network:'arc',name:'ARCY',address:'0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b'},
 {network:'arc',name:'snapshot-171a',address:'0x171a4217b86a807a64eb94757db6849fb4bdbaa0'},
 {network:'arc',name:'snapshot-1ed9',address:'0x1ed9306725b8b4ca1a1a56d32970e49e64c51dde'},
 {network:'robinhood',name:'TSLA',address:'0x322f0929c4625ed5bad873c95208d54e1c003b2d'},
 {network:'robinhood',name:'AAPL',address:'0xaf3d76f1834a1d425780943c99ea8a608f8a93f9'},
 {network:'robinhood',name:'LINK',address:'0x492641f648a4986844848e0befe66d14817bce34'},
 {network:'robinhood',name:'PONS',address:'0x39dbed3a2bd333467115de45665cc57f813c4571'}
];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pct=(a,p)=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.ceil(s.length*p)-1)];};
async function head(network){
 const url=observer.endpoints(network,{}).endpoints[0].url;
 const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_blockNumber',params:[]}),signal:AbortSignal.timeout(10000)});
 const b=await r.json();return '0x'+(BigInt(b.result)-6n).toString(16);
}
function check(t,r,hard){
 const records=new Map(r.records.map(x=>[x.metricId,x]));
 for(const x of r.records){try{evidence.parseMetricEvidence(x);}catch(e){hard.push(t.name+' '+x.metricId+' contract '+e.message);}}
 if(t.network!=='ethereum'&&r.records.some(x=>x.scope))hard.push(t.name+' pool record without a reviewed USD anchor');
 for(const f of r.findings){
  const metric={'admin-upgrade-authority':'risk.upgrade-authority','privileged-minting':'risk.mint-authority','high-exit-impact':'risk.exit-impact','low-pool-liquidity':'risk.pool-liquidity','sell-transfer-tax':'risk.sell-transfer-tax','top-ten-holder-concentration':'risk.top-ten-concentration'}[f.ruleId];
  if(f.status==='NOT_CONFIRMED'&&f.ruleId!=='low-pool-liquidity')hard.push(t.name+' '+f.ruleId+' NOT_CONFIRMED without a reviewed negative producer');
  if(f.status!=='CONFIRMED'&&f.status!=='NOT_CONFIRMED')continue;
  const x=records.get(metric);
  if(!x||x.state!=='VERIFIED_ONCHAIN'||new Set(x.observations.map(o=>o.source.operator)).size<2||new Set(x.observations.map(o=>o.block.hash)).size!==1)hard.push(t.name+' '+f.ruleId+' verdict without two-operator anchor');
  if(f.ruleId==='admin-upgrade-authority'||f.ruleId==='privileged-minting'){
   const cap=f.ruleId==='privileged-minting'?'mint':'upgrade',ids=new Set((r.operators.authority||[]).map(o=>o.outcome?.[cap]?.reviewId||''));
   if(t.network!=='ethereum'||ids.size!==1||!reviewed.REGISTRY.entries.some(e=>ids.has(e.id)&&e.capability===cap))hard.push(t.name+' '+f.ruleId+' CONFIRMED outside the reviewed routes');
  }
  if(f.ruleId==='top-ten-holder-concentration'&&f.status==='CONFIRMED'&&!(x.value>=5000))hard.push(t.name+' concentration confirmed below threshold');
 }
}
(async()=>{
 for(const k of ['ARC_AUTONOMY_RISK_ENGINE_ENABLED','ARC_AUTONOMY_RISK_PUBLIC_ENABLED','ARC_AUTONOMY_RISK_WORKER_ENABLED','ARC_VERIFICATION_LEDGER_DIR','ARC_HOLDER_PUBLISHED_DIR','UPSTASH_REDIS_REST_URL','ARC_INDEX_REDIS_URL'])delete process.env[k];
 const hard=[],ms={},calls={},byProducer={authority:[],pool:[],concentration:[]},table={},gaps={};
 for(const t of COHORT){
  const row={network:t.network,name:t.name};
  try{
   const block=await head(t.network),r=await shadow.analyze({network:t.network,token:t.address,block,log:()=>{}});
   (ms[t.network]||=[]).push(r.cost.totalMs);(calls[t.network]||=[]).push(r.cost.rpcCalls);for(const k of Object.keys(byProducer))byProducer[k].push(r.cost.byProducer[k]);
   check(t,r,hard);
   const n=table[t.network]||={tokens:0,CONFIRMED:0,NOT_CONFIRMED:0,UNKNOWN:0,STALE:0,CONFLICTING:0,UNSUPPORTED:0};
   n.tokens++;for(const f of r.findings)n[f.status]++;
   for(const g of Object.values(r.evidenceGaps))gaps[t.network+':'+g]=(gaps[t.network+':'+g]||0)+1;
   const auth=r.operators.authority||[];
   Object.assign(row,{block:r.block.number,scope:r.scope,
    findings:Object.fromEntries(r.findings.map(f=>[f.ruleId,f.status+'|'+f.reasonCode])),
    values:Object.fromEntries(r.records.map(x=>[x.metricId,x.state+'|'+(x.value??'')+'|'+x.reasonCode])),
    authority:auth.map(o=>o.operator+':'+o.state+':'+[o.outcome?.upgrade?.reviewId||o.outcome?.upgrade?.reasonCode||'',o.outcome?.mint?.reviewId||o.outcome?.mint?.reasonCode||''].join('/')),
    pool:(r.operators.pool||[]).map(o=>o.operator+':'+o.state+':'+(o.reasonCode||'')+(o.failedAt?'@'+o.failedAt+'#'+o.rpcError:'')),
    concentration:(r.operators.concentration||[]).map(o=>o.operator+':'+o.state+':'+(o.reasonCode||'')+(o.failedAt?'@'+o.failedAt+'#'+o.rpcError:'')),
    gaps:r.evidenceGaps,rpcCalls:r.cost.byProducer,ms:r.cost.totalMs});
  }catch(e){row.error=String(e?.message||e).slice(0,160);}
  notice('risk-'+t.network+'-'+t.name,row);
  await sleep(t.network==='ethereum'?20000:3000);
 }
 notice('risk-coverage-by-network (6 rules x tokens)',table);
 notice('risk-unknown-causes',gaps);
 notice('risk-cost',Object.fromEntries(Object.keys(ms).map(n=>[n,{analyses:ms[n].length,p50Ms:pct(ms[n],.5),p95Ms:pct(ms[n],.95),rpcCallsP50:pct(calls[n],.5),rpcCallsMax:Math.max(...calls[n])}])));
 notice('risk-cost-by-producer',Object.fromEntries(Object.entries(byProducer).map(([k,a])=>[k,{p50:pct(a,.5),max:a.length?Math.max(...a):null}])));

 // ---- background worker with a durable local store (restart-safe) ----
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcy-risk-probe-'));
 const env={ARC_RISK_STORAGE:'local',ARC_RISK_STORE_DIR:dir,ARC_VERIFICATION_LEDGER_DIR:dir,ARC_AUTONOMY_RISK_WORKER_ENABLED:'1'};
 const worker=require('../lib/risk-engine/worker'),store=require('../lib/risk-engine/store');
 try{
  const s=store.open({env}),jobs=[COHORT[6],COHORT[11],COHORT[14]];
  for(const t of jobs)await s.enqueue(t.network,t.address,Date.now()-1);
  const out=await worker.tick({env,options:{maxJobs:3}});
  const reopened=store.open({env}),snaps=[];
  for(const t of jobs){const snap=await reopened.getSnapshot(t.network,t.address),job=await reopened.getJob(t.network,t.address);snaps.push({name:t.name,job:job?.state,snapshot:Boolean(snap),records:snap?.records?.length??0,ledger:snap?.ledger?.history});
   if(job?.state!=='COMPLETE'&&job?.state!=='RETRY')hard.push('worker job '+t.name+' '+job?.state);if(job?.state==='COMPLETE'&&!snap)hard.push('worker snapshot missing '+t.name);}
  worker._reset();
  const restarted=await worker.tick({env,analyze:async()=>{throw Error('not due');}});
  if(restarted.results.length)hard.push('restarted worker re-ran a job that is not due');
  notice('risk-worker',{tick:out.results.map(r=>({network:r.network,state:r.state,reasonCode:r.reasonCode||null,rpcCalls:r.rpcCalls??null,ms:r.ms??null})),durable:snaps,
   metrics:await reopened.getMetrics().then(m=>({queue:m?.queue,totals:m?.totals,jobMs:m?.jobMs,rpcLastHour:m?.rpcLastHour})).catch(()=>null)});
 }catch(e){hard.push('worker probe '+String(e.message).slice(0,80));}

 // ---- Search request path with the engine flag ON (public flag OFF) ----
 const service=require('../search/server/lib/multichain-service');
 for(const t of [COHORT[0],COHORT[11],COHORT[14]]){
  const row={network:t.network,name:t.name};
  try{
   const t0=Date.now(),off=await service.report({network:t.network,address:t.address}),offMs=Date.now()-t0;
   Object.assign(process.env,{ARC_AUTONOMY_RISK_ENGINE_ENABLED:'1',ARC_RISK_STORAGE:'local',ARC_RISK_STORE_DIR:dir});
   const original=global.fetch,producerCalls=[];
   global.fetch=async(url,init)=>{try{const body=init?.body&&JSON.parse(init.body);if(body?.method==='eth_call'&&/0x40c10f19|0xfeaf968c|0xca15c873/.test(body?.params?.[0]?.data||''))producerCalls.push(1);}catch{}return original(url,init);};
   const t1=Date.now();let on;try{on=await service.report({network:t.network,address:t.address});}finally{global.fetch=original;}
   const onMs=Date.now()-t1;
   for(const k of ['ARC_AUTONOMY_RISK_ENGINE_ENABLED','ARC_RISK_STORAGE','ARC_RISK_STORE_DIR'])delete process.env[k];
   row.sameKeys=JSON.stringify(Object.keys(off))===JSON.stringify(Object.keys(on));row.sameCardKeys=JSON.stringify(Object.keys(off.cards))===JSON.stringify(Object.keys(on.cards));
   row.riskFindings='riskFindings' in on;row.producerCalls=producerCalls.length;row.offMs=offMs;row.onMs=onMs;
   const q=await store.open({env}).due(Date.now()+10*86400000,50);row.queued=q.some(x=>x.token===t.address);
   if(!row.sameKeys||!row.sameCardKeys)hard.push(t.name+' engine flag changed the report shape');
   if(row.riskFindings)hard.push(t.name+' riskFindings attached without the public flag');
   if(row.producerCalls)hard.push(t.name+' producer RPC in the Search request path');
   if(!row.queued)hard.push(t.name+' not enqueued');
  }catch(e){row.error=String(e?.message||e).slice(0,160);}
  notice('risk-search-path-'+t.network+'-'+t.name,row);
 }
 fs.rmSync(dir,{recursive:true,force:true});
 if(hard.length){for(const h of hard)console.error('::error::'+h.slice(0,300));process.exit(1);}
})().catch(e=>{console.error('::error::probe failed '+String(e.message).slice(0,200));process.exit(1);});
