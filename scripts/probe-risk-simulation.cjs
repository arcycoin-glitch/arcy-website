'use strict';
// Read-only capability probe for the sell-transfer-tax producer: which registered operators support eth_call state
// overrides (code + storage) and eth_simulateV1, and whether ERC-20 balance slots can be located by override.
// Public endpoints, eth_call / eth_simulateV1 only; nothing is signed or sent. No endpoint URL is printed.
const observer=require('../lib/verification/onchain-observer');
const keccak=require('../lib/keccak');
const notice=(t,d)=>console.log('::notice title='+t+'::'+JSON.stringify(d).slice(0,3800));
const FRESH='0x'+keccak(Buffer.from('arcy-risk-sim-holder-v1')).slice(-40),HELPER='0x'+keccak(Buffer.from('arcy-risk-sim-helper-v1')).slice(-40);
const TOKENS={ethereum:['0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48','0x6982508145454ce325ddbe47a25d4ec3d2311933','0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9'],
 arc:['0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b','0x171a4217b86a807a64eb94757db6849fb4bdbaa0'],robinhood:['0x492641f648a4986844848e0befe66d14817bce34','0x39dbed3a2bd333467115de45665cc57f813c4571']};
const pad=v=>BigInt(v).toString(16).padStart(64,'0');
const W=v=>'0x'+pad(v);
const sel=s=>'0x'+keccak(Buffer.from(s)).slice(2,10);
const OZ7201='0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00'; // ERC20Storage namespace (OZ v5)
async function rpc(url,method,params){
 try{const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(15000)});
  if(!r.ok)return {http:r.status};const b=await r.json();return b.error?{error:b.error.code+':'+String(b.error.message).slice(0,90)}:{result:b.result};}
 catch(e){return {error:'FETCH:'+String(e.message).slice(0,50)};}
}
function slotKey(holder,slot,layout){
 const k=holder.slice(2).padStart(64,'0'),s=typeof slot==='string'?slot.slice(2):pad(slot);
 return keccak(Buffer.from(layout==='vyper'?s+k:k+s,'hex'));
}
(async()=>{
 for(const network of Object.keys(TOKENS)){
  const {endpoints}=observer.endpoints(network,{});
  for(const e of endpoints){
   const row={network,operator:e.operator};
   const head=await rpc(e.url,'eth_blockNumber',[]);if(!head.result){row.head=head;notice('sim-'+network+'-'+e.operator,row);continue;}
   const block='0x'+(BigInt(head.result)-6n).toString(16);
   // 1) code override: a contract returning 42
   const code=await rpc(e.url,'eth_call',[{to:HELPER,data:'0x'},block,{[HELPER]:{code:'0x602a60005260206000f3'}}]);
   row.codeOverride=code.result===W(42)?'OK':code;
   // 2) eth_simulateV1 minimal
   const sim=await rpc(e.url,'eth_simulateV1',[{blockStateCalls:[{stateOverrides:{[HELPER]:{code:'0x602a60005260206000f3'}},calls:[{to:HELPER,data:'0x'}]}],validation:false,traceTransfers:false},block]);
   row.simulateV1=sim.result?(sim.result[0]?.calls?.[0]?.returnData===W(42)?'OK':'UNEXPECTED:'+JSON.stringify(sim.result).slice(0,120)):sim;
   // 3) balance slot discovery by storage override
   row.slots={};
   for(const token of TOKENS[network]){
    let found=null;
    const tries=[...Array.from({length:12},(_,i)=>[i,'solidity']),...Array.from({length:6},(_,i)=>[i,'vyper']),[OZ7201,'solidity']];
    for(const [slot,layout] of tries){
     const key=slotKey(FRESH,slot,layout),magic=123456789n;
     const r=await rpc(e.url,'eth_call',[{to:token,data:sel('balanceOf(address)')+FRESH.slice(2).padStart(64,'0')},block,{[token]:{stateDiff:{[key]:W(magic)}}}]);
     if(r.result===W(magic)){found={slot:typeof slot==='string'?'oz7201':slot,layout};break;}
     if(r.error&&!found){found={error:r.error};if(/state|override|param/i.test(r.error))break;found=null;}
    }
    row.slots[token.slice(0,10)]=found;
   }
   notice('sim-'+network+'-'+e.operator,row);
  }
 }
})().catch(e=>{console.error('::error::'+e.message);process.exit(1);});
