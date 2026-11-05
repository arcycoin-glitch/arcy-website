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
 // Official Arc Blockscout API availability only; no contract safety inference.
 const arcAddress='0x9d33Ba78389c8772bC114Cba47Dc1985E933e76F';
 const arc=await json('https://explorer.arc.io/api/v2/smart-contracts/'+arcAddress);
 const obj=arc.data||{};
 console.log('ARC_BLOCKSCOUT_SOURCE_API',compact({ok:arc.ok,http:arc.http||null,error:arc.error||null,
  isVerified:obj.is_verified??null,isFullyVerified:obj.is_fully_verified??null,
  hasBytecode:typeof obj.deployed_bytecode==='string',hasSource:typeof obj.source_code==='string',
  address:arcAddress}));

 const rh=await json('https://robinhoodchain.blockscout.com/api/v2/stats');
 console.log('ROBINHOOD_BLOCKSCOUT_API',compact({ok:rh.ok,http:rh.http||null,error:rh.error||null,
  hasStats:Boolean(rh.data&&typeof rh.data==='object')}));
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
   const crypto=require('node:crypto');
   const ordered=Object.entries(sf.sources||{}).map(([p,v])=>[p,v.content]).sort(([a],[b])=>a.localeCompare(b));
   const sourceDigest=crypto.createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
   console.log('SOURCE_IDENTITY_DIGEST',compact({address:addr,sourceDigest,sourceExactRuntime:true}));
   const creatorInfo=await json('https://eth.blockscout.com/api/v2/addresses/'+addr);
   const ci=creatorInfo.data||{};
   const creator=ci.creator_address_hash||ci.creator_address?.hash||null;
   console.log('CREATOR_META',compact({ok:creatorInfo.ok,creator,creationTx:ci.creation_tx_hash||null,reason:creatorInfo.http||creatorInfo.error||null}));
   if(typeof creator==='string'&&ADDR.test(creator)){
    const deployed=await rpc('eth_getCode',[creator,head.value]);
    const creatorType=deployed.ok&&(deployed.value==='0x'||deployed.value==='0x0')?'EOA_OR_EMPTY':'CONTRACT_OR_UNKNOWN';
    const balance=await rpc('eth_call',[{to:addr,data:'0x70a08231'+creator.slice(2).padStart(64,'0')},head.value]);
    console.log('CREATOR_CONTROL_CONTEXT',compact({creatorType,balanceNonzero:balance.ok?/^0x0+$/i.test(balance.value)===false:null,readStatus:balance.ok?'OK':balance.error}));
    // eth_call ONLY: no broadcast, no wallet keys, no state transition.
    // A normal ERC20 transferFrom with zero allowance must revert, including from==spender.
    // Compare a deployment-origin call with an independent caller at the same pinned block.
    if(creatorType==='EOA_OR_EMPTY'&&balance.ok&&BigInt(balance.value)>1n){
      const w=a=>a.toLowerCase().slice(2).padStart(64,'0'),same=creator;
      const allowance=await rpc('eth_call',[{to:addr,data:'0xdd62ed3e'+w(same)+w(same)},head.value]);
      const transferData='0x23b872dd'+w(same)+w(same)+(1n).toString(16).padStart(64,'0');
      const originCall=await rpc('eth_call',[{from:same,to:addr,data:transferData},head.value]);
      const control='0x1111111111111111111111111111111111111111';
      const controlCall=await rpc('eth_call',[{from:control,to:addr,data:transferData},head.value]);
      console.log('ALLOWANCE_CONTROL_READONLY',compact({creatorAllowanceRaw:allowance.ok?allowance.value:null,
        originCallResult:originCall.ok?originCall.value:originCall.error,
        controlCallResult:controlCall.ok?controlCall.value:controlCall.error,
        bypassPossible:allowance.ok&&BigInt(allowance.value)===0n&&originCall.ok&&!controlCall.ok,
        note:'No transaction was sent; both transferFrom calls were eth_call simulations.'}));
    }
   }
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
