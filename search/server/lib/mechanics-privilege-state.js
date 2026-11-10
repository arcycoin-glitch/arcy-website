'use strict';
// Mechanics V2: privilege-state classification from runtime bytecode and pinned-block read-only simulation.
// Works WITHOUT verified source, so it also covers contracts where the source-gated Mechanics path has no evidence.
//
// Five states that are never merged:
//   FUNCTION_DETECTED               the exact 4-byte selector is compared in the runtime dispatcher. Nothing else is claimed.
//   PRIVILEGE_CONFIRMED             an access gate is proven for the paired function and this call reverts in the current
//                                   contract state (e.g. unpause() while not paused).
//   PRIVILEGE_CURRENTLY_EXECUTABLE  at the pinned block the call succeeds when sent by the live authority AND reverts when
//                                   sent by an unrelated control address.
//   PRIVILEGE_REVOKED               owner() is the zero address, the call succeeds ONLY when simulated from the zero
//                                   address and reverts for the control address: the gate exists, nobody can pass it.
//   UNKNOWN                         a read failed or the answer was ambiguous.
//
// What is NOT claimed: role-gated functions stay FUNCTION_DETECTED (role holders are not guessed); a successful
// simulation shows the call does not revert with these arguments at this block, not that it will be used; nothing here
// is a statement that a contract is safe.
const keccak=require('../../../lib/keccak');
const {chain:chainConfig,rpcUrl}=require('./chains');
const selector=signature=>keccak(Buffer.from(signature)).slice(0,10).toLowerCase();
const WORD=/^0x[0-9a-f]{64}$/i,CODE=/^0x(?:[0-9a-f]{2})*$/i;
const ZERO='0x0000000000000000000000000000000000000000';
// Unrelated caller / recipient for control simulations: derived, never a real project address.
const CONTROL='0x'+keccak(Buffer.from('arcy-mechanics-privilege-control-caller')).slice(-40);
const RECIPIENT='0x'+keccak(Buffer.from('arcy-mechanics-privilege-control-recipient')).slice(-40);
const IMPLEMENTATION_SLOT='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const ADMIN_SLOT='0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';
// Pre-EIP-1967 (zos) proxy slots, identical to the reviewed constants in mechanics-deep.js (asserted by test).
const LEGACY_IMPLEMENTATION_SLOT='0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3';
const LEGACY_ADMIN_SLOT='0x10d6a54a4754c8869d6886b5f5d7fbfa5b4522237ea5c60d11bc4e7a1ff9390b';
const pad=a=>a.slice(2).toLowerCase().padStart(64,'0');
const uintWord=n=>BigInt(n).toString(16).padStart(64,'0');

// Exact signatures only. `args` present => simulated; absent => detection only (arguments would be semantic guesses).
const FUNCTIONS=Object.freeze([
 {category:'MINT',signature:'mint(address,uint256)',args:()=>pad(RECIPIENT)+uintWord(1)},
 {category:'PAUSE',signature:'pause()',args:()=>'',pair:'unpause()'},
 {category:'PAUSE',signature:'unpause()',args:()=>'',pair:'pause()'},
 {category:'BLACKLIST',signature:'blacklist(address)',args:()=>pad(RECIPIENT)},
 {category:'BLACKLIST',signature:'addBlackList(address)',args:()=>pad(RECIPIENT)},
 {category:'OWNERSHIP',signature:'renounceOwnership()',args:()=>''},
 {category:'OWNERSHIP',signature:'transferOwnership(address)'},
 {category:'UPGRADE',signature:'upgradeTo(address)'},
 {category:'UPGRADE',signature:'upgradeToAndCall(address,bytes)'},
 {category:'ROLE_ADMIN',signature:'grantRole(bytes32,address)'},
 {category:'TAX',signature:'setFee(uint256)'},
 {category:'TAX',signature:'setFees(uint256,uint256)'},
 {category:'TAX',signature:'setTaxes(uint256,uint256)'},
 {category:'TRANSFER_RESTRICTION',signature:'freeze(address)'},
 {category:'TRANSFER_RESTRICTION',signature:'setTradingEnabled(bool)'}
].map(f=>Object.freeze({...f,selector:selector(f.signature)})));
const OWNER_SELECTOR=selector('owner()');
const MAX_SIMULATED=5;

