'use strict';
// Reviewed-code evidence collector (read-only). It does NOT create registry entries: it gathers the machine-checkable
// half of a review so a human/audited change can add an entry + artifact under lib/risk-engine/reviewed-code/.
//
// For each target (network:address) it:
//  1. pins one block and reads, from TWO registered independent operators: block hash, EIP-1967 implementation /
//     admin / beacon slots, owner(), runtime code of the token and of the implementation; everything must agree;
//  2. asks Sourcify (server v2) for the token and the implementation: runtime match level and the on-chain runtime
//     bytecode the match was made against; keccak256 of that bytecode must equal the code hash the operators returned;
//  3. records compiler + source file hashes and prints the source of the functions that decide the capability
//     (upgrade / mint / access modifiers / fallback routing) so they can be reviewed and quoted in the artifact.
// It never signs or sends anything, stores nothing outside ./review-out and prints no endpoint URL.
// Limits (reported in every draft): the source<->bytecode proof is Sourcify's exact match (creation/runtime bytecode
// incl. metadata hash; immutables/libraries are handled by Sourcify's transformations), not a local recompilation.
const fs=require('node:fs'),path=require('node:path');
const keccak=require('../lib/keccak');
const observer=require('../lib/verification/onchain-observer');
const evidence=require('../lib/verification/metric-evidence');
const authority=require('../lib/risk-engine/producers/authority');
const DEFAULT_TARGETS=['ethereum:0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9','ethereum:0x96f6ef951840721adbf46ac996b59e0235cb985c','ethereum:0x1b19c19393e2d034d8ff31ff34c81252fcbbee92',
 'ethereum:0xace8e719899f6e91831b18ae746c9a965c2119f1','ethereum:0x6c3ea9036406852006290770bedfcaba0e23a0e8','robinhood:0x322f0929c4625ed5bad873c95208d54e1c003b2d','arc:0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b'];
