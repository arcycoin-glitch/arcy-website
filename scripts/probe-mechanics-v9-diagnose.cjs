#!/usr/bin/env node
'use strict';
// V9 read-only diagnosis of the 16 non-strict contracts of the immutable 40-subject cohort.
// For each: runtime shape, standard proxy slots, Sourcify/Blockscout source status, and the V8 engine's own field results/reasons (live).
// Prints compact ::notice annotations. No writes, no log scans, GoPlus disabled like Production.
process.env.VERCEL='1';delete process.env.GOPLUS_PUBLIC_DISPLAY_APPROVED;
const fs=require('node:fs'),path=require('node:path');
const root=process.cwd(),req=p=>require(path.join(root,p));
const keccak=require('../lib/keccak');
const {chain}=req('search/server/lib/chains');
const rpcs={ethereum:req('search/server/lib/eth').rpc,arc:req('search/server/lib/arc-rpc').rpc,robinhood:req('search/server/lib/robinhood-rpc').rpc};
const TARGETS='ARGUS ARCOON FAZE LONG CRA oBrain ARCANUS MSS2 LDO AAVE API3 STATICS FLOCK STONKBROKER AI TENDIES'.split(' ');
const cohort=require('../data/verified-coverage/radar-cohort-20261121.json').tokens.filter(t=>TARGETS.includes(t.symbol));
const only=(process.argv[2]||'').split(',').filter(Boolean);const SOURCE=process.env.V9_SOURCE==='1';
const crypto=require('node:crypto');
const SLOTS={impl1967:'0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',admin1967:'0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103',beacon:'0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50',uups1822:'0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7',ozLegacy:'0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3'};
const sel=s=>keccak(Buffer.from(s)).slice(2,10);
const NAMES=['owner()','admin()','pendingOwner()','paused()','mint(address,uint256)','mint(uint256)','burn(uint256)','burnFrom(address,uint256)','transferOwnership(address)','renounceOwnership()','implementation()','upgradeTo(address)','upgradeToAndCall(address,bytes)','facets()','facetAddress(bytes4)','diamondCut((address,uint8,bytes4[])[],address,bytes)','getRoleMember(bytes32,uint256)','hasRole(bytes32,address)','grantRole(bytes32,address)','setFee(uint256)','setTax(uint256)','setFees(uint256,uint256)','setBuyFee(uint256)','setSellFee(uint256)','setTaxes(uint256,uint256,uint256)','buyTax()','sellTax()','transferTax()','taxFee()','_taxFee()','totalFees()','feeReceiver()','taxWallet()','setBlacklist(address,bool)','blacklist(address)','isBlacklisted(address)','pause()','unpause()','setPair(address,bool)','pair()','uniswapV2Pair()','router()','transferAndCall(address,uint256,bytes)','approveAndCall(address,uint256,bytes)','tradingEnabled()','launched()','graduated()','hook()','setHook(address)','beforeTokenTransfer(address,address,uint256)','_update(address,address,uint256)','_transfer(address,address,uint256)','maxTransactionAmount()','maxWallet()','excludeFromFees(address,bool)','isExcludedFromFees(address)','getPair(address,address)','factory()','proxiableUUID()','getImplementation()','upgradeable()','minter()','minters(address)','isMinter(address)','cap()','supplyCap()','maxSupply()'];
const TABLE=Object.fromEntries(NAMES.map(n=>[sel(n),n]));
function selectors(code){const b=Buffer.from(code.slice(2),'hex'),out=new Set();for(let i=0;i<b.length-4;i++){const op=b[i];if(op===0x63)out.add(b.slice(i+1,i+5).toString('hex'));if(op>=0x60&&op<=0x7f)i+=op-0x5f;}return out;}
const jget=async(u,ms=9000)=>{try{const r=await fetch(u,{headers:{accept:'application/json'},signal:AbortSignal.timeout(ms)});let j=null;try{j=await r.json();}catch{}return {s:r.status,j};}catch(e){return {s:-1,e:String(e.message||e).slice(0,50)};}};
const esc=x=>x.replace(/%/g,'%25').replace(/\r/g,'').replace(/\n/g,'%0A');

