'use strict';
// Pulse V2 on-chain activity engine.
//
// One bounded, read-only scan per network over a reviewed watch scope (lib/pulse-onchain/watchlist.js):
//   ownership / proxy-admin changes, proxy upgrades, AccessControl role changes, pause state, supply mints and burns,
//   and new pools created for watched tokens at reviewed factory / pool-manager deployments.
//
// Guarantees:
//   - Nothing is inferred. An event exists only if a structurally valid log from a watched emitter was returned
//     by eth_getLogs AND the canonical header at that height still carries the log's block hash.
//   - A provider failure, a refused range, a budget stop or a lagging head is PARTIAL_COVERAGE or
//     PROVIDER_UNAVAILABLE. NO_QUALIFYING_EVENTS is returned only when every planned window was read.
//   - Logs above the confirmed head are reported as ONCHAIN_PENDING_CONFIRMATION, never as confirmed.
//   - Fixed RPC budget and wall-clock deadline per scan; cost is reported with the result.
const crypto=require('node:crypto');
const catalog=require('./catalog'),watchlist=require('./watchlist'),transport=require('./rpc');

const SCHEMA_VERSION=1,MIN_SPAN=64,MAX_EVENTS=12,HEAD_STALE_SECONDS=900,SPARSE_LOGS=250;
// Calls held back from the window scan for header confirmation (one per shown event + head + window start) and two supply reads.
const RESERVE_CALLS=MAX_EVENTS+4;
const RANK={HIGH:0,MEDIUM:1,LOW:2,UNKNOWN:3};
const hex=n=>'0x'+n.toString(16);
function blockNumber(value){
 if(typeof value!=='string'||!/^0x[0-9a-f]{1,14}$/i.test(value))return null;
 const n=Number(BigInt(value));return Number.isSafeInteger(n)?n:null;
}
const fail=(code,extra={})=>Object.assign(Error(code),{code,...extra});
const pad=address=>'0x'+'0'.repeat(24)+address.slice(2);
const eventId=(chainId,tx,logIndex)=>'poc1-'+crypto.createHash('sha256').update(chainId+':'+tx.toLowerCase()+':'+logIndex).digest('hex').slice(0,24);

// The complete log-query plan for one block window: at most 3 + 2 per factory layout group.
function queries(cfg,from,to){
 const range={fromBlock:hex(from),toBlock:hex(to)},out=[];
 // Public endpoints cap the address list of one filter (PublicNode: 10); longer lists are split into several queries.
 const limit=Math.max(1,cfg.maxAddresses||Infinity);
 const chunks=list=>{const parts=[];for(let i=0;i<list.length;i+=limit)parts.push(list.slice(i,i+limit));return parts;};
 const push=(kind,addresses,topics)=>{for(const part of chunks(addresses))out.push({kind,emitters:new Set(part),filter:{address:part,topics,...range}});};
 // Some endpoints also cap the OR-list of one topic position (Arc: 12 refused, 2 accepted); it is split the same way.
 const skipped=new Set(cfg.skipEvents||[]);
 const tokenTopics=catalog.EVENTS.filter(e=>e.scope==='token'&&!skipped.has(e.key)).map(e=>e.topic0);
 const all=cfg.tokens.map(t=>t.address),supply=cfg.tokens.filter(t=>t.supply).map(t=>t.address);
 const transfer=catalog.EVENTS.find(e=>e.key==='TRANSFER').topic0;
 const topicLimit=Math.max(1,cfg.maxTopics||Infinity);
 for(let i=0;i<tokenTopics.length;i+=topicLimit)push('token',all,[tokenTopics.slice(i,i+topicLimit)]);
 push('supply',supply,[[transfer],[catalog.ZERO_TOPIC]]);
 push('supply',supply,[[transfer],null,[catalog.ZERO_TOPIC]]);
 // Base assets (stablecoins, wrapped native) pair with every new token; only non-base watched tokens select a pool.
 const poolTokens=cfg.tokens.filter(t=>!t.base).map(t=>pad(t.address));
 if(poolTokens.length)for(const positions of [[1,2],[2,3]]){
  const events=catalog.EVENTS.filter(e=>e.scope==='factory'&&e.tokenTopics.join()===positions.join());
  const factories=cfg.factories.filter(f=>events.some(e=>e.architecture===f.architecture));
  if(!factories.length)continue;
  const addresses=factories.map(f=>f.address),topic0=events.filter(e=>factories.some(f=>f.architecture===e.architecture)).map(e=>e.topic0);
  // One unfiltered creation query (tokens matched after decoding) where calls are scarcer than logs; otherwise
  // one query per indexed token position so the node filters to watched tokens.
  if(cfg.factoryTokenFilter===false){push('factory',addresses,[topic0]);continue;}
  for(const position of positions){
   const topics=[topic0];for(let i=1;i<position;i++)topics.push(null);topics.push(poolTokens);
   push('factory',addresses,topics);
  }
 }
 return out;
}