const SOURCIFY='https://sourcify.dev/server/v2/contract/';
const INTERESTING=/^(upgradeTo|upgradeToAndCall|upgradeToAndCallUUPS|_upgradeTo|_upgradeToAndCall|_upgradeToAndCallUUPS|_setImplementation|_authorizeUpgrade|mint|_mint|issue|_fallback|_willFallback|_beforeFallback|_delegate|ifAdmin|onlyOwner|onlyProxy|onlyRole|_checkOwner|_checkRole|_admin|_getAdmin|admin|owner|_beforeTokenTransfer|_afterTokenTransfer|hasRole|getRoleMember|getRoleMemberCount|grantRole|_grantRole|_setupRole|pause|unpause|_checkMinter|_checkKYC|_checkAllowlist)$/;
const hashOf=hex=>typeof hex==='string'&&/^0x(?:[0-9a-f]{2})+$/i.test(hex)?keccak(Buffer.from(hex.slice(2),'hex')):null;
const word=raw=>/^0x[0-9a-f]{64}$/i.test(raw||'')?(/^0x0{24}/i.test(raw)&&!/^0x0{64}$/.test(raw)?'0x'+raw.slice(-40).toLowerCase():null):undefined;
async function rpc(url,method,params){
 const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('HTTP_'+r.status);const b=await r.json();if(b.error)return {error:b.error.code===3||/revert/i.test(b.error.message||'')?'REVERTED':'RPC_ERROR'};return {result:b.result};
}
async function chainView(e,chainId,token,block){
 const id=await rpc(e.url,'eth_chainId',[]);if(Number(BigInt(id.result))!==chainId)throw Error('WRONG_CHAIN');
 const header=(await rpc(e.url,'eth_getBlockByNumber',[block,false])).result;if(!header?.hash)throw Error('NO_HEADER');
 const slot=async s=>word((await rpc(e.url,'eth_getStorageAt',[token,s,block])).result);
 const implementation=await slot(authority.SLOTS.implementation),admin=await slot(authority.SLOTS.admin),beacon=await slot(authority.SLOTS.beacon);
 if([implementation,admin,beacon].includes(undefined))throw Error('MALFORMED_SLOT');
 const o=await rpc(e.url,'eth_call',[{to:token,data:authority.SEL.owner},block]),owner=o.result&&o.result.length===66?word(o.result)||null:null;
 const code=(await rpc(e.url,'eth_getCode',[token,block])).result,implCode=implementation?(await rpc(e.url,'eth_getCode',[implementation,block])).result:null;
 return {operator:e.operator,blockHash:header.hash,implementation,admin,beacon,owner,codeHash:hashOf(code),codeBytes:code?(code.length-2)/2:0,implementationCodeHash:hashOf(implCode),
  mintSelectorInExecutingCode:authority.hasSelector(implementation?implCode:code,authority.SEL.mint)};
}
// Solidity function / modifier bodies by brace matching (comments and strings are rare enough in these headers; the
// excerpt is review INPUT, the reviewer still reads the full verified source).
function excerpts(content){
 const out=[],re=/\b(function|modifier)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(?/g;let m;
 while((m=re.exec(content))){
  if(!INTERESTING.test(m[2]))continue;
  let i=m.index,depth=0,end=-1;
  for(let j=i;j<content.length&&j<i+6000;j++){const c=content[j];if(c==='{')depth++;else if(c==='}'){depth--;if(depth===0){end=j+1;break;}}else if(c===';'&&depth===0){end=j+1;break;}}
  if(end>0)out.push({kind:m[1],name:m[2],text:content.slice(i,end).replace(/\s+/g,' ').slice(0,900)});
 }
 // Storage-slot constants decide WHERE the reviewed functions read and write.
 const slots=/bytes32\s+(?:internal\s+|private\s+|public\s+)?constant\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;]{1,200});/g;
 while((m=slots.exec(content)))out.push({kind:'constant',name:m[1],text:m[2].replace(/\s+/g,' ')});
 return out;
}
// Role-based mint observation (AccessControlEnumerable): MINTER_ROLE members, then mint(recipient,1) from a member and
// from the control address at the pinned block. eth_call only; reported per operator so they can be compared.
const MINTER_ROLE='0x'+keccak(Buffer.from('MINTER_ROLE')).slice(2);
async function roleMint(e,token,block,control){
 const call=(from,data)=>rpc(e.url,'eth_call',[{...(from?{from}:{}),to:token,data},block]);
 const count=await call(null,'0xca15c873'+MINTER_ROLE.slice(2));
 if(count.error||!/^0x[0-9a-f]{64}$/i.test(count.result||''))return {operator:e.operator,enumerable:false};
 const n=Number(BigInt(count.result)),members=[];
 for(let i=0;i<Math.min(n,3);i++){const m=await call(null,'0x9010d07c'+MINTER_ROLE.slice(2)+i.toString(16).padStart(64,'0'));members.push(word(m.result)||null);}
 const mint=to=>'0x40c10f19'+to.slice(2).padStart(64,'0')+'1'.padStart(64,'0'),out=[];
 for(const m of members.filter(Boolean))for(const to of [m,control]){
  const a=await call(m,mint(to)),c=await call(control,mint(to));
  out.push({member:m,recipient:to===m?'member':'control',memberCall:a.error||'ACCEPTED:'+String(a.result).slice(0,10),controlCall:c.error||'ACCEPTED'});
 }
 return {operator:e.operator,enumerable:true,minterCount:n,members,calls:out};
}
async function sourcify(chainId,address,expectedCodeHash){
 const res={address,status:null,runtimeMatch:null,creationMatch:null,onchainBytecodeHash:null,bytecodeEqualsOnchain:false,compiler:null,contract:null,sources:[],functions:[]};
 try{
  const r=await fetch(SOURCIFY+chainId+'/'+address+'?fields=all',{signal:AbortSignal.timeout(30000),headers:{accept:'application/json'}});
  res.status=r.status;if(!r.ok)return res;
  const b=await r.json();
  res.runtimeMatch=b.runtimeMatch??null;res.creationMatch=b.creationMatch??null;res.verifiedAt=b.verifiedAt??null;
  res.onchainBytecodeHash=hashOf(b.runtimeBytecode?.onchainBytecode);res.bytecodeEqualsOnchain=Boolean(res.onchainBytecodeHash&&res.onchainBytecodeHash===expectedCodeHash);
  res.compiler=b.compilation?.compilerVersion??null;res.contract=b.compilation?.fullyQualifiedName??b.compilation?.name??null;
  res.transformations=(b.runtimeBytecode?.transformations||[]).map(t=>t.reason||t.type).slice(0,20);
  for(const [p,s] of Object.entries(b.sources||{})){
   const content=typeof s?.content==='string'?s.content:'';
   res.sources.push({path:p,keccak256:keccak(Buffer.from(content,'utf8')),bytes:Buffer.byteLength(content)});
   for(const f of excerpts(content))res.functions.push({path:p,...f});
  }
 }catch(error){res.status='FETCH_FAILED:'+String(error.message).slice(0,40);}
 return res;
}
async function review(target){
 const [network,address]=target.split(':'),token=String(address||'').toLowerCase();
 if(!Object.hasOwn(evidence.NETWORKS,network)||!/^0x[0-9a-f]{40}$/.test(token))return {target,state:'INVALID_TARGET'};
 const chainId=evidence.NETWORKS[network],{endpoints,independence}=observer.endpoints(network,{});
 const out={schemaVersion:1,kind:'REVIEW_EVIDENCE_DRAFT',network,chainId,token,generatedAt:new Date().toISOString(),missing:[]};
 if(!independence.independent||endpoints.length<2){out.missing.push('TWO_INDEPENDENT_OPERATORS');return out;}
 const headNumber=BigInt((await rpc(endpoints[0].url,'eth_blockNumber',[])).result)-6n,block='0x'+headNumber.toString(16);
 const views=[];for(const e of endpoints.slice(0,2)){try{views.push(await chainView(e,chainId,token,block));}catch(error){views.push({operator:e.operator,error:String(error.message).slice(0,40)});}}
 out.block={number:headNumber.toString(),hash:views[0].blockHash||null};out.operators=views;
 if(views.some(v=>v.error)){out.missing.push('OPERATOR_READ_FAILED');return out;}
 const same=k=>views[0][k]===views[1][k];
 for(const k of ['blockHash','implementation','admin','beacon','owner','codeHash','implementationCodeHash'])if(!same(k))out.missing.push('OPERATORS_DISAGREE_'+k);
 if(new Set(views.map(v=>v.operator)).size<2)out.missing.push('TWO_INDEPENDENT_OPERATORS');
 if(out.missing.length)return out;
 const v=views[0];
 out.roleMint=[];for(const e of endpoints.slice(0,2)){try{out.roleMint.push(await roleMint(e,token,block,authority.CONTROL));}catch(error){out.roleMint.push({operator:e.operator,error:String(error.message).slice(0,40)});}}
 out.identity={proxyCodeHash:v.codeHash,implementation:v.implementation,implementationCodeHash:v.implementationCodeHash,admin:v.admin,beacon:v.beacon,owner:v.owner};
 out.tokenSource=await sourcify(chainId,token,v.codeHash);
 out.implementationSource=v.implementation?await sourcify(chainId,v.implementation,v.implementationCodeHash):null;
 const proof=(s,label)=>{if(!s)return;if(s.status!==200)out.missing.push(label+'_NOT_ON_SOURCIFY('+s.status+')');else{if(s.runtimeMatch!=='exact_match')out.missing.push(label+'_RUNTIME_MATCH_IS_'+String(s.runtimeMatch).toUpperCase());
  if(!s.bytecodeEqualsOnchain)out.missing.push(label+'_VERIFIED_BYTECODE_HASH_DIFFERS_FROM_OPERATORS');if(!s.sources.length)out.missing.push(label+'_NO_SOURCES');}};
 proof(out.tokenSource,'TOKEN');proof(out.implementationSource,'IMPLEMENTATION');
 if(v.beacon)out.missing.push('BEACON_ROUTE_UNSUPPORTED');
 out.codeProofs=[[v.codeHash,out.tokenSource],[v.implementationCodeHash,out.implementationSource]].filter(([h,s])=>h&&s&&s.status===200&&s.runtimeMatch==='exact_match'&&s.bytecodeEqualsOnchain)
  .map(([h,s])=>({codeHash:h,sourceMatch:s.runtimeMatch,verifiedRuntimeCodeHash:s.onchainBytecodeHash,sourcify:{chainId,address:s.address,contract:s.contract,compiler:s.compiler,verifiedAt:s.verifiedAt||null},
   onchain:views.map(x=>({operator:x.operator,codeHash:h,blockHash:x.blockHash,blockNumber:headNumber.toString()})),sources:s.sources.map(({path:p,keccak256})=>({path:p,keccak256}))}));
 out.machineEvidenceComplete=out.missing.length===0;
 out.stillRequired='Human review of the printed functions (authorization + state change + proxy routing) before any registry entry.';
 return out;
}
(async()=>{
 const targets=(process.env.REVIEW_TARGETS||'').split(',').map(s=>s.trim()).filter(Boolean);
 const list=(targets.length?targets:DEFAULT_TARGETS).slice(0,12),dir=path.join(process.cwd(),'review-out');fs.mkdirSync(dir,{recursive:true});
 const summary=[];
 for(const t of list){
  let r;try{r=await review(t);}catch(error){r={target:t,state:'FAILED',error:String(error.message).slice(0,60)};}
  fs.writeFileSync(path.join(dir,t.replace(':','-')+'.json'),JSON.stringify(r,null,1));
  const line={target:t,block:r.block||null,identity:r.identity||null,missing:r.missing||[r.state||r.error],complete:Boolean(r.machineEvidenceComplete),
   token:r.tokenSource&&{status:r.tokenSource.status,runtimeMatch:r.tokenSource.runtimeMatch,creationMatch:r.tokenSource.creationMatch,equal:r.tokenSource.bytecodeEqualsOnchain,contract:r.tokenSource.contract,compiler:r.tokenSource.compiler,files:r.tokenSource.sources.length,transformations:r.tokenSource.transformations},
   implementation:r.implementationSource&&{status:r.implementationSource.status,runtimeMatch:r.implementationSource.runtimeMatch,creationMatch:r.implementationSource.creationMatch,equal:r.implementationSource.bytecodeEqualsOnchain,contract:r.implementationSource.contract,compiler:r.implementationSource.compiler,files:r.implementationSource.sources.length,transformations:r.implementationSource.transformations},
   operators:(r.operators||[]).map(o=>o.operator+(o.error?':'+o.error:'')),mintSelector:r.operators?.[0]?.mintSelectorInExecutingCode??null};
  summary.push(line);console.log('REVIEW_EVIDENCE '+JSON.stringify(line));
  if(r.roleMint)console.log('REVIEW_ROLE_MINT '+JSON.stringify({target:t,roleMint:r.roleMint}));
  if(r.machineEvidenceComplete)console.log('REVIEW_PROOF '+JSON.stringify({target:t,block:r.block,codeProofs:r.codeProofs}));
  for(const [label,s] of [['token',r.tokenSource],['implementation',r.implementationSource]]){
   if(!s||s.runtimeMatch!=='exact_match'||!s.bytecodeEqualsOnchain)continue; // only exact, on-chain-equal sources are worth reviewing
   for(const f of s.functions.filter(x=>x.kind!=='constant').slice(0,40))console.log('REVIEW_SOURCE '+JSON.stringify({target:t,code:label,path:f.path.split('/').slice(-2).join('/'),name:f.name,text:f.text}));
   for(const f of s.functions.filter(x=>x.kind==='constant'))console.log('REVIEW_CONSTANT '+JSON.stringify({target:t,code:label,path:f.path.split('/').slice(-1)[0],name:f.name,value:f.text}));
   console.log('REVIEW_FILES '+JSON.stringify({target:t,code:label,files:s.sources.map(x=>x.path.split('/').slice(-1)[0]+':'+x.keccak256.slice(0,18))}).slice(0,3000));
  }
 }
 console.log('REVIEW_SUMMARY '+JSON.stringify({targets:summary.length,machineComplete:summary.filter(s=>s.complete).map(s=>s.target)}));
})().catch(e=>{console.error('REVIEW_FAILED',String(e.message).slice(0,80));process.exit(1);});
