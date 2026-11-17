'use strict';
// #262 resumable, checkpointed holder-census benchmark (read-only; CI audit workflow; public Arc RPC; no writes on chain).
// Evidence standard = lib/holder-rpc-discovery.js BENCHMARKED_SPANS: deployment block by eth_getCode binary search, FULL
// Transfer-log scan from deployBlock-1 to ONE pinned block, balanceOf of every candidate at that SAME pinned block, and
// EXACT equality sum(balances) == totalSupply(). A completed log scan alone is never reported as a census.
//
// Checkpoint (JSON, atomic tmp+rename, sha256 over the canonical body):
//  {version,token,chainId,pinned:{number,hash},deployBlock,window,scan:{nextFrom,windows,transfers},candidates:[sorted],
//   balances:{index,sum},phase:'SCAN'|'BALANCES'|'DONE',result?}
// Resume rules: checksum, token, chainId and window must match AND the pinned block must still have the recorded hash (reorg
// check). Anything else -> the checkpoint is rejected and the run starts from scratch (never trusted partially).
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const TRANSFER='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',VERSION=1;
const hex=n=>'0x'+n.toString(16),sleep=ms=>new Promise(r=>setTimeout(r,ms));
function digest(body){const {checksum,...rest}=body;return crypto.createHash('sha256').update(JSON.stringify(rest)).digest('hex');}
function save(file,state){
 const body={...state,candidates:[...state.candidates].sort()};body.checksum=digest(body);
 fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.tmp-'+process.pid;
 fs.writeFileSync(tmp,JSON.stringify(body));fs.renameSync(tmp,file);
}
async function loadValid(file,{token,chainId,window,rpc}){
 let body;try{body=JSON.parse(fs.readFileSync(file,'utf8'));}catch{return {state:null,reason:'NO_CHECKPOINT'};}
 if(body.version!==VERSION||body.checksum!==digest(body))return {state:null,reason:'CHECKSUM_MISMATCH'};
 if(body.token!==token||body.chainId!==chainId||body.window!==window)return {state:null,reason:'IDENTITY_MISMATCH'};
 if(!Array.isArray(body.candidates)||body.candidates.some((a,i)=>!/^0x[0-9a-f]{40}$/.test(a)||i&&a<=body.candidates[i-1]))return {state:null,reason:'CANDIDATES_INVALID'};
 const span=body.scan.nextFrom-(body.deployBlock-1);
 if(span<0||span%window!==0)return {state:null,reason:'RANGE_NOT_CONTIGUOUS'};
 const b=await rpc('eth_getBlockByNumber',[hex(body.pinned.number),false]);
 if(!b||String(b.hash).toLowerCase()!==body.pinned.hash)return {state:null,reason:'PINNED_BLOCK_REORGED'};
 return {state:{...body,candidates:new Set(body.candidates)},reason:'RESUMED'};
}
function makeRpc(urls,{paceMs=120,maxAttempts=10,fetchImpl=fetch}={}){
 const stats={calls:0,retries:0,rateLimited:0};
 const rpc=async(method,params)=>{
  for(let attempt=0;attempt<maxAttempts;attempt++){
   const url=urls[attempt%urls.length];stats.calls++;await sleep(paceMs);
   try{
    const r=await fetchImpl(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(20000)});
    if(r.status===429||r.status===503){stats.rateLimited++;const ra=Number(r.headers?.get?.('retry-after'));throw Object.assign(Error('HTTP '+r.status),{wait:Number.isFinite(ra)&&ra>0?Math.min(30000,ra*1000):null});}
    const d=await r.json();if(d.error){if(/rate|-32005|429/i.test(JSON.stringify(d.error)))stats.rateLimited++;throw Error(JSON.stringify(d.error).slice(0,120));}
    return d.result;
   }catch(e){if(attempt===maxAttempts-1)throw e;stats.retries++;await sleep(e.wait||(/rate|-32005|429/i.test(String(e.message))?2500*(attempt+1):400*(attempt+1)));}
  }
 };
 return {rpc,stats};
}
async function run({token,chainId=5042,rpc,stats,file,window=2000,concurrency=2,deadlineMs,now=Date.now,saveEvery=200,log=()=>{}}){
 const t0=now();const loaded=await loadValid(file,{token,chainId,window,rpc});log('CHECKPOINT',{reason:loaded.reason});
 let s=loaded.state;
 if(!s){
  const head=Number(BigInt(await rpc('eth_blockNumber',[])));const pinBlock=await rpc('eth_getBlockByNumber',[hex(head),false]);
  let lo=0,hi=head;while(hi-lo>1){const mid=Math.floor((lo+hi)/2),c=await rpc('eth_getCode',[token,hex(mid)]);if(c&&c!=='0x')hi=mid;else lo=mid;}
  s={version:VERSION,token,chainId,pinned:{number:head,hash:String(pinBlock.hash).toLowerCase()},deployBlock:hi,window,
   scan:{nextFrom:hi-1,windows:0,transfers:0},candidates:new Set(),balances:{index:0,sum:'0'},phase:'SCAN',startedAt:new Date(t0).toISOString(),runs:0};
  save(file,s);
 }
 s.runs=(s.runs||0)+1;
 const pin=s.pinned.number,timeUp=()=>now()>=deadlineMs;
 if(s.phase==='SCAN'){
  // Windows are claimed in order; a window counts as done only when every lower window is done (contiguous frontier).
  let claim=s.scan.nextFrom;const done=new Map();let sinceSave=0;
  const worker=async()=>{for(;;){if(timeUp())return;const from=claim;if(from>pin)return;claim+=window;const to=Math.min(pin,from+window-1);
   const logs=await rpc('eth_getLogs',[{address:token,topics:[TRANSFER],fromBlock:hex(from),toBlock:hex(to)}]);
   const addrs=[];let n=0;for(const l of logs||[]){if(l.removed)continue;n++;for(const t of [l.topics[1],l.topics[2]])if(t)addrs.push('0x'+t.slice(26).toLowerCase());}
   done.set(from,{addrs,n});
   while(done.has(s.scan.nextFrom)){const w=done.get(s.scan.nextFrom);done.delete(s.scan.nextFrom);for(const a of w.addrs)s.candidates.add(a);s.scan.transfers+=w.n;s.scan.windows++;s.scan.nextFrom+=window;sinceSave++;}
   if(sinceSave>=saveEvery){save(file,s);sinceSave=0;log('PROGRESS',{nextFrom:s.scan.nextFrom,pinned:pin,windows:s.scan.windows,candidates:s.candidates.size,calls:stats?.calls});}}};
  await Promise.all(Array.from({length:concurrency},worker));
  if(s.scan.nextFrom>pin){s.phase='BALANCES';s.candidates.delete('0x0000000000000000000000000000000000000000');}
  save(file,s);
 }
 if(s.phase==='BALANCES'){
  const list=[...s.candidates].sort();let sum=BigInt(s.balances.sum),idx=s.balances.index,sinceSave=0;
  // sequential index frontier with bounded concurrency (same contiguous-commit rule as the scan)
  let claim=idx;const got=new Map();
  const worker=async()=>{for(;;){if(timeUp())return;const i=claim;if(i>=list.length)return;claim++;
   const r=await rpc('eth_call',[{to:token,data:'0x70a08231'+list[i].slice(2).padStart(64,'0')},hex(pin)]);got.set(i,BigInt(r));
   while(got.has(idx)){sum+=got.get(idx);got.delete(idx);idx++;sinceSave++;}
   if(sinceSave>=saveEvery){s.balances={index:idx,sum:sum.toString()};save(file,s);sinceSave=0;}}};
  await Promise.all(Array.from({length:concurrency},worker));
  s.balances={index:idx,sum:sum.toString()};
  if(idx>=list.length){
   const supply=BigInt(await rpc('eth_call',[{to:token,data:'0x18160ddd'},hex(pin)]));
   const anchor=await rpc('eth_getBlockByNumber',[hex(pin),false]);
   s.result={totalSupply:supply.toString(),sum:sum.toString(),exact:sum===supply,anchorStable:String(anchor?.hash).toLowerCase()===s.pinned.hash,candidates:list.length,
    span:pin-s.deployBlock+1,windows:s.scan.windows,transfers:s.scan.transfers};
   s.phase='DONE';
  }
  save(file,s);
 }
 return {phase:s.phase,state:s,elapsedMs:now()-t0,resumed:loaded.reason==='RESUMED',resumeReason:loaded.reason};
}
module.exports={run,save,loadValid,digest,makeRpc,TRANSFER};
if(require.main===module){
 const token=String(process.env.BENCH_TOKEN||'0x178b01f61cbea1d2a5581fe1621be607835ec349').toLowerCase();
 const file=process.env.BENCH_STATE||'.holder-bench/'+token+'.json';
 const budgetMin=Number(process.env.BENCH_MINUTES||70);
 const {rpc,stats}=makeRpc(['https://rpc.mainnet.arc.io','https://rpc.quicknode.mainnet.arc.io']);
 const log=(k,v)=>console.log('BENCH '+k+' '+JSON.stringify(v));
 run({token,rpc,stats,file,deadlineMs:Date.now()+budgetMin*60000,log}).then(r=>{
  const s=r.state;log('RUN',{phase:r.phase,resumed:r.resumed,resumeReason:r.resumeReason,runs:s.runs,elapsedMs:r.elapsedMs,rpc:stats,
   pinned:s.pinned,deployBlock:s.deployBlock,scanNextFrom:s.scan.nextFrom,remainingBlocks:Math.max(0,s.pinned.number-s.scan.nextFrom+1),windows:s.scan.windows,
   transfers:s.scan.transfers,candidates:s.candidates.size,balances:s.balances,result:s.result||null});
 }).catch(e=>{log('ERROR',{error:String(e.message).slice(0,200),rpc:stats});process.exitCode=1;});
}
