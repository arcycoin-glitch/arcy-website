const core=require('./core'),budget=require('./holder-budget'),c=budget.facade(core,['rpc','call','batch']),f=require('./fields'),crypto=require('crypto');
const MULTICALL='0xca11bde05977b3631167028862be2a173976ca11';
// Exact Arc runtime compared with Sourcify's exact-match canonical deployment on chain 1.
const RUNTIME_SHA256='0fb6a9dbcc4e17098c35d4b821bfc8cc404ab2dbd195d75bee6ce914979ddbfd';
const word=n=>BigInt(n).toString(16).padStart(64,'0');
function encode(token,addresses){if(!/^0x[0-9a-f]{40}$/i.test(token)||!addresses.length||addresses.length>200||addresses.some(a=>!/^0x[0-9a-f]{40}$/i.test(a)))throw Error('Invalid balance batch');const tuples=addresses.map(a=>token.slice(2).padStart(64,'0')+word(64)+word(36)+('70a08231'+a.slice(2).padStart(64,'0')).padEnd(128,'0'));return '0x252dba42'+word(32)+word(addresses.length)+tuples.map((_,i)=>word(addresses.length*32+i*160)).join('')+tuples.join('');}
function decode(raw,count,block){if(!/^0x(?:[0-9a-f]{64})+$/i.test(raw))throw Error('Malformed multicall result');const words=raw.slice(2).match(/.{64}/g),n=i=>{if(i<0||i>=words.length)throw Error('Out of bounds');return BigInt('0x'+words[i]);},offset=i=>{const x=n(i);if(x%32n||x>BigInt(words.length*32))throw Error('Invalid offset');return Number(x/32n);};if(n(0)!==BigInt(block)||offset(1)!==2||n(2)!==BigInt(count))throw Error('Multicall identity/count mismatch');const starts=new Set();return Array.from({length:count},(_,i)=>{const start=3+offset(3+i);if(start<3+count||starts.has(start)||n(start)!==32n)throw Error('Invalid balance result');starts.add(start);const value='0x'+words[start+1];c.uint(value);return value;});}
async function balances(token,addresses,block){try{const verified=await f.cached('multicall-code:'+block,60000,async()=>{if(Number(BigInt(await c.rpc('eth_chainId',[])))!==5042)throw Error('Wrong chain');const code=await c.rpc('eth_getCode',[MULTICALL,block]);return typeof code==='string'&&crypto.createHash('sha256').update(code.toLowerCase()).digest('hex')===RUNTIME_SHA256;});if(!verified)throw Error('Unrecognized Multicall runtime');const values=[];for(let i=0;i<addresses.length;i+=200){const chunk=addresses.slice(i,i+200);values.push(...decode(await c.call(MULTICALL,encode(token,chunk),block),chunk.length,block));}return {values,method:'Source-matched Multicall aggregate / pinned Arc RPC',multicall:MULTICALL,runtimeSha256:RUNTIME_SHA256};}catch(e){
  // Budget cancellation is never a reason to start a long sequence of individual calls.
  if(e?.code==='HOLDER_WORKER_BUDGET_EXHAUSTED')throw e;
  return individual(token,addresses,block,e);}}
// Individual pinned balanceOf fallback in tiny ordered chunks. Each chunk is attempted only when it can finish before
// the slice minus a persistence reserve; the contiguous prefix read so far is returned so the caller can checkpoint it.
// Nothing is skipped or guessed: unread addresses simply stay at the cursor for the next slice.
async function individual(token,addresses,block,cause){const values=[],reserve=Math.max(500,Math.min(10000,Number(process.env.ARC_HOLDER_CHECKPOINT_RESERVE_MS)||2000)),size=Math.max(1,Math.min(50,Number(process.env.ARC_HOLDER_FALLBACK_CHUNK)||5));
 for(let i=0;i<addresses.length;i+=size){
  const room=budget.remaining()-reserve;
  if(room<=0){if(values.length)break;throw Object.assign(Error('Holder worker time slice exhausted'),{code:'HOLDER_WORKER_BUDGET_EXHAUSTED'});}
  try{const chunk=addresses.slice(i,i+size);
   values.push(...await budget.run(Number.isFinite(room)?room:2147483647,()=>c.batch(chunk.map(address=>({method:'eth_call',params:[{to:token,data:'0x70a08231'+address.slice(2).padStart(64,'0')},block]})))));}
  catch(err){if(err?.code==='HOLDER_WORKER_BUDGET_EXHAUSTED'&&values.length)break;throw err;}}
 return {values,partial:values.length<addresses.length,method:'Individual pinned Arc RPC balanceOf calls',multicallFailure:c.failure(cause)};}
module.exports={balances,encode,decode,MULTICALL,RUNTIME_SHA256};
