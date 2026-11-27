'use strict';
// Exact-scope Uniswap v4 pool principal reconstruction from PoolManager tick state (read through the official StateView).
// v4 keeps all pools' tokens in one PoolManager, so a pool's own token amounts are not a balanceOf. They are reconstructed from
// every initialized tick: walking ticks in ascending order and applying liquidityNet gives the liquidity of each range, and the
// amounts of each range follow from the v3/v4 concentrated-liquidity formulas at the pinned sqrtPriceX96.
// Completeness proof: the liquidity accumulated up to the current tick must EQUAL StateView.getLiquidity(poolId) exactly
// (BigInt). Any missing or extra tick breaks that equality, and the pool is rejected (never a partial TVL).
// Excluded by design (stated in evidence): uncollected LP fees and any balance a hook keeps outside the pool's ticks. Pools whose
// hook address enables a *ReturnDelta permission (custom accounting, flags 0x0f) fail closed.
// Reads use Multicall `aggregate` at the same pinned block; the Multicall runtime hash is verified first.
const crypto=require('node:crypto');
const MULTICALL='0xca11bde05977b3631167028862be2a173976ca11';
const MULTICALL_RUNTIME_SHA256='0fb6a9dbcc4e17098c35d4b821bfc8cc404ab2dbd195d75bee6ce914979ddbfd';
const SEL={getTickBitmap:'1c7ccb4c',getTickLiquidity:'caedab54',getLiquidity:'fa6793d5',aggregate:'252dba42'};
const MIN_TICK=-887272,MAX_TICK=887272,MAX_WORDS=640,MAX_TICKS=1500,BATCH=120;
const fail=(c,x)=>Object.assign(Error(c),{code:c},x||{});
const w=n=>BigInt.asUintN(256,BigInt(n)).toString(16).padStart(64,'0');
const signedN=(x,bits)=>{const m=1n<<BigInt(bits);x&=m-1n;return x>=m>>1n?x-m:x;};
function encodeAggregate(calls){
 // aggregate((address target, bytes callData)[]) -> (uint256 blockNumber, bytes[] returnData)
 const tuples=calls.map(({to,data})=>{const d=data.replace(/^0x/,''),len=d.length/2,padded=d.padEnd(Math.ceil(len/32)*64,'0');return to.slice(2).padStart(64,'0')+w(64)+w(len)+padded;});
 let offs=[],pos=calls.length*32;for(const t of tuples){offs.push(w(pos));pos+=t.length/2;}
 return '0x'+SEL.aggregate+w(32)+w(calls.length)+offs.join('')+tuples.join('');
}
function decodeAggregate(raw,count){
 if(!/^0x(?:[0-9a-f]{64})+$/i.test(raw||''))throw fail('V4_MULTICALL_MALFORMED');
 const words=raw.slice(2).match(/.{64}/g),n=i=>{if(i<0||i>=words.length)throw fail('V4_MULTICALL_MALFORMED');return BigInt('0x'+words[i]);};
 if(n(1)!==64n||n(2)!==BigInt(count))throw fail('V4_MULTICALL_MALFORMED');
 const out=[];for(let i=0;i<count;i++){const start=3+Number(n(3+i)/32n),len=Number(n(start));if(len%32)throw fail('V4_MULTICALL_MALFORMED');
  out.push('0x'+words.slice(start+1,start+1+len/32).join(''));}
 return out;
}
const floorDiv=(a,b)=>Math.floor(a/b);
function wordRange(tickSpacing){const lo=floorDiv(floorDiv(MIN_TICK,tickSpacing),256),hi=floorDiv(floorDiv(MAX_TICK,tickSpacing),256);return [lo>>0,hi>>0];}
const sqrtAt=t=>Math.sqrt(Math.pow(1.0001,t));
// amounts in raw token units (float); L is uint128 as Number (relative precision ~1e-15, far below the cross-check tolerance)
function amounts(ticks,{tick,sqrtPriceX96}){
 const P=Number(sqrtPriceX96)/2**96;let L=0n,a0=0,a1=0,active=null;
 for(let i=0;i<ticks.length;i++){
  L+=ticks[i].net;if(L<0n)throw fail('V4_TICK_LIQUIDITY_NEGATIVE');
  const lower=ticks[i].tick,upper=i+1<ticks.length?ticks[i+1].tick:null;
  if(upper===null){if(L!==0n)throw fail('V4_TICK_SET_INCOMPLETE');break;}
  if(tick>=lower&&tick<upper)active=L;
  if(L===0n)continue;const l=Number(L),sa=sqrtAt(lower),sb=sqrtAt(upper);
  if(tick<lower)a0+=l*(sb-sa)/(sa*sb);
  else if(tick>=upper)a1+=l*(sb-sa);
  else{a0+=l*(sb-P)/(P*sb);a1+=l*(P-sa);}
 }
 return {amount0Raw:a0,amount1Raw:a1,activeLiquidity:active??0n};
}
async function poolPrincipal({call,getCode,stateView,poolId,key,tick,sqrtPriceX96}){
 if(!/^0x[0-9a-f]{64}$/i.test(poolId))throw fail('POOL_ID_INVALID');
 if(Number(BigInt(key.hooks)&0x0fn))throw fail('V4_HOOK_CUSTOM_ACCOUNTING');
 const spacing=Number(key.tickSpacing);if(!Number.isInteger(spacing)||spacing<1)throw fail('V4_TICK_SPACING_INVALID');
 const code=await getCode(MULTICALL);
 if(crypto.createHash('sha256').update(String(code).toLowerCase()).digest('hex')!==MULTICALL_RUNTIME_SHA256)throw fail('V4_MULTICALL_UNVERIFIED');
 const agg=async calls=>{const out=[];for(let i=0;i<calls.length;i+=BATCH){const part=calls.slice(i,i+BATCH);out.push(...decodeAggregate(await call(MULTICALL,encodeAggregate(part)),part.length));}return out;};
 const [lo,hi]=wordRange(spacing);if(hi-lo+1>MAX_WORDS)throw fail('V4_TICK_SCAN_EXCEEDS_BUDGET',{words:hi-lo+1});
 const id=poolId.slice(2).toLowerCase(),words=[];for(let p=lo;p<=hi;p++)words.push(p);
 const bitmaps=await agg(words.map(p=>({to:stateView,data:'0x'+SEL.getTickBitmap+id+w(p)})));
 const ticks=[];
 bitmaps.forEach((hex,i)=>{let b=BigInt(hex);for(let bit=0;b>0n;bit++,b>>=1n)if(b&1n){const t=((words[i]*256)+bit)*spacing;if(t<MIN_TICK||t>MAX_TICK)throw fail('V4_TICK_OUT_OF_RANGE');ticks.push(t);}});
 if(ticks.length>MAX_TICKS)throw fail('V4_TICK_SCAN_EXCEEDS_BUDGET',{ticks:ticks.length});
 if(!ticks.length)throw fail('V4_POOL_HAS_NO_LIQUIDITY');
 const tl=await agg([...ticks.map(t=>({to:stateView,data:'0x'+SEL.getTickLiquidity+id+w(t)})),{to:stateView,data:'0x'+SEL.getLiquidity+id}]);
 const rows=ticks.map((t,i)=>{const x=tl[i].slice(2).match(/.{64}/g);return {tick:t,gross:BigInt('0x'+x[0]),net:signedN(BigInt('0x'+x[1]),128)};});
 if(rows.some(r=>r.gross===0n))throw fail('V4_TICK_BITMAP_INCONSISTENT');
 const liquidity=BigInt(tl[tl.length-1]);
 const r=amounts(rows,{tick,sqrtPriceX96});
 if(r.activeLiquidity!==liquidity)throw fail('V4_ACTIVE_LIQUIDITY_MISMATCH',{reconstructed:r.activeLiquidity.toString(),stateView:liquidity.toString()});
 return {amount0Raw:r.amount0Raw,amount1Raw:r.amount1Raw,initializedTicks:ticks.length,bitmapWords:words.length,activeLiquidity:liquidity.toString(),
  proof:'sum of liquidityNet over all initialized ticks <= current tick == StateView.getLiquidity(poolId); excludes uncollected fees and hook-held balances'};
}
module.exports={poolPrincipal,amounts,encodeAggregate,decodeAggregate,wordRange,MULTICALL,SEL};
