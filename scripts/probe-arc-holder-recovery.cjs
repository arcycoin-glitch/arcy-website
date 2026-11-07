#!/usr/bin/env node
'use strict';
// Read-only, bounded Arc Holder recovery diagnostics for issue #187. Never writes to the worker, queue, Redis,
// /data, checkpoints or signed publications; never calls ?action=queue or /api/search token reports.
//   PROBE_MODE=meta    : production status (public, read-only) + runtime/interface/proxy/deployment facts for the 5 contracts
//                        + candidate-source availability (status codes only; Cloudflare challenges are recorded, never bypassed)
//   PROBE_MODE=scan    : independent full Transfer-log scan from the deployment block to one pinned block, pinned
//                        Multicall balanceOf reads and exact totalSupply reconciliation for PROBE_CONTRACT (benchmark only;
//                        nothing is published). Bounded by PROBE_MAX_LOG_CALLS / PROBE_MAX_CANDIDATES.
const crypto=require('node:crypto'),fs=require('node:fs');
const RPC=process.env.ARC_RPC_URL||'https://rpc.mainnet.arc.io',BASE=process.env.ARCY_BASE||'https://www.arcyusdc.xyz';
const MODE=process.env.PROBE_MODE||'meta',OUT=process.env.PROBE_OUTPUT||'probe.json';
const FIVE=['0x425ecb63957c78bec278d71cffd49a873dba7777','0x0dc6b79f3c3854e4d74514fd4d29be6c96beee39','0xbbe6aab0ed76e90aea0d1cd978ec231c8adcdf8b','0x5bc5ced48bec9260c8d626269f44e22808b8d2c1','0xf89005ccf237a59eeee1521e74b15c7d8d022ab7'];
const TRANSFER='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const T1155S='0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62',T1155B='0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb';
const MULTICALL='0xca11bde05977b3631167028862be2a173976ca11';
const SLOTS={eip1967Impl:'0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',eip1967Admin:'0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103',eip1967Beacon:'0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50'};
const KNOWN={'06fdde03':'name()','95d89b41':'symbol()','313ce567':'decimals()','18160ddd':'totalSupply()','70a08231':'balanceOf(address)','a9059cbb':'transfer(address,uint256)','23b872dd':'transferFrom(address,address,uint256)','095ea7b3':'approve(address,uint256)','dd62ed3e':'allowance(address,address)','01ffc9a7':'supportsInterface(bytes4)','6352211e':'ownerOf(uint256)','00fdd58e':'balanceOf(address,uint256)','4e1273f4':'balanceOfBatch(address[],uint256[])','e985e9c5':'isApprovedForAll(address,address)','42842e0e':'safeTransferFrom(address,address,uint256)','f242432a':'safeTransferFrom(address,address,uint256,uint256,bytes)','c87b56dd':'tokenURI(uint256)','0e89341c':'uri(uint256)','38d52e0f':'asset()','01e1d114':'totalAssets()','07a2d13a':'convertToAssets(uint256)','6e553f65':'deposit(uint256,address)','5c60da1b':'implementation()','3659cfe6':'upgradeTo(address)','4f1ef286':'upgradeToAndCall(address,bytes)','8da5cb5b':'owner()','5c975abb':'paused()','f851a440':'admin()','52d1902d':'proxiableUUID()','d505accf':'permit(...)','40c10f19':'mint(address,uint256)','42966c68':'burn(uint256)','9dc29fac':'burn(address,uint256)','3644e515':'DOMAIN_SEPARATOR()','7ecebe00':'nonces(address)','248a9ca3':'getRoleAdmin(bytes32)','91d14854':'hasRole(bytes32,address)','150b7a02':'onERC721Received(...)','1626ba7e':'isValidSignature(bytes32,bytes)','f23a6e61':'onERC1155Received(...)','ac9650d8':'multicall(bytes[])','252dba42':'aggregate((address,bytes)[])','3d18b912':'getReward()','c45a0155':'factory()','0902f1ac':'getReserves()','0dfe1681':'token0()','d21220a7':'token1()','022c0d9f':'swap(uint256,uint256,address,bytes)','128acb08':'swap(V3)','ddca3f43':'fee()','3850c7bd':'slot0()','1a686502':'liquidity()','b6b55f25':'deposit(uint256)','2e1a7d4d':'withdraw(uint256)','d0e30db0':'deposit()','3ccfd60b':'withdraw()','e30c3978':'pendingOwner()','715018a6':'renounceOwnership()','f2fde38b':'transferOwnership(address)','b88d4fde':'safeTransferFrom(address,address,uint256,bytes)','a22cb465':'setApprovalForAll(address,bool)','081812fc':'getApproved(uint256)','2eb2c2d6':'safeBatchTransferFrom(...)','4f6ccce7':'tokenByIndex(uint256)','2f745c59':'tokenOfOwnerByIndex(address,uint256)','e8a3d485':'contractURI()','ef8b30f7':'previewDeposit(uint256)','c6e6f592':'convertToShares(uint256)','402d267d':'maxDeposit(address)','ba087652':'redeem(uint256,address,address)','b460af94':'withdraw(uint256,address,address)','cbf0b0c0':'kill/destroy?'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const stats={calls:0,ok:0,http429:0,httpErr:0,rpcErr:0,transport:0,latencyMs:[],retries:0};
let id=0,last=0;const PACE=Math.max(0,Number(process.env.PROBE_PACE_MS)||120);
async function raw(body,timeout=30000){
 for(let attempt=0;;attempt++){
  const wait=last+PACE-Date.now();if(wait>0)await sleep(wait);last=Date.now();
  const t0=Date.now();stats.calls++;let r;
  try{r=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});}
  catch(e){stats.transport++;if(attempt<4){stats.retries++;await sleep(2000*2**attempt);continue;}throw Object.assign(Error('TRANSPORT '+(e.name||'')),{code:'TRANSPORT'});}
  stats.latencyMs.push(Date.now()-t0);
  if(r.status===429||r.status>=500){if(r.status===429)stats.http429++;else stats.httpErr++;if(attempt<6){stats.retries++;const ra=Number(r.headers.get('retry-after'));await sleep(Number.isFinite(ra)&&ra>0?ra*1000:2000*2**attempt);continue;}throw Object.assign(Error('HTTP '+r.status),{code:'HTTP_'+r.status});}
  if(!r.ok){stats.httpErr++;throw Object.assign(Error('HTTP '+r.status),{code:'HTTP_'+r.status});}
  stats.ok++;return r.json();
 }
}
async function rpc(method,params,timeout){const d=await raw({jsonrpc:'2.0',id:++id,method,params},timeout);if(d.error){stats.rpcErr++;throw Object.assign(Error(String(d.error.message||'').slice(0,200)),{code:'RPC_'+d.error.code,rpcCode:d.error.code,data:typeof d.error.data==='string'?d.error.data.slice(0,202):d.error.data??null});}return d.result;}
async function call(to,data,block='latest',from){try{const v=await rpc('eth_call',[{to,data,...(from?{from}:{})},block]);return {ok:true,len:(v.length-2)/2,value:v.length<=2+64*6?v:v.slice(0,2+64*6)+'…'};}catch(e){return {ok:false,code:e.code,message:e.message,data:e.data??null};}}
const hex=n=>'0x'+n.toString(16),pad=a=>a.slice(2).toLowerCase().padStart(64,'0'),addrWord=w=>'0x'+w.slice(-40).toLowerCase();
const sha=s=>crypto.createHash('sha256').update(String(s).toLowerCase()).digest('hex');
function selectors(code){const b=Buffer.from(code.slice(2),'hex'),out=new Set();for(let i=0;i<b.length;i++){const op=b[i];if(op===0x63&&i+4<b.length)out.add(b.subarray(i+1,i+5).toString('hex'));if(op>=0x60&&op<=0x7f)i+=op-0x5f;}return [...out];}
function asciiWord(v){try{const h=v.slice(2);if(h.length>=192){const len=Number(BigInt('0x'+h.slice(64,128)));return Buffer.from(h.slice(128,128+len*2),'hex').toString('utf8').replace(/[^\x20-\x7e]/g,'?');}return Buffer.from(h,'hex').toString('utf8').replace(/\0/g,'').replace(/[^\x20-\x7e]/g,'?');}catch{return null;}}
async function deployBlock(a,head){let lo=0,hi=head,steps=0;while(hi-lo>1){const mid=Math.floor((lo+hi)/2),code=await rpc('eth_getCode',[a,hex(mid)]);if(code&&code.length>2)hi=mid;else lo=mid;steps++;}return {deployBlock:hi,steps};}
async function getJson(url,headers={}){const t0=Date.now();try{const r=await fetch(url,{headers:{accept:'application/json','user-agent':'arcy-search-readonly-probe',...headers},signal:AbortSignal.timeout(25000),redirect:'manual'});const text=await r.text();let d=null;try{d=JSON.parse(text);}catch{}return {http:r.status,ms:Date.now()-t0,server:r.headers.get('server'),cfMitigated:r.headers.get('cf-mitigated'),json:d,head:d?null:text.slice(0,160).replace(/\s+/g,' ')};}catch(e){return {http:null,ms:Date.now()-t0,error:e.name};}}
async function getLogsAdaptive(a,topics,from,to,width){
 // contiguous, shrinking-only on range/cap errors; returns logs and the width that worked
 for(;;){const end=Math.min(to,from+width-1);try{const logs=await rpc('eth_getLogs',[{address:a,...(topics?{topics}:{}),fromBlock:hex(from),toBlock:hex(end)}],45000);if(!Array.isArray(logs))throw Error('malformed');if(logs.length>=10000&&width>1){width=Math.floor(width/2);continue;}return {logs,end,width};}
  catch(e){if(String(e.code).startsWith('RPC_')&&width>1){width=Math.max(1,Math.floor(width/2));continue;}throw e;}}
}
async function production(a){
 const pub=await getJson(BASE+'/api/holders?address='+a);await sleep(2500);
 const st=await getJson(BASE+'/api/holders?address='+a+'&action=status');await sleep(2500);
 const d=pub.json||{},j=st.json?.job||null;
 return {publicationHttp:pub.http,publication:{reasonCode:d.reasonCode||null,lookup:d.publicationLookup||null,holderCount:d.fields?.holderCount?.dataState||null,block:d.block||null,completedAt:d.snapshot?.completedAt||null},
  statusHttp:st.http,job:j?{state:j.state,queued:j.queued,reasonCode:j.reasonCode,retryAt:j.retryAt,attempts:j.attempts,updatedAt:j.updatedAt,hasCompleteSnapshot:j.hasCompleteSnapshot,progress:j.progress}:st.json};
}
async function meta(){
 const out={at:new Date().toISOString(),mode:'meta'};
 out.chainId=await rpc('eth_chainId',[]);const head=Number(BigInt(await rpc('eth_blockNumber',[])));out.head=head;
 const hb=await rpc('eth_getBlockByNumber',[hex(head),false]);out.headTime=new Date(Number(BigInt(hb.timestamp))*1000).toISOString();
 const st=await getJson(BASE+'/api/status');out.status=st.json?{overall:st.json.overall,runtime:st.json.runtime,worker:st.json.worker?.runtime||st.json.holder?.runtime||null,keys:Object.keys(st.json)}:st;
 out.statusRaw=st.json?JSON.stringify(st.json).slice(0,3500):null;
 out.contracts=[];
 for(const a of FIVE){
  const r={address:a};
  try{r.production=await production(a);}catch(e){r.production={error:e.message};}
  const code=await rpc('eth_getCode',[a,'latest']);r.codeBytes=(code.length-2)/2;r.codeSha256=sha(code);
  r.eip1167=/^0x363d3d373d3d3d363d73[0-9a-f]{40}5af43d82803e903d91602b57fd5bf3$/i.test(code)?'0x'+code.slice(22,62):null;
  r.slots={};for(const [k,s] of Object.entries(SLOTS)){const v=await rpc('eth_getStorageAt',[a,s,'latest']);r.slots[k]=/^0x0*$/.test(v)?null:addrWord(v);}
  const sels=selectors(code);r.selectorCount=sels.length;r.knownSelectors=sels.filter(s=>KNOWN[s]).map(s=>KNOWN[s]);r.unknownSelectors=sels.filter(s=>!KNOWN[s]).slice(0,60);
  const impl=r.eip1167||r.slots.eip1967Impl;
  if(r.slots.eip1967Beacon){const b=await call(r.slots.eip1967Beacon,'0x5c60da1b');r.beaconImplementation=b.ok?addrWord(b.value):b;}
  const target=impl||(typeof r.beaconImplementation==='string'?r.beaconImplementation:null);
  if(target){const ic=await rpc('eth_getCode',[target,'latest']);const is=selectors(ic);r.implementation={address:target,codeBytes:(ic.length-2)/2,codeSha256:sha(ic),knownSelectors:is.filter(s=>KNOWN[s]).map(s=>KNOWN[s]),unknownSelectors:is.filter(s=>!KNOWN[s]).slice(0,60)};}
  const self=a,dead='0x000000000000000000000000000000000000dead';
  r.calls={name:await call(a,'0x06fdde03'),symbol:await call(a,'0x95d89b41'),decimals:await call(a,'0x313ce567'),totalSupply:await call(a,'0x18160ddd'),
   balanceOfDead:await call(a,'0x70a08231'+pad(dead)),balanceOfSelf:await call(a,'0x70a08231'+pad(self)),balanceOfZeroFromEOA:await call(a,'0x70a08231'+pad(dead),'latest','0x1111111111111111111111111111111111111111'),
   sup165:await call(a,'0x01ffc9a7'+'01ffc9a7'.padEnd(64,'0')),sup721:await call(a,'0x01ffc9a7'+'80ac58cd'.padEnd(64,'0')),sup1155:await call(a,'0x01ffc9a7'+'d9b67a26'.padEnd(64,'0')),
   owner:await call(a,'0x8da5cb5b'),asset:await call(a,'0x38d52e0f'),totalAssets:await call(a,'0x01e1d114'),implementation:await call(a,'0x5c60da1b'),paused:await call(a,'0x5c975abb'),
   ownerOf1:await call(a,'0x6352211e'+pad('0x1')),uri1:await call(a,'0x0e89341c'+pad('0x1')),balance1155:await call(a,'0x00fdd58e'+pad(dead)+pad('0x1'))};
  for(const k of ['name','symbol'])if(r.calls[k].ok)r.calls[k].text=asciiWord(r.calls[k].value);
  const dep=await deployBlock(a,head);r.deployBlock=dep.deployBlock;r.deploySearchCalls=dep.steps;r.spanToHead=head-dep.deployBlock+1;
  const db=await rpc('eth_getBlockByNumber',[hex(dep.deployBlock),false]);r.deployTime=new Date(Number(BigInt(db.timestamp))*1000).toISOString();
  r.withinApproved10mCap=r.spanToHead<=10000000;
  // Same getters right after deployment and mid-life: does it ever behave as ERC-20?
  const early=dep.deployBlock+10,mid=Math.floor((dep.deployBlock+head)/2);
  r.history={earlyBlock:early,totalSupplyEarly:await call(a,'0x18160ddd',hex(early)),midBlock:mid,totalSupplyMid:await call(a,'0x18160ddd',hex(mid))};
  // First events after deployment (all topics) -> event families
  try{const first=await getLogsAdaptive(a,null,dep.deployBlock,Math.min(head,dep.deployBlock+199999),2000);const fam={};let scanned=dep.deployBlock,windows=0,logs=[...first.logs];let cursor=first.end+1,w=first.width;
   while(logs.length<50&&cursor<=Math.min(head,dep.deployBlock+199999)&&windows<100){const n=await getLogsAdaptive(a,null,cursor,Math.min(head,dep.deployBlock+199999),w);logs.push(...n.logs);cursor=n.end+1;w=n.width;windows++;}
   for(const l of logs){const t=l.topics?.[0]||'none';fam[t]=(fam[t]||0)+1;}r.firstEvents={scannedThrough:cursor-1,logs:logs.length,topic0:fam,transferWithThreeTopics:logs.filter(l=>l.topics?.[0]===TRANSFER&&l.topics.length===3).length,transfer1155:logs.filter(l=>[T1155S,T1155B].includes(l.topics?.[0])).length};}catch(e){r.firstEvents={error:e.code||e.message};}
  // Log-density sample over the whole life (20 evenly spaced 2000-block windows) -> projected Transfer volume
  try{const n=20,sample=[];for(let i=0;i<n;i++){const from=dep.deployBlock+Math.floor((r.spanToHead-2000)*i/(n-1));const x=await getLogsAdaptive(a,[TRANSFER],Math.max(dep.deployBlock,from),Math.min(head,Math.max(dep.deployBlock,from)+1999),2000);sample.push(x.logs.length);}const avg=sample.reduce((s,v)=>s+v,0)/n;r.transferDensity={windows:n,width:2000,perWindow:sample,projectedTransfers:Math.round(avg*r.spanToHead/2000)};}catch(e){r.transferDensity={error:e.code||e.message};}
  // Range acceptance (one call each) for planning a bounded scan
  r.rangeAcceptance={};for(const w of [2000,5000,10000]){const t0=Date.now();try{const l=await rpc('eth_getLogs',[{address:a,topics:[TRANSFER],fromBlock:hex(Math.max(dep.deployBlock,head-w+1)),toBlock:hex(head)}],45000);r.rangeAcceptance[w]={ok:true,logs:l.length,ms:Date.now()-t0};}catch(e){r.rangeAcceptance[w]={ok:false,code:e.code,message:e.message,ms:Date.now()-t0};}}
  out.contracts.push(r);console.log('::notice title=meta-'+a.slice(0,8)+'::'+JSON.stringify({...r,production:undefined}).slice(0,3900));console.log('::notice title=prod-'+a.slice(0,8)+'::'+JSON.stringify(r.production).slice(0,3900));
 }
 // Candidate-source availability (status only; challenges are recorded and never bypassed)
 out.sources={};
 out.sources.arcexplorerStats=await getJson('https://arcexplorer.org/api/v1/stats');
 for(const a of FIVE){out.sources['arcexplorer_'+a.slice(0,8)]=await getJson('https://arcexplorer.org/api/v1/tokens/'+a+'/holders?limit=1&offset=0');}
 out.sources.blockscoutArcIo=await getJson('https://explorer.arc.io/api/v2/tokens/'+FIVE[1]);
 out.sources.etherscanChainlist=await getJson('https://api.etherscan.io/v2/chainlist');
 const cl=out.sources.etherscanChainlist.json;out.sources.etherscanArc=Array.isArray(cl?.result)?cl.result.filter(x=>/arc/i.test(x.chainname||'')||String(x.chainid)==='5042'):null;delete out.sources.etherscanChainlist.json;
 for(const [k,v] of Object.entries(out.sources))if(v&&v.json)v.json=JSON.stringify(v.json).slice(0,400);
 console.log('::notice title=sources::'+JSON.stringify(out.sources).slice(0,3900));
 return out;
}
const word=n=>BigInt(n).toString(16).padStart(64,'0');
function encode(token,addresses){const tuples=addresses.map(a=>token.slice(2).padStart(64,'0')+word(64)+word(36)+('70a08231'+a.slice(2).padStart(64,'0')).padEnd(128,'0'));return '0x252dba42'+word(32)+word(addresses.length)+tuples.map((_,i)=>word(addresses.length*32+i*160)).join('')+tuples.join('');}
function decode(raw,count,block){const w=raw.slice(2).match(/.{64}/g),n=i=>BigInt('0x'+w[i]);if(n(0)!==BigInt(block)||n(2)!==BigInt(count))throw Error('multicall identity mismatch');return Array.from({length:count},(_,i)=>{const start=3+Number(n(3+i)/32n);if(n(start)!==32n)throw Error('bad result');return BigInt('0x'+w[start+1]);});}
async function scan(){
 const a=String(process.env.PROBE_CONTRACT||'').toLowerCase();if(!/^0x[0-9a-f]{40}$/.test(a))throw Error('PROBE_CONTRACT required');
 const maxCalls=Number(process.env.PROBE_MAX_LOG_CALLS)||3000,maxCand=Number(process.env.PROBE_MAX_CANDIDATES)||100000,width0=Math.min(2000,Number(process.env.PROBE_WINDOW)||2000);
 const out={at:new Date().toISOString(),mode:'scan',address:a,limits:{maxCalls,maxCand,window:width0}};const t0=Date.now();
 if(Number(BigInt(await rpc('eth_chainId',[])))!==5042)throw Error('wrong chain');
 const head=Number(BigInt(await rpc('eth_blockNumber',[]))),pin=head-5,pinHex=hex(pin);const pb=await rpc('eth_getBlockByNumber',[pinHex,false]);out.pinnedBlock=pin;out.anchor=pb.hash;
 const dep=await deployBlock(a,pin);out.deployBlock=dep.deployBlock;out.span=pin-dep.deployBlock+2;out.withinApproved10mCap=out.span<=10000000;
 const total=BigInt(await rpc('eth_call',[{to:a,data:'0x18160ddd'},pinHex]));out.totalSupplyRaw=total.toString();
 let cursor=dep.deployBlock-1,width=width0,logCalls=0,transfers=0;const seen=new Set(),ids=new Set();const tScan=Date.now();
 while(cursor<=pin){if(logCalls>=maxCalls){out.stopped='LOG_CALL_CAP';break;}const r=await getLogsAdaptive(a,[TRANSFER],cursor,pin,width);logCalls++;
  for(const l of r.logs){if(l.removed||l.topics.length!==3||l.address.toLowerCase()!==a)continue;const k=l.blockHash+':'+l.logIndex;if(ids.has(k))continue;ids.add(k);transfers++;seen.add(addrWord(l.topics[1]));seen.add(addrWord(l.topics[2]));}
  cursor=r.end+1;width=r.logs.length<250?Math.min(width0,r.width*2):r.width;if(seen.size>maxCand){out.stopped='CANDIDATE_CAP';break;}
  if(logCalls%500===0)console.log(JSON.stringify({progress:cursor,pin,logCalls,candidates:seen.size,elapsedS:Math.round((Date.now()-tScan)/1000)}));}
 out.logScan={calls:logCalls,transfers,candidates:seen.size,throughBlock:Math.min(cursor-1,pin),complete:cursor>pin,elapsedSeconds:Math.round((Date.now()-tScan)/1000)};
 if(cursor<=pin){out.result='NOT_COMPLETE_SCAN_BOUNDED';return out;}
 seen.delete('0x0000000000000000000000000000000000000000');
 for(const b of ['0x000000000000000000000000000000000000dead'])seen.add(b);
 const list=[...seen].sort(),bal=new Map();const tRead=Date.now();let readCalls=0;
 const mcode=await rpc('eth_getCode',[MULTICALL,pinHex]);out.multicallRuntimeSha256=sha(mcode);
 for(let i=0;i<list.length;i+=200){const chunk=list.slice(i,i+200);const v=decode(await rpc('eth_call',[{to:MULTICALL,data:encode(a,chunk)},pinHex]),chunk.length,pin);readCalls++;chunk.forEach((x,j)=>bal.set(x,v[j]));}
 const sum=[...bal.values()].reduce((s,v)=>s+v,0n),anchor2=(await rpc('eth_getBlockByNumber',[pinHex,false])).hash;
 const holders=[...bal.entries()].filter(([x,v])=>v>0n&&x!=='0x000000000000000000000000000000000000dead');
 out.reconciliation={balanceReadCalls:readCalls,elapsedSeconds:Math.round((Date.now()-tRead)/1000),sumRaw:sum.toString(),totalSupplyRaw:total.toString(),exact:sum===total,anchorStable:anchor2===pb.hash,positiveBalanceAddressesExDead:holders.length};
 out.result=sum===total&&anchor2===pb.hash?'EXACT_RECONCILIATION_AT_PINNED_BLOCK':'RECONCILIATION_FAILED';
 out.totalElapsedSeconds=Math.round((Date.now()-t0)/1000);
 return out;
}
(async()=>{
 const out=MODE==='scan'?await scan():await meta();
 const L=stats.latencyMs.sort((x,y)=>x-y),q=p=>L.length?L[Math.min(L.length-1,Math.floor(L.length*p))]:null;
 out.rpcStats={calls:stats.calls,ok:stats.ok,http429:stats.http429,httpErr:stats.httpErr,rpcErr:stats.rpcErr,transport:stats.transport,retries:stats.retries,p50ms:q(0.5),p95ms:q(0.95)};
 fs.writeFileSync(OUT,JSON.stringify(out,null,1));
 const summary=MODE==='scan'?{address:out.address,deployBlock:out.deployBlock,pinnedBlock:out.pinnedBlock,span:out.span,withinApproved10mCap:out.withinApproved10mCap,logScan:out.logScan,reconciliation:out.reconciliation,result:out.result,stopped:out.stopped,rpcStats:out.rpcStats}:{head:out.head,status:out.status,rpcStats:out.rpcStats};
 console.log('::notice title='+MODE+'-summary::'+JSON.stringify(summary).slice(0,3900));
 if(out.statusRaw)console.log('::notice title=status-raw::'+out.statusRaw);
})().catch(e=>{console.error('FAILED',e.code||'',e.message);console.log('::error title=probe-failed::'+(e.code||'')+' '+e.message+' '+JSON.stringify(stats));process.exitCode=1;});
