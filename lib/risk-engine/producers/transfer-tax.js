'use strict';
// Reviewed sell-transfer-tax producer v1 (risk.sell-transfer-tax), POSITIVE ONLY. Ethereum and Robinhood.
//
// Method: no swap and no quote. A token TRANSFER into the token's main reviewed pool is simulated with eth_simulateV1 on
// top of the pinned block (blockOverrides: number = block + 1, time = block time + 12, identical on both operators):
//   * the sender is a fresh, key-less address FRESH (keccak256("arcy-risk-sim-holder-v1")[12:]) with no code, so it is
//     on no exemption list and is not privileged; its token balance is set with a storage override of the token's own
//     balance mapping (slot found by override probing: balanceOf(FRESH) must return the written value exactly);
//   * calls in ONE simulated block: balanceOf(pool), balanceOf(FRESH), totalSupply(), transfer(pool, amount) from FRESH,
//     then the same three reads again;
//   * amount = 0.01% of the pool's token balance (stays below typical max-transaction limits);
//   * deduction = amount - (pool balance increase). DEX fee, price impact and gas cannot appear: nothing is swapped.
// Fail closed (UNKNOWN) unless: every call succeeds; transfer returns true or no data; FRESH is debited EXACTLY `amount`
// (a no-op or fake transfer that does not debit is never a tax); the Transfer events from FRESH sum to `amount`; the
// pool is credited at most `amount`. A deduction is reported with where it went: burned (supply fell) or sent elsewhere.
// Positive only: a 0% result can be an exemption, a time- or account-dependent tax, or a disabled-trading window.
// Arc: neither registered operator offers eth_simulateV1 (live probe, #236) => SIMULATION_METHOD_UNSUPPORTED.
const keccak=require('../../keccak');
const v2=require('../../liquidity-exit-v2');
const v3=require('../../liquidity-exit-v3');
const {runOperators,buildRecord,fail}=require('./operators');
const PRODUCER=Object.freeze({id:'arcy-risk-transfer-tax-producer',version:1});
const ADDRESS=/^0x[0-9a-f]{40}$/,WORD=/^0x[0-9a-f]{64}$/i,ZERO='0x'+'0'.repeat(40);
const FRESH='0x'+keccak(Buffer.from('arcy-risk-sim-holder-v1')).slice(-40);
const sel=s=>'0x'+keccak(Buffer.from(s)).slice(2,10);
const SEL=Object.freeze({balanceOf:sel('balanceOf(address)'),totalSupply:sel('totalSupply()'),transfer:sel('transfer(address,uint256)'),factory:sel('factory()'),
 token0:sel('token0()'),token1:sel('token1()'),getPair:sel('getPair(address,address)'),getPool:v3.SELECTORS.getPool});
const TRANSFER_TOPIC='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
// Reviewed quote assets per network (pool destinations only; no price is used by this producer).
const QUOTES=Object.freeze({
 ethereum:Object.freeze(['0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48','0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2','0xdac17f958d2ee523a2206206994597c13d831ec7']),
 robinhood:Object.freeze(['0x0bd7d308f8e1639fab988df18a8011f41eacad73'])   // WETH (lib/radar-v2/sources.js, pons docs)
});
for(const list of Object.values(QUOTES))for(const a of list)if(!ADDRESS.test(a))throw Error('Invalid reviewed quote address');
const V3_FEES=Object.freeze([100,500,3000,10000]);
// Solidity mapping slots 0..11, Vyper 0..5, OpenZeppelin v5 ERC-7201 ERC20Storage namespace.
const OZ7201='0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00';
const SLOT_TRIES=Object.freeze([...Array.from({length:12},(_,i)=>[i,'solidity']),...Array.from({length:6},(_,i)=>[i,'vyper']),[OZ7201,'solidity']]);
// MAGIC fits uint96 (Compound-style packed balances, e.g. UNI and ONDO): a larger probe value is truncated and the slot
// is never found (live probe #236).
const THRESHOLD_BPS=100,MAGIC=0x1234567890abcdefn;
const LIMITS=Object.freeze({callsPerEndpoint:90,timeoutMs:6000,deadlineMs:25000,maxBodyBytes:512*1024,minIntervalMs:150});
const SUPPORTED=Object.freeze(['ethereum','robinhood']);
const supported=network=>SUPPORTED.includes(network);
const pad=a=>a.slice(2).padStart(64,'0');
const W=v=>'0x'+BigInt(v).toString(16).padStart(64,'0');
const word=raw=>{if(!WORD.test(raw||''))throw fail('RPC_MALFORMED_RESPONSE');return BigInt(raw);};
const addr=raw=>{if(!WORD.test(raw||'')||!/^0x0{24}/i.test(raw))throw fail('RPC_MALFORMED_RESPONSE');return '0x'+raw.slice(-40).toLowerCase();};
function slotKey(holder,slot,layout){
 const k=holder.slice(2).padStart(64,'0'),s=typeof slot==='string'?slot.slice(2):BigInt(slot).toString(16).padStart(64,'0');
 return keccak(Buffer.from(layout==='vyper'?s+k:k+s,'hex'));
}

