#!/usr/bin/env node
'use strict';
// READ-ONLY Contract & Mechanics deep audit (CI / operator tool). No writes, no queues, no production mutations.
// 1. Samples: production Radar top-10 per section (arc, ethereum, robinhood, pons) — the same public source the
//    existing benchmark uses. 2. Runs the repository's own Mechanics pipeline in-process (GoPlus disabled exactly like
//    production: VERCEL=1, no GOPLUS_PUBLIC_DISPLAY_APPROVED). 3. Independent bounded on-chain facts per contract
//    (<= ~12 RPC calls: code, EIP-1967/1822/beacon slots, EIP-1167 clone target, implementation code, owner(), paused()).
// 4. For Ethereum/Robinhood/Pons only, the production /api/search report card is also read for a production-vs-code
//    comparison. Arc production reports are NOT requested: they can queue Arc holder work (/queue-missing).
// Output: mechanics-audit.json (+ ::notice annotations).
process.env.VERCEL='1';delete process.env.GOPLUS_PUBLIC_DISPLAY_APPROVED;
const fs=require('node:fs'),path=require('node:path');
const root=process.cwd(),req=p=>require(path.join(root,p));
const keccak=req('lib/keccak');
const BASE=process.env.ARCY_BASE||'https://www.arcyusdc.xyz',PER=Math.max(1,Math.min(10,Number(process.env.PER_SECTION)||10));
const FIELDS=['tradingTaxes','mintCapability','ownerAdmin','contractArchitecture'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const sel=s=>keccak(Buffer.from(s)).slice(2,10);
const SIG={
 mint:['mint(address,uint256)','mint(uint256)','mintTo(address,uint256)','issue(uint256)','mint(address,uint256,bytes)'],
 burn:['burn(uint256)','burnFrom(address,uint256)','burn(address,uint256)'],
 pause:['pause()','unpause()','paused()'],
 blacklist:['blacklist(address)','isBlacklisted(address)','addBlackList(address)','setBlacklist(address,bool)','isBlackListed(address)','blacklisted(address)','setBots(address[],bool)'],
 fees:['setFees(uint256,uint256)','setTaxes(uint256,uint256)','setBuyTax(uint256)','setSellTax(uint256)','buyTax()','sellTax()','buyFee()','sellFee()','taxFee()','_taxFee()','setFee(uint256)','updateFees(uint256,uint256)','setTaxFeePercent(uint256)','excludeFromFee(address)','isExcludedFromFee(address)'],
 limits:['maxTxAmount()','_maxTxAmount()','maxWalletSize()','tradingEnabled()','enableTrading()','openTrading()','setMaxTxAmount(uint256)'],
 owner:['owner()','getOwner()','transferOwnership(address)','renounceOwnership()'],
 roles:['hasRole(bytes32,address)','grantRole(bytes32,address)','MINTER_ROLE()','DEFAULT_ADMIN_ROLE()'],
 upgrade:['upgradeTo(address)','upgradeToAndCall(address,bytes)','implementation()','admin()','changeAdmin(address)']
};
const SEL=Object.fromEntries(Object.entries(SIG).map(([k,v])=>[k,new Map(v.map(s=>[sel(s),s]))]));
function selectors(code){const b=Buffer.from(code.slice(2),'hex'),out=new Set();for(let i=0;i+4<b.length;i++){const op=b[i];if(op===0x63){out.add(b.slice(i+1,i+5).toString('hex'));i+=4;}else if(op>=0x60&&op<=0x7f)i+=op-0x5f;}return out;}
const SLOT={impl1967:'0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',admin1967:'0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103',beacon1967:'0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeee59ff6cb3582b35133d50',impl1822:'0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5132cf622f8c',zos:'0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3'};
const word2addr=w=>typeof w==='string'&&/^0x[0-9a-f]{64}$/i.test(w)&&!/^0x0{64}$/.test(w)?'0x'+w.slice(-40).toLowerCase():null;
async function get(p){const r=await fetch(BASE+p,{headers:{accept:'application/json',referer:BASE+'/','sec-fetch-site':'same-origin'},signal:AbortSignal.timeout(45000)});const t=await r.text();let j=null;try{j=JSON.parse(t);}catch{}return {s:r.status,j};}
async function samples(){
 const out=[],seen=new Set();
 for(const section of ['arc','ethereum','robinhood','pons']){
  let d=null;for(let i=0;i<3&&!d;i++){const r=await get('/api/search?action=radar&chain='+section);if(r.s===200)d=r.j;else await sleep(10000);}
  for(const t of (d?.tokens||[]).slice(0,PER)){const a=String(t.address||t.token||'').toLowerCase();const chain=section==='pons'?'robinhood':section;if(/^0x[0-9a-f]{40}$/.test(a)&&!seen.has(chain+a)){seen.add(chain+a);out.push({section,chain,address:a,symbol:t.symbol||t.y||null});}}
  if(!d)out.push({section,error:'RADAR_UNAVAILABLE'});
 }
 return out;
}
async function pipeline(chain,address){
 if(chain==='ethereum'){
  const report=req('search/server/lib/report'),control=req('search/server/lib/control'),security=req('search/server/lib/goplus-evidence'),eth=req('search/server/lib/eth');
  const t=await eth.inspect(address);
  const [c,sec]=await Promise.all([control.inspect(t.address,t.block).catch(control.failure),security.inspect('ethereum',t.address).catch(()=>({}))]);let extra={};
  if(c.fields?.owner?.dataState!=='DATA_FOUND'||c.fields?.proxyImplementation?.dataState!=='DATA_FOUND'){try{extra=await req('search/server/lib/admin-getters').inspect({network:'ethereum',address:t.address,block:t.block,rpc:eth.rpc,needAdmin:c.fields?.owner?.dataState!=='DATA_FOUND',needImplementation:c.fields?.proxyImplementation?.dataState!=='DATA_FOUND'});}catch{}}
  return {block:t.block,card:await req('search/server/lib/mechanics-coverage').enrich({network:'ethereum',address:t.address,block:t.block,rpc:eth.rpc,card:report.mechanicsCard(c,sec,extra)})};
 }
 const adapter=req('search/server/lib/'+(chain==='arc'?'arc':'robinhood')+'-adapter');
 const base=await adapter.inspectToken({address});
 return {block:base.block,card:await adapter.inspectCard({base,cardId:'mechanics',address})};
}
const rpcFor=chain=>chain==='ethereum'?req('search/server/lib/eth').rpc:chain==='arc'?req('search/server/lib/arc-rpc').rpc:req('search/server/lib/robinhood-rpc').rpc;
async function facts(chain,a){
 const rpc=rpcFor(chain),f={calls:0};const call=async(m,p)=>{f.calls++;return rpc(m,p);};
 try{
  const code=await call('eth_getCode',[a,'latest']);f.codeBytes=(code.length-2)/2;f.codeHash=code.length>2?keccak(Buffer.from(code.slice(2),'hex')).slice(2,10):null;
  const clone=/^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/i.exec(code);
  f.clone1167=clone?'0x'+clone[1].toLowerCase():null;
  for(const [k,slot] of Object.entries(SLOT)){try{f[k]=word2addr(await call('eth_getStorageAt',[a,slot,'latest']));}catch{f[k]='ERR';}}
  const target=f.clone1167||(f.impl1967&&f.impl1967!=='ERR'?f.impl1967:null)||(f.impl1822&&f.impl1822!=='ERR'?f.impl1822:null)||(f.zos&&f.zos!=='ERR'?f.zos:null);
  let implCode=null;if(target){try{implCode=await call('eth_getCode',[target,'latest']);}catch{}}
  if(f.beacon1967&&f.beacon1967!=='ERR'){try{const r=await call('eth_call',[{to:f.beacon1967,data:'0x5c60da1b'},'latest']);f.beaconImpl=word2addr(r);if(f.beaconImpl)implCode=await call('eth_getCode',[f.beaconImpl,'latest']);}catch{}}
  f.target=f.beaconImpl||target||null;
  f.implHash=implCode&&implCode.length>2?keccak(Buffer.from(implCode.slice(2),'hex')).slice(2,10):null;
  const s=selectors(code);if(implCode&&implCode.length>2)for(const x of selectors(implCode))s.add(x);
  f.selectors=Object.fromEntries(Object.entries(SEL).map(([k,m])=>[k,[...m.keys()].filter(x=>s.has(x)).map(x=>m.get(x))]));
  if(f.selectors.owner.includes('owner()')){try{f.owner=word2addr(await call('eth_call',[{to:a,data:'0x8da5cb5b'},'latest']))||'0x0';}catch(e){f.owner='REVERT';}}
  if(f.selectors.pause.includes('paused()')){try{const r=await call('eth_call',[{to:a,data:'0x5c975abb'},'latest']);f.paused=BigInt(r)!==0n;}catch{f.paused='REVERT';}}
 }catch(e){f.error=String(e.code||e.message).slice(0,60);}
 return f;
}
const pick=f=>f?{v:f.value===null||f.value===undefined?null:String(typeof f.value==='object'?JSON.stringify(f.value):f.value).slice(0,180),ds:f.dataState||null,st:f.status||null,rc:f.reasonCode||null,ec:f.evidenceClass||null,src:typeof f.source==='string'?f.source.slice(0,60):null,reason:typeof f.reason==='string'?f.reason.slice(0,160):null,diag:f.analysisDiagnostics?JSON.stringify(f.analysisDiagnostics).slice(0,300):null}:null;
(async()=>{
 const {classify}=req('search/server/lib/evidence-class');
 const list=await samples(),rows=[];
 for(const s of list){
  if(s.error){rows.push(s);continue;}
  const row={...s},t0=Date.now();
  try{const r=await Promise.race([pipeline(s.chain,s.address),new Promise((_,j)=>setTimeout(()=>j(Error('AUDIT_TIMEOUT_75S')),75000))]);
   row.block=r.block;row.code=Object.fromEntries(FIELDS.map(k=>{const f=r.card?.fields?.[k];let ec=null;try{ec=f?(f.evidenceClass||classify(f,{card:'mechanics'})?.evidenceClass||null):null;}catch{}return [k,{...pick(f),ec:ec||pick(f)?.ec||null}];}));}
  catch(e){row.codeError=String(e.message||e).slice(0,100);}
  row.ms=Date.now()-t0;
  row.facts=await facts(s.chain,s.address);
  if(s.chain!=='arc'){await sleep(3500);try{const p=await get('/api/search?action=report&chain='+s.chain+'&address='+s.address);row.prodHttp=p.s;const card=p.j?.cards?.mechanics;row.prod=card?Object.fromEntries(FIELDS.map(k=>[k,pick(card.fields?.[k])])):null;}catch(e){row.prodHttp='ERR '+String(e.message).slice(0,40);}}
  rows.push(row);
  console.log('::notice title=mech-'+s.section+'-'+s.address.slice(2,8)+'::'+JSON.stringify({s:s.symbol,code:row.code&&Object.fromEntries(FIELDS.map(k=>[k,[row.code[k]?.ds,row.code[k]?.rc,row.code[k]?.v?.slice(0,50)]])),prod:row.prod&&Object.fromEntries(FIELDS.map(k=>[k,[row.prod[k]?.ds,row.prod[k]?.rc]])),f:{c:row.facts.clone1167,i:row.facts.impl1967,b:row.facts.beacon1967,o:row.facts.owner,p:row.facts.paused,sel:Object.fromEntries(Object.entries(row.facts.selectors||{}).map(([k,v])=>[k,v.length]))},err:row.codeError}).slice(0,3900));
 }
 fs.writeFileSync('mechanics-audit.json',JSON.stringify({at:new Date().toISOString(),base:BASE,rows},null,1));
 const sum={};for(const r of rows){if(r.error)continue;const n=sum[r.section]||={tokens:0,slots:0,found:0,codeErrors:0,byField:{},reasons:{}};n.tokens++;if(r.codeError){n.codeErrors++;continue;}for(const k of FIELDS){n.slots++;const f=r.code[k];const ok=f?.ds==='DATA_FOUND';if(ok)n.found++;(n.byField[k]||=[0,0])[ok?0:1]++;if(!ok){const c=k+':'+(f?.rc||'NONE');n.reasons[c]=(n.reasons[c]||0)+1;}}}
 console.log('::notice title=mech-audit-summary::'+JSON.stringify(sum).slice(0,3900));
})().catch(e=>{console.error(e);process.exitCode=1;});
