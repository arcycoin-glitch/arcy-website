'use strict';
// Chain registry + execution scope for the durable holder index (lib/holder-index.js, holder-storage, balance-reader, publication).
// Default scope = Arc 5042 with EXACTLY the previous behaviour, storage keys and file paths. Other chains run the same code inside
// run(chainId, fn): storage keys become holders:v2:<chainId>:..., local files live in <cache>/chain-<chainId>/, every RPC call of the
// index (core.rpc/call/context, balance-reader) is routed to that chain's throttled client, and the expected chainId follows.
// Robinhood and Pons tokens share chain 4663, so one index per contract serves both sections (no duplicate indexing).
const {AsyncLocalStorage}=require('node:async_hooks'),scope=new AsyncLocalStorage();
// Chain 4663 parameters are measured, not assumed (.github/workflows/data-engine-phase2.yml, 2026-11-21, public RPC):
// block time ~0.105 s; eth_getLogs accepts <= 10,000,000 blocks and <= 10,000 logs per query; state for pinned eth_call is retained
// for >= 1,000 and < 10,000 blocks (no archive); Multicall3 present; bursts answer HTTP 429. Arbitrum Orbit: NUMBER returns the L1 block.
const CHAINS=Object.freeze({
 // Arc: the ledger values are the previous holder-index defaults. rpcEnv/publicRpc/pacing are used ONLY by explicit rpcClient(5042)
 // callers (read-only CI proof scans); the Arc default scope never creates a client and keeps core's own transport.
 5042:Object.freeze({chainId:5042,id:'arc',label:'Arc',source:'Arc RPC',rpcEnv:'ARC_PROOF_RPC_URLS',publicRpc:'https://rpc.mainnet.arc.io',
  ledger:Object.freeze({initialRange:100000,maxRange:100000,maxLogs:1000,balanceChunk:50,grow:false,confirmations:0,positiveOnly:false,minIntervalMs:250,concurrency:1,maxRetries:8})}),
 4663:Object.freeze({chainId:4663,id:'robinhood',label:'Robinhood Chain',source:'Robinhood Chain RPC',
  rpcEnv:'ROBINHOOD_HOLDER_RPC_URLS',publicRpc:'https://rpc.mainnet.chain.robinhood.com',
  ledger:Object.freeze({initialRange:9990000,maxRange:9990000,maxLogs:10000,balanceChunk:200,grow:true,confirmations:20,positiveOnly:true,evmBlockNumber:'L1',
   stateRetentionBlocks:1000,minIntervalMs:150,concurrency:2,maxRetries:6})}),
 // Ethereum (#337), measured by scripts/probe-eth-holder-feasibility.cjs in CI on 2026-11-27: free public endpoints are not archive
 // nodes for STATE (flashbots keeps ~10k blocks; publicnode needs a token for archive), but rpc.flashbots.net answers historical
 // eth_getLogs up to 2,000 blocks per query ("block range greater than 2000 max"; 3,045 LINK Transfer logs in one 2,000-block window).
 // Hence: fixed 1,999-block windows, ledger starts at the receipt-verified creation block (lib/holder-creation.js), balances are
 // reconciled at the recent ledger cursor (within state retention), 64 confirmations (two epochs) for finality.
 1:Object.freeze({chainId:1,id:'ethereum',label:'Ethereum',source:'Ethereum RPC',
  rpcEnv:'ETHEREUM_HOLDER_RPC_URLS',publicRpc:'https://rpc.flashbots.net',
  ledger:Object.freeze({initialRange:1999,maxRange:1999,maxLogs:10000,balanceChunk:200,grow:false,confirmations:64,positiveOnly:true,
   startFromCreation:true,stateRetentionBlocks:10000,minIntervalMs:120,concurrency:2,maxRetries:6})})});