async function destination({must,token,network,preferred}){
 // Candidate pools from reviewed factories; the one holding the most of the token is the main sell venue. Balances are
 // read first and pool identity (factory, exact token pair) is verified only for the chosen candidate, in balance order.
 const balance=async p=>{const b=await must(token,SEL.balanceOf+pad(p));try{return b.ok?word(b.result):0n;}catch{return 0n;}};
 const verify=async c=>{
  const [f,t0,t1]=[await must(c.pool,SEL.factory),await must(c.pool,SEL.token0),await must(c.pool,SEL.token1)];
  try{if(!f.ok||!t0.ok||!t1.ok)return false;const pair=new Set([addr(t0.result),addr(t1.result)]);return addr(f.result)===c.factory&&pair.size===2&&pair.has(token)&&pair.has(c.quote);}catch{return false;}
 };
 const found=[];
 const lookup=async(factory,data,quote,protocol)=>{const r=await must(factory,data);let pool;try{if(!r.ok)return;pool=addr(r.result);}catch{return;}if(pool!==ZERO&&!found.some(c=>c.pool===pool))found.push({pool,factory,quote,protocol});};
 // The pool producer's pool (when given) is checked first; discovery runs only if it is not a verified, funded pool.
 if(preferred){
  for(const q of QUOTES[network])for(const p of v2.protocols(network))if(q!==token)await lookup(p.factory,SEL.getPair+pad(token)+pad(q),q,p.id);
  const c=found.find(x=>x.pool===preferred);
  if(c){c.tokenBalance=await balance(c.pool);if(c.tokenBalance>0n&&await verify(c))return {chosen:c,candidates:[{pool:c.pool,protocol:c.protocol,tokenBalance:c.tokenBalance.toString()}]};}
 }
 for(const q of QUOTES[network]){
  if(q===token)continue;
  for(const p of v2.protocols(network))await lookup(p.factory,SEL.getPair+pad(token)+pad(q),q,p.id);
  for(const p of v3.protocols(network))for(const fee of V3_FEES)await lookup(p.factory,SEL.getPool+pad(token)+pad(q)+fee.toString(16).padStart(64,'0'),q,p.id+':'+fee);
 }
 for(const c of found)if(c.tokenBalance===undefined)c.tokenBalance=await balance(c.pool);
 const ranked=found.filter(c=>c.tokenBalance>0n).sort((a,b)=>b.tokenBalance>a.tokenBalance?1:b.tokenBalance<a.tokenBalance?-1:a.pool.localeCompare(b.pool));
 let chosen=null;for(const c of ranked.slice(0,3))if(await verify(c)){chosen=c;break;}
 return {chosen,candidates:found.map(c=>({pool:c.pool,protocol:c.protocol,tokenBalance:c.tokenBalance.toString()})),
  unverified:!chosen&&ranked.length>0};
}
async function read({call,block,anchor},{network,token,preferred}){
 const must=async(to,data,overrides)=>{const r=await call('eth_call',overrides?[{to,data},block,overrides]:[{to,data},block]);if(r.error)throw fail(r.error);return r;};
 const dest=await destination({must,token,network,preferred});
 const out={destination:dest.chosen?{pool:dest.chosen.pool,protocol:dest.chosen.protocol}:null,candidates:dest.candidates,slot:null,amount:null,result:null,reasonCode:null};
 if(!dest.chosen){out.reasonCode=dest.unverified?'POOL_IDENTITY_UNVERIFIED':dest.candidates.length?'NO_POOL_HOLDS_TOKEN':'NO_REVIEWED_POOL_FOR_TOKEN';return out;}
 // Balance slot for FRESH.
 for(const [slot,layout] of SLOT_TRIES){
  const key=slotKey(FRESH,slot,layout);
  const r=await must(token,SEL.balanceOf+pad(FRESH),{[token]:{stateDiff:{[key]:W(MAGIC)}}});
  if(r.ok&&r.result===W(MAGIC)){out.slot={slot:typeof slot==='string'?'erc7201':slot,layout,key};break;}
 }
 if(!out.slot){out.reasonCode='BALANCE_SLOT_NOT_FOUND';return out;}
 const amount=dest.chosen.tokenBalance/10000n;
 const UINT96_MAX=(1n<<96n)-1n;
 if(amount<=0n){out.reasonCode='POOL_BALANCE_TOO_SMALL';return out;}
 if(amount*2n>UINT96_MAX){out.reasonCode='PROBE_AMOUNT_TOO_LARGE';return out;}   // keep the funded balance valid for uint96 storage
 out.amount=amount.toString();
 const pool=dest.chosen.pool,read=(data)=>({from:FRESH,to:token,data});
 const reads=[read(SEL.balanceOf+pad(pool)),read(SEL.balanceOf+pad(FRESH)),read(SEL.totalSupply)];
 const transfer={from:FRESH,to:token,data:SEL.transfer+pad(pool)+amount.toString(16).padStart(64,'0'),gas:'0x7a120'};
 const r=await call('eth_simulateV1',[{blockStateCalls:[{blockOverrides:{number:'0x'+(BigInt(block)+1n).toString(16),time:'0x'+(anchor.timestamp+12).toString(16)},
  stateOverrides:{[token]:{stateDiff:{[out.slot.key]:W(amount*2n)}},[FRESH]:{balance:'0x56bc75e2d63100000'}},calls:[...reads,transfer,...reads]}],validation:false,traceTransfers:false},block]);
 if(r.error)throw fail(r.error);
 const calls=r.result?.[0]?.calls;
 if(!Array.isArray(calls)||calls.length!==7)throw fail('RPC_MALFORMED_RESPONSE');
 const okCall=c=>c&&(c.status==='0x1'||c.status===1);
 if(![0,1,2,4,5,6].every(i=>okCall(calls[i])))throw fail('RPC_MALFORMED_RESPONSE');
 const v=i=>word(calls[i].returnData);
 const [poolBefore,selfBefore,supplyBefore,poolAfter,selfAfter,supplyAfter]=[v(0),v(1),v(2),v(4),v(5),v(6)];
 const t=calls[3];
 if(!okCall(t)){out.reasonCode='TRANSFER_REVERTED';return out;}
 if(t.returnData&&t.returnData!=='0x'&&!(WORD.test(t.returnData)&&BigInt(t.returnData)===1n)){out.reasonCode='TRANSFER_RETURNED_FALSE';return out;}
 const debited=selfBefore-selfAfter,credited=poolAfter-poolBefore,burned=supplyBefore-supplyAfter;
 const logs=(t.logs||[]).filter(l=>Array.isArray(l.topics)&&String(l.address).toLowerCase()===token&&l.topics[0]===TRANSFER_TOPIC&&l.topics.length===3);
 const fromFresh=logs.filter(l=>('0x'+l.topics[1].slice(-40)).toLowerCase()===FRESH);
 let logged=0n;for(const l of fromFresh){try{logged+=word(l.data);}catch{throw fail('RPC_MALFORMED_RESPONSE');}}
 out.result={debited:debited.toString(),credited:credited.toString(),burned:burned.toString(),transferEvents:fromFresh.length,loggedFromSender:logged.toString(),
  recipients:[...new Set(fromFresh.map(l=>'0x'+l.topics[2].slice(-40).toLowerCase()))].sort()};
 // A transfer that does not debit the sender exactly is not a transfer (no-op, fake success, rebasing balances).
 if(debited!==amount){out.reasonCode='TRANSFER_DEBIT_MISMATCH';return out;}
 if(!fromFresh.length||logged!==amount){out.reasonCode='TRANSFER_EVENTS_INCONSISTENT';return out;}
 if(credited<0n){out.reasonCode='POOL_BALANCE_DECREASED';return out;}
 const deduction=credited>=amount?0n:amount-credited;
 out.result.deduction=deduction.toString();
 out.result.deductionBps=Number(deduction*10000n/amount);
 out.result.destination=deduction===0n?null:burned>=deduction?'BURNED':'OTHER_ADDRESS';
 out.reasonCode=out.result.deductionBps>=THRESHOLD_BPS?null:'BELOW_THRESHOLD_NEGATIVE_NOT_REVIEWED';
 return out;
}
const signature=o=>JSON.stringify(o?{destination:o.destination,candidates:o.candidates,slot:o.slot&&{slot:o.slot.slot,layout:o.slot.layout},amount:o.amount,result:o.result,reasonCode:o.reasonCode}:null);