function candidate(cfg,query,log,from,to,counts){
 const decoded=catalog.decode(log);
 const reject=reason=>{counts.rejected[reason]=(counts.rejected[reason]||0)+1;return null;};
 if(decoded.rejected)return reject(decoded.rejected);
 const emitter=log.address.toLowerCase(),block=blockNumber(log.blockNumber);
 if(!query.emitters.has(emitter))return reject('EMITTER_NOT_WATCHED');
 if(block===null||block<from||block>to)return reject('OUTSIDE_QUERIED_RANGE');
 const {event,details}=decoded;
 if(query.kind==='token'&&event.scope!=='token')return reject('SCOPE_MISMATCH');
 if(query.kind==='supply'&&event.key!=='TRANSFER')return reject('SCOPE_MISMATCH');
 let subject;
 if(query.kind==='factory'){
  const factory=cfg.factories.find(f=>f.address===emitter);
  if(event.scope!=='factory'||factory.architecture!==event.architecture)return reject('SCOPE_MISMATCH');
  const watched=[details.token0,details.token1].map(a=>cfg.bySymbol.get(a)).filter(Boolean);
  if(!watched.some(t=>!t.base)||details.token0===details.token1)return reject('POOL_NOT_IN_SCOPE');
  subject={address:emitter,label:factory.label,role:'FACTORY',reference:factory.reference};
  details.watchedTokens=watched.map(t=>t.symbol);
  details.counterpartWatched=watched.length===2;
 }else{
  const token=cfg.bySymbol.get(emitter);
  subject={address:emitter,label:token.symbol,role:'TOKEN_CONTRACT'};
 }
 if(event.key==='OWNERSHIP_TRANSFERRED'&&details.previousOwner===details.newOwner)return reject('NO_STATE_CHANGE');
 if(event.key==='ADMIN_CHANGED'&&details.previousAdmin===details.newAdmin)return reject('NO_STATE_CHANGE');
 const logIndex=Number(BigInt(log.logIndex));
 return {id:eventId(cfg.chainId,log.transactionHash,logIndex),event,details,subject,block,logIndex,
  blockHash:log.blockHash.toLowerCase(),transactionHash:log.transactionHash.toLowerCase()};
}