async function sourceDump(t,cfg,target){
 const addr=target||t.address.toLowerCase();
 const r=await jget('https://sourcify.dev/server/v2/contract/'+cfg.chainId+'/'+addr+'?fields=sources,compilation,runtimeBytecode',20000);
 const o={sym:t.symbol,addr,status:r.s,compiler:r.j?.compilation?.compilerVersion,name:r.j?.compilation?.name,settings:r.j?.compilation?.compilerSettings?JSON.stringify({opt:r.j.compilation.compilerSettings.optimizer,evm:r.j.compilation.compilerSettings.evmVersion}):null};
 const src=r.j?.sources||{};o.files=Object.entries(src).map(([k,v])=>[k,v.content?.length,crypto.createHash('sha256').update(v.content||'').digest('hex').slice(0,12)]);
 console.log('::notice title=v9-src-files-'+t.symbol+'::'+esc(JSON.stringify(o)));
 const out=[];
 for(const [k,v] of Object.entries(src)){
  if(/(^|\/)(@openzeppelin|openzeppelin)\//i.test(k)&&!/ERC20\.sol$/.test(k))continue;
  const lines=(v.content||'').split('\n');
  for(let i=0;i<lines.length;i++){
   if(/function\s+(transfer|transferFrom|_transfer|_update|_beforeTokenTransfer|_afterTokenTransfer|_mint|mint|_burn|burn|doTransfer|_tax|_fee|_takeFee|_collect\w*|_applyFee\w*)\b/.test(lines[i])){
    out.push('// '+k+':'+(i+1)+'\n'+lines.slice(i,i+(SOURCE_LINES)).join('\n'));
   }
  }
 }
 const text=out.join('\n----\n');
 for(let i=0,n=0;i<text.length&&n<3;i+=30000,n++)console.log('::notice title=v9-src-fn-'+t.symbol+'-'+n+'::'+esc(text.slice(i,i+30000)));
}
const SOURCE_LINES=Number(process.env.V9_LINES||45);
const FIELDS=['tradingTaxes','mintCapability','ownerAdmin','contractArchitecture'];
(async()=>{
 const runMechanics=require('./mechanics-bench-run.cjs').mechanics;
 for(const t of cohort){
  if(only.length&&!only.includes(t.symbol))continue;
  const cfg=chain(t.network),a=t.address.toLowerCase(),rpc=rpcs[t.network],o={sym:t.symbol,net:t.network,addr:a};
  try{
   const code=await rpc('eth_getCode',[a,'latest']);o.bytes=(code.length-2)/2;o.head=code.slice(0,66);
   const clone=/^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/i.exec(code);if(clone)o.clone='0x'+clone[1];
   o.del=/f4/.test(code)?'has-f4':'no-f4';
   const sl={};for(const [k,s] of Object.entries(SLOTS)){try{const w=await rpc('eth_getStorageAt',[a,s,'latest']);if(!/^0x0*$/.test(w))sl[k]=w.slice(-40);}catch(e){sl[k]='err';}}o.slots=sl;
   const s=selectors(code);o.nsel=s.size;o.known=[...s].map(x=>TABLE[x]).filter(Boolean);o.unk=[...s].filter(x=>!TABLE[x]).slice(0,40);
   const tgt=o.clone||(sl.impl1967&&'0x'+sl.impl1967)||null;o.target=tgt;
   const sy=await jget('https://sourcify.dev/server/v2/contract/'+cfg.chainId+'/'+a);o.sourcify=sy.s+':'+(sy.j?.match||sy.j?.matchId||sy.e||'');
   if(tgt){const ty=await jget('https://sourcify.dev/server/v2/contract/'+cfg.chainId+'/'+tgt);o.tgtSourcify=ty.s+':'+(ty.j?.match||'');}
   if(cfg.blockscoutTokens){const b=await jget(cfg.blockscoutTokens.replace('/tokens/','/smart-contracts/')+a);o.blockscout=b.s+':'+(b.j?.is_verified??b.j?.is_fully_verified??'')+':'+(b.j?.name||'');}
  }catch(e){o.shapeErr=String(e.message||e).slice(0,80);}
  if(SOURCE){await sourceDump(t,cfg,o.target);continue;}
  console.log('::notice title=v9-shape-'+t.symbol+'::'+esc(JSON.stringify(o)));
  const t0=Date.now(),r={sym:t.symbol};
  try{const res=await Promise.race([runMechanics(req,t.network,t.address),new Promise((_,j)=>setTimeout(()=>j(Error('TIMEOUT_60S')),60000))]);
   r.block=res.block;r.ms=Date.now()-t0;r.f={};
   for(const k of FIELDS){const x=res.card?.fields?.[k];r.f[k]=[x?.dataState,x?.status,x?.reasonCode,String(x?.value??'').slice(0,90),(x?.analysisDiagnostics?.failures||[]).map(z=>z.reason).slice(0,6)];}
   r.restr=res.card?.supplementary?.transferRestrictions?[res.card.supplementary.transferRestrictions.dataState,res.card.supplementary.transferRestrictions.reasonCode]:null;
   const ev=Object.values(res.card?.fields||{}).flatMap(x=>x?.evidence||[]);const d=ev.find(x=>x?.method==='Mechanics analysis detail');
   if(d){r.src=d.sourceVerification||null;r.proxy=d.proxyBinding||null;r.path=d.delegationPath||null;r.auth=d.authorityGraph?{state:d.authorityGraph.state||d.authorityGraph.status,n:d.authorityGraph.nodes?.length}:null;r.fail=(d.failures||[]).slice(0,12);r.reads=d.readBudget||null;}
  }catch(e){r.err=String(e.message||e).slice(0,100);}
  console.log('::notice title=v9-engine-'+t.symbol+'::'+esc(JSON.stringify(r)));
  await new Promise(x=>setTimeout(x,700));
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
