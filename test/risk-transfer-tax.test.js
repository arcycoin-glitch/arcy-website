'use strict';
const {test,beforeEach}=require('node:test'),assert=require('node:assert/strict');
const tax=require('../lib/risk-engine/producers/transfer-tax');
const {evaluateRisk}=require('../lib/risk-engine');
const evidence=require('../lib/verification/metric-evidence');
const observer=require('../lib/verification/onchain-observer');
const v2=require('../lib/liquidity-exit-v2');
const keccak=require('../lib/keccak');

const NOW=Date.parse('2026-11-15T00:00:00Z'),BLOCK='0x64',HASH='0x'+'11'.repeat(32),TS=Math.floor((NOW-60000)/1000);
const TOKEN='0x'+'ab'.repeat(20),PAIR='0x'+'50'.repeat(20),TAXW='0x'+'7a'.repeat(20),USDC=tax.QUOTES.ethereum[0],UNI=v2.PROTOCOLS.ethereum[0];
const FRESH=tax.FRESH,FAST={ARC_RISK_RPC_MIN_INTERVAL_MS:'0'},TOPIC='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const W=v=>'0x'+BigInt.asUintN(256,BigInt(v)).toString(16).padStart(64,'0');
const A=a=>'0x'+a.slice(2).padStart(64,'0');
const sel=s=>'0x'+keccak(Buffer.from(s)).slice(2,10);
beforeEach(()=>observer._resetHealth());

function sim(over={}){
 const calls=[];
 const base={chainId:'0x1',hash:HASH,slot:3,poolBal:10n**24n,uint96:false,supply:10n**27n,taxBps:500,burn:false,noop:false,noEvents:false,revert:false,retFalse:false,reflectBonus:0n,...over};
 const fetcher=async(url,init)=>{
  const host=new URL(url).hostname,q=JSON.parse(init.body),b={...base,...(over.hosts?.[host]||{})};calls.push({host,method:q.method,params:q.params});
  const ok=result=>new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));
  const revert=()=>new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,error:{code:3,message:'execution reverted'}}));
  if(b.http)return new Response('x',{status:b.http});
  if(q.method==='eth_chainId')return ok(b.chainId);
  if(q.method==='eth_getBlockByNumber')return ok({number:q.params[0],hash:b.hash,timestamp:'0x'+TS.toString(16)});
  if(q.method==='eth_call'){
   const {to,data}=q.params[0],s=data.slice(0,10),ov=q.params[2];
   if(to===UNI.factory&&s===v2.SELECTORS.getPair){const t=['0x'+data.slice(34,74),'0x'+data.slice(98,138)];return ok(A(t.includes(TOKEN)&&t.includes(USDC)?PAIR:'0x'+'0'.repeat(40)));}
   if(to===PAIR){if(s===sel('factory()'))return ok(A(UNI.factory));if(s===sel('token0()'))return ok(A(TOKEN));if(s===sel('token1()'))return ok(A(USDC));}
   if(to===TOKEN&&s===sel('balanceOf(address)')){
    const who='0x'+data.slice(34,74);
    if(who===PAIR)return ok(W(b.poolBal));
    if(who===FRESH&&ov){const v=b.slot===null?null:ov[TOKEN]?.stateDiff?.[tax._internals.slotKey(FRESH,b.slot,'solidity')];return ok(v?(b.uint96?W(BigInt(v)&((1n<<96n)-1n)):v):W(0));}
    return ok(W(0));
   }
   return revert();
  }
  if(q.method==='eth_simulateV1'){
   if(b.simUnsupported)return new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,error:{code:-32601,message:'method not supported'}}));
   const bsc=q.params[0].blockStateCalls[0],key=tax._internals.slotKey(FRESH,b.slot,'solidity');
   let fresh=BigInt(bsc.stateOverrides[TOKEN].stateDiff[key]),pool=b.poolBal,supply=b.supply;
   const out=[];const rd=v=>({status:'0x1',returnData:W(v),logs:[]});
   for(const c of bsc.calls){
    const s=c.data.slice(0,10);
    if(s===sel('balanceOf(address)'))out.push(rd(('0x'+c.data.slice(34,74))===PAIR?pool:fresh));
    else if(s===sel('totalSupply()'))out.push(rd(supply));
    else if(s===sel('transfer(address,uint256)')){
     const amount=BigInt('0x'+c.data.slice(74));
     if(b.revert){out.push({status:'0x0',returnData:'0x',error:{message:'trading not open'}});continue;}
     if(b.retFalse){out.push({status:'0x1',returnData:W(0),logs:[]});continue;}
     const logs=[];
     if(!b.noop){
      const t=amount*BigInt(b.taxBps)/10000n;fresh-=amount;pool+=amount-t+b.reflectBonus-(b.poolDrain?amount*3n:0n);
      if(b.burn)supply-=t;
      if(!b.noEvents){logs.push({address:TOKEN,topics:[TOPIC,A(FRESH),A(PAIR)],data:W(amount-t)});if(t>0n)logs.push({address:TOKEN,topics:[TOPIC,A(FRESH),A(b.burn?'0x'+'0'.repeat(40):TAXW)],data:W(t)});}
     }
     out.push({status:'0x1',returnData:b.emptyReturn?'0x':W(1),logs});
    }
   }
   return ok([{calls:out}]);
  }
  return revert();
 };
 return {fetcher,calls};
}
const run=(s,extra={})=>tax.produce({network:'ethereum',token:TOKEN,block:BLOCK,env:FAST,fetcher:s.fetcher,now:()=>NOW,...extra});
const finding=(r,{now=NOW,scope=PAIR}={})=>evaluateRisk({network:'ethereum',chainId:1,token:TOKEN,scope,evidence:r.records,now}).findings.find(f=>f.ruleId==='sell-transfer-tax');
const rec=r=>r.records[0];

