'use strict';
// Deterministic, conservative source-structure analysis for tokens built on UNMODIFIED OpenZeppelin ERC20 libraries.
// It never reads token names/addresses/tickers. A library file counts only when its exact SHA-256 is in the pinned table
// (oz-library-hashes.js, computed from the published npm tarballs). The result is meaningful ONLY after the caller has
// verified that these exact sources match the deployed runtime (Sourcify runtime match + independent eth_getCode).
//
// Soundness argument: OZ ERC20 keeps balances/supply private, so a derived contract can change them only through the
// internal _mint/_burn/_update/_transfer paths (or inline assembly, which is rejected). Any override of the transfer
// path, any assembly/delegatecall/selfdestruct, any shadowing of a library contract name, or any unpinned library file
// makes the analysis return null (= no claim). Absence of a claim is NOT evidence of absence.
const crypto=require('node:crypto');
const sha=t=>crypto.createHash('sha256').update(t).digest('hex');
function strip(src){
 let out='',i=0;const n=src.length;
 while(i<n){
  const c=src[i],d=src[i+1];
  if(c==='/'&&d==='/'){while(i<n&&src[i]!=='\n')i++;continue;}
  if(c==='/'&&d==='*'){i+=2;while(i<n&&!(src[i]==='*'&&src[i+1]==='/'))i++;i+=2;out+=' ';continue;}
  if(c==='"'||c==="'"){const q=c;i++;while(i<n&&src[i]!==q){if(src[i]==='\\')i++;i++;}i++;out+='""';continue;}
  out+=c;i++;
 }
 return out;
}
function matchBrace(s,open){let depth=0;for(let i=open;i<s.length;i++){if(s[i]==='{')depth++;else if(s[i]==='}'){depth--;if(!depth)return i;}}return -1;}
function matchParen(s,open){let depth=0;for(let i=open;i<s.length;i++){if(s[i]==='(')depth++;else if(s[i]===')'){depth--;if(!depth)return i;}}return -1;}
function contracts(s){
 const out=[],re=/\b(abstract\s+contract|contract|library|interface)\s+([A-Za-z_$][\w$]*)\s*([^{;]*)\{/g;let m;
 while((m=re.exec(s))){const open=m.index+m[0].length-1,close=matchBrace(s,open);if(close<0)return null;
  out.push({kind:m[1].replace(/\s+/g,' '),name:m[2],bases:(/\bis\b([\s\S]*)/.exec(m[3])?.[1]||'').split(',').map(x=>x.trim().replace(/\(.*$/s,'').trim()).filter(Boolean),body:s.slice(open+1,close),start:open+1});
  re.lastIndex=close+1;}
 return out;
}
function functions(body){
 const out=[],re=/\b(function|constructor|modifier|fallback|receive)\b\s*([A-Za-z_$][\w$]*)?\s*\(/g;let m;
 while((m=re.exec(body))){
  const pOpen=m.index+m[0].length-1,pClose=matchParen(body,pOpen);if(pClose<0)return null;
  let j=pClose+1,hdrEnd=-1,bodyOpen=-1,paren=0;
  for(;j<body.length;j++){const ch=body[j];if(ch==='(')paren++;else if(ch===')')paren--;else if(!paren&&(ch==='{'||ch===';')){hdrEnd=j;if(ch==='{')bodyOpen=j;break;}}
  if(hdrEnd<0)return null;
  const header=body.slice(pClose+1,hdrEnd),close=bodyOpen>=0?matchBrace(body,bodyOpen):hdrEnd;if(close<0)return null;
  out.push({kind:m[1],name:m[2]||m[1],header,params:body.slice(pOpen+1,pClose),body:bodyOpen>=0?body.slice(bodyOpen+1,close):'',index:m.index});
  re.lastIndex=close+1;
 }
 return out;
}
const FORBIDDEN_FN=new Set(['transfer','transferFrom','_transfer','_update','_beforeTokenTransfer','_afterTokenTransfer','balanceOf','totalSupply','allowance','approve','_approve','_spendAllowance','_mint','_burn','_useNonce']);
const OWNABLE_FN=new Set(['owner','_checkOwner','_transferOwnership','transferOwnership','renounceOwnership']);
const BANNED=/\b(assembly|delegatecall|callcode|selfdestruct|suicide)\b/;
const LIB_CONTRACTS=['ERC20','IERC20','IERC20Metadata','ERC20Burnable','Ownable','Context','IERC20Errors','IERC721Errors','IERC1155Errors',
 'ERC20Permit','IERC20Permit','EIP712','Nonces','IERC5267','AccessControl','IAccessControl','ERC165','IERC165','ECDSA','Strings','Math','SignedMath','ShortStrings','StorageSlot','MessageHashUtils','Counters'];
/**
 * @param {Object<string,{content:string}>} sources Sourcify-style source map (path -> {content})
 * @param {{lib:Object<string,string>, main?:string}} opts lib maps sha256(content)->canonical library file name
 * @returns {null|object} null = no claim possible
 */
function run(sources,{lib,main}={}){
 const REJ=(reason,detail={})=>({reject:reason,...detail});
 if(!sources||typeof sources!=='object'||!lib)return REJ('NO_SOURCES');
 const own=[],libNames=new Set();
 for(const [p,f] of Object.entries(sources)){
  if(typeof f?.content!=='string')return REJ('BAD_SOURCE_ENTRY');
  const known=lib[sha(f.content)];
  if(known)libNames.add(known);else own.push({path:p,text:strip(f.content)});
 }
 if(!own.length)return REJ('NO_OWN_FILES');
 if(!libNames.has('ERC20'))return REJ('ERC20_NOT_PINNED',{unpinned:own.map(f=>f.path).slice(0,6)});
 const mine=[];
 for(const f of own){
  {const bm=BANNED.exec(f.text);if(bm)return REJ('BANNED_'+bm[1].toUpperCase(),{file:f.path});}
  const cs=contracts(f.text);if(!cs)return REJ('PARSE_CONTRACTS',{file:f.path});
  for(const c of cs)mine.push({...c,file:f.path});
 }
 if(!mine.length)return REJ('NO_CONTRACTS');
 // Shadowing: an own contract may never reuse a pinned library contract name.
 if(mine.some(c=>LIB_CONTRACTS.includes(c.name)))return REJ('SHADOWS_LIBRARY_NAME',{names:mine.filter(c=>LIB_CONTRACTS.includes(c.name)).map(c=>c.name).slice(0,4)});
 // Inheritance closure of the deployed contract (when known) must reach the pinned ERC20.
 const byName=new Map(mine.map(c=>[c.name,c]));
 const roots=main&&byName.has(main)?[byName.get(main)]:mine.filter(c=>c.kind.endsWith('contract')&&!mine.some(o=>o!==c&&o.bases.includes(c.name)));
 if(roots.length!==1)return REJ('ROOT_CONTRACT_AMBIGUOUS',{count:roots.length});
 const closure=new Set(),stack=[roots[0]];let reachesErc20=false,ownable=false,burnable=false,accessControl=false;
 while(stack.length){const c=stack.pop();if(closure.has(c))continue;closure.add(c);
  for(const b of c.bases){if(b==='ERC20')reachesErc20=true;else if(b==='Ownable')ownable=true;else if(b==='AccessControl')accessControl=true;else if(b==='ERC20Burnable'){reachesErc20=true;burnable=true;}
   else if(byName.has(b))stack.push(byName.get(b));
   else if(!LIB_CONTRACTS.includes(b))return REJ('UNPINNED_BASE',{base:b});}}
 if(!reachesErc20)return REJ('ERC20_NOT_INHERITED');
 const fns=[],mintSites=[];let updateCalls=0,escalation=false;
 for(const c of closure){
  const list=functions(c.body);if(!list)return REJ('PARSE_FUNCTIONS',{contract:c.name});
  for(const f of list){
   if(f.kind==='function'&&FORBIDDEN_FN.has(f.name))return REJ('OVERRIDES_'+f.name,{contract:c.name});
   if(ownable&&(f.kind==='modifier'&&f.name==='onlyOwner'||f.kind==='function'&&OWNABLE_FN.has(f.name)))return REJ('OVERRIDES_OWNABLE_'+f.name,{contract:c.name});
   if(f.kind==='fallback'||f.kind==='receive')continue;
   fns.push({...f,contract:c.name});
  }
 }
 const external=[];
 for(const f of fns){
  const hasBody=f.body.length>0||/\{/.test(f.header);
  if(f.kind==='constructor'){for(const m of f.body.matchAll(/\b_mint\s*\(/g))mintSites.push({where:'constructor'});continue;}
  const isPublic=/\b(public|external)\b/.test(f.header),isView=/\b(view|pure)\b/.test(f.header);
  const gatedOwner=/\bonlyOwner\b/.test(f.header)&&ownable,gatedRole=/\bonlyRole\s*\(/.test(f.header)&&accessControl;
  // An UNGATED function that can change who owns/administers the contract defeats every gate-based conclusion.
  if(!gatedOwner&&!gatedRole&&/\b(_transferOwnership|transferOwnership|renounceOwnership|_grantRole|grantRole|_setupRole|_setRoleAdmin|_revokeRole|revokeRole|renounceRole)\s*\(/.test(f.body))escalation=true;
  const calls=[...f.body.matchAll(/\b_mint\s*\(/g)].length;
  if(calls)mintSites.push({where:f.name,gate:isPublic&&f.kind==='function'?(gatedOwner?'owner':gatedRole?'role':null):null});
  if(/\b_update\s*\(/.test(f.body))updateCalls++;
  if(f.kind==='function'&&isPublic&&!isView&&hasBody)external.push({name:f.name,ownerOnly:gatedOwner,roleOnly:gatedRole,header:f.header.replace(/\s+/g,' ').trim()});
 }
 if(updateCalls)return REJ('CALLS_UPDATE_DIRECTLY');
 // Free-standing modifiers other than onlyOwner make a gate unproven.
 const customGate=external.filter(f=>!f.ownerOnly&&!f.roleOnly&&/\b(only[A-Z]\w*|auth|requiresAuth|whenNotPaused|whenPaused)\b/.test(f.header)).map(f=>f.name);
 const nonCtor=mintSites.filter(x=>x.where!=='constructor');
 const constructorMintOnly=mintSites.length>0&&nonCtor.length===0;
 const allOwner=nonCtor.length>0&&nonCtor.every(x=>x.gate==='owner'),allRole=nonCtor.length>0&&nonCtor.every(x=>x.gate==='role');
 return {
  profile:'OZ_ERC20_TEMPLATE',
  libraries:[...libNames].sort(),
  contract:roots[0].name,
  ownable,burnable,
  transferUnmodified:true,
  mint:updateCalls||(nonCtor.length&&escalation)?'UNRESOLVED':allOwner?'OWNER_GATED':allRole?'ROLE_GATED':constructorMintOnly?'CONSTRUCTOR_ONLY':mintSites.length===0?'NO_MINT_CALL':'UNRESOLVED',
  escalation,accessControl,
  ownerOnlyFunctions:external.filter(f=>f.ownerOnly).map(f=>f.name).sort(),
  roleOnlyFunctions:external.filter(f=>f.roleOnly).map(f=>f.name).sort(),
  ungatedFunctions:external.filter(f=>!f.ownerOnly&&!f.roleOnly).map(f=>f.name).sort(),
  unprovenGates:customGate.sort()
 };
}
function analyze(sources,opts){const r=run(sources,opts);return r&&!r.reject?r:null;}
/** Same analysis, but explains a rejection (diagnostics only; never evidence). */
function diagnose(sources,opts){const r=run(sources,opts);return r&&!r.reject?{ok:true,mint:r.mint,ownable:r.ownable,ungated:r.ungatedFunctions.length}:{ok:false,reason:r?.reject||'UNKNOWN',...(r||{})};}
module.exports={analyze,diagnose,strip,contracts,functions};
