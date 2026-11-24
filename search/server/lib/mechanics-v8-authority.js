'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
const {addressWord}=require('./admin-getters');
const {nonDelegating}=require('../../../lib/mechanics-runtime');
const {ZERO,address}=require('./mechanics-v8-evidence');
const scope=new AsyncLocalStorage();
const LIMITS=Object.freeze({nodes:6,depth:3,requests:20,sources:4,timeMs:2600});
const GETTERS=['owner()','pendingOwner()','getMinDelay()','getThreshold()','getOwners()','masterCopy()'];
const OWNERSHIP=new Set(['ADMIN','BEACON','OWNABLE','OWNABLE_2STEP']);
const link=(controller,mechanism,permission,verificationStatus,source,extra={})=>({
 controller,mechanism,permission,verificationStatus,sourceDigest:source?.digest||null,
 sourceReference:source?.runtimeFamily?.sourceReference||source?.url||null,...extra
});
const matched=(source,a)=>source?.subjectAddress===a;
const LIMIT_REASONS=new Set(['GRAPH_NODE_OR_DEPTH_LIMIT','GRAPH_BUDGET','GRAPH_DEADLINE']);
// Traversal completeness does not imply proof of exclusive or executable authority.
function traversalStatus(nodes,skipped){
 const reasons=[...nodes,...skipped].map(x=>x.reason).filter(Boolean);
 if(reasons.some(reason=>LIMIT_REASONS.has(reason)))return 'TRUNCATED';
 return reasons.length?'INCOMPLETE':'TRAVERSED';
}