test('a 5% transfer tax into the reviewed pool is CONFIRMED on two operators; the simulation is read-only and deterministic',async()=>{
 const s=sim(),r=await run(s),x=rec(r);
 assert.equal(r.pool,PAIR);assert.equal(x.state,'VERIFIED_ONCHAIN',x.reasonCode);assert.equal(x.value,500);assert.equal(x.scope,PAIR);
 assert.doesNotThrow(()=>evidence.parseMetricEvidence(x));
 const f=finding(r);assert.equal(f.status,'CONFIRMED');assert.equal(f.severity,'MEDIUM');
 const o=r.operators[0].outcome;assert.deepEqual(o.result.recipients,[PAIR,TAXW].sort());assert.equal(o.result.destination,'OTHER_ADDRESS');
 assert.deepEqual(o.slot,{slot:3,layout:'solidity'});
 // The simulation: fixed block number/time, fresh sender, no validation, nothing broadcast.
 const simCalls=s.calls.filter(c=>c.method==='eth_simulateV1');assert.equal(simCalls.length,2);
 for(const c of simCalls){const b=c.params[0].blockStateCalls[0];assert.equal(b.blockOverrides.number,'0x65');assert.equal(b.blockOverrides.time,'0x'+(TS+12).toString(16));
  assert.ok(b.calls.every(k=>k.from===FRESH));assert.equal(c.params[0].validation,false);assert.equal(c.params[1],BLOCK);}
 assert.ok(s.calls.every(c=>['eth_chainId','eth_getBlockByNumber','eth_call','eth_simulateV1'].includes(c.method)));
 // Amount is 0.01% of the pool's token balance.
 assert.equal(r.operators[0].outcome.result.debited,(10n**20n).toString());
 // A burn tax is reported as burned.
 const burn=await run(sim({burn:true,taxBps:1200}));assert.equal(rec(burn).value,1200);assert.equal(burn.operators[0].outcome.result.destination,'BURNED');
 // Tokens whose transfer returns no data are accepted.
 assert.equal(rec(await run(sim({emptyReturn:true}))).state,'VERIFIED_ONCHAIN');
});

test('no-op, fake-success, eventless, reverting and false-returning transfers never confirm a tax',async()=>{
 for(const [over,reason] of [[{noop:true},'TRANSFER_DEBIT_MISMATCH'],[{noEvents:true},'TRANSFER_EVENTS_INCONSISTENT'],[{revert:true},'TRANSFER_REVERTED'],[{retFalse:true},'TRANSFER_RETURNED_FALSE'],
  [{slot:null},'BALANCE_SLOT_NOT_FOUND'],[{poolBal:5000n},'POOL_BALANCE_TOO_SMALL'],[{poolBal:0n},'NO_POOL_HOLDS_TOKEN']]){
  observer._resetHealth();const r=await run(sim(over));
  const reasons=r.records.length?rec(r).reasonCode:r.reasonCode;assert.equal(reasons,reason,reason);
  if(r.records.length){assert.equal(rec(r).value,null);assert.notEqual(finding(r).status,'CONFIRMED');}
 }
 // No tax, or a reflection bonus: below threshold is NOT a negative verdict.
 for(const over of [{taxBps:0},{taxBps:0,reflectBonus:5n},{taxBps:50}]){
  const r=await run(sim(over));assert.equal(rec(r).reasonCode,'BELOW_THRESHOLD_NEGATIVE_NOT_REVIEWED');assert.equal(finding(r).status,'UNKNOWN');
 }
 // A forged negative record is refused by the gate.
 const ok=await run(sim()),forged=structuredClone(rec(ok));forged.value=0;for(const o of forged.observations)o.value=0;
 assert.equal(finding({records:[forged]}).reasonCode,'PRODUCER_NOT_REVIEWED');
});

