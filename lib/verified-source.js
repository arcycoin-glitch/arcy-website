const crypto=require('node:crypto'),c=require('./core');
const profiles={
 'f4abba6aa7071125168a9b9ea39cdfd08f01835d3c59aa74c55173c71e50daa1':{id:'ARGUS_V4_LAUNCH_TOKEN_7',name:'ArgusV4LaunchToken7',transferTax:0},
 'c96f888a58e671d77378eddde2e6fb195bea44201ab50006478377d312156ba6':{id:'ARGUS_TAX_TOKEN',name:'ArgusTaxToken',transferTax:0},
 '316b86e4d73ad7a683188f2ac85162c763fd055d47d44c2be790d54b83a73a49':{id:'FIAT_TOKEN_PROXY',name:'FiatTokenProxy',purpose:'PROXY'},
 'd8d6edfc12f71433b5efe6ab623af4db5b160750902daa4f08fe337865087ceb':{id:'FIAT_TOKEN_V2_2',name:'FiatTokenV2_2',transferTax:0}
};
function digest(sources){return crypto.createHash('sha256').update(JSON.stringify(Object.entries(sources).map(([p,x])=>[p,x.content]).sort(([a],[b])=>a.localeCompare(b)))).digest('hex');}
function validate(d,a,code){
 if(String(d.chainId)!==String(c.CHAIN)||String(d.address).toLowerCase()!==a.toLowerCase())return {dataState:'NOT_VERIFIED',reasonCode:'SOURCE_IDENTITY_MISMATCH'};
 if(!['exact_match','match'].includes(d.runtimeMatch)||d.runtimeBytecode?.onchainBytecode?.toLowerCase()!==code.toLowerCase())return {dataState:'NOT_VERIFIED',reasonCode:'SOURCE_BYTECODE_MISMATCH'};
 if(!Array.isArray(d.abi)||!d.sources||!Object.values(d.sources).every(x=>typeof x.content==='string'))return {dataState:'SOURCE_API_FAILED',reasonCode:'MALFORMED_VERIFIED_SOURCE'};
 const hash=digest(d.sources),p=profiles[hash];
 return {dataState:'DATA_FOUND',source:'Sourcify',address:a,chainId:c.CHAIN,runtimeMatch:d.runtimeMatch,sourceDigest:hash,profile:p&&p.name===d.compilation?.name?p:null,abi:d.abi,signatures:d.signatures,storageLayout:d.storageLayout,sources:d.sources,userdoc:d.userdoc,devdoc:d.devdoc};
}
const inflight=new Map();
async function lookup(a,code){const url='https://sourcify.dev/server/v2/contract/'+c.CHAIN+'/'+a+'?fields=all';const key=a+code;let p=inflight.get(key);if(!p){p=require('./fields').cached('source:'+a+crypto.createHash('sha256').update(code).digest('hex'),300000,async()=>{try{return {...validate(await c.json(url),a,code),url};}catch(e){const primary={source:'Sourcify',url,...(e.httpStatus===404?{dataState:'SOURCE_HAS_NO_DATA',httpStatus:404,reasonCode:'SOURCE_NOT_VERIFIED_ON_SOURCIFY'}:c.failure(e))};try{const alternate=await require('./explorer-source').lookup(a,code);if(alternate.dataState==='DATA_FOUND')return {...alternate,attempts:[primary]};return {...primary,attempts:[primary,alternate]};}catch(err){return {...primary,attempts:[primary,{source:'Etherscan V2',...c.failure(err)}]};}}});inflight.set(key,p);p.finally(()=>inflight.delete(key));}return p;}
function summary(s){const {abi,signatures,storageLayout,sources,userdoc,devdoc,...rest}=s;return rest;}
function selector(s,name){return s.signatures?.function?.find(x=>x.signature===name)?.signatureHash4||null;}
module.exports={lookup,validate,digest,summary,selector,profiles};
