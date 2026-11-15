'use strict';
// Read-only CI source-review probe for Contract & Mechanics (no writes, no transactions, no secrets printed).
// For each sample it resolves the executed runtime (EIP-1967 / legacy slot / beacon / EIP-1167 clone), fetches the
// Sourcify record of the executed contract, re-validates exact chain/address/runtime identity with the production
// validator and prints the transfer-path and privileged functions for human review. Output is evidence for review
// only; nothing here is used by the production code path.
// usage: node scripts/probe-mechanics-sources.cjs mechanics-samples.json [extra.json]
const fs=require('node:fs');
const deep=require('../search/server/lib/mechanics-deep');
const oz=require('../search/server/lib/oz-template');
const {addressWord}=require('../search/server/lib/admin-getters');
const RPC={ethereum:require('../search/server/lib/eth').rpc,arc:require('../search/server/lib/arc-rpc').rpc,robinhood:require('../search/server/lib/robinhood-rpc').rpc};
const CHAIN={ethereum:1,arc:5042,robinhood:4663};
const samples=[...JSON.parse(fs.readFileSync(process.argv[2]||'mechanics-samples.json','utf8'))];
if(process.argv[3]&&fs.existsSync(process.argv[3]))samples.push(...JSON.parse(fs.readFileSync(process.argv[3],'utf8')));
const FULL=(process.env.PROBE_FULL||'').toLowerCase().split(',').filter(Boolean);
const full=(...xs)=>xs.some(x=>FULL.some(p=>p==='all'||String(x||'').slice(2).startsWith(p)));
const PATH_FNS=/^(transfer|transferFrom|_transfer|_update|_beforeTokenTransfer|_afterTokenTransfer|_transferFrom)$/;
const PRIV=/mint|issue|pause|freeze|blacklist|blocklist|allowlist|whitelist|frozen|fee|tax|limit|max|owner|admin|role|upgrade|supplyController|assetProtection|rescue|wipe|seize|burn/i;
const SLOT={impl:'0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',legacy:'0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3',beacon:'0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function source(chainId,address,code){
 const url='https://sourcify.dev/server/v2/contract/'+chainId+'/'+address+'?fields=abi,sources,compilation,runtimeBytecode';
 const r=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!r.ok)return {status:r.status};
 const d=await r.json();try{const v=deep.validateSource(d,{chainId,address,code});return {status:200,d,digest:v.digest,match:d.runtimeMatch};}catch(e){return {status:200,invalid:e.message};}
}
function excerpt(src,full){
 const out=[];
 for(const [p,f] of Object.entries(src.sources)){
  if(/@openzeppelin|node_modules|\/lib\/forge-std/.test(p)&&!full)continue;
  const s=oz.strip(f.content),cs=oz.contracts(s);if(!cs)continue;
  for(const c of cs){if(c.kind==='interface'||c.kind==='library')continue;const fns=oz.functions(c.body)||[];
   for(const fn of fns){const priv=PATH_FNS.test(fn.name)||fn.kind==='modifier'||(fn.kind==='function'&&PRIV.test(fn.name));
    if(!priv&&!full)continue;const hdr=fn.header.replace(/\s+/g,' ').trim();
    const body=fn.body.replace(/\s+/g,' ').trim();
    out.push(p.split('/').pop()+':'+c.name+'.'+fn.kind[0]+':'+fn.name+'('+fn.params.replace(/\s+/g,' ').trim()+') '+hdr+' { '+body.slice(0,full?2400:700)+(body.length>(full?2400:700)?' …':'')+' }');}}
 }
 return out;
}
(async()=>{
 for(const s of samples){
  const net=s.chain,rpc=RPC[net],chainId=CHAIN[net],a=s.address.toLowerCase();
  try{
   const block=await rpc('eth_blockNumber',[]);const code=await rpc('eth_getCode',[a,block]);
   let target=a,kind='direct';
   const clone=/^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/i.exec(code||'');
   if(clone){target='0x'+clone[1].toLowerCase();kind='clone';}
   else if(!require('../lib/mechanics-runtime').nonDelegating(code)){
    for(const [k,slot] of Object.entries(SLOT)){const w=addressWord(await rpc('eth_getStorageAt',[a,slot,block]).catch(()=>null));if(!w)continue;
     if(k==='beacon'){const impl=addressWord(await rpc('eth_call',[{to:w,data:'0x5c60da1b'},block]).catch(()=>null));if(impl){target=impl.toLowerCase();kind='beacon:'+w;break;}}
     else{target=w.toLowerCase();kind=k;break;}}
    if(kind==='direct')kind='delegating-unresolved';
   }
   const tcode=target===a?code:await rpc('eth_getCode',[target,block]);
   const outer=await source(chainId,a,code);await sleep(400);
   const inner=target===a?outer:await source(chainId,target,tcode);await sleep(400);
   const src=inner.d?inner:outer.d&&target===a?outer:null;
   const profile=src?deep.PROFILES[src.digest]||null:null;
   const tmpl=src?oz.diagnose(src.d.sources,{lib:require('../search/server/lib/oz-library-hashes'),main:src.d.compilation?.name}):null;
   console.log('SRC '+JSON.stringify({net,group:s.group,a,kind,target,block,outer:{status:outer.status,match:outer.match,invalid:outer.invalid,digest:outer.digest},inner:target===a?'same':{status:inner.status,match:inner.match,invalid:inner.invalid,digest:inner.digest},main:src?.d.compilation?.name||null,profile,template:tmpl?(tmpl.ok?'OK:'+tmpl.mint:tmpl.reason):null}));
   if(src&&(!profile||full(a,target))){for(const line of excerpt(src.d,full(a,target)))console.log('  FN '+line);}
   else if(src&&profile){for(const line of excerpt(src.d,false).filter(l=>/\.(f:(transfer|transferFrom|_transfer|_update|_beforeTokenTransfer|_transferFrom)\(|m:)/.test(l)))console.log('  FN '+line);}
  }catch(e){console.log('SRC '+JSON.stringify({net,a,error:String(e.message||e).slice(0,160)}));}
 }
})();
