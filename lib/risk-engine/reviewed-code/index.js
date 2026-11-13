'use strict';
// Reviewed-code registry: the security control that turns an ACCESS observation into a CAPABILITY finding.
//
// One entry proves ONE capability for ONE execution route on ONE network:
//   { id, network, capability: 'upgrade'|'mint', architecture, selector, actorRole,
//     proxyCodeHash, implementationCodeHash, artifact }
// architecture (what handles the call, and therefore which code must be reviewed):
//   'eip1967-transparent-proxy'  upgrade only. The PROXY code handles admin calls itself; the implementation never
//                                sees them. proxyCodeHash required; actorRole must be 'eip1967-admin'.
//   'eip1967-uups'               upgrade only. The proxy is reviewed as purely delegating and the IMPLEMENTATION holds
//                                the upgrade logic. Both hashes required.
//   'eip1967-delegated'          mint through a proxy. The proxy is reviewed as delegating this selector for this actor
//                                (no interception) AND the implementation is reviewed as increasing supply. Both hashes
//                                required; actorRole 'owner' or 'minter-role' (AccessControlEnumerable MINTER_ROLE member),
//                                never 'eip1967-admin' (a transparent proxy intercepts admin calls).
//   'direct'                     not a proxy: the token's own code handles the call. proxyCodeHash is the token code
//                                hash; implementationCodeHash must be null.
// Every entry must point at a review artifact (JSON in this folder) produced by scripts/review-code-evidence.cjs from
// a Sourcify exact match whose runtime bytecode hash equals the on-chain code hash seen by two operators, with the
// reviewed function sources recorded. An entry whose artifact is missing, inconsistent or not an exact match is
// dropped at load time (fail closed). There is no wildcard and no "trusted contract" entry.
const HASH=/^0x[0-9a-f]{64}$/,SELECTORS=new Set(['upgradeTo','upgradeToAndCall','mint']);
const ARCHITECTURES=Object.freeze({
 'eip1967-transparent-proxy':{capabilities:['upgrade'],proxy:true,implementation:false,roles:['eip1967-admin']},
 'eip1967-uups':{capabilities:['upgrade'],proxy:true,implementation:true,roles:['owner']},
 'eip1967-delegated':{capabilities:['mint'],proxy:true,implementation:true,roles:['owner','minter-role']},
 'direct':{capabilities:['mint'],proxy:true,implementation:false,roles:['owner','minter-role']}
});
const NETWORKS=Object.freeze({arc:5042,ethereum:1,robinhood:4663});
// Static requires so the artifacts ship with every bundle/image that ships this module.
const ENTRIES=Object.freeze([
 {id:'eth-aave-upgradeto',network:'ethereum',capability:'upgrade',architecture:'eip1967-transparent-proxy',selector:'upgradeTo',actorRole:'eip1967-admin',
  proxyCodeHash:'0x98a3150c9759d754a4b31f6fb3f4828371c60c2c07fb0754cfa2b230cb601001',implementationCodeHash:null,artifact:require('./eth-aave-upgradeto.json')},
 {id:'eth-aave-upgradetoandcall',network:'ethereum',capability:'upgrade',architecture:'eip1967-transparent-proxy',selector:'upgradeToAndCall',actorRole:'eip1967-admin',
  proxyCodeHash:'0x98a3150c9759d754a4b31f6fb3f4828371c60c2c07fb0754cfa2b230cb601001',implementationCodeHash:null,artifact:require('./eth-aave-upgradetoandcall.json')},
 {id:'eth-ondo-tokenproxy-upgradeto',network:'ethereum',capability:'upgrade',architecture:'eip1967-transparent-proxy',selector:'upgradeTo',actorRole:'eip1967-admin',
  proxyCodeHash:'0xa23b20d4f9e75f4bf9bd74d8c1b7f0219547289c67a11dea65370c1810fc1387',implementationCodeHash:null,artifact:require('./eth-ondo-tokenproxy-upgradeto.json')},
 {id:'eth-ondo-tokenproxy-upgradetoandcall',network:'ethereum',capability:'upgrade',architecture:'eip1967-transparent-proxy',selector:'upgradeToAndCall',actorRole:'eip1967-admin',
  proxyCodeHash:'0xa23b20d4f9e75f4bf9bd74d8c1b7f0219547289c67a11dea65370c1810fc1387',implementationCodeHash:null,artifact:require('./eth-ondo-tokenproxy-upgradetoandcall.json')},
 {id:'eth-ondo-usdy-mint-minter-role',network:'ethereum',capability:'mint',architecture:'eip1967-delegated',selector:'mint',actorRole:'minter-role',
  proxyCodeHash:'0xa23b20d4f9e75f4bf9bd74d8c1b7f0219547289c67a11dea65370c1810fc1387',implementationCodeHash:'0x8f5e4d087ec40f0ce649c01bf65465091aac7c8268c89b9556def5e244c9c145',artifact:require('./eth-ondo-usdy-mint-minter-role.json')},
 {id:'eth-ondo-ousg-mint-minter-role',network:'ethereum',capability:'mint',architecture:'eip1967-delegated',selector:'mint',actorRole:'minter-role',
  proxyCodeHash:'0xa23b20d4f9e75f4bf9bd74d8c1b7f0219547289c67a11dea65370c1810fc1387',implementationCodeHash:'0xe3966d923815cfd861c8d73e35fa571de9439704c40ec2341f867ede467fbbdf',artifact:require('./eth-ondo-ousg-mint-minter-role.json')}
]);
function validArtifact(entry,a){
 if(!a||a.schemaVersion!==1||a.reviewId!==entry.id||a.network!==entry.network||a.chainId!==NETWORKS[entry.network]||a.capability!==entry.capability||
  a.architecture!==entry.architecture||a.selector!==entry.selector||a.actorRole!==entry.actorRole)return false;
 if((a.proxyCodeHash??null)!==(entry.proxyCodeHash??null)||(a.implementationCodeHash??null)!==(entry.implementationCodeHash??null))return false;
 // Each reviewed code hash needs its own exact source match whose runtime bytecode is the on-chain code.
 const need=[entry.proxyCodeHash,entry.implementationCodeHash].filter(Boolean),proofs=Array.isArray(a.codeProofs)?a.codeProofs:[];
 for(const hash of need){
  const p=proofs.find(x=>x&&x.codeHash===hash);
  if(!p||p.sourceMatch!=='exact_match'||p.verifiedRuntimeCodeHash!==hash||!Array.isArray(p.onchain)||p.onchain.length<2||
   new Set(p.onchain.map(o=>o.operator)).size<2||!p.onchain.every(o=>o.codeHash===hash&&HASH.test(o.blockHash||''))||new Set(p.onchain.map(o=>o.blockHash)).size!==1||
   !Array.isArray(p.sources)||!p.sources.length||!p.sources.every(s=>typeof s.path==='string'&&HASH.test(s.keccak256||'')))return false;
 }
 return Array.isArray(a.reviewedFunctions)&&a.reviewedFunctions.length>0&&a.reviewedFunctions.every(f=>typeof f.name==='string'&&typeof f.finding==='string'&&f.finding.length>20)&&
  typeof a.conclusion==='string'&&a.conclusion.length>40;
}
function validEntry(e){
 const arch=e&&ARCHITECTURES[e.architecture];
 if(!arch||typeof e.id!=='string'||!/^[a-z0-9][a-z0-9-]{3,80}$/.test(e.id)||!Object.hasOwn(NETWORKS,e.network)||!arch.capabilities.includes(e.capability)||
  !SELECTORS.has(e.selector)||(e.capability==='mint')!==(e.selector==='mint')||!arch.roles.includes(e.actorRole)||!HASH.test(e.proxyCodeHash||''))return false;
 if(arch.implementation?!HASH.test(e.implementationCodeHash||''):e.implementationCodeHash!==null&&e.implementationCodeHash!==undefined)return false;
 return validArtifact(e,e.artifact);
}
function build(entries){
 const accepted=[],rejected=[];
 for(const e of entries||[])(validEntry(e)?accepted:rejected).push(e);
 // Ambiguity fails closed: two entries for the same route and capability are both dropped.
 const key=e=>[e.network,e.capability,e.architecture,e.selector,e.actorRole,e.proxyCodeHash,e.implementationCodeHash||''].join('|');
 const counts=new Map();for(const e of accepted)counts.set(key(e),(counts.get(key(e))||0)+1);
 const unique=accepted.filter(e=>counts.get(key(e))===1);
 const frozen=Object.freeze(unique.map(e=>Object.freeze({id:e.id,network:e.network,capability:e.capability,architecture:e.architecture,selector:e.selector,actorRole:e.actorRole,
  proxyCodeHash:e.proxyCodeHash,implementationCodeHash:e.implementationCodeHash||null})));
 return {entries:frozen,rejected:rejected.length+(accepted.length-unique.length),
  // route: {network, capability, isProxy, proxyCodeHash, implementationCodeHash, actorRole, selector}
  match(route){
   if(!route||!HASH.test(route.proxyCodeHash||''))return null;
   for(const e of frozen){
    if(e.network!==route.network||e.capability!==route.capability||e.selector!==route.selector||e.actorRole!==route.actorRole||e.proxyCodeHash!==route.proxyCodeHash)continue;
    const arch=ARCHITECTURES[e.architecture];
    if((e.architecture==='direct')===Boolean(route.isProxy))continue;                       // proxy vs non-proxy must match the reviewed architecture
    if(arch.implementation?e.implementationCodeHash!==route.implementationCodeHash:false)continue;
    return e;
   }
   return null;
  }};
}
const REGISTRY=build(ENTRIES);
module.exports={REGISTRY,build,validEntry,validArtifact,ARCHITECTURES};
