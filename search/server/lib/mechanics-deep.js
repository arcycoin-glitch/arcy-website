'use strict';
// Mechanics-only read-only enrichment. No holder, market or worker dependency.
const {chain}=require('./chains');
const keccak=require('../../../lib/keccak');
const {nonDelegating}=require('../../../lib/mechanics-runtime');
const {addressWord}=require('./admin-getters');
const {createReader}=require('./source-request');
const crypto=require('node:crypto');
const reader=createReader({ttlMs:300000,maxEntries:32});
const WORD=/^0x[0-9a-f]{64}$/i,CODE=/^0x(?:[0-9a-f]{2})+$/i,ADDRESS=/^0x[0-9a-f]{40}$/i;
const SLOTS=Object.freeze({
 implementation:'0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
 beacon:'0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50',
 admin:'0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103',
 legacy:'0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3',
 legacyAdmin:'0x10d6a54a4754c8869d6886b5f5d7fbfa5b4522237ea5c60d11bc4e7a1ff9390b'
});
// Reviewed full-source fingerprints, NEVER token addresses, names or selectors alone.
const PROFILES=Object.freeze({
 '9799263b22d762e31d781b80bcf9efa38e24917e39a5d75c683ad04f80ce5965':'CAPPED_FEE_LEGACY_TOKEN',
 '292fad46b97e1b50bd191dfd857de081abfb199ad96ff02a055124da4a708cf2':'TIMED_CAPPED_MINTER',
 '3424b81acc01fc833b18f1e2341511fe1bffdd065376112ef979243834e13ba4':'WARD_AUTH_TOKEN',
 '5f75f27c6b98783b82c28164831948668e502ee20bd302aaaeff35c74dbda664':'ALLOWANCE_MINTER_TOKEN',
 '82f4da21cdb0464ca580be2847548393fa678d7e06310fc169d74663ede571fd':'REGISTRY_AUTH_TOKEN'
});
const REVIEWED_LEGACY_PROXY='b49bec6077f927208196e052c2a55e5a37fe21fd8e9e1dc8e90f6f1116cf8c7e';
const REVIEWED_BEACON_PROXY='922425867904c46fb129080ebcd685ba70e0afb5aaa9fdc47b5f9327cee41196';
const selector=s=>keccak(Buffer.from(s)).slice(0,10);
function digest(sources){return crypto.createHash('sha256').update(JSON.stringify(Object.entries(sources).map(([p,x])=>[p,x.content]).sort(([a],[b])=>a.localeCompare(b)))).digest('hex');}
function validateSource(d,{chainId,address,code}){
 if(String(d?.chainId)!==String(chainId)||d?.address?.toLowerCase()!==address.toLowerCase())throw Error('SOURCE_IDENTITY_MISMATCH');
 if(!['match','exact_match'].includes(d.runtimeMatch)||!CODE.test(code)||d.runtimeBytecode?.onchainBytecode?.toLowerCase()!==code.toLowerCase())throw Error('SOURCE_BYTECODE_MISMATCH');
 if(!Array.isArray(d.abi)||!d.abi.every(f=>f&&typeof f.type==='string'&&(f.type!=='function'||typeof f.name==='string'&&Array.isArray(f.inputs)&&Array.isArray(f.outputs)&&[...f.inputs,...f.outputs].every(p=>typeof p?.type==='string')))||!d.sources||!Object.keys(d.sources).length||!Object.values(d.sources).every(x=>typeof x?.content==='string'))throw Error('SOURCE_SCHEMA_INVALID');
 return {abi:d.abi,digest:digest(d.sources),runtimeMatch:d.runtimeMatch,compilation:d.compilation,immutableReferences:d.runtimeBytecode.immutableReferences};
}
async function sourceFor(cfg,address,code,diagnostics){
 const url='https://sourcify.dev/server/v2/contract/'+cfg.chainId+'/'+address+'?fields=abi,sources,compilation,runtimeBytecode';
 try{const body=await reader.json(url,{maxBytes:4*1024*1024,timeoutMs:4000,validate:d=>{validateSource(d,{chainId:cfg.chainId,address,code});return true;}});return {...validateSource(body,{chainId:cfg.chainId,address,code}),url,retrievedAt:new Date(reader.observedAt(url)).toISOString()};}
 catch(e){diagnostics.push({source:'Sourcify',address,chainId:cfg.chainId,sourceUrl:url,reason:e.httpStatus===404?'SOURCE_CODE_UNAVAILABLE':e.httpStatus===429?'SOURCE_RATE_LIMIT':/SOURCE_/.test(e.message)?e.message:'SOURCE_API_FAILED'});return null;}
}
function abiFn(source,signature,type){
 const name=signature.slice(0,signature.indexOf('(')),inputs=signature.slice(signature.indexOf('(')+1,-1).split(',').filter(Boolean);
 return source?.abi?.some(f=>f.type==='function'&&f.name===name&&['view','pure'].includes(f.stateMutability)&&f.inputs?.map(x=>x.type).join(',')===inputs.join(',')&&f.outputs?.length===1&&f.outputs[0].type===type);
}
function decodeArray(raw,max=32){
 if(typeof raw!=='string'||!/^0x(?:[0-9a-f]{64})+$/i.test(raw)||raw.length>2+(max+2)*64)return null;
 const words=raw.slice(2).match(/.{64}/g);if(words.length<2||BigInt('0x'+words[0])!==32n)return null;
 const n=Number(BigInt('0x'+words[1]));if(n<1||n>max||words.length!==n+2)return null;
 const addresses=words.slice(2).map(w=>addressWord('0x'+w));return addresses.every(Boolean)&&new Set(addresses).size===n?addresses:null;
}
async function inspect({network,address,block,rpc,sourceLoader=sourceFor}={}){
 const cfg=chain(network);if(!ADDRESS.test(address||'')||!/^0x[0-9a-f]+$/i.test(block||'')||typeof rpc!=='function')throw Error('Invalid Mechanics identity');
 address=address.toLowerCase();const diagnostics=[],fields={},details={block,chainId:cfg.chainId,address,observations:[],sources:[],failures:diagnostics};
 // Bounded shared per-inspection reads. No cached state crosses a pinned block.
 const reads=new Map();let active=0;const waiters=[],deadline=Date.now()+14000;
 const read=(method,params)=>{const key=method+JSON.stringify(params);if(reads.has(key))return reads.get(key);const p=(async()=>{if(active>=4)await new Promise(r=>waiters.push(r));active++;let timer;try{const timeoutMs=Math.min(4000,deadline-Date.now());if(timeoutMs<=0)throw Error('Mechanics read budget exceeded');return await Promise.race([rpc(method,params,{timeoutMs}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Mechanics RPC timeout')),timeoutMs);})]);}finally{clearTimeout(timer);active--;waiters.shift()?.();}})();reads.set(key,p);return p;};
 const safe=async(method,params)=>{try{return await read(method,params)}catch(e){diagnostics.push({source:cfg.label+' RPC',method,address,block,reason:/429/.test(String(e?.message))?'RPC_RATE_LIMIT':/timeout|budget/i.test(String(e?.message))?'RPC_TIMEOUT':'RPC_READ_FAILED'});return null;}};
 const call=(to,signature,args='')=>safe('eth_call',[{to,data:selector(signature)+args},block]);
 const word=async(to,signature,args='')=>{const raw=await call(to,signature,args);return WORD.test(raw||'')?raw:null;};
 const fact=(value,method,extra={},status='ON_CHAIN')=>({value,dataState:'DATA_FOUND',status,chainId:cfg.chainId,network,source:cfg.label+' RPC / contract evidence',freshness:{block,retrievedAt:new Date().toISOString()},evidence:[{chainId:cfg.chainId,network,address,block,method,...extra}]});
 const code=await safe('eth_getCode',[address,block]);if(!CODE.test(code||'')||/^0xef/i.test(code)){diagnostics.push({reason:'RUNTIME_UNSUPPORTED_OR_UNAVAILABLE'});return {fields,details};}
 const runtimeCodeHash=keccak(Buffer.from(code.slice(2),'hex'));details.runtimeCodeHash=runtimeCodeHash;
 const sourcePromise=sourceLoader(cfg,address,code,diagnostics);
 let target=address,targetCode=code,beacon=null,kind=null,admin=null;
 const clone=/^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/i.exec(code);
 const deployed=async a=>{if(!a||a===address)return null;const c=await safe('eth_getCode',[a,block]);return CODE.test(c||'')&&!/^0xef/i.test(c)?c:null;};
 if(nonDelegating(code))fields.contractArchitecture=fact('NON-PROXY · runtime verified','Conservative complete runtime control-flow inspection',{runtimeCodeHash,scope:'No reachable DELEGATECALL, CALLCODE or SELFDESTRUCT; all JUMPDESTs are roots, metadata retained. External forwarding, permissions and future governance remain separate.'});
 else if(clone){target='0x'+clone[1].toLowerCase();targetCode=await deployed(target);if(targetCode)kind='EIP-1167 minimal proxy';}
 else{
  const entries=await Promise.all(Object.entries(SLOTS).map(async([key,slot])=>[key,addressWord(await safe('eth_getStorageAt',[address,slot,block]))]));const slots=Object.fromEntries(entries);admin=slots.admin;
  for(const [key,label]of [['implementation','EIP-1967 implementation'],['legacy','Legacy implementation slot']]){const c=await deployed(slots[key]);if(c){target=slots[key];targetCode=c;kind=label;break;}}
  if(!kind&&slots.beacon){const bcode=await deployed(slots.beacon);if(bcode){beacon=slots.beacon;const impl=addressWord(await call(beacon,'implementation()'));const c=await deployed(impl);if(c){target=impl;targetCode=c;kind='EIP-1967 beacon';}}}
  if(!kind){
   // Loupe reports are explicitly observations, not proof of selector routing.
   const facets=decodeArray(await call(address,'facetAddresses()'));
   if(facets){const codes=await Promise.all(facets.map(deployed));if(codes.every(Boolean))details.observations.push({method:'facetAddresses()',facets,block,runtimeCodeHash,scope:'Diamond candidate only. Reported facet bytecode exists; actual selector routing/upgrade authority remains NOT VERIFIED.'});}
  }
 }
 const outer=await sourcePromise;if(outer)details.sources.push({address,digest:outer.digest,url:outer.url,retrievedAt:outer.retrievedAt});
 if(outer?.digest===REVIEWED_LEGACY_PROXY&&kind==='Legacy implementation slot')admin=addressWord(await safe('eth_getStorageAt',[address,SLOTS.legacyAdmin,block]));
 let beaconBinding=false;
 if(outer?.digest===REVIEWED_BEACON_PROXY){
  const refs=Object.values(outer.immutableReferences||{}).flat();
  if(refs.length===1&&refs[0].length===32&&Number.isInteger(refs[0].start)&&refs[0].start>=0&&refs[0].start*2+64<=code.length-2){
   const actual=addressWord('0x'+code.slice(2+refs[0].start*2,2+refs[0].start*2+64));
   if(actual&&await deployed(actual)){if(beacon!==actual)diagnostics.push({reason:'BEACON_SLOT_IMMUTABLE_MISMATCH'});beacon=actual;const impl=addressWord(await call(beacon,'implementation()'));const c=await deployed(impl);if(c){target=impl;targetCode=c;kind='Reviewed immutable beacon proxy';beaconBinding=true;}}
  }
 }
 if(kind&&targetCode){
  // UUPS UUID is read on the implementation, never through the proxy.
  const uuid=await word(target,'proxiableUUID()');
  fields.contractArchitecture=fact(kind+(uuid?.toLowerCase()===SLOTS.implementation?' · UUPS UUID observed':''),'Pinned proxy runtime/storage + deployed target bytecode',{implementation:target,beacon,runtimeCodeHash,implementationCodeHash:keccak(Buffer.from(targetCode.slice(2),'hex')),scope:'Observed proxy target only; Transparent/UUPS upgrade authorization and nested delegation are not assumed.'});
  if(admin){fields.ownerAdmin=fact('Proxy admin: '+admin,'EIP-1967 admin slot on delegating runtime',{admin,scope:'Observed admin storage, not proof that all privileges are enumerated.'});const aCode=await deployed(admin);if(aCode){const o=addressWord(await call(admin,'owner()'));if(o)details.observations.push({method:'ProxyAdmin owner()',contract:admin,value:o,block,scope:'Getter-reported; not complete admin semantics.'});}}
  if(beacon){const owner=addressWord(await call(beacon,'owner()'));if(owner&&!fields.ownerAdmin)fields.ownerAdmin=fact('Beacon owner() getter: '+owner,'Pinned beacon owner() getter',{beacon,implementation:target,scope:'Getter-reported, not a proof of complete authority.'},'GETTER_REPORTED');}
 }
 const implementationSource=target!==address&&targetCode?await sourceLoader(cfg,target,targetCode,diagnostics):outer;
 if(implementationSource&&target!==address)details.sources.push({address:target,digest:implementationSource.digest,url:implementationSource.url,retrievedAt:implementationSource.retrievedAt});
 // Unknown delegated target cannot inherit an outer ABI as token implementation evidence.
 const boundTarget=target===address||Boolean(clone)||outer?.digest===REVIEWED_LEGACY_PROXY&&kind==='Legacy implementation slot'||beaconBinding;
 const reviewedImplementation=implementationSource&&Object.hasOwn(PROFILES,implementationSource.digest);
 const resolved=boundTarget&&(target===address?nonDelegating(code):targetCode&&(nonDelegating(targetCode)||reviewedImplementation));
 const source=resolved?implementationSource:null;
 if(!resolved)diagnostics.push({reason:'IMPLEMENTATION_EXECUTION_UNRESOLVED'});
 const sourceProof=source?{sourceUrl:source.url,sourceDigest:source.digest,sourceRetrievedAt:source.retrievedAt,implementation:target,runtimeMatch:source.runtimeMatch}:{};
 if(source){
  const getters=['owner','getOwner','admin','getAdmin','authority','masterMinter','pauser','blacklister','pendingOwner'];
  await Promise.all(getters.filter(n=>abiFn(source,n+'()','address')).map(async name=>{const value=addressWord(await call(address,name+'()'));if(value){details.observations.push({method:name+'()',value,...sourceProof,block,scope:name==='pendingOwner'?'Pending address; not active owner.':'ABI-matched getter; permission semantics not implied.'});if(!fields.ownerAdmin&&name!=='pendingOwner')fields.ownerAdmin=fact(name+'(): '+value,'Verified ABI + pinned getter',{...sourceProof,scope:'Observed authority getter; zero owner never establishes complete renouncement.'},'GETTER_REPORTED');}}));
  for(const name of ['paused','mintingFinished'])if(abiFn(source,name+'()','bool')){const v=await word(address,name+'()');if(v&&BigInt(v)<=1n)details.observations.push({method:name+'()',value:BigInt(v)===1n,block,...sourceProof});}
  // Raw fee values/exemptions are evidence only until their execution and units are reviewed.
  await Promise.all(['buyTax','sellTax','transferTax','buyFee','sellFee','transferFee','feeDenominator','taxDenominator','FEE_DENOMINATOR','cap'].filter(n=>abiFn(source,n+'()','uint256')).map(async n=>{const v=await word(address,n+'()');if(v)details.observations.push({method:n+'()',raw:BigInt(v).toString(),block,...sourceProof,scope:'Raw getter, not a verified tax rate/cap semantics.'});}));
  const candidates=source.abi.filter(f=>f.type==='function'&&/mint|bridge|blacklist|whitelist|pause|fee|tax|upgrade|role|timelock|delay|threshold/i.test(f.name||'')).slice(0,40).map(f=>({name:f.name,stateMutability:f.stateMutability,inputs:f.inputs?.map(x=>x.type),status:'INTERFACE_ONLY'}));
  details.interfaceCandidates=candidates;
  if(abiFn(source,'hasRole(bytes32,address)','bool')){
   const roleAdmin=abiFn(source,'getRoleAdmin(bytes32)','bytes32');
   for(const name of ['DEFAULT_ADMIN_ROLE','MINTER_ROLE']){
    const role=name==='DEFAULT_ADMIN_ROLE'?'0x'+'0'.repeat(64):abiFn(source,name+'()','bytes32')?await word(address,name+'()'):null;if(!role)continue;
    if(roleAdmin){const adminRole=await word(address,'getRoleAdmin(bytes32)',role.slice(2));if(adminRole)details.observations.push({method:'getRoleAdmin',role:name,roleId:role,adminRole,block,...sourceProof});}
    const accounts=[...new Set(details.observations.map(x=>x.value).filter(x=>ADDRESS.test(x||'')))].slice(0,3);
    for(const member of accounts){const has=await word(address,'hasRole(bytes32,address)',role.slice(2)+member.slice(2).padStart(64,'0'));if(has&&BigInt(has)<=1n)details.observations.push({method:'hasRole',role:name,roleId:role,member,value:BigInt(has)===1n,block,...sourceProof,scope:'One observed account, not a complete membership or permission proof.'});}
   }
  }
  // Exact verified AccessControl interface; enumerate only a bounded sample.
  if(abiFn(source,'getRoleMemberCount(bytes32)','uint256')&&abiFn(source,'getRoleMember(bytes32,uint256)','address')&&abiFn(source,'hasRole(bytes32,address)','bool')){
   for(const name of ['DEFAULT_ADMIN_ROLE','MINTER_ROLE']){
    const role=name==='DEFAULT_ADMIN_ROLE'?'0x'+'0'.repeat(64):abiFn(source,name+'()','bytes32')?await word(address,name+'()'):null;if(!role)continue;
    const count=await word(address,'getRoleMemberCount(bytes32)',role.slice(2));if(!count)continue;const n=BigInt(count);details.observations.push({method:'getRoleMemberCount',role:name,roleId:role,count:n.toString(),block,...sourceProof,scope:'Zero members does not prove no alternative mint/admin authority.'});
    if(abiFn(source,'getRoleAdmin(bytes32)','bytes32')){const roleAdmin=await word(address,'getRoleAdmin(bytes32)',role.slice(2));if(roleAdmin)details.observations.push({method:'getRoleAdmin',role:name,roleAdmin,block});}
    for(let i=0;i<Math.min(Number(n>4n?4n:n),4);i++){const member=addressWord(await call(address,'getRoleMember(bytes32,uint256)',role.slice(2)+BigInt(i).toString(16).padStart(64,'0')));if(!member)continue;const has=await word(address,'hasRole(bytes32,address)',role.slice(2)+member.slice(2).padStart(64,'0'));if(has&&BigInt(has)===1n){details.observations.push({method:'hasRole',role:name,member,value:true,block,...sourceProof});if(!fields.ownerAdmin)fields.ownerAdmin=fact(name+': '+member,'Verified ABI + enumerated role membership',{...sourceProof,role:name,roleId:role,member,scope:'Confirmed membership only. Role execution semantics and other roles not inferred.'},'GETTER_REPORTED');}}
   }
  }
  const profile=PROFILES[source.digest];details.reviewedProfile=profile||null;
  if(profile){
   const proof={...sourceProof,profile,scope:'Reviewed complete source matched to pinned deployed bytecode; token-level transfer mechanics only. DEX pool/hook fees are NOT VERIFIED; no trade simulation was performed.'};
   if(profile==='WARD_AUTH_TOKEN'){
    fields.tradingTaxes=fact('Transfer 0% · DEX/hook fees NOT VERIFIED','Reviewed transfer/transferFrom execution',{...proof,coverage:'TOKEN_TRANSFER_ONLY'},'VERIFIED_SOURCE');
    fields.mintCapability=fact('Ward-authorized mint','Reviewed mint(address,uint256) auth modifier',{...proof,scope:'Mint adds balance and totalSupply; wards[msg.sender] must equal 1. Active ward enumeration not claimed.'},'VERIFIED_SOURCE');
    fields.ownerAdmin=fields.ownerAdmin||fact('wards authorization','Reviewed rely/deny/auth permission model',{...proof,scope:'Source-defined ward authority, not a complete current ward member list or ownership absence.'},'VERIFIED_SOURCE');
   }
   if(profile==='ALLOWANCE_MINTER_TOKEN'){
    fields.tradingTaxes=fact('Transfer 0% · DEX/hook fees NOT VERIFIED','Reviewed transfer/transferFrom execution',{...proof,coverage:'TOKEN_TRANSFER_ONLY',scope:'Token transfer moves full value; blacklist/pause restrictions can revert. Pool/hook fees are separate.'},'VERIFIED_SOURCE');
    const master=addressWord(await call(address,'masterMinter()'));
    if(master)fields.mintCapability=fact('Allowance-limited mint','Reviewed mint/configureMinter + pinned masterMinter',{...proof,masterMinter:master,scope:'Configured minters mint within allowance; masterMinter configures them. Paused/blacklist checks apply. No complete minter list or executable mint simulation claimed.'},'VERIFIED_SOURCE_AND_STATE');
   }
   if(profile==='REGISTRY_AUTH_TOKEN'){
    const registry=addressWord(await call(address,'ACCESS_CONTROLLED_REGISTRY()'));const registryCode=await deployed(registry);
    if(registry&&registryCode){
     fields.mintCapability=fact('Registry MINTER_ROLE mint','Reviewed mint and external role enforcement',{...proof,registry,minterRole:keccak(Buffer.from('MINTER_ROLE')),scope:'Reviewed mint requires external registry MINTER_ROLE, unpaused state and unblocked accounts. Current role members and executable mint are not claimed.'},'VERIFIED_SOURCE_AND_STATE');
     fields.ownerAdmin=fact('Access registry: '+registry,'Reviewed immutable registry + pinned deployed registry',{...proof,registry,scope:'External registry controls mint/burn, pause, blocked accounts, metadata and UI multiplier roles; not an ownership-renouncement claim.'},'VERIFIED_SOURCE_AND_STATE');
     fields.tradingTaxes=fact('Transfer 0% · DEX/hook fees NOT VERIFIED','Reviewed inherited ERC20 full-value transfer',{...proof,coverage:'TOKEN_TRANSFER_ONLY',scope:'Base-unit transfers have no deduction; pause/block restrictions may revert. UI multiplier/rebase display is not a tax; DEX/hook fees unknown.'},'VERIFIED_SOURCE');
    }
   }
   if(profile==='TIMED_CAPPED_MINTER'){
    fields.tradingTaxes=fact('Transfer 0% · DEX/hook fees NOT VERIFIED','Reviewed full transfer execution',{...proof,coverage:'TOKEN_TRANSFER_ONLY'},'VERIFIED_SOURCE');
    const minter=addressWord(await call(address,'minter()'));const after=await word(address,'mintingAllowedAfter()');const cap=await word(address,'mintCap()');
    if(minter&&after&&cap){fields.mintCapability=fact('Capped / time-gated minter','Reviewed mint path + pinned minter/cap/timestamp',{...proof,minter,mintingAllowedAfter:BigInt(after).toString(),mintCapPct:BigInt(cap).toString(),scope:'Capability is time/cap constrained; this does not claim a mint can execute now.'},'VERIFIED_SOURCE_AND_STATE');fields.ownerAdmin=fields.ownerAdmin||fact('Minter authority: '+minter,'Reviewed setMinter and mint authority',{...proof,minter},'VERIFIED_SOURCE_AND_STATE');}
   }
   if(profile==='CAPPED_FEE_LEGACY_TOKEN'){
    const [deprecated,bps,maximumFee,owner]=await Promise.all([word(address,'deprecated()'),word(address,'basisPointsRate()'),word(address,'maximumFee()'),call(address,'owner()')]);const authority=addressWord(owner);
    if(deprecated&&BigInt(deprecated)===0n&&bps&&maximumFee&&BigInt(bps)<20n){const rate=BigInt(bps),max=BigInt(maximumFee);fields.tradingTaxes=fact('Transfer '+(max===0n?0:Number(rate)/100)+'% · DEX/hook fees NOT VERIFIED','Reviewed capped fee formula + pinned active parameters',{...proof,basisPointsRate:rate.toString(),denominator:'10000',maximumFeeRaw:max.toString(),deprecated:false,feeController:authority,mutable:true,coverage:'TOKEN_TRANSFER_ONLY',scope:'fee=min(amount*bps/10000, maximumFee). Owner can set bps<20 and maxFee<50 tokens. Rounding/cap changes effective rate. No sender exemption in reviewed transfer path; blacklist/pause can revert. DEX/hook fees separate.'},'VERIFIED_SOURCE_AND_STATE');}
    else diagnostics.push({reason:deprecated&&BigInt(deprecated)===1n?'LEGACY_FORWARDING_ACTIVE':'FEE_STATE_UNAVAILABLE'});
    if(authority)fields.mintCapability=fact('Owner-authorized issuance','Reviewed issue(uint256) + pinned owner',{...proof,owner:authority,scope:'Source issue() increases balances/supply under onlyOwner; no claim of successful execution now.'},'VERIFIED_SOURCE_AND_STATE');
   }
  }
 }
 // Optional read-only authority evidence. No Safe/timelock identity from a
 // selector alone: source must match the authority's pinned runtime first.
 const authorities=[...new Set([admin,...details.observations.map(x=>x.value)].filter(x=>ADDRESS.test(x||'')))].slice(0,2);
 for(const authority of authorities){
  const c=await deployed(authority);if(!c)continue;
  const s=await sourceLoader(cfg,authority,c,diagnostics);if(!s)continue;
  for(const signature of ['getMinDelay()','getThreshold()'])if(abiFn(s,signature,'uint256')){const v=await word(authority,signature);if(v)details.observations.push({method:signature,authority,value:BigInt(v).toString(),block,sourceDigest:s.digest,sourceUrl:s.url,scope:'Source/ABI getter-reported delay or threshold, not a complete execution/authority audit.'});}
  if(abiFn(s,'getOwners()','address[]')){const owners=decodeArray(await call(authority,'getOwners()'));if(owners)details.observations.push({method:'getOwners()',authority,owners,block,sourceDigest:s.digest,sourceUrl:s.url,scope:'Bounded source/ABI-reported owner set; multisig execution semantics remain separate.'});}
 }
 for(const f of Object.values(fields))f.evidence.push({chainId:cfg.chainId,network,address,block,method:'Mechanics analysis detail',...details});
 return {fields,details};
}
async function enrich(options){
 const card=options.card,old=card?.fields||{};let result;
 try{result=await inspect(options);}catch{return card;}
 const fields={...old};
 for(const[key,value]of Object.entries(result.fields)){
  // Strong source/state proof wins over a secondary provider; generic getters
  // only fill gaps. Never discard established reviewed Arc mechanics evidence.
  if(key==='contractArchitecture'||old[key]?.dataState!=='DATA_FOUND'||
   (value.status.startsWith('VERIFIED_SOURCE')&&!['VERIFIED_SOURCE','VERIFIED_SOURCE_AND_STATE','ONCHAIN_VERIFIED'].includes(old[key]?.status)))fields[key]={...value,evidence:[...value.evidence,...(old[key]?.dataState==='DATA_FOUND'&&Array.isArray(old[key].evidence)?old[key].evidence.map(e=>({...e,retainedFrom:'Existing Mechanics evidence; original block preserved'})):[])]};
 }
 // Unknown architecture observations must not retain an unchecked storage word.
 if(!result.fields.contractArchitecture&&old.contractArchitecture?.dataState==='DATA_FOUND'&&
  /EIP-1967 implementation|DELEGATECALL opcode|No DELEGATECALL/.test(String(old.contractArchitecture.value)))fields.contractArchitecture={value:null,status:'NOT_VERIFIED',dataState:'NOT_VERIFIED',source:null,evidence:[],reasonCode:'ARCHITECTURE_TARGET_UNRESOLVED',reason:'Proxy target/runtime proof could not be established at the pinned block.'};
 for(const key of Object.keys(fields))if(fields[key]?.dataState==='DATA_FOUND'&&!Object.hasOwn(result.fields,key))fields[key]={...fields[key],evidence:[...(fields[key].evidence||[]),{method:'Additional Mechanics evidence',chainId:chain(options.network).chainId,network:options.network,address:options.address,block:options.block,...result.details}]};
 return {...card,fields};
}
module.exports={inspect,enrich,validateSource,digest,abiFn,decodeArray,PROFILES,SLOTS,selector};
