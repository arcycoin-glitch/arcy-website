'use strict';
const {createHash}=require('node:crypto');
const {addressWord}=require('./admin-getters');
const releases=require('./mechanics-v8-oz.json');
const hash=s=>createHash('sha256').update(s).digest('hex');
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const ref=r=>'https://github.com/OpenZeppelin/openzeppelin-contracts/blob/'+r.commit+'/'+r.path;

// This checks a closed source bundle, including the compiler's selected main
// contract and all inherited code. A familiar contract name is not a match.
function classify(sources,compilation){
 const fq=compilation?.fullyQualifiedName, name=compilation?.name;
 if(typeof fq!=='string'||!name||!fq.endsWith(':'+name)||Object.keys(sources).length>32)return null;
 const path=fq.slice(0,-name.length-1), content=sources[path]?.content;
 if(typeof content!=='string'||content.length>160000)return null;
 const main=hash(content), dependencyHashes=Object.entries(sources).filter(([key])=>key!==path).map(([,s])=>hash(s.content));
 const files=[...dependencyHashes,main].sort();
 const family=releases.find(r=>r.contract===name&&r.main===main&&same(r.files,files));
 if(family)return {kind:family.kind,release:family.release,sourceReference:ref(family)};
 if(name==='SafeProxy'&&files.length===1&&main==='a32e2bb41a928cc17ac82a7240571e7ad8b8230555f711c13343584d8a4802bb')
  return {kind:'SAFE_PROXY',release:'v1.4.1',sourceReference:'https://github.com/safe-global/safe-smart-account/blob/bf943f80fec5ac647159d26161446ac5d716a294/contracts/proxies/SafeProxy.sol'};
 // Narrow, closed support for concrete OZ UUPS implementations whose entire
 // top-level source uses the reviewed authorization template. Anything with
 // custom inheritance, functions or authorization remains unclassified.
 if(!/^[A-Za-z_$][\w$]*$/.test(name)||content.length>5000)return null;
 const compact=content.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g,'').trim();
 const header=/^(?:pragma\s+solidity\s+[\^~>=.\d\s<]+;\s*)(?:import\s+(?:\{\s*(?:UUPSUpgradeable|Ownable|AccessControl)\s*\}\s+from\s+)?["'][^"'\r\n;]+["'];\s*){2}/.exec(compact);
 if(!header)return null;
 const body=compact.slice(header[0].length).replace(/\s+/g,'');
 const ownerBody='contract'+name+'isUUPSUpgradeable,Ownable{constructor(addressinitialOwner)Ownable(initialOwner){}function_authorizeUpgrade(address)internaloverrideonlyOwner{}}';
 const roleBody='contract'+name+'isUUPSUpgradeable,AccessControl{bytes32publicconstantUPGRADER_ROLE=keccak256("UPGRADER_ROLE");constructor(addressadmin){_grantRole(DEFAULT_ADMIN_ROLE,admin);}function_authorizeUpgrade(address)internaloverrideonlyRole(UPGRADER_ROLE){}}';
 const role=body===roleBody, owner=body===ownerBody;
 if(!role&&!owner)return null;
 for(const r of releases.filter(x=>x.kind==='UUPS_BASE'&&(role||x.release.startsWith('v5.')))){
  const gate=releases.find(x=>x.kind===(owner?'OWNABLE':'ACCESS_CONTROL')&&x.release===r.release);
  if(same([...new Set([...r.files,...gate.files])].sort(),dependencyHashes.sort()))
   return {kind:owner?'UUPS_ONLY_OWNER':'UUPS_ONLY_ROLE',release:r.release,sourceReference:ref(r),gateSource:ref(gate)};
 }
 return null;
}

function immutableAddress(code,references){
 const groups=Object.values(references||{});
 if(groups.length!==1||!Array.isArray(groups[0])||groups[0].length<1||groups[0].length>8)return null;
 const values=groups[0].map(ref=>{const {start,length}=ref||{};return length===32&&Number.isInteger(start)&&start>=0&&start*2+64<=code.length-2?
  addressWord('0x'+code.slice(2+start*2,2+start*2+64)):null;});
 return values[0]&&values.every(v=>v===values[0])?values[0]:null;
}
module.exports={classify,immutableAddress};
