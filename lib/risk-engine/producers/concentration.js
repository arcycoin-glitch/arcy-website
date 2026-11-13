'use strict';
// Reviewed concentration producer v1 for `top-ten-holder-concentration` (risk.top-ten-concentration), POSITIVE ONLY.
//
// Claim proven when the value is >= 5000 bps: ten (or fewer) addresses WITHOUT code, whose balances were read from two
// independent operators at one pinned block, hold at least 50% of totalSupply() minus the balances of 0x0 and 0x...dEaD.
// Because the true ten largest holders hold at least as much as any ten addresses, no complete census is needed for
// this claim. The converse (below 50%) would need one, so a lower share is reported as NOT_VERIFIED, never as a verdict.
//
// Candidate addresses come from the public Blockscout holder list of the network. That list is UNTRUSTED and only
// supplies addresses: its balances and its "is contract" flags are ignored; every balance and every code check is an
// on-chain read at the pinned block on both operators. Both operators evaluate the identical candidate list.
// Policy (reviewed): contracts (pools, bridges, Safes, exchanges' contracts, EIP-7702-delegated accounts) are left out of
// the numerator, which can only make the share smaller; custodial EOAs (e.g. exchange hot wallets) count as holders.
const keccak=require('../../keccak');
const {runOperators,buildRecord,fail}=require('./operators');
const PRODUCER=Object.freeze({id:'arcy-risk-concentration-producer',version:1});
const ADDRESS=/^0x[0-9a-f]{40}$/,WORD=/^0x[0-9a-f]{64}$/i,ZERO='0x'+'0'.repeat(40);
const BURNS=Object.freeze([ZERO,'0x000000000000000000000000000000000000dead']);
const EXPLORERS=Object.freeze({ethereum:'https://eth.blockscout.com',arc:'https://arcscan.app',robinhood:'https://robinhoodchain.blockscout.com'});
const MAX_CANDIDATES=32,TOP=10,THRESHOLD_BPS=5000;
const LIMITS=Object.freeze({callsPerEndpoint:80,timeoutMs:3000,deadlineMs:12000,maxBodyBytes:256*1024});
const sel=s=>'0x'+keccak(Buffer.from(s)).slice(2,10);
const SEL=Object.freeze({totalSupply:sel('totalSupply()'),balanceOf:sel('balanceOf(address)')});
const pad=a=>a.slice(2).padStart(64,'0');
const word=raw=>{if(!WORD.test(raw||''))throw fail('RPC_MALFORMED_RESPONSE');return BigInt(raw);};

// Untrusted candidate addresses (first page of the explorer's holder list, explorer order).
async function candidates(network,token,{fetcher=fetch,timeoutMs=6000}={}){
 const base=EXPLORERS[network];if(!base)return {state:'UNSUPPORTED',addresses:[]};
 try{
  const r=await fetcher(base+'/api/v2/tokens/'+token+'/holders',{headers:{accept:'application/json'},signal:AbortSignal.timeout(timeoutMs)});
  if(!r.ok)return {state:'UNAVAILABLE',reasonCode:'CANDIDATE_SOURCE_HTTP_'+r.status,addresses:[]};
  const body=await r.json(),seen=new Set(),addresses=[];
  for(const item of Array.isArray(body?.items)?body.items:[]){
   const a=String(item?.address?.hash||item?.address||'').toLowerCase();
   if(ADDRESS.test(a)&&!BURNS.includes(a)&&!seen.has(a)){seen.add(a);addresses.push(a);}
   if(addresses.length>=MAX_CANDIDATES)break;
  }
  return addresses.length?{state:'OK',addresses}:{state:'UNAVAILABLE',reasonCode:'CANDIDATE_SOURCE_EMPTY',addresses:[]};
 }catch{return {state:'UNAVAILABLE',reasonCode:'CANDIDATE_SOURCE_UNREACHABLE',addresses:[]};}
}