async function trace({subject,roots,codeAt,sourceAt,call,abiFn,decodeArray,stamp,deadline}){
 const nodes=[],edges=[],skipped=[],complete=new Set(),pending=new Map(),starts=new Set();
 const graphDeadline=Math.min(deadline,Date.now()+LIMITS.timeMs);
 const seenEdges=new Set();
 let requests=0,sources=0;
 function add(from,record,depth,ancestors,method){
  const {controller}=record;
  const key=[from,controller,record.permission,record.mechanism].join('|');
  if(seenEdges.has(key))return;
  seenEdges.add(key);
  const cycle=Boolean(controller&&(controller===from||ancestors.includes(controller)));
  edges.push(stamp({contractAddress:from,...record,cycle},'AUTHORITY_EDGE',method,record.verificationStatus));
  if(controller&&!cycle&&controller!==ZERO&&!complete.has(controller)&&!pending.has(controller)&&!['PROPOSED_OWNER','SIGNER_INDICATOR'].includes(record.mechanism))
   pending.set(controller,{depth,ancestors:[...ancestors,from],grant:record.mechanism});
 }
 for(const root of roots){add(subject,root,1,[],root.method||root.mechanism);if(root.controller)starts.add(root.controller);}
 const bounded=async(fn,source=false)=>{
  const ms=graphDeadline-Date.now();
  if(ms<=0||requests>=LIMITS.requests||source&&sources>=LIMITS.sources)return {error:'GRAPH_BUDGET'};
  requests++;if(source)sources++;
  let timer;
  try{return {value:await Promise.race([Promise.resolve().then(fn),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('budget')),ms);})])};}
  catch{return {error:Date.now()>=graphDeadline?'GRAPH_DEADLINE':'CONTROLLER_READ_FAILED'};}
  finally{clearTimeout(timer);}
 };
 await scope.run(true,async()=>{
  for(const [target,path] of pending){
   pending.delete(target);
   if(complete.has(target))continue;
   if(nodes.length>=LIMITS.nodes||path.depth>LIMITS.depth){skipped.push({contractAddress:target,reason:'GRAPH_NODE_OR_DEPTH_LIMIT'});continue;}
   complete.add(target);
   const finish=(data,method='eth_getCode',status='UNKNOWN')=>nodes.push(stamp({contractAddress:target,depth:path.depth,...data},'CONTROLLER_NODE',method,status));
   const code=await bounded(()=>codeAt(target));
   if(code.error||code.value===null||code.value===undefined){finish({reason:code.error||'CONTROLLER_CODE_UNAVAILABLE'});continue;}
   if(code.value==='0x'){finish({kind:'NO_RUNTIME_AT_BLOCK',reason:'Zero code does not establish private key control.'},'eth_getCode','OBSERVED_CONTROLLER');continue;}
   if(!/^0x(?:[a-f0-9]{2})+$/i.test(code.value)||/^0xef/i.test(code.value)){finish({reason:'CONTROLLER_RUNTIME_UNSUPPORTED'});continue;}
   let {value:source,error}=await bounded(()=>sourceAt(target,code.value),true);
   if(!matched(source,target)){finish({kind:'CONTRACT',reason:error||'CONTROLLER_SOURCE_UNBOUND'},'eth_getCode','OBSERVED_CONTROLLER');continue;}
   const family=source.runtimeFamily?.kind;
   let logic=source,implementation=null;
   if(family==='SAFE_PROXY'){
    const next=await bounded(()=>call(target,'masterCopy()'));
    implementation=addressWord(next.value);
    if(!implementation||implementation===target){finish({kind:'SAFE_PROXY',reason:'SAFE_SINGLETON_UNRESOLVED',sourceDigest:source.digest});continue;}
    const cc=await bounded(()=>codeAt(implementation));
    if(/^0x(?:[a-f0-9]{2})+$/i.test(cc.value||''))({value:logic}=await bounded(()=>sourceAt(implementation,cc.value),true));
    else logic=null;
    if(!matched(logic,implementation)){finish({kind:'SAFE_PROXY',implementation,reason:'SAFE_SINGLETON_SOURCE_UNBOUND',sourceDigest:source.digest},'masterCopy()','OBSERVED_CONTROLLER');continue;}
   }else if(!nonDelegating(code.value)){
    finish({kind:'CONTRACT',reason:'CONTROLLER_DELEGATION_UNBOUND',sourceDigest:source.digest});continue;
   }
   const values={};
   for(const [signature,type] of [['owner()','address'],['pendingOwner()','address'],['getMinDelay()','uint256'],['getThreshold()','uint256'],['getOwners()','address[]']]){
    if(!abiFn(logic,signature,type))continue;
    const result=await bounded(()=>call(target,signature));
    if(result.error){skipped.push({contractAddress:target,method:signature,reason:result.error});continue;}
    const raw=result.value;
    if(type==='address'&&/^0x0{64}$/i.test(raw||''))values[signature]=ZERO;
    else if(type==='address'){const a=addressWord(raw);if(a)values[signature]=a;}
    else if(type==='uint256'&&/^0x[0-9a-f]{64}$/i.test(raw||''))values[signature]=BigInt(raw).toString();
    else if(type==='address[]'){const a=decodeArray(raw,16);if(a?.length)values[signature]=a;}
   }
   const owners=values['getOwners()'],threshold=values['getThreshold()'];
   const multisig=owners&&threshold&&BigInt(threshold)>0n&&BigInt(threshold)<=owners.length;
   const onlyOwner=OWNERSHIP.has(family);
   const owner=values['owner()'];
   const chains=onlyOwner&&(family==='ADMIN'&&(path.grant==='TRANSPARENT_PROXY_ADMIN'||path.grant==='LEGACY_PROXY_ADMIN')||
    family==='BEACON'&&path.grant==='PROXY_BEACON');
   const description=family==='ADMIN'?'upgradeAndCall(address,address,bytes)':family==='BEACON'?'upgradeTo(address)':'Ownership only';
   if(owner&&owner!==ZERO)add(target,link(owner,chains?'REVIEWED_ONLY_OWNER':'OWNER_GETTER',description,chains?'CONFIRMED_AUTHORITY':'OBSERVED_CONTROLLER',logic),path.depth+1,path.ancestors,'owner()');
   const nominee=values['pendingOwner()'];
   if(nominee&&nominee!==ZERO)add(target,link(nominee,'PROPOSED_OWNER','Pending owner; no active authority','OBSERVED_CONTROLLER',logic),path.depth+1,path.ancestors,'pendingOwner()');
   if(multisig)for(const signer of owners)add(target,link(signer,'SIGNER_INDICATOR','Reported signer; no unilateral control asserted','OBSERVED_CONTROLLER',logic),path.depth+1,path.ancestors,'getOwners() + getThreshold()');
   finish({kind:multisig?'MULTISIG_INDICATOR':family==='TIMELOCK'?'TIMELOCK_CONTROLLER':values['getMinDelay()']!==undefined?'TIMELOCK_INDICATOR':family||'CONTRACT',
    implementation,values,sourceDigest:logic.digest,sourceReference:logic.runtimeFamily?.sourceReference||logic.url||null,
    ...(onlyOwner&&owner===ZERO?{reason:'OWNER_ZERO; OTHER_PATHS_NOT_ENUMERATED'}:{})},'Bound source and pinned controller getters','OBSERVED_CONTROLLER');
  }
 });
 const adjacency=new Map();
 for(const e of edges)if(e.controller){if(!adjacency.has(e.contractAddress))adjacency.set(e.contractAddress,[]);adjacency.get(e.contractAddress).push(e.controller);}
 const reaches=(a,b,seen)=>{if(a===b)return true;if(seen.has(a))return false;seen.add(a);return (adjacency.get(a)||[]).some(x=>reaches(x,b,seen));};
 for(const e of edges)if(e.controller&&!e.cycle)e.cycle=reaches(e.controller,e.contractAddress,new Set());
 return {edges,nodes,skipped,traversalStatus:traversalStatus(nodes,skipped),limits:LIMITS,requests,sources,
  scope:'Confirmed edges apply only to the named function, source and block. Signer composition, alternate roles, modules, delays, executability and multi-hop exclusivity are not inferred.'};
}
function root(addressValue,mechanism,permission,status,source,extra){
 const a=address(addressValue);
 return link(a!==ZERO?a:null,mechanism,permission,status,source,extra);
}
module.exports={trace,root,LIMITS,GETTERS,traversalStatus,inScope:()=>scope.getStore()===true};