function baseMateriality(c){
 switch(c.event.category){
  case 'OWNERSHIP_CHANGE':return c.details.pending?{level:'MEDIUM',basis:'Two-step ownership transfer started; the nominated owner has not accepted.'}:{level:'HIGH',basis:c.details.renounced?'Ownership moved to the zero address (renounced).':'Contract owner changed.'};
  case 'CONTRACT_UPGRADE':return {level:'HIGH',basis:'Proxy implementation / beacon pointer changed; contract logic may differ from before.'};
  case 'ADMIN_CHANGE':return {level:'HIGH',basis:'Proxy administrator changed; this account controls upgrades.'};
  case 'ROLE_CHANGE':return c.details.defaultAdminRole?{level:'HIGH',basis:'DEFAULT_ADMIN_ROLE membership changed; this role administers other roles.'}:{level:'MEDIUM',basis:'AccessControl role membership changed. The role identifier is reported; its permissions are not inferred.'};
  case 'PAUSE_STATE':return {level:'HIGH',basis:c.details.paused?'Contract emitted a pause event.':'Contract emitted an unpause event.'};
  case 'NEW_POOL':return c.details.counterpartWatched?{level:'MEDIUM',basis:'New pool between two watched contracts.'}:{level:'LOW',basis:'Counterpart token is outside the reviewed scope. Pool creation is permissionless.'};
  default:return {level:'UNKNOWN',basis:'Supply share not yet computed.'};
 }
}
function supplyMateriality(amountRaw,totalSupplyRaw){
 const amount=BigInt(amountRaw),total=BigInt(totalSupplyRaw);
 if(total<=0n)return {level:'UNKNOWN',basis:'Total supply is zero at the pinned block.'};
 const ppm=Number(amount*1000000n/total);
 return {level:ppm>=10000?'HIGH':ppm>=1000?'MEDIUM':'LOW',shareOfSupplyPpm:ppm,basis:'Amount is '+(ppm/10000).toFixed(ppm<100?4:2)+'% of totalSupply() read at the scan head block (not at the event block).'};
}
function freshness(seconds){
 if(!Number.isFinite(seconds)||seconds<0)return {status:'UNKNOWN',ageSeconds:null};
 return {status:seconds<21600?'LIVE':seconds<86400?'FRESH':seconds<604800?'RECENT':'AGED',ageSeconds:Math.round(seconds)};
}
const short=a=>a?a.slice(0,6)+'…'+a.slice(-4):'unknown';
function describe(c){
 const d=c.details,s=c.subject.label;
 switch(c.event.key){
  case 'OWNERSHIP_TRANSFERRED':return d.renounced?[s+': ownership renounced','Owner changed from '+short(d.previousOwner)+' to the zero address.']:[s+': contract owner changed','Owner changed from '+short(d.previousOwner)+' to '+short(d.newOwner)+'.'];
  case 'OWNERSHIP_TRANSFER_STARTED':return [s+': ownership transfer started',short(d.previousOwner)+' nominated '+short(d.pendingOwner)+' as the next owner. Not effective until accepted.'];
  case 'UPGRADED':return [s+': proxy implementation upgraded','Implementation pointer set to '+short(d.implementation)+'.'];
  case 'BEACON_UPGRADED':return [s+': beacon changed','Beacon pointer set to '+short(d.beacon)+'.'];
  case 'ADMIN_CHANGED':return [s+': proxy admin changed','Proxy admin changed from '+short(d.previousAdmin)+' to '+short(d.newAdmin)+'.'];
  case 'ROLE_GRANTED':case 'ROLE_REVOKED':return [s+': role '+(d.granted?'granted':'revoked'),(d.defaultAdminRole?'DEFAULT_ADMIN_ROLE':'Role '+d.role.slice(0,10)+'…')+' '+(d.granted?'granted to ':'revoked from ')+short(d.account)+' by '+short(d.sender)+'.'];
  case 'PAUSED':case 'PAUSE_LEGACY':return [s+': contract paused','The contract emitted a pause event'+(d.account?' (caller '+short(d.account)+')':'')+'.'];
  case 'UNPAUSED':case 'UNPAUSE_LEGACY':return [s+': contract unpaused','The contract emitted an unpause event'+(d.account?' (caller '+short(d.account)+')':'')+'.'];
  case 'TRANSFER':case 'ISSUE_LEGACY':case 'REDEEM_LEGACY':return [s+': supply '+(d.direction==='MINT'?'minted':'burned'),(d.direction==='MINT'?'Mint':'Burn')+' of '+d.amountRaw+' base units'+(d.account?(d.direction==='MINT'?' to ':' from ')+short(d.account):'')+'.'];
  default:return [d.watchedTokens.join(' / ')+': new '+d.architecture.split('_')[0]+' pool created','Pool for '+short(d.token0)+' / '+short(d.token1)+' created at '+c.subject.label+'. Creation does not prove liquidity or endorsement.'];
 }
}

