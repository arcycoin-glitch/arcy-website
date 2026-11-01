'use strict';
// Read-only diagnostic: WHY does a contract stay NOT VERIFIED in Mechanics? One bounded request set per contract. CI/operator only.
// usage: node scripts/probe-mechanics-gaps.cjs [mechanics-samples.json]
process.env.VERCEL='1';
const fs=require('node:fs'),keccak=require('../lib/keccak'),{chain}=require('../search/server/lib/chains');
const rpcs={ethereum:require('../search/server/lib/eth').rpc,arc:require('../search/server/lib/arc-rpc').rpc,robinhood:require('../search/server/lib/robinhood-rpc').rpc};
const sel=s=>keccak(Buffer.from(s)).slice(2,10);
const NAMES=['owner()','getOwner()','admin()','authority()','transferOwnership(address)','renounceOwnership()','mint(address,uint256)','mint(uint256)','burn(uint256)','burnFrom(address,uint256)','pause()','paused()','blacklist(address)','isBlacklisted(address)','setTaxes(uint256,uint256)','taxFee()','_taxFee()','buyTax()','sellTax()','buyFee()','sellFee()','setFees(uint256,uint256)','excludeFromFee(address)','isExcludedFromFee(address)','maxTxAmount()','_maxTxAmount()','tradingEnabled()','enableTrading()','openTrading()','swapAndLiquify()','initialize(string,string,uint256,address)','implementation()','upgradeTo(address)','hasRole(bytes32,address)','totalSupply()','MINTER_ROLE()','cap()','pair()','uniswapV2Pair()','router()'];
const TABLE=Object.fromEntries(NAMES.map(n=>[sel(n),n]));
function selectors(code){const b=Buffer.from(code.slice(2),'hex'),out=new Set();for(let i=0;i<b.length-4;i++){if(b[i]===0x63){out.add(b.slice(i+1,i+5).toString('hex'));}}return out;}
const oz=require('../search/server/lib/oz-template'),lib=require('../search/server/lib/oz-library-hashes');
const jget=async(u,ms=6000)=>{try{const r=await fetch(u,{headers:{accept:'application/json'},signal:AbortSignal.timeout(ms)});let j=null;try{j=await r.json();}catch{}return {s:r.status,j};}catch(e){return {s:0,j:null};}};
(async()=>{
 const samples=JSON.parse(fs.readFileSync(process.argv[2]||'mechanics-samples.json','utf8'));
 const rows=[],hashes={};
 for(const s of samples){
  const cfg=chain(s.chain),a=s.address.toLowerCase(),rpc=rpcs[s.chain];let code=null;
  try{code=await rpc('eth_getCode',[a,'latest']);}catch{}
  if(!/^0x(?:[0-9a-f]{2})+$/i.test(code||'')){rows.push([s.chain[0],a.slice(2,8),'nocode']);continue;}
  const h=keccak(Buffer.from(code.slice(2),'hex')).slice(2,10);hashes[h]=(hashes[h]||0)+1;
  const clone=/^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/i.exec(code);
  let impl=null;try{const w=await rpc('eth_getStorageAt',[a,'0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc','latest']);if(/^0x0{24}[0-9a-f]{40}$/i.test(w)&&!/^0x0+$/.test(w))impl='0x'+w.slice(-40);}catch{}
  const target=clone?'0x'+clone[1]:impl;
  const sy=await jget('https://sourcify.dev/server/v2/contract/'+cfg.chainId+'/'+a);
  let bs={s:-1,j:null};if(cfg.blockscoutTokens)bs=await jget(cfg.blockscoutTokens.replace('/tokens/','/smart-contracts/')+a);
  let ozr='-';
  {const sa=target||a;const full=await jget('https://sourcify.dev/server/v2/contract/'+cfg.chainId+'/'+sa+'?fields=sources,compilation',9000);
   if(full.s===200&&full.j?.sources){const d=oz.diagnose(full.j.sources,{lib,main:full.j.compilation?.name});ozr=d.ok?'OK:'+d.mint+(d.ownable?'+own':'')+(d.ungated?'+u'+d.ungated:''):d.reason+(d.unpinned?'['+d.unpinned.map(x=>x.split('/').pop()).join(',').slice(0,60)+']':'')+(d.base?'['+d.base+']':'')+(d.file?'['+String(d.file).split('/').pop()+']':'');}}
  let tsy=null,tbs=null,tcode=null;
  if(target){try{tcode=await rpc('eth_getCode',[target,'latest']);}catch{}tsy=await jget('https://sourcify.dev/server/v2/contract/'+cfg.chainId+'/'+target);if(cfg.blockscoutTokens)tbs=await jget(cfg.blockscoutTokens.replace('/tokens/','/smart-contracts/')+target);}
  const sl=selectors(tcode&&/^0x(?:[0-9a-f]{2})+$/.test(tcode)?tcode:code);
  let ow='-';if(sl.has(sel('owner()'))||sl.has(sel('getOwner()'))){try{const r=await rpc('eth_call',[{to:a,data:'0x'+sel('owner()')},'latest']);ow=/^0x0{64}$/.test(r)?'ZERO':/^0x0{24}[0-9a-f]{40}$/.test(r)?'addr':'odd';}catch{ow='revert';}}
  const flags=[...sl].map(x=>TABLE[x]).filter(Boolean).map(n=>n.replace(/\(.*/,''));
  rows.push([s.chain[0]+(s.group==='pons'?'p':''),a.slice(2,8),(code.length-2)/2,h,clone?'clone':impl?'1967':'-',target?target.slice(2,8):'-',
   'sy:'+sy.s+(sy.j?.runtimeMatch||''),'bs:'+bs.s+(bs.j?(bs.j.is_verified?'V':'u')+(bs.j.proxy_type?'/'+bs.j.proxy_type:''):''),
   target?'tsy:'+tsy.s+(tsy.j?.runtimeMatch||'')+' tbs:'+tbs?.s+(tbs?.j?(tbs.j.is_verified?'V':'u'):''):'',[...new Set(flags)].join(','),'ow:'+ow,'oz:'+ozr]);
  await new Promise(r=>setTimeout(r,400));
 }
 const esc=x=>x.replace(/%/g,'%25').replace(/\r/g,'').replace(/\n/g,'%0A');
 let cur=[],i=0;const flush=()=>{if(cur.length)console.log('::notice title=gap-'+(i++)+'::'+esc(JSON.stringify(cur)));cur=[];};
 for(const r of rows){if(JSON.stringify([...cur,r]).length>3300)flush();cur.push(r);}flush();
 console.log('::notice title=gap-hashes::'+esc(JSON.stringify(hashes)));
 fs.writeFileSync('mechanics-gaps.json',JSON.stringify(rows));
})().catch(e=>{console.error(e);process.exitCode=1;});