const DEFAULT=CHAINS[5042];
function get(chainId){const c=CHAINS[Number(chainId)];if(!c)throw Object.assign(Error('Unsupported holder chain'),{code:'HOLDER_CHAIN_UNSUPPORTED'});return c;}
function current(){return scope.getStore()?.chain||DEFAULT;}
function enabledChains(env=process.env){return String(env.ARC_HOLDER_CHAINS||'5042').split(',').map(x=>Number(x.trim())).filter(x=>CHAINS[x]);}
// Run `fn` in the chain's scope. For Arc nothing changes. For other chains the index RPC is the chain client (or an injected one).
function run(chainId,fn,{rpc}={}){
 const chain=get(chainId);
 if(chain===DEFAULT&&!rpc)return scope.run({chain},fn);
 const client=rpc||shared(chain.chainId);
 return scope.run({chain,client},()=>require('./search-request').withRpc(client,fn));
}
const clients=new Map();
function shared(chainId){if(!clients.has(chainId))clients.set(chainId,rpcClient(chainId));return clients.get(chainId);}
function client(){return scope.getStore()?.client||null;}
const RANGE=/query spans|exceeds limit|block range|range is too large|too many blocks|logs matched/i;
const HISTORY=/historical state|missing trie node|state .*not available|header not found/i;
// Throttled, bounded-concurrency JSON-RPC client with 429/5xx backoff (Retry-After honoured), failover and a one-time chainId check.
function rpcClient(chainId,{urls,fetcher=globalThis.fetch,env=process.env,sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now}={}){
 const chain=get(chainId),L=chain.ledger;
 const list=(urls||String(env[chain.rpcEnv]||'').split(',').map(s=>s.trim()).filter(Boolean));
 const endpoints=[...new Set([...list,chain.publicRpc].filter(Boolean))];
 for(const u of endpoints){const x=new URL(u);if(x.protocol!=='https:'||x.username||x.password)throw Object.assign(Error('Holder RPC must be HTTPS without credentials'),{code:'HOLDER_RPC_CONFIG_INVALID'});}
 const checked=new Set(),waiters=[];let active=0,last=0,id=0;
 // Adaptive pacing: every 429 raises the shared interval x1.5 (max 1 s); every 10 consecutive successes take 20% off it, never
 // below the measured base. CI 2026-11-21: a x2 / 25-success / max-4 s rule cut 429s to 0.7% but collapsed throughput (interval
 // stuck at 3.3 s, 5,039 calls in 76 min vs 21,783), so recovery must be faster than the penalty.
 let interval=L.minIntervalMs,streak=0;const maxInterval=1000;
 const metrics={calls:0,http429:0,retries:0,backoffMs:0,errors:0,rangeLimited:0,historyUnavailable:0,intervalMs:interval,maxIntervalMs:interval};
 const slower=()=>{interval=Math.min(maxInterval,Math.ceil(interval*1.5));streak=0;metrics.intervalMs=interval;metrics.maxIntervalMs=Math.max(metrics.maxIntervalMs,interval);};
 const faster=()=>{if(++streak>=10&&interval>L.minIntervalMs){interval=Math.max(L.minIntervalMs,Math.floor(interval*0.8));streak=0;metrics.intervalMs=interval;}};
 const acquire=async()=>{if(active>=L.concurrency)await new Promise(r=>waiters.push(r));active++;const gap=last+interval-now();if(gap>0)await sleep(gap);last=now();};
 const release=()=>{active--;const w=waiters.shift();if(w)w();};
 async function post(url,method,params){
  await acquire();
  try{metrics.calls++;const r=await fetcher(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(30000)});
   if(r.status===429||r.status>=500)throw Object.assign(Error('HTTP '+r.status),{code:r.status===429?'RPC_RATE_LIMITED':'RPC_HTTP_ERROR',retryAfterMs:Number(r.headers?.get?.('retry-after'))*1000||0,retryable:true});
   const j=await r.json();
   if(j?.error){const m=String(j.error.message||'');
    if(j.error.code===429||/too many requests/i.test(m))throw Object.assign(Error('RPC 429'),{code:'RPC_RATE_LIMITED',retryable:true});
    if(RANGE.test(m)){metrics.rangeLimited++;throw Object.assign(Error('range'),{code:'RPC_RANGE_LIMIT'});}
    if(HISTORY.test(m)){metrics.historyUnavailable++;throw Object.assign(Error('history'),{code:'HISTORICAL_STATE_UNAVAILABLE'});}
    throw Object.assign(Error('RPC error'),{code:'RPC_CALL_FAILED',rpcCode:j.error.code});}
   if(!j||!Object.hasOwn(j,'result'))throw Object.assign(Error('malformed'),{code:'MALFORMED_RPC_RESPONSE',retryable:true});
   faster();return j.result;
  }catch(e){if(e.name==='TimeoutError'||e.name==='AbortError'||e instanceof TypeError)throw Object.assign(Error('transport'),{code:'RPC_TRANSPORT_FAILED',retryable:true});throw e;}
  finally{release();}
 }
 async function rpc(method,params){
  let lastError;
  for(let attempt=0;attempt<=L.maxRetries;attempt++){
   const url=endpoints[attempt%endpoints.length];
   try{
    if(!checked.has(url)){const cid=Number(BigInt(await post(url,'eth_chainId',[])));if(cid!==chain.chainId)throw Object.assign(Error('chain'),{code:'CHAIN_ID_MISMATCH'});checked.add(url);}
    return await post(url,method,params);
   }catch(e){lastError=e;if(!e.retryable)throw e;metrics.errors++;if(e.code==='RPC_RATE_LIMITED'){metrics.http429++;slower();}
    metrics.retries++;const wait=Math.min(30000,Math.max(e.retryAfterMs||0,500*2**attempt));metrics.backoffMs+=wait;await sleep(wait);}
  }
  throw lastError;
 }
 rpc.metrics=metrics;rpc.chainId=chain.chainId;
 return rpc;
}
module.exports={CHAINS,DEFAULT,get,current,run,client,rpcClient,enabledChains};
