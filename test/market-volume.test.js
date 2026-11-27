'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const V=require('../search/server/lib/market-volume'),M=require('../search/server/lib/market-onchain');
const TOKEN='0x'+'1'.repeat(40),POOL='0x'+'3'.repeat(40),POOL2='0x'+'4'.repeat(40),WETH='0x0bd7d308f8e1639fab988df18a8011f41eacad73',OTHER='0x'+'9'.repeat(40);
const W=n=>BigInt.asUintN(256,BigInt(n)).toString(16).padStart(64,'0'),A=a=>'0x'+a.slice(2).padStart(64,'0');
const HEAD=1000000,BT=0.1; // 0.1 s blocks => 24h = 864,000 blocks
const ts=n=>1700000000+Math.floor(n*BT);
function chain({swaps={},token0={[POOL]:TOKEN,[POOL2]:TOKEN},token1={[POOL]:WETH,[POOL2]:OTHER},hashes={},flip=false,removed=false,dup=false}={}){
 const reads={};
 const rpc=async(m,p)=>{
  if(m==='eth_blockNumber')return '0x'+HEAD.toString(16);
  if(m==='eth_getBlockByNumber'){const n=Number(BigInt(p[0]));reads[n]=(reads[n]||0)+1;const h=flip&&n===HEAD-20&&reads[n]>1?'0x'+'e'.repeat(64):hashes[n]||'0x'+String(n).padStart(64,'7');return {hash:h,timestamp:'0x'+ts(n).toString(16)};}
  if(m==='eth_call'){const {to,data}=p[0];if(data==='0x0dfe1681')return A(token0[to]);if(data==='0xd21220a7')return A(token1[to]);if(data==='0x313ce567')return '0x'+W(18);throw Error('revert');}
  if(m==='eth_getLogs'){const f=p[0],from=Number(BigInt(f.fromBlock)),to=Number(BigInt(f.toBlock));
   const t0s=Array.isArray(f.topics[0])?f.topics[0]:[f.topics[0]];
   return t0s.flatMap(t0=>(swaps[f.address+':'+t0]||[]).map(l=>({...l,t0}))).filter(l=>l.n>=from&&l.n<=to).flatMap(l=>{const log={address:f.address,removed:removed&&l.n%2===0,blockNumber:'0x'+l.n.toString(16),blockHash:'0x'+String(l.n).padStart(64,'7'),logIndex:'0x'+(l.i||0).toString(16),topics:[l.t0,...(f.topics[1]?[f.topics[1]]:[A(OTHER)])],data:l.data};return dup?[log,{...log}]:[log];});}
  throw Error('unexpected '+m);};
 return rpc;
}
const v3=(a0,a1)=>'0x'+W(a0)+W(a1)+W(1)+W(1)+W(0);
const primary=pools=>({volume24h:{value:1,dataState:'DATA_FOUND',evidence:[{provider:'DEX Screener',pairs:pools}]}});
const usdOf=async a=>({usd:a==='ETH'?3000:1});
test('VOL-1 V3: quote-side |amount| summed inside the 24h window only, de-duplicated, priced with the quote reference',async()=>{
 V._reset();const E=10n**18n;
 const swaps={[POOL+':'+V.TOPIC.V3]:[{n:HEAD-20-100,data:v3(-5n*E,2n*E)},{n:HEAD-20-200,i:1,data:v3(7n*E,-1n*E)},{n:HEAD-20-900000,data:v3(1n,999n*E)}]};
 const r=await V.inspect('robinhood',TOKEN,primary([POOL]),{rpc:chain({swaps,dup:true}),usdOf,now:Date.now()});
 assert.ok(r.field,'reason '+r.profile.reason);assert.equal(r.field.value,(2+1)*3000,'3 WETH x 3000, the out-of-window swap excluded, duplicates dropped');
 assert.equal(r.field.evidence[0].swaps,2);assert.ok(r.field.evidence[0].windowSeconds>=86400&&r.field.evidence[0].windowSeconds<86400+1);
});
test('VOL-2 fail closed: removed logs, reorged anchors, Arc window, oversized scope',async()=>{
 const E=10n**18n,swaps={[POOL+':'+V.TOPIC.V3]:[{n:HEAD-20-100,data:v3(-5n*E,2n*E)},{n:HEAD-20-101,data:v3(1n,1n)}]};
 V._reset();assert.equal((await V.inspect('robinhood',TOKEN,primary([POOL]),{rpc:chain({swaps,removed:true}),usdOf})).profile.reason,'INVALID_SWAP_LOG');
 V._reset();assert.equal((await V.inspect('robinhood',TOKEN,primary([POOL]),{rpc:chain({swaps,flip:true}),usdOf})).profile.reason,'VOLUME_WINDOW_REORGED');
 assert.equal((await V.inspect('arc',TOKEN,primary([POOL]),{rpc:chain({swaps}),usdOf})).profile.reason,'VOLUME_WINDOW_EXCEEDS_RPC_BUDGET');
 const many=Array.from({length:13},(_,i)=>'0x'+(i+1).toString(16).padStart(40,'a'));
 assert.match((await V.inspect('robinhood',TOKEN,primary(many),{rpc:chain({swaps}),usdOf})).profile.reason,/VOLUME_SCOPE_EXCEEDS_BUDGET/);
});
test('VOL-3 unsupported quote: a pool with swaps fails closed, a pool with ZERO swaps contributes exactly 0',async()=>{
 const E=10n**18n;V._reset();
 const zero=await V.inspect('robinhood',TOKEN,primary([POOL,POOL2]),{rpc:chain({swaps:{[POOL+':'+V.TOPIC.V3]:[{n:HEAD-20-5,data:v3(-E,E)}]}}),usdOf});
 assert.equal(zero.field.value,3000);assert.deepEqual(zero.field.evidence[0].pools.find(p=>p.pool===POOL2),{pool:POOL2,kind:'V2',swaps:0,usd:0});
 V._reset();const bad=await V.inspect('robinhood',TOKEN,primary([POOL,POOL2]),{rpc:chain({swaps:{[POOL+':'+V.TOPIC.V3]:[{n:HEAD-20-5,data:v3(-E,E)}],[POOL2+':'+V.TOPIC.V2]:[{n:HEAD-20-6,data:'0x'+W(1)+W(0)+W(0)+W(1)}]}}),usdOf});
 assert.equal(bad.field,null);assert.equal(bad.profile.reason,'QUOTE_ASSET_UNSUPPORTED');
});
test('VOL-4 V2 quote amount = amountIn + amountOut of the quote side; V4 uses int128 amounts',()=>{
 const l2={data:'0x'+W(5)+W(0)+W(0)+W(7)};assert.equal(V.quoteAmount('V2',l2,true),5n);assert.equal(V.quoteAmount('V2',l2,false),7n);
 const l4={data:'0x'+W(BigInt.asUintN(128,-9n))+W(4)+W(1)+W(1)+W(0)+W(3000)};assert.equal(V.quoteAmount('V4',l4,true),9n);assert.equal(V.quoteAmount('V4',l4,false),4n);
});
test('VOL-5 ENS namehash is the standard EIP-137 value (feed names are resolved on-chain, never hard-coded)',()=>{
 assert.equal(M.namehash('eth'),'0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae');
 assert.equal(M.FEEDS.USDS.address,undefined);assert.equal(M.FEEDS.USDS.ens,'usds-usd.data.eth');
});
test('VOL-CRV Curve 2-coin pool: TokenExchange quote side counted once per swap; coin index checked; 3-coin fails closed',async()=>{
 const E=10n**18n,P='0x'+'c'.repeat(40),n=i=>W(i);
 const coins=(extra)=>{const base=chain({token0:{},token1:{},swaps:{[P+':'+V.TOPIC.CURVE[1]]:[{n:HEAD-20-100,data:'0x'+W(0)+W(9n*E)+W(1)+W(2n*E)},{n:HEAD-20-200,i:1,data:'0x'+W(1)+W(3n*E)+W(0)+W(13n*E)}]}});
  return async(m,p)=>{if(m==='eth_call'){const {to,data}=p[0];if(to===P&&data==='0x0dfe1681')throw Error('revert');
   if(to===P&&data==='0xc6610657'+n(0))return A(TOKEN);if(to===P&&data==='0xc6610657'+n(1))return A('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
   if(extra&&to===P&&data==='0xc6610657'+n(2))return A(OTHER);}
   return base(m,p);};};
 V._reset();let r=await V.inspect('robinhood',TOKEN,primary([P]),{rpc:coins(false),usdOf,now:Date.now()});
 assert.ok(r.field,'reason '+r.profile.reason);assert.equal(r.field.value,(2+3)*3000,'native ETH side: 2 bought + 3 sold');
 V._reset();r=await V.inspect('robinhood',TOKEN,primary([P]),{rpc:coins(true),usdOf,now:Date.now()});
 assert.equal(r.field,null);assert.equal(r.profile.reason,'CURVE_POOL_NOT_TWO_COIN');
});