// Linear disassembly (PUSH data skipped). A selector counts only when PUSH4 <sel> is compared with EQ directly or after
// one DUP, the form solc and vyper dispatchers emit. A selector merely embedded as data or used in an external call is ignored.
function dispatchSelectors(code){
 const found=new Set();
 if(typeof code!=='string'||!CODE.test(code))return found;
 const b=Buffer.from(code.slice(2),'hex');
 for(let i=0;i<b.length;){
  const op=b[i];
  if(op>=0x60&&op<=0x7f){
   const size=op-0x5f;
   if(op===0x63&&i+5<b.length){
    const next=b[i+5],after=b[i+6];
    if(next===0x14||(next>=0x80&&next<=0x8f&&after===0x14))found.add('0x'+b.subarray(i+1,i+5).toString('hex'));
   }
   i+=1+size;
  }else i++;
 }
 return found;
}
const addressOf=word=>WORD.test(word||'')&&/^0x0{24}/.test(word)?'0x'+word.slice(26).toLowerCase():null;
const minimalProxy=code=>/^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/i.exec(code||'')?.[1]?.toLowerCase()||null;
const REVERT=/revert|invalid opcode|invalid jump|out of gas|stack (?:under|over)flow|execution error|vm exception/i;

function endpoints(network,env=process.env){
 if(network==='arc')return require('./arc-rpc').providers(env);
 if(network==='robinhood')return require('./robinhood-rpc').providers(env);
 return [rpcUrl('ethereum',env)];
}
// Minimal pinned reader. eth_call results are tri-state so a provider failure can never be read as a revert.
function createReader({url,chainId,fetcher=fetch,maxCalls=24,paceMs=0,timeoutMs=5000,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
 const cost={rpcCalls:0};let id=0,last=0;
 async function send(method,params){
  if(!['eth_chainId','eth_blockNumber','eth_getCode','eth_getStorageAt','eth_call'].includes(method))throw Error('PRIVILEGE_METHOD_NOT_ALLOWED');
  if(cost.rpcCalls>=maxCalls)return {state:'BUDGET'};
  const wait=last+paceMs-Date.now();if(paceMs>0&&wait>0)await sleep(wait);
  last=Date.now();cost.rpcCalls++;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const response=await fetcher(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:controller.signal});
   if(!response.ok)return {state:'PROVIDER_ERROR',httpStatus:response.status};
   const body=await response.json();
   if(!body||body.jsonrpc!=='2.0'||body.id!==id)return {state:'PROVIDER_ERROR'};
   if(body.error){
    const message=String(body.error.message||'');
    return method==='eth_call'&&(body.error.code===3||REVERT.test(message))?{state:'REVERT'}:{state:'PROVIDER_ERROR',rpcCode:Number.isInteger(body.error.code)?body.error.code:null};
   }
   return typeof body.result==='string'?{state:'OK',result:body.result}:{state:'PROVIDER_ERROR'};
  }catch{return {state:'PROVIDER_ERROR'};}
  finally{clearTimeout(timer);}
 }
 return {send,cost,chainId};
}

