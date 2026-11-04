'use strict';
// Read-only Mechanics provenance probe. No keys, no writes, no contract claims.
// Candidate discovery by ticker is NOT identity verification: every row remains a candidate
// until its full address is matched to the ARCY SEARCH token URL.
const ADDR=/^0x[0-9a-f]{40}$/i;
const cutoff=ms=>AbortSignal.timeout(ms);
async function json(url,{method='GET',body}={}){
 try{
  const res=await fetch(url,{method,body:body?JSON.stringify(body):undefined,
   headers:body?{'content-type':'application/json','accept':'application/json'}:{accept:'application/json'},
   signal:cutoff(7000),redirect:'error'});
  if(!res.ok)return {ok:false,http:res.status};
  const raw=await res.text();
  if(raw.length>5000000)return {ok:false,error:'RESPONSE_TOO_LARGE'};
  return {ok:true,data:JSON.parse(raw)};
 }catch(e){return {ok:false,error:String(e?.cause?.code||e?.name||'FETCH_FAILED')};}
}
const compact=o=>JSON.stringify(o);
(async()=>{
 let list=[];
 const exact=process.env.TOKEN_ADDRESS;
 if(exact&&ADDR.test(exact))list=[{address:exact.toLowerCase(),volume24h:'manual',price:'manual',source:'exact-address-override'}];
 else{
  const r=await json('https://api.dexscreener.com/latest/dex/search?q=GTA6');
  if(!r.ok){console.log('DISCOVERY_UNAVAILABLE',compact(r));return;}
  const raw=Array.isArray(r.data?.pairs)?r.data.pairs:[];
  const matched=raw.filter(p=>p.chainId==='ethereum'&&ADDR.test(p.baseToken?.address||'')&&/^(?:GTA6|GTAVI)$/i.test(p.baseToken?.symbol||''));
  const seen=new Set();
  list=matched.sort((a,b)=>(Number(b.volume?.h24)||0)-(Number(a.volume?.h24)||0)).filter(p=>{
   const key=p.baseToken.address.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;
  }).slice(0,4).map(p=>({address:p.baseToken.address.toLowerCase(),symbol:p.baseToken.symbol,name:p.baseToken.name,
   volume24h:p.volume?.h24??null,price:p.priceUsd??null,pair:p.pairAddress,source:'DEX_SCANNER_CANDIDATE_ONLY'}));
 }
 console.log('GTA6_CANDIDATES_NOT_TOKEN_IDENTITY',compact(list));
 if(!list.length)return;
 // One pinned block for all source/code comparisons.
 const endpoint='https://ethereum-rpc.publicnode.com';
 const rpc=async(method,params)=>{
  const r=await json(endpoint,{method:'POST',body:{jsonrpc:'2.0',id:1,method,params}});
  return r.ok&&r.data?.result?{ok:true,value:r.data.result}:{ok:false,error:r.ok?'JSON_RPC_UNAVAILABLE':r.http||r.error};
 };
 const head=await rpc('eth_blockNumber',[]);
 console.log('PINNED_BLOCK',compact(head.ok?{block:head.value}:head));
 for(const cand of list){
  const addr=cand.address;
  const code=head.ok?await rpc('eth_getCode',[addr,head.value]):{ok:false,error:'NO_PINNED_BLOCK'};
  const liveCode=code.ok&&/^0x[0-9a-f]+$/i.test(code.value)?code.value.toLowerCase():null;
  const blockscout=await json('https://eth.blockscout.com/api/v2/smart-contracts/'+addr);
  const bs=blockscout.data||{};
  const bsCode=typeof bs.deployed_bytecode==='string'?bs.deployed_bytecode.toLowerCase():null;
  const bsIdentity=Boolean(liveCode&&bsCode&&bsCode===liveCode);
  const sourcify=await json('https://sourcify.dev/server/v2/contract/1/'+addr+'?fields=abi,sources,compilation,runtimeBytecode');
  const sf=sourcify.data||{};
  const sfCode=typeof sf.runtimeBytecode?.onchainBytecode==='string'?sf.runtimeBytecode.onchainBytecode.toLowerCase():null;
  const sfIdentity=Boolean(liveCode&&sfCode&&sfCode===liveCode&&['match','exact_match'].includes(sf.runtimeMatch)&&String(sf.chainId)==='1'&&sf.address?.toLowerCase()===addr);
  const summary={address:addr,block:head.ok?head.value:null,
   onchainCode:liveCode?{bytes:(liveCode.length-2)/2}:code,
   blockscout:{ok:blockscout.ok,reason:blockscout.http||blockscout.error||null,
    sourcePublished:Boolean(bs.source_code||bs.additional_sources?.length),
    abiPublished:Array.isArray(bs.abi),
    deployedRuntimeExactMatch:bsIdentity,
    publishedCodeAvailable:Boolean(bsCode),
    verificationOnly:bs.is_verified??null},
   sourcify:{ok:sourcify.ok,reason:sourcify.http||sourcify.error||null,
    runtimeExactMatch:sfIdentity,sourceFiles:Object.keys(sf.sources||{}).length,abiPublished:Array.isArray(sf.abi)}};
  console.log('MECHANICS_SOURCE_PROBE',compact(summary));
  if(cand===list[0]&&sfIdentity){
   const entries=Object.entries(sf.sources||{});
   const abi=Array.isArray(sf.abi)?sf.abi.filter(x=>x?.type==='function').map(x=>x.name+'('+x.inputs?.map(a=>a.type).join(',')+')'):[];
   console.log('PRIMARY_SOURCE_ABI',compact(abi.slice(0,120)));
   for(const [file,data] of entries.slice(0,2)){
    const content=typeof data?.content==='string'?data.content:'';
    console.log('PRIMARY_SOURCE_FILE',compact({file,length:content.length,lastLines:content.split('\\n').length}));
    // Diagnostics only. Source is publicly verified; emit the contract implementation
    // tail, not imported library boilerplate, and never cache it in the repository.
    const tail=content.slice(-24000);
    for(let i=0;i<tail.length;i+=5000)console.log('PRIMARY_SOURCE_TAIL',String(i/5000+1),JSON.stringify(tail.slice(i,i+5000)));
   }
  }
 }
})().catch(e=>{console.error('PROBE_FATAL',String(e?.message||e));process.exitCode=1;});