test('operator disagreement, a different block, 429 and staleness never produce a confident tax verdict',async()=>{
 const split=await run(sim({hosts:{'eth.drpc.org':{taxBps:300}}}));assert.equal(rec(split).state,'CONFLICTING');assert.equal(finding(split).status,'CONFLICTING');
 const fork=await run(sim({hosts:{'eth.drpc.org':{hash:'0x'+'22'.repeat(32)}}}));assert.equal(rec(fork).reasonCode,'BLOCK_HASH_MISMATCH');
 // Same tax, different destination of the deduction (burn vs wallet): identity mismatch.
 const dest=await run(sim({hosts:{'eth.drpc.org':{burn:true}}}));assert.equal(rec(dest).reasonCode,'EXECUTION_IDENTITY_MISMATCH');
 observer._resetHealth();
 const limited=await run(sim({hosts:{'eth.drpc.org':{http:429}}}));assert.equal(rec(limited).state,'SINGLE_SOURCE');assert.equal(finding(limited).status,'UNKNOWN');
 observer._resetHealth();
 const unsupported=await run(sim({hosts:{'eth.drpc.org':{simUnsupported:true}}}));assert.equal(rec(unsupported).state,'SINGLE_SOURCE');
 observer._resetHealth();
 const ok=await run(sim());assert.equal(finding(ok,{now:NOW+20*60000}).status,'STALE');
 assert.equal(finding(ok,{scope:'0x'+'51'.repeat(20)}).reasonCode,'EVIDENCE_MISSING');
});

test('Arc has no simulation method: no request, explicit reason; the preferred pool is used when it holds the token',async()=>{
 const s=sim(),arc=await tax.produce({network:'arc',token:TOKEN,block:BLOCK,env:FAST,fetcher:s.fetcher,now:()=>NOW});
 assert.equal(arc.reasonCode,'SIMULATION_METHOD_UNSUPPORTED');assert.equal(s.calls.length,0);assert.equal(arc.records.length,0);
 assert.equal((await run(sim(),{preferredPool:PAIR})).pool,PAIR);
 // A preferred pool that is not a reviewed candidate is ignored (never trusted blindly).
 assert.equal((await run(sim(),{preferredPool:'0x'+'99'.repeat(20)})).pool,PAIR);
 assert.equal(tax.FRESH,'0x'+keccak(Buffer.from('arcy-risk-sim-holder-v1')).slice(-40));
});

test('pool identity is verified for the chosen candidate; an unverifiable funded pool is never used',async()=>{
 // The pair reports a different factory: it is not a reviewed pool.
 const bad=sim();const orig=bad.fetcher;
 bad.fetcher=async(url,init)=>{const q=JSON.parse(init.body);if(q.method==='eth_call'&&q.params[0].to===PAIR&&q.params[0].data===sel('factory()'))return new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,result:A('0x'+'99'.repeat(20))}));return orig(url,init);};
 const r=await run(bad);assert.equal(r.reasonCode,'POOL_IDENTITY_UNVERIFIED');assert.equal(r.records.length,0);
 assert.ok(!bad.calls.some(c=>c.method==='eth_simulateV1'));
 // With the pool producer's pool, discovery is skipped (fewer calls) and the result is the same.
 const a=sim(),b=sim();await run(a);const pref=await run(b,{preferredPool:PAIR});
 assert.equal(pref.pool,PAIR);assert.ok(b.calls.length<a.calls.length,b.calls.length+' < '+a.calls.length);
});

test('reflection bonuses are a zero deduction and a pool balance that falls is never interpreted',async()=>{
 const bonus=await run(sim({taxBps:0,reflectBonus:5n}));
 assert.equal(bonus.operators[0].outcome.result.deduction,'0');assert.equal(bonus.operators[0].outcome.result.deductionBps,0);
 const drain=await run(sim({poolDrain:true}));assert.equal(rec(drain).reasonCode,'POOL_BALANCE_DECREASED');assert.notEqual(finding(drain).status,'CONFIRMED');
});

test('uint96-packed balances (UNI, ONDO style) are found by the balance slot probe',async()=>{
 const r=await run(sim({uint96:true}));assert.equal(rec(r).state,'VERIFIED_ONCHAIN');assert.deepEqual(r.operators[0].outcome.slot,{slot:3,layout:'solidity'});
});
