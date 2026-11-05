#!/usr/bin/env node
'use strict';
// READ-ONLY Phase B evidence probe: (1) reference source facts for the Pons launch-token family, (2) immutable values and
// getter readback per sibling, (3) eth_call state-override support per chain RPC (proxy delegation probe feasibility).
process.env.VERCEL='1';
const path=require('node:path'),root=process.cwd(),req=p=>require(path.join(root,p));
const deep=req('search/server/lib/mechanics-deep'),keccak=req('lib/keccak');
const RPC={ethereum:'https://ethereum-rpc.publicnode.com',arc:'https://rpc.mainnet.arc.io',robinhood:'https://rpc.mainnet.chain.robinhood.com'};
async function rpc(chain,method,params){const r=await fetch(RPC[chain],{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(15000)});const d=await r.json();if(d.error)throw Object.assign(Error(d.error.message),{rpcCode:d.error.code});return d.result;}
const sel=s=>keccak(Buffer.from(s)).slice(0,10);
(async()=>{
 const ref='0xaa07a0e9b7a4e6c0e7e0a5a2b5d5c3c8b8a2d3f1';
 const cohort=require(path.join(root,'scripts/mechanics-audit-cohort-20261105.json'));
 const fam=cohort.filter(c=>['ORBIO','VRAX','OAK','SIC','Kitsu','UPOCH','NOVUS','ZHOOK','LMNI'].includes(c.symbol));
 const orbio=fam.find(c=>c.symbol==='ORBIO').address;
 const sf=await (await fetch('https://sourcify.dev/server/v2/contract/4663/'+orbio+'?fields=abi,sources,compilation,runtimeBytecode',{signal:AbortSignal.timeout(20000)})).json();
 const digest=deep.digest(sf.sources);
 const imm=sf.runtimeBytecode?.immutableReferences;
 const views=(sf.abi||[]).filter(f=>f.type==='function'&&['view','pure'].includes(f.stateMutability)&&!f.inputs.length).map(f=>f.name+':'+f.outputs.map(o=>o.type).join(','));
 const fns=(sf.abi||[]).filter(f=>f.type==='function').map(f=>f.name+'('+f.inputs.map(i=>i.type).join(',')+')'+(f.stateMutability==='view'||f.stateMutability==='pure'?'v':''));
 console.log('PB_REF '+JSON.stringify({orbio,digest,profile:deep.PROFILES[digest]||null,runtimeMatch:sf.runtimeMatch,match:sf.match,compilation:{name:sf.compilation?.name,fullyQualifiedName:sf.compilation?.fullyQualifiedName,compilerVersion:sf.compilation?.compilerVersion},imm,views,fns,files:Object.keys(sf.sources||{})}));
 const onchainRef=sf.runtimeBytecode?.onchainBytecode;
 for(const c of fam){
  const code=await rpc('robinhood','eth_getCode',[c.address,'latest']);
  const ranges=Object.values(imm||{}).flat();
  const words=ranges.map(r=>'0x'+code.slice(2+r.start*2,2+(r.start+r.length)*2));
  const getters={};for(const v of views.filter(v=>/address$/.test(v))){const n=v.split(':')[0];try{getters[n]=await rpc('robinhood','eth_call',[{to:c.address,data:sel(n+'()')},'latest']);}catch(e){getters[n]='ERR '+e.message.slice(0,40);}}
  let masked=null;if(onchainRef&&onchainRef.length===code.length){const a=Buffer.from(onchainRef.slice(2),'hex'),b=Buffer.from(code.slice(2),'hex');for(const r of ranges){a.fill(0,r.start,r.start+r.length);b.fill(0,r.start,r.start+r.length);}masked=a.equals(b);}
  console.log('PB_SIB '+JSON.stringify({symbol:c.symbol,address:c.address,len:(code.length-2)/2,maskedEqualRef:masked,immutables:words,getters}));
 }
 // State-override support: probe code returns ADDRESS (0x30) => under DELEGATECALL equals the caller-context contract.
 const PROBE='0x3060005260206000f3',dummy='0x'+'a'.repeat(38)+'01';
 const targets=[['ethereum','0x68749665ff8d2d112fa859aa293f07a622782f38','0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'],['ethereum','0x45804880de22913dafe09f4980848ece6ecbaf78','0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3'],['arc','0x0000000000000000000000000000000000000001',null],['robinhood','0x0000000000000000000000000000000000000001',null]];
 for(const [chain,a,slot] of targets){
  const data=sel('arcyProxyProbe()');const out={chain,address:a};
  try{out.plain=await rpc(chain,'eth_call',[{to:a,data,from:'0x'+'b'.repeat(40)},'latest']);}catch(e){out.plain='ERR '+String(e.message).slice(0,60);}
  const ov=slot?{[a]:{stateDiff:{[slot]:'0x'+'0'.repeat(24)+dummy.slice(2)}},[dummy]:{code:PROBE}}:{[a]:{code:PROBE}};
  try{out.override=await rpc(chain,'eth_call',[{to:a,data,from:'0x'+'b'.repeat(40)},'latest',ov]);}catch(e){out.override='ERR '+String(e.message).slice(0,80);}
  console.log('PB_OV '+JSON.stringify(out));
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