async function produce({network,token,block,env=process.env,fetcher=fetch,now=Date.now,preferredPool=null}={}){
 const address=String(token||'').toLowerCase();
 if(!ADDRESS.test(address)||address===ZERO)throw fail('RISK_PRODUCER_INVALID_TOKEN');
 if(!supported(network))return {producer:{...PRODUCER},network,reasonCode:'SIMULATION_METHOD_UNSUPPORTED',pool:null,records:[],operators:[],cost:{rpcCalls:0,ms:0}};
 const preferred=ADDRESS.test(String(preferredPool||''))?preferredPool.toLowerCase():null;
 const run=await runOperators({network,block,env,fetcher,now,limits:LIMITS,read:ctx=>read(ctx,{network,token:address,preferred})});
 const ok=run.rows.filter(r=>r.state==='OK');
 const pools=new Set(ok.map(r=>r.outcome.destination?.pool||null)),pool=pools.size===1?[...pools][0]:null;
 const records=[];
 if(pool)records.push(buildRecord({metricId:'risk.sell-transfer-tax',unit:'bps',method:'pinned-sell-transfer-state-override-simulation',reference:pool,network,token:address,scope:pool,
  generatedAt:new Date(now()).toISOString(),blockNumber:run.blockNumber,rows:run.rows,independence:run.independence,engine:PRODUCER,signature,
  pick:o=>o.reasonCode?{reasonCode:o.reasonCode}:{value:Math.min(10000,o.result.deductionBps)}}));
 const reasonCode=pool?(records[0].state==='VERIFIED_ONCHAIN'?null:records[0].reasonCode):pools.size>1?'OPERATORS_SELECTED_DIFFERENT_POOLS':ok[0]?.outcome?.reasonCode||run.rows.find(r=>r.reasonCode)?.reasonCode||'NO_OPERATOR_RESULT';
 return {producer:{...PRODUCER},network,reasonCode,pool,block:{number:run.blockNumber,hex:run.blockHex},independence:run.independence,
  operators:run.rows.map(r=>({role:r.role,operator:r.operator,state:r.state,reasonCode:r.reasonCode||null,failedAt:r.failedAt||null,rpcError:r.rpcError??null,watchdogState:r.watchdogState||null,
   rpcCalls:r.cost.rpcCalls,ms:r.cost.ms,outcome:r.outcome?{destination:r.outcome.destination,reasonCode:r.outcome.reasonCode,result:r.outcome.result,slot:r.outcome.slot&&{slot:r.outcome.slot.slot,layout:r.outcome.slot.layout}}:null})),
  records,cost:run.cost};
}
module.exports={PRODUCER,produce,supported,FRESH,QUOTES,LIMITS,SEL,THRESHOLD_BPS,_internals:{read,signature,slotKey,OZ7201}};
