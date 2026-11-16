'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const op=require('../lib/radar-v2/onchain-pools');
const w=a=>'0x'+'0'.repeat(24)+a.slice(2),A=i=>'0x'+String(i).repeat(40).slice(0,40);
const USDC='0x3600000000000000000000000000000000000000',PM='0x8366a39cc670b4001a1121b8f6a443a643e40951',SYN='0x6307fc239c7964942c1bffe51930e55606619c74';
function mock({logs=[],head=200000,fail=0}={}){
 const calls=[];let failing=fail;
 const fn=async(m,p)=>{calls.push(m);
  if(m==='eth_getBlockByNumber')return {number:p[0]==='latest'?'0x'+head.toString(16):p[0],timestamp:'0x6553f100'};
  if(m==='eth_getLogs'){if(failing-->0)throw Error('range too large');const f=p[0];return logs.filter(l=>f.address.includes(l.address)&&f.topics[0].includes(l.topics[0])&&BigInt(l.blockNumber)>=BigInt(f.fromBlock)&&BigInt(l.blockNumber)<=BigInt(f.toBlock));}
  if(m==='eth_call')return '0x'+'0'.repeat(62)+'20'+'0'.repeat(63)+'3'+Buffer.from('NEW').toString('hex').padEnd(64,'0');
  throw Error('unexpected '+m);};
 return {fn,calls};
}
const v4=(id,c0,c1,b)=>({address:PM,topics:[op.TOPICS.V4_INITIALIZE,id,w(c0),w(c1)],data:'0x'+'0'.repeat(64*5),blockNumber:'0x'+b.toString(16),transactionHash:'0x'+'a'.repeat(64)});
const v3=(pool,t0,t1,b)=>({address:SYN,topics:[op.TOPICS.V3_POOL_CREATED,w(t0),w(t1),'0x'+'0'.repeat(60)+'2710'],data:'0x'+'0'.repeat(62)+'c8'+w(pool).slice(2),blockNumber:'0x'+b.toString(16),transactionHash:'0x'+'b'.repeat(64)});
test('on-chain discovery: V4 Initialize + V3 PoolCreated, base token = non-quote side, deduped per token with pools kept, bounded calls',async()=>{
 const T1=A(1),T2=A(2),P=A(5);
 const m=mock({logs:[v4('0x'+'c'.repeat(64),USDC,T1,199000),v3(P,T1,USDC,198500),v3(A(6),T2,A(7),198000)]});
 const r=await op.discover('arc',m.fn);
 assert.equal(r.poolCount,3);assert.equal(r.tokens.length,1,'T1 deduped; pool of two non-quote assets has no base');
 assert.equal(r.tokens[0].address,T1);assert.equal(r.tokens[0].pools.length,2);assert.deepEqual(new Set(r.tokens[0].pools.map(p=>p.dex)),new Set(['uniswap-v4','synthra-arc']));
 assert.equal(r.tokens[0].pools.find(p=>p.dex==='synthra-arc').sourceStatus,'DISCOVERY_ONLY_UNREVIEWED');
 assert.equal(r.tokens[0].symbol,'NEW');
 assert.ok(r.scanned.calls<=op.MAX_LOG_CALLS+2+op.MAX_SYMBOLS);assert.ok(['OK','PARTIAL_WINDOW'].includes(r.status));
});
test('on-chain discovery: provider range errors narrow the span; unknown networks are explicit',async()=>{
 const m=mock({fail:2});const r=await op.discover('arc',m.fn);
 assert.ok(['OK','PARTIAL_WINDOW'].includes(r.status));assert.ok(r.scanned.errors>=2);
 assert.equal((await op.discover('pons',m.fn)).status,'NOT_CONFIGURED');
});
test('parse rejects malformed creation events',()=>{
 const src={kind:'V3'};assert.equal(op.parse(src,{topics:[op.TOPICS.V3_POOL_CREATED],data:'0x'}),null);
 assert.equal(op.parse({kind:'V4'},{topics:[op.TOPICS.V3_POOL_CREATED,'0x1','0x2','0x3']}),null);
});
test('V3 Arc: persistent chunk errors at the minimum span are skipped as gaps, the scan continues',async()=>{
 const m=mock({fail:6});const r=await op.discover('arc',m.fn);
 assert.notEqual(r.status,'UNAVAILABLE');assert.ok(r.scanned.gaps>=1||r.scanned.errors>=1);assert.ok(r.scanned.calls<=op.MAX_LOG_CALLS+2+op.MAX_SYMBOLS);
});
test('#262: duplicate creation logs (overlapping/retried chunks) count once; Arc span never exceeds the verified 7.5k',async()=>{
 const T1=A(1),log=v4('0x'+'c'.repeat(64),USDC,T1,199000);
 const m=mock({logs:[log,{...log}]});const r=await op.discover('arc',m.fn);
 assert.equal(r.poolCount,1);assert.equal(r.tokens[0].pools.length,1);
 assert.ok(op.WINDOW.arc.maxSpan<=7500&&op.WINDOW.arc.span<=7500);
});