async function read({call,block},{token,list}){
 const must=async(method,params)=>{const r=await call(method,params);if(r.error)throw fail(r.error);return r;};
 const balance=async a=>{const r=await must('eth_call',[{to:token,data:SEL.balanceOf+pad(a)},block]);return r.ok?word(r.result):null;};
 const supplyRaw=await must('eth_call',[{to:token,data:SEL.totalSupply},block]);
 if(!supplyRaw.ok)return {reasonCode:'TOTAL_SUPPLY_UNREADABLE'};
 const supply=word(supplyRaw.result);
 let burned=0n;const burns=[];
 for(const b of BURNS){const v=await balance(b);burns.push(v===null?null:v.toString());if(v!==null)burned+=v;}
 if(supply===0n)return {reasonCode:'ZERO_SUPPLY'};
 if(burned>=supply)return {reasonCode:'SUPPLY_RECONCILIATION_FAILED'};
 const balances=[];
 for(const a of list){const v=await balance(a);if(v===null)return {reasonCode:'BALANCE_UNREADABLE'};balances.push([a,v]);}
 const listed=balances.reduce((n,[,v])=>n+v,0n);
 if(listed+burned>supply)return {reasonCode:'SUPPLY_RECONCILIATION_FAILED'}; // balances cannot exceed supply
 const ranked=balances.filter(([,v])=>v>0n).sort((x,y)=>(y[1]>x[1]?1:y[1]<x[1]?-1:x[0].localeCompare(y[0])));
 const top=[];
 for(const [a,v] of ranked){
  if(top.length>=TOP)break;
  const code=await must('eth_getCode',[a,block]);
  if(!code.ok||typeof code.result!=='string'||!/^0x[0-9a-f]*$/i.test(code.result))throw fail('RPC_MALFORMED_RESPONSE');
  if(code.result==='0x')top.push([a,v]);
 }
 const eligible=supply-burned,held=top.reduce((n,[,v])=>n+v,0n);
 const bps=Number(held*10000n/eligible);
 return {supply:supply.toString(),burned:burned.toString(),burns,eligible:eligible.toString(),top:top.map(([a,v])=>[a,v.toString()]),heldByTop:held.toString(),
  shareBps:bps,reasonCode:bps>=THRESHOLD_BPS?null:'BELOW_THRESHOLD_NEGATIVE_NOT_REVIEWED'};
}
const signature=o=>JSON.stringify(o?{supply:o.supply||null,burns:o.burns||null,top:o.top||null,reasonCode:o.reasonCode||null}:null);

async function produce({network,token,block,env=process.env,fetcher=fetch,now=Date.now,candidateList}={}){
 const address=String(token||'').toLowerCase();
 if(!ADDRESS.test(address)||address===ZERO)throw fail('RISK_PRODUCER_INVALID_TOKEN');
 const source=candidateList?{state:'OK',addresses:candidateList.filter(a=>ADDRESS.test(a)&&!BURNS.includes(a)).slice(0,MAX_CANDIDATES)}:await candidates(network,address,{fetcher});
 const generatedAt=new Date(now()).toISOString();
 if(source.state!=='OK')return {producer:{...PRODUCER},network,reasonCode:source.reasonCode||'CANDIDATE_SOURCE_UNSUPPORTED',candidates:0,records:[],operators:[],cost:{rpcCalls:0,ms:0}};
 const list=source.addresses;
 const run=await runOperators({network,block,env,fetcher,now,limits:LIMITS,read:ctx=>read(ctx,{token:address,list})});
 const record=buildRecord({metricId:'risk.top-ten-concentration',unit:'bps',method:'pinned-verified-top-ten-eoa-share',reference:address,network,token:address,scope:null,generatedAt,
  blockNumber:run.blockNumber,rows:run.rows,independence:run.independence,engine:PRODUCER,signature,
  pick:o=>o.reasonCode?{reasonCode:o.reasonCode}:{value:o.shareBps}});
 return {producer:{...PRODUCER},network,reasonCode:record.state==='VERIFIED_ONCHAIN'?null:record.reasonCode,candidates:list.length,
  candidateDigest:keccak(Buffer.from(list.join(','))),block:{number:run.blockNumber,hex:run.blockHex},independence:run.independence,
  operators:run.rows.map(r=>({role:r.role,operator:r.operator,state:r.state,reasonCode:r.reasonCode||null,failedAt:r.failedAt||null,rpcError:r.rpcError??null,watchdogState:r.watchdogState||null,rpcCalls:r.cost.rpcCalls,ms:r.cost.ms,
   outcome:r.outcome?{shareBps:r.outcome.shareBps??null,reasonCode:r.outcome.reasonCode||null,topCount:r.outcome.top?.length??null}:null})),
  records:[record],cost:run.cost};
}
module.exports={PRODUCER,produce,candidates,BURNS,EXPLORERS,LIMITS,THRESHOLD_BPS,_internals:{read,signature}};