async function classify({network,address,fetcher=fetch,env=process.env,url=null,paceMs=null,now=Date.now}={}){
 const cfg=chainConfig(network);
 if(typeof address!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(address))throw Object.assign(Error('INVALID_ADDRESS'),{code:'INVALID_ADDRESS'});
 address=address.toLowerCase();
 const reader=createReader({url:url||endpoints(network,env)[0],chainId:cfg.chainId,fetcher,paceMs:paceMs??(network==='arc'?280:0)});
 const base={schemaVersion:1,analysis:'mechanics-privilege-state',network,chainId:cfg.chainId,address,generatedAt:new Date(now()).toISOString()};
 const unavailable=reasonCode=>({...base,status:'PROVIDER_UNAVAILABLE',reasonCode,functions:[],authorities:[],cost:reader.cost});
 const chainId=await reader.send('eth_chainId',[]);
 if(chainId.state!=='OK'||!/^0x[0-9a-f]+$/i.test(chainId.result)||Number(BigInt(chainId.result))!==cfg.chainId)return unavailable(chainId.state==='OK'?'CHAIN_ID_MISMATCH':'RPC_UNAVAILABLE');
 const head=await reader.send('eth_blockNumber',[]);
 if(head.state!=='OK'||!/^0x[0-9a-f]+$/i.test(head.result))return unavailable('HEAD_UNAVAILABLE');
 const block=head.result;
 const code=await reader.send('eth_getCode',[address,block]);
 if(code.state!=='OK'||!CODE.test(code.result))return unavailable('CODE_UNAVAILABLE');
 if(code.result==='0x')return {...base,status:'NO_CONTRACT_CODE',block,functions:[],authorities:[],cost:reader.cost};

 // Logic code: the contract itself, an EIP-1167 target or an EIP-1967 implementation that has code at the same block.
 let logic=code.result,proxy=null;
 const clone=minimalProxy(code.result);
 const slotAddress=async slot=>{const a=addressOf((await reader.send('eth_getStorageAt',[address,slot,block])).result);return a&&a!==ZERO&&a!==address?a:null;};
 const candidates=clone?[['EIP-1167 minimal proxy','0x'+clone,null]]:[];
 if(!clone){
  const modern=await slotAddress(IMPLEMENTATION_SLOT);
  if(modern)candidates.push(['EIP-1967 proxy',modern,ADMIN_SLOT]);
  else{const legacy=await slotAddress(LEGACY_IMPLEMENTATION_SLOT);if(legacy)candidates.push(['Legacy (zos) proxy',legacy,LEGACY_ADMIN_SLOT]);}
 }
 for(const [kind,implementation,adminSlot] of candidates){
  const target=await reader.send('eth_getCode',[implementation,block]);
  if(target.state==='OK'&&CODE.test(target.result)&&target.result!=='0x'){logic=target.result;proxy={kind,implementation,adminSlot};}
 }
 const authorities=[];
 const holder=async(kind,account,method)=>{
  if(!account)return;
  if(account===ZERO){authorities.push({kind,holder:ZERO,holderType:'ZERO_ADDRESS',state:'REVOKED',method,block});return;}
  const c=await reader.send('eth_getCode',[account,block]);
  authorities.push({kind,holder:account,holderType:c.state!=='OK'?'UNKNOWN':c.result==='0x'?'EOA':'CONTRACT',state:'ACTIVE',method,block,
   ...(c.state==='OK'&&c.result!=='0x'?{scope:'Holder is a contract; who controls it is a separate question (multisig, timelock or other).'}:{})});
 };
 if(proxy?.adminSlot){
  const admin=addressOf((await reader.send('eth_getStorageAt',[address,proxy.adminSlot,block])).result);
  if(admin&&admin!==ZERO)await holder('PROXY_ADMIN',admin,proxy.kind+' admin slot');
 }
 if(proxy)proxy={kind:proxy.kind,implementation:proxy.implementation};
 const selectors=new Set([...dispatchSelectors(logic),...dispatchSelectors(code.result)]);
 let owner=null,ownerRead='NOT_PRESENT';
 if(selectors.has(OWNER_SELECTOR)){
  const answer=await reader.send('eth_call',[{to:address,data:OWNER_SELECTOR},block]);
  ownerRead=answer.state;
  if(answer.state==='OK'){owner=addressOf(answer.result);if(owner!==null)await holder('OWNER',owner,'owner()');else ownerRead='MALFORMED';}
 }
 const simulate=(from,fn)=>reader.send('eth_call',[{from,to:address,data:fn.selector+fn.args()},block]);
 const detected=FUNCTIONS.filter(f=>selectors.has(f.selector)),functions=[];let simulated=0;
 for(const fn of detected){
  const entry={category:fn.category,signature:fn.signature,selector:fn.selector,state:'FUNCTION_DETECTED',
   evidence:[{method:'runtime dispatcher selector comparison',block,codeScope:proxy?'implementation '+proxy.implementation:'contract runtime'}]};
  functions.push(entry);
  if(!fn.args){entry.note='Detection only: this function is not simulated because its arguments carry meaning.';continue;}
  if(simulated>=MAX_SIMULATED){entry.note='Simulation budget reached; detection only.';continue;}
  simulated++;
  const control=await simulate(CONTROL,fn);
  if(control.state!=='OK'&&control.state!=='REVERT'){entry.state='UNKNOWN';entry.note='Control simulation was not answered by the provider.';continue;}
  entry.evidence.push({method:'eth_call simulation',caller:'unrelated control address',outcome:control.state==='OK'?'SUCCEEDS':'REVERTS',block});
  if(control.state==='OK'){entry.unrestrictedInSimulation=true;entry.note='The call does not revert for an unrelated address with these arguments. Either the function is not access-restricted or it is a no-op here.';continue;}
  if(owner===null){entry.note=ownerRead==='NOT_PRESENT'?'No owner() getter in the dispatcher; the authority (for example a role) is not identified.':'owner() could not be read.';continue;}
  const caller=await simulate(owner,fn);
  if(caller.state!=='OK'&&caller.state!=='REVERT'){entry.state='UNKNOWN';entry.note='Authority simulation was not answered by the provider.';continue;}
  entry.evidence.push({method:'eth_call simulation',caller:owner===ZERO?'zero address (current owner() value)':'current owner() '+owner,outcome:caller.state==='OK'?'SUCCEEDS':'REVERTS',block});
  if(caller.state==='OK'){
   entry.accessRestricted=true;
   if(owner===ZERO){entry.state='PRIVILEGE_REVOKED';entry.note='Only the zero address passes the gate and owner() is the zero address at this block.';}
   else{entry.state='PRIVILEGE_CURRENTLY_EXECUTABLE';entry.authority=owner;entry.note='Succeeds for the current owner and reverts for an unrelated address at this block.';}
  }else entry.note='Reverts for both the owner and an unrelated address: gated by another authority, or not callable in the current state.';
 }
 // Paired pause functions: one side proven executable, the other reverting in the current state.
 for(const entry of functions){
  const fn=FUNCTIONS.find(f=>f.signature===entry.signature);
  if(entry.state!=='FUNCTION_DETECTED'||!fn.pair||entry.unrestrictedInSimulation||entry.evidence.length<3)continue;
  const other=functions.find(x=>x.signature===fn.pair);
  if(other?.state==='PRIVILEGE_CURRENTLY_EXECUTABLE'){entry.state='PRIVILEGE_CONFIRMED';entry.accessRestricted=true;entry.authority=other.authority;
   entry.note='The paired '+fn.pair+' is executable by the owner and gated against others; this call reverts in the current pause state. The shared gate is inferred from the pair.';}
 }
 const count=state=>functions.filter(f=>f.state===state).length;
 return {...base,status:'ANALYZED',block,proxy,authorities,functions,
  summary:{detected:functions.length,functionDetectedOnly:count('FUNCTION_DETECTED'),privilegeConfirmed:count('PRIVILEGE_CONFIRMED'),currentlyExecutable:count('PRIVILEGE_CURRENTLY_EXECUTABLE'),revoked:count('PRIVILEGE_REVOKED'),unknown:count('UNKNOWN'),unrestrictedInSimulation:functions.filter(f=>f.unrestrictedInSimulation).length},
  assumptions:['Selectors are matched against a fixed list of exact signatures; a privileged function with another signature is not listed.','Simulation uses fixed arguments at one pinned block; outcomes can differ for other arguments or later blocks.','Absence of a listed function is not evidence that the capability does not exist.'],
  cost:reader.cost};
}
// Per-instance cache + shared in-flight analysis: one bounded analysis per contract per TTL.
const TTL_MS=300000,cache=new Map(),inflight=new Map();
async function cached(options){
 const key=options.network+':'+String(options.address).toLowerCase(),now=Date.now(),hit=cache.get(key);
 if(hit&&hit.expiresAt>now)return hit.value;
 if(!inflight.has(key))inflight.set(key,classify(options).then(value=>{
  cache.set(key,{value,expiresAt:Date.now()+(value.status==='ANALYZED'?TTL_MS:30000)});
  while(cache.size>128)cache.delete(cache.keys().next().value);
  return value;
 }).finally(()=>inflight.delete(key)));
 return inflight.get(key);
}
module.exports={classify,cached,dispatchSelectors,createReader,FUNCTIONS,CONTROL,RECIPIENT,selector,MAX_SIMULATED,LEGACY_IMPLEMENTATION_SLOT,LEGACY_ADMIN_SLOT,IMPLEMENTATION_SLOT,ADMIN_SLOT};
