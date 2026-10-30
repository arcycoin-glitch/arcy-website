'use strict';
// pons membership + graduation by TARGETED eth_call reads only (no eth_getLogs, no history, no index).
// A token counts as a pons launch only if an official factory's getLaunchedToken(token) says exists==true for that exact token.
const keccak=require('../keccak');
const {PONS}=require('./sources');
const http=require('./http');
const sel=sig=>'0x'+keccak(Buffer.from(sig)).slice(2,10);
const SEL={getLaunchedToken:sel('getLaunchedToken(address)'),graduationStatus:sel('graduationStatus(address)')};
const word=(d,i)=>d.slice(2+i*64,2+(i+1)*64),addrOf=w=>'0x'+w.slice(-40).toLowerCase();
const calldata=(s,token)=>s+'0'.repeat(24)+token.slice(2);
async function batch(rpcUrl,calls,{fetcher,now}){
 const body=calls.map((c,i)=>({jsonrpc:'2.0',id:i+1,...c}));
 const out=await http.request('pons-rpc',rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body,fetcher,now});
 if(!Array.isArray(out)||out.length!==body.length||new Set(out.map(x=>x?.id)).size!==body.length)throw http.fail('RADAR_PONS_RPC_BAD_BATCH');
 const byId=new Map(out.map(x=>[x.id,x]));
 return body.map(b=>byId.get(b.id));
}
// decode getLaunchedToken: 13 static words; word0 token, word1 deployer, word2 paired token, word11 exists
function decodeLaunch(raw,token){
 if(typeof raw!=='string'||!/^0x[0-9a-f]{832}$/i.test(raw))return null;
 if(BigInt('0x'+word(raw,11))!==1n||addrOf(word(raw,0))!==token)return null;
 return {deployer:addrOf(word(raw,1)),pairToken:addrOf(word(raw,2))};
}
function decodeGraduation(raw){
 if(typeof raw!=='string'||!/^0x[0-9a-f]{192}$/i.test(raw))return null;
 return {pairedPrincipalEth:Number(BigInt('0x'+word(raw,0)))/1e18,thresholdEth:Number(BigInt('0x'+word(raw,1)))/1e18,graduated:BigInt('0x'+word(raw,2))===1n};
}
// -> Map(token -> {factory,deployer,pairToken,graduation|null}); throws RADAR_PONS_MEMBERSHIP_UNAVAILABLE if the RPC cannot answer.
async function membership(rpcUrl,tokens,{fetcher,now}){
 const list=[...new Set(tokens)].slice(0,PONS.maxCandidates);
 if(!list.length)return {members:new Map(),block:null,checked:0};
 try{
  const calls=[{method:'eth_chainId',params:[]},{method:'eth_blockNumber',params:[]}];
  for(const f of PONS.factories)for(const t of list)calls.push({method:'eth_call',params:[{to:f,data:calldata(SEL.getLaunchedToken,t)},'latest']});
  const res=await batch(rpcUrl,calls,{fetcher,now});
  if(res[0]?.result===undefined||Number(BigInt(res[0].result))!==4663)throw http.fail('RADAR_PONS_WRONG_CHAIN');
  const block=res[1]?.result&&/^0x[0-9a-f]+$/i.test(res[1].result)?Number(BigInt(res[1].result)):null;
  const members=new Map();let k=2;
  for(const f of PONS.factories)for(const t of list){const r=res[k++];if(!r||r.error||typeof r.result!=='string')continue;const d=decodeLaunch(r.result,t);if(d&&!members.has(t))members.set(t,{factory:f,...d});}
  if(members.size){
   const ids=[...members.keys()],g=await batch(rpcUrl,ids.map(t=>({method:'eth_call',params:[{to:members.get(t).factory,data:calldata(SEL.graduationStatus,t)},'latest']})),{fetcher,now});
   ids.forEach((t,i)=>{members.get(t).graduation=g[i]&&!g[i].error?decodeGraduation(g[i].result):null;});
  }
  return {members,block,checked:list.length};
 }catch(e){
  if(e.code==='RADAR_PROVIDER_RATE_LIMITED')throw e;
  throw http.fail('RADAR_PONS_MEMBERSHIP_UNAVAILABLE',{detail:e.code||'ERROR'});
 }
}
// Up to PONS.maxChecked candidates, checked in sequential batches of PONS.maxCandidates. A failure in ANY batch fails the whole check
// (never a partial answer presented as complete). -> {members, block, checked, requests}
async function membershipMany(rpcUrl,tokens,ctx){
 const list=[...new Set(tokens)].slice(0,PONS.maxChecked),members=new Map();let block=null,checked=0,requests=0;
 for(let i=0;i<list.length;i+=PONS.maxCandidates){
  const m=await membership(rpcUrl,list.slice(i,i+PONS.maxCandidates),ctx);
  requests+=m.members.size?2:1;checked+=m.checked;if(m.block!==null)block=m.block;
  for(const [t,v] of m.members)members.set(t,v);
 }
 return {members,block,checked,requests};
}
module.exports={SEL,calldata,decodeLaunch,decodeGraduation,membership,membershipMany};