// `limits` ({span,maxWindows,maxCalls}) exists for offline measurement probes; production callers use the reviewed defaults.
async function scan({chain,now=Date.now(),fetcher=fetch,env=process.env,urls=null,deadlineMs=8000,maxEvents=MAX_EVENTS,limits=null,pace=null,range=null}={}){
 const cfg={...watchlist.network(chain),...(limits||{})};
 const scope={contracts:cfg.tokens.length,tokens:cfg.tokens.map(t=>t.symbol),factories:cfg.factories.map(f=>f.label),
  categories:[...new Set(catalog.EVENTS.filter(e=>!(cfg.skipEvents||[]).includes(e.key)&&(e.scope!=='factory'||cfg.factories.some(f=>f.architecture===e.architecture))).map(e=>e.category))]};
 const base={schemaVersion:SCHEMA_VERSION,engine:'pulse-onchain',chain,chainId:cfg.chainId,generatedAt:new Date(now).toISOString(),scope};
 const counts={rawLogs:0,rejected:{},duplicates:0,reorged:0,filtered:{belowMateriality:0,materialityUnknown:0,netZeroInTransaction:0,overflow:0}};
 const diagnostics=[];const note=entry=>{if(diagnostics.length<6)diagnostics.push(entry);};
 let rpc;
 const unavailable=(reasonCode)=>({...base,status:'PROVIDER_UNAVAILABLE',complete:false,reasonCode,events:[],counts,
  emptyState:'On-chain activity could not be read for '+cfg.label+' ('+reasonCode+'). This is a data-source failure, not a quiet network.',diagnostics,cost:rpc?.cost||{rpcCalls:0,httpRequests:0}});
 try{rpc=transport.create({chainId:cfg.chainId,urls:urls||transport.endpoints(chain,env),fetcher,maxCalls:cfg.maxCalls,deadlineAt:Date.now()+deadlineMs,batch:cfg.batch!==false,paceMs:pace??cfg.paceMs??0});}
 catch(error){return unavailable(error.code||'ONCHAIN_RPC_NOT_CONFIGURED');}

 // 1. Head and confirmation boundary.
 let head,confirmation;
 try{
  const [headRaw,finalized]=await rpc.batch([{method:'eth_blockNumber',params:[]},{method:'eth_getBlockByNumber',params:['finalized',false]}]);
  head=headRaw.ok?blockNumber(headRaw.result):null;
  if(head===null)throw fail('ONCHAIN_HEAD_INVALID');
  const final=finalized.ok?blockNumber(finalized.result?.number):null;
  confirmation=final!==null&&final<=head?{policy:'FINALIZED_TAG',confirmedHead:final}:
   {policy:'DEPTH_FALLBACK',depth:cfg.confirmationDepth,confirmedHead:Math.max(0,head-cfg.confirmationDepth),assumption:'Node returned no finalized block; '+cfg.confirmationDepth+' confirmations are treated as confirmed. This is an operational threshold, not a finality proof.'};
 }catch(error){return unavailable(error.code||'ONCHAIN_HEAD_UNAVAILABLE');}

 // 2. Bounded window scan, newest first. A refused range / result cap halves the span; a sparse window doubles the
 //    next one up to cfg.maxSpan (never after a refusal). The scan is complete once maxWindows windows were read AND
 //    at least the planned minimum (span x maxWindows blocks, or back to genesis) is covered.
 const rangeMode=range!==null;
 if(rangeMode&&(!range||!Number.isSafeInteger(range.fromBlock)||range.fromBlock<0||!Number.isSafeInteger(range.toBlock)||range.toBlock<range.fromBlock))return unavailable('ONCHAIN_RANGE_INVALID');
 const maxSpan=Math.max(cfg.span,cfg.maxSpan||cfg.span);
 const lowest=rangeMode?range.fromBlock:Math.max(0,head-Math.min(head+1,cfg.span*cfg.maxWindows)+1);
 const scanTo=rangeMode?Math.min(range.toBlock,confirmation.confirmedHead):head;
 const planned=rangeMode?Math.max(0,scanTo-lowest+1):Math.min(head+1,cfg.span*cfg.maxWindows);
 if(rangeMode&&planned===0)return {...base,status:'PARTIAL_COVERAGE',complete:false,reasonCode:'ONCHAIN_RANGE_NOT_READY',window:{fromBlock:range.fromBlock,toBlock:null,blocksCovered:0,blocksPlanned:range.toBlock-range.fromBlock+1,windowsRead:0,spanNarrowed:0},head:{number:head,timestamp:null,ageSeconds:null,stale:false},confirmation,events:[],counts,diagnostics,cost:rpc.cost,emptyState:'The requested checkpoint range is not finalized yet.'};
 let to=rangeMode?scanTo:head,position=lowest,span=cfg.span,coveredFrom=null,coveredTo=null,stopReason=null,narrowed=0,windows=0;const found=new Map();
 const accept=async(from,toBlock)=>{
  const plan=queries(cfg,from,toBlock);
  if(rpc.remainingCalls()<plan.length+RESERVE_CALLS)throw fail('ONCHAIN_RPC_BUDGET_EXHAUSTED');
  const answers=await rpc.batch(plan.map(q=>({method:'eth_getLogs',params:[q.filter]})));
  const refused=answers.findIndex(a=>!a.ok||!Array.isArray(a.result));
  if(refused>=0)throw fail('ONCHAIN_LOG_QUERY_REJECTED',{detail:answers[refused].detail||null,query:plan[refused].kind});
  const capped=answers.findIndex(a=>a.result.length>=cfg.truncationAt);
  if(capped>=0)throw fail('ONCHAIN_RANGE_LIMIT',{detail:'RESULT_CAP '+answers[capped].result.length+' logs',query:plan[capped].kind});
  let logs=0;
  answers.forEach((answer,i)=>{for(const log of answer.result){
   counts.rawLogs++;logs++;
   const item=candidate(cfg,plan[i],log,from,toBlock,counts);
   if(!item)continue;
   if(found.has(item.id)){counts.duplicates++;continue;}
   found.set(item.id,item);
  }});
  return logs;
 };
 if(rangeMode){
  // Checkpointed scans are oldest-first so a partial scan can advance only through a contiguous proven prefix.
  while(position<=scanTo&&windows<cfg.maxWindows){
   const from=position,toBlock=Math.min(scanTo,from+span-1);
   try{const logs=await accept(from,toBlock);coveredFrom??=from;coveredTo=toBlock;position=toBlock+1;windows++;if(!narrowed&&logs<SPARSE_LOGS)span=Math.min(maxSpan,span*2);}
   catch(error){note({step:'window',code:error.code,span,query:error.query||null,detail:error.detail||null,httpStatus:error.httpStatus||null});if(error.code==='ONCHAIN_RANGE_LIMIT'&&span>MIN_SPAN){span=Math.max(MIN_SPAN,Math.floor(span/2));narrowed++;continue;}stopReason=error.code||'ONCHAIN_SCAN_FAILED';break;}
  }
  if(position<=scanTo&&!stopReason)stopReason=windows>=cfg.maxWindows?'ONCHAIN_WINDOW_LIMIT':'ONCHAIN_WINDOW_INCOMPLETE';
 }else{
  while(to>=0&&(windows<cfg.maxWindows||coveredFrom>lowest)){
   const from=Math.max(0,to-span+1);
   try{const logs=await accept(from,to);coveredFrom=from;coveredTo=coveredTo===null?to:Math.max(coveredTo,to);to=from-1;windows++;if(!narrowed&&logs<SPARSE_LOGS)span=Math.min(maxSpan,span*2);}
   catch(error){note({step:'window',code:error.code,span,query:error.query||null,detail:error.detail||null,httpStatus:error.httpStatus||null});if(error.code==='ONCHAIN_RANGE_LIMIT'&&span>MIN_SPAN){span=Math.max(MIN_SPAN,Math.floor(span/2));narrowed++;continue;}stopReason=error.code||'ONCHAIN_SCAN_FAILED';break;}
  }
 }
 if(coveredFrom===null)return unavailable(stopReason||'ONCHAIN_SCAN_FAILED');
 const complete=rangeMode?(!stopReason&&coveredTo===scanTo):(!stopReason&&coveredFrom<=lowest);
 const items=[...found.values()];

 // 3. Materiality. Supply share needs totalSupply() at the head block for each token with supply events.
 const supplyTokens=[...new Set(items.filter(c=>c.event.category==='SUPPLY_CHANGE').map(c=>c.subject.address))];
 const totals=new Map();
 const affordable=Math.max(0,Math.min(supplyTokens.length,rpc.remainingCalls()-(maxEvents+2)));
 if(affordable>0)try{
  const answers=await rpc.batch(supplyTokens.slice(0,affordable).map(a=>({method:'eth_call',params:[{to:a,data:catalog.SELECTORS.totalSupply},hex(head)]})));
  answers.forEach((a,i)=>{if(a.ok&&/^0x[0-9a-f]{64}$/i.test(a.result||''))totals.set(supplyTokens[i],BigInt(a.result).toString());});
 }catch(error){note({step:'totalSupply',code:error.code||'READ_FAILED',detail:error.detail||null});/* materiality stays UNKNOWN; those events are counted, not shown */}
 // A mint and a burn of the same token inside ONE transaction (flash mint, wrap-and-unwrap, bridge round trip) is not
 // a supply change. Opposite legs are netted per (transaction, token); a zero net removes both, a non-zero net keeps
 // one event carrying the net amount. Live Ethereum evidence: DAI flash mints of 6.9% and 11.1% of supply.
 const legs=new Map();
 for(const c of items)if(c.event.category==='SUPPLY_CHANGE'){const k=c.transactionHash+':'+c.subject.address;if(!legs.has(k))legs.set(k,[]);legs.get(k).push(c);}
 const dropped=new Set();
 for(const group of legs.values()){
  const minted=group.filter(c=>c.details.direction==='MINT').reduce((n,c)=>n+BigInt(c.details.amountRaw),0n),burned=group.filter(c=>c.details.direction==='BURN').reduce((n,c)=>n+BigInt(c.details.amountRaw),0n);
  if(minted===0n||burned===0n)continue;
  const net=minted-burned,direction=net>0n?'MINT':'BURN';
  const keep=net===0n?null:group.filter(c=>c.details.direction===direction).sort((a,b)=>b.logIndex-a.logIndex)[0];
  for(const c of group)if(c!==keep){dropped.add(c.id);counts.filtered.netZeroInTransaction++;}
  if(keep){keep.details={...keep.details,amountRaw:(net>0n?net:-net).toString(),netOfTransaction:true,account:null};}
 }
 const netted=items.filter(c=>!dropped.has(c.id));
 for(const c of netted)c.materiality=c.event.category==='SUPPLY_CHANGE'?(totals.has(c.subject.address)?supplyMateriality(c.details.amountRaw,totals.get(c.subject.address)):{level:'UNKNOWN',basis:'totalSupply() was not readable at the scan head block.'}):baseMateriality(c);
 const kept=netted.filter(c=>{
  if(c.materiality.level==='UNKNOWN'){counts.filtered.materialityUnknown++;return false;}
  if(c.materiality.level==='LOW'){counts.filtered.belowMateriality++;return false;}
  return true;
 }).sort((a,b)=>RANK[a.materiality.level]-RANK[b.materiality.level]||b.block-a.block||b.logIndex-a.logIndex);
 counts.filtered.overflow=Math.max(0,kept.length-maxEvents);
 const selected=kept.slice(0,maxEvents);

 // 4. Reorg-aware confirmation: re-read the canonical header at each event height and compare block hashes.
 const heights=[...new Set([head,coveredFrom,coveredTo,...selected.map(c=>c.block)])],headers=new Map();let headersRead=false;
 try{
  const answers=await rpc.batch(heights.map(h=>({method:'eth_getBlockByNumber',params:[hex(h),false]})));
  answers.forEach((a,i)=>{const b=a.ok?a.result:null;if(b&&/^0x[0-9a-f]{64}$/i.test(b.hash||'')&&blockNumber(b.timestamp)!==null)headers.set(heights[i],{hash:b.hash.toLowerCase(),timestamp:blockNumber(b.timestamp)});});
  headersRead=true;
 }catch(error){note({step:'headers',code:error.code||'READ_FAILED',detail:error.detail||null});stopReason=stopReason||error.code||'ONCHAIN_HEADER_READ_FAILED';}
 const confirmedItems=headersRead?selected.filter(c=>{const h=headers.get(c.block);if(h&&h.hash===c.blockHash)return true;counts.reorged++;return false;}):selected;

 // 5. Best-effort state corroboration at the head block (never downgrades a confirmed log).
 const checks=[];
 for(const c of confirmedItems){
  if(c.event.key==='OWNERSHIP_TRANSFERRED')checks.push({c,call:{method:'eth_call',params:[{to:c.subject.address,data:catalog.SELECTORS.owner},hex(head)]},expect:r=>/^0x0{24}[0-9a-f]{40}$/i.test(r)?('0x'+r.slice(26).toLowerCase()===c.details.newOwner):null});
  else if(c.event.key==='UPGRADED')checks.push({c,call:{method:'eth_getStorageAt',params:[c.subject.address,catalog.IMPLEMENTATION_SLOT,hex(head)]},expect:r=>/^0x[0-9a-f]{64}$/i.test(r)&&!/^0x0+$/.test(r)?('0x'+r.slice(26).toLowerCase()===c.details.implementation):null});
  else if(['PAUSED','UNPAUSED','PAUSE_LEGACY','UNPAUSE_LEGACY'].includes(c.event.key))checks.push({c,call:{method:'eth_call',params:[{to:c.subject.address,data:catalog.SELECTORS.paused},hex(head)]},expect:r=>/^0x0{63}[01]$/.test(r)?((r.slice(-1)==='1')===c.details.paused):null});
 }
 const affordableChecks=checks.slice(0,Math.max(0,rpc.remainingCalls()));
 if(affordableChecks.length)try{
  const answers=await rpc.batch(affordableChecks.map(x=>x.call));
  answers.forEach((a,i)=>{const verdict=a.ok&&typeof a.result==='string'?affordableChecks[i].expect(a.result):null;
   affordableChecks[i].c.stateCheck={atBlock:head,method:affordableChecks[i].call.method,result:verdict===true?'IN_EFFECT_AT_HEAD':verdict===false?'DIFFERENT_AT_HEAD':'NOT_CORROBORATED'};});
 }catch{/* corroboration is optional evidence */}

 const headHeader=headers.get(head),fromHeader=headers.get(coveredFrom),toHeader=headers.get(coveredTo),nowSeconds=Math.floor(now/1000);
 const headAge=headHeader?nowSeconds-headHeader.timestamp:null,headStale=headAge!==null&&headAge>HEAD_STALE_SECONDS;
 const events=confirmedItems.map(c=>{
  const header=headers.get(c.block),pending=c.block>confirmation.confirmedHead,[headline,summary]=describe(c);
  return {id:c.id,network:chain,chainId:cfg.chainId,category:c.event.category,type:c.event.key,headline,summary,
   subject:c.subject,eventTimestamp:header?new Date(header.timestamp*1000).toISOString():null,detectedAt:base.generatedAt,
   blockNumber:c.block,blockHash:c.blockHash,transactionHash:c.transactionHash,logIndex:c.logIndex,
   evidence:{source:'JSON-RPC eth_getLogs',signature:c.event.signature,topic0:c.event.topic0,emitter:c.subject.address,reference:cfg.explorer+'/tx/'+c.transactionHash},
   verification:!headersRead?'ONCHAIN_LOG_UNCONFIRMED':pending?'ONCHAIN_PENDING_CONFIRMATION':c.stateCheck?.result==='IN_EFFECT_AT_HEAD'?'ONCHAIN_CONFIRMED_STATE_CORROBORATED':'ONCHAIN_CONFIRMED_LOG',
   confirmation:{status:!headersRead?'UNCONFIRMED':pending?'PENDING':'CONFIRMED',confirmations:head-c.block,policy:confirmation.policy,canonicalHashChecked:headersRead},
   materiality:c.materiality,freshness:freshness(header?nowSeconds-header.timestamp:NaN),details:c.details,...(c.stateCheck?{stateCheck:c.stateCheck}:{})};
 });
 const partialReason=!complete?stopReason||'ONCHAIN_WINDOW_INCOMPLETE':!headersRead?stopReason:headStale?'ONCHAIN_HEAD_STALE':null;
 const status=partialReason?'PARTIAL_COVERAGE':events.length?'EVENTS_DETECTED':'NO_QUALIFYING_EVENTS';
 const hours=toHeader&&fromHeader?Math.round((toHeader.timestamp-fromHeader.timestamp)/360)/10:null;
 const windowText='blocks '+coveredFrom+'–'+coveredTo+(hours!==null?' (about '+hours+' h)':'');
 return {...base,status,complete:!partialReason,reasonCode:partialReason,
  window:{fromBlock:coveredFrom,toBlock:coveredTo,blocksCovered:coveredTo-coveredFrom+1,blocksPlanned:planned,windowsRead:windows,fromTimestamp:fromHeader?new Date(fromHeader.timestamp*1000).toISOString():null,toTimestamp:toHeader?new Date(toHeader.timestamp*1000).toISOString():null,toBlockHash:toHeader?.hash||null,hoursCovered:hours,spanNarrowed:narrowed},
  head:{number:head,timestamp:headHeader?new Date(headHeader.timestamp*1000).toISOString():null,hash:headHeader?.hash||null,ageSeconds:headAge,stale:headStale},
  confirmation,events,counts,diagnostics,
  emptyState:events.length?null:status==='NO_QUALIFYING_EVENTS'?
   'No qualifying ownership, upgrade, admin, role, pause, supply or pool-creation event from '+scope.contracts+' watched '+cfg.label+' contracts in '+windowText+'. This covers the watched scope only, not the whole network.':
   'Coverage is incomplete for '+cfg.label+' ('+partialReason+'): only '+windowText+' of the planned window was read. Absence of events here is not evidence of a quiet network.',
  assumptions:['Scope is the reviewed watch list, not every contract on the network.','Supply share uses totalSupply() at the scan head block.','Mints and burns below 0.1% of supply, mint/burn pairs that net to zero inside one transaction, and pools with an unreviewed counterpart are filtered and counted, not shown.',...(confirmation.assumption?[confirmation.assumption]:[])],
  cost:rpc.cost};
}
module.exports={scan,queries,supplyMateriality,freshness,eventId,SCHEMA_VERSION,MAX_EVENTS,HEAD_STALE_SECONDS};
