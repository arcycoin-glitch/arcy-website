const {AsyncLocalStorage}=require('node:async_hooks');
const networks=require('./search-chain-identity');
const chainScope=new AsyncLocalStorage(),DEFAULT_CHAIN=5042;
function chainId(){return chainScope.getStore()?.chainId||DEFAULT_CHAIN;}
function runWithChain(id,fn){const network=networks.chain(id);if(!network)throw Object.assign(Error('Unsupported chain'),{code:'UNSUPPORTED_CHAIN'});return chainScope.run({chainId:network.id},fn);}
function rpcProviders(id=chainId()){
 const config={
  5042:{primary:process.env.ARC_RPC_URL||'https://rpc.mainnet.arc.io',fallbacks:process.env.ARC_RPC_FALLBACK_URLS||'https://rpc.quicknode.mainnet.arc.io'},
  1:{primary:process.env.ETHEREUM_RPC_URL||process.env.ETH_RPC_URL||'',fallbacks:process.env.ETHEREUM_RPC_FALLBACK_URLS||process.env.ETH_RPC_FALLBACK_URLS||''},
  4663:{primary:process.env.ROBINHOOD_RPC_URL||process.env.RH_RPC_URL||'https://rpc.mainnet.chain.robinhood.com',fallbacks:process.env.ROBINHOOD_RPC_FALLBACK_URLS||process.env.RH_RPC_FALLBACK_URLS||''}
 }[id];
 if(!config)return [];
 return [...new Set([config.primary,...config.fallbacks.split(',').map(x=>x.trim()).filter(Boolean)].filter(Boolean))];
}
function chainLabel(){return networks.chain(chainId()).label;}
const BURNS = ['0x0000000000000000000000000000000000000000','0x000000000000000000000000000000000000dead'];
const health=require('./search-health'),jsonPending=new Map();
async function readJson(url,options,retry){for(let attempt=0;;attempt++){try{const r=await fetch(url,{...options,signal:AbortSignal.timeout(8000)});if(!r.ok){const e=new Error(`HTTP ${r.status}`);e.httpStatus=r.status;if(r.status===429)health.record('EXTERNAL_PROVIDER_RATE_LIMITED',{httpStatus:429});throw e;}try{return await r.json();}catch{throw Object.assign(Error('Malformed JSON response'),{code:'MALFORMED_JSON',httpStatus:r.status});}}catch(e){if(!retry||attempt>=1||!([429,502,503,504].includes(e.httpStatus)||['TimeoutError','AbortError','TypeError'].includes(e.name)))throw e;await new Promise(r=>setTimeout(r,500));}}}
function json(url,options={}){const get=!options.method||options.method==='GET';if(!get)return readJson(url,options,false);const key=JSON.stringify([url,options.headers||null]);if(jsonPending.has(key))return jsonPending.get(key);const promise=readJson(url,options,true).finally(()=>jsonPending.delete(key));jsonPending.set(key,promise);return promise;}

const providerChecks=new Map(),nextRpcAt=new Map();
async function pace(count){const id=chainId(),now=Date.now(),next=nextRpcAt.get(id)||0,delay=Math.max(0,next-now),intervalName=id===5042?'ARC_RPC_MIN_INTERVAL_MS':id===1?'ETH_RPC_MIN_INTERVAL_MS':'ROBINHOOD_RPC_MIN_INTERVAL_MS',interval=Number(process.env[intervalName])||250;nextRpcAt.set(id,Math.max(now,next)+count*interval);if(delay)await new Promise(r=>setTimeout(r,delay));}

async function transport(payload){
 const id=chainId(),providers=rpcProviders(id);if(!providers.length)throw Object.assign(Error('No RPC endpoint configured for '+chainLabel()),{code:'RPC_NOT_CONFIGURED'});let last;
 for(const endpoint of [...new Set(providers)]){try{
  const checkKey=id+':'+endpoint,checked=providerChecks.get(checkKey);if(!checked||checked<Date.now()){const identity=await json(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]})});if(identity.error||!/^0x[0-9a-f]+$/i.test(identity.result||'')||Number(BigInt(identity.result))!==id)throw Object.assign(Error(),{code:'CHAIN_ID_MISMATCH'});providerChecks.set(checkKey,Date.now()+60000);}
  await pace(Array.isArray(payload)?payload.length:1);const d=await json(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  if(Array.isArray(payload)){if(!Array.isArray(d)||d.length!==payload.length||new Set(d.map(x=>x?.id)).size!==payload.length||payload.some(p=>!d.some(x=>x?.id===p.id&&(Object.hasOwn(x,'result')||x.error))))throw Object.assign(Error(),{code:'MALFORMED_RPC_BATCH'});}
  else if(!d||Array.isArray(d)||d.id!==payload.id||(!Object.hasOwn(d,'result')&&!d.error))throw Object.assign(Error(),{code:'MALFORMED_RPC_RESPONSE'});
  const errors=(Array.isArray(d)?d:[d]).filter(x=>x?.error).map(x=>x.error);
  const limited=errors.find(e=>[-32005,-32016].includes(e.code)||/rate.limit|too many|request limit|limit exceeded|quota|capacity/i.test(e.message||''));
  const range=errors.find(e=>/pruned|block range|range.*(?:large|limit|exceed)|history unavailable|too many (?:logs|results)|query returned more/i.test(e.message||''));
  if(range||limited){health.record(range?'RPC_RANGE_LIMITED':'RPC_RATE_LIMITED');throw Object.assign(Error('RPC provider limit'),{code:range?'RPC_RANGE_LIMIT':'RPC_RATE_LIMIT',rpcCode:(range||limited).code});}
  if(endpoint!==providers[0])health.record('RPC_FALLBACK_USED');return d;
 }catch(e){if(!last||e.code!=='CHAIN_ID_MISMATCH')last=e;}}
 throw last||Error('No RPC provider');
}

const pending=new Map(),waiters=[];let active=0;
async function send(method,params){
  if(active>=4)await new Promise(resolve=>waiters.push(resolve));else active++;
  try{for(let attempt=0;attempt<3;attempt++){try{
    const d=await transport({jsonrpc:'2.0',id:1,method,params});
    if(!d||d.id!==1||d.error||!Object.hasOwn(d,'result')){const e=new Error('RPC unavailable');e.rpcCode=d?.error?.code;e.code=/revert/i.test(d?.error?.message||'')?'GETTER_REVERTED':d?.error?'RPC_CALL_FAILED':'MALFORMED_RPC_RESPONSE';throw e;}return d.result;
  }catch(e){if(attempt===2||!(e.code==='RPC_RATE_LIMIT'||['TimeoutError','AbortError'].includes(e.name)||[429,502,503,504].includes(e.httpStatus)))throw e;await new Promise(r=>setTimeout(r,250*2**attempt));}}}
  finally{const next=waiters.shift();if(next)next();else active--;}
}
function rpc(method,params){const key=JSON.stringify([chainId(),method,params]);if(pending.has(key))return pending.get(key);const p=(process.env.ARC_HOLDER_WORKER_RPC==='1'?require('./holder-rpc').current().rpc(method,params):send(method,params)).finally(()=>pending.delete(key));pending.set(key,p);return p;}
function uint(h) { if(!/^0x[0-9a-fA-F]{64}$/.test(h)) throw new Error('Invalid ABI word'); return BigInt(h); }
function units(n,d) {const s=n.toString().padStart(d+1,'0'); return d ? (s.slice(0,-d)+'.'+s.slice(-d)).replace(/\.?0+$/,'') || '0':s;}
function addressWord(h) {uint(h); if(!/^0x0{24}/i.test(h)) throw new Error('Invalid address word'); return '0x'+h.slice(-40).toLowerCase();}
function string(h) {
  if(!/^0x(?:[0-9a-f]{2})+$/i.test(h)) return null;
  const b=Buffer.from(h.slice(2),'hex');
  if(b.length===32) return b.toString('utf8').replace(/\0+$/,'');
  if(b.length<64) return null;
  const o=Number(BigInt('0x'+b.subarray(0,32).toString('hex')));
  if(!Number.isSafeInteger(o)||o+32>b.length) return null;
  const l=Number(BigInt('0x'+b.subarray(o,o+32).toString('hex')));
  return Number.isSafeInteger(l)&&l<=4096&&o+32+l<=b.length ? b.subarray(o+32,o+32+l).toString('utf8'):null;
}
const call=(a,data,block)=>rpc('eth_call',[{to:a,data},block]);
async function context(a) {
  if(Number(BigInt(await rpc('eth_chainId',[])))!==chainId()){const e=new Error('Wrong chain');e.code='CHAIN_ID_MISMATCH';throw e;}
  const block=await rpc('eth_blockNumber',[]);
  const code=await rpc('eth_getCode',[a,block]);
  if(!/^0x(?:[0-9a-f]{2})+$/i.test(code)){const e=new Error('No contract');e.code=code==='0x'?'NO_CONTRACT':'MALFORMED_RPC_RESPONSE';throw e;}
  return {block,code};
}
const unknown=(reason='Reliable evidence unavailable',reasonCode='INSUFFICIENT_EVIDENCE',dataState='NOT_VERIFIED')=>({value:null,status:'NOT_VERIFIED',dataState,reasonCode,evidence:[],reason,source:null,confidence:'NONE'});
const fact=(value,evidence,status='ON_CHAIN')=>({value,status,dataState:'DATA_FOUND',evidence,source:evidence.find(x=>x.source)?.source||chainLabel()+' RPC',confidence:['GETTER_REPORTED','INTERFACE_REPORTED'].includes(status)?'MEDIUM':'HIGH',reason:null});
function failure(e){return {dataState:e.code==='NO_CONTRACT'?'SOURCE_HAS_NO_DATA':['CHAIN_ID_MISMATCH','GETTER_REVERTED','HOLDER_SUPPLY_RECONCILIATION_FAILED','TRANSFER_HISTORY_INCONSISTENT','LOG_RESPONSE_POSSIBLY_TRUNCATED'].includes(e.code)?'NOT_VERIFIED':'SOURCE_API_FAILED',reasonCode:e.code|| (e.httpStatus?'UPSTREAM_HTTP_ERROR':'UPSTREAM_UNAVAILABLE'),httpStatus:e.httpStatus||null,rpcCode:e.rpcCode??null};}
function route(fn) {return async(req,res)=>{
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  if(req.method && req.method!=='GET') return res.status(405).json({ok:false,error:'GET required'});
  const a=String(req.query.address || req.query.token || '').trim().toLowerCase();
  if(!/^0x[0-9a-f]{40}$/.test(a)) return res.status(400).json({ok:false,error:'Valid contract address required'});
  const requested=req.query.chainId??req.query.chain_id??chainId(),network=networks.chain(requested);
  if(!network)return res.status(400).json({ok:false,error:'Supported chainId required'});
  return runWithChain(network.id,async()=>{
   try {return res.status(200).json({ok:true,address:a,chainId:network.id,network:network.key,scannedAt:new Date().toISOString(),...await fn(a,req)});}
   catch(e) {return res.status(200).json({ok:false,address:a,chainId:network.id,network:network.key,status:'NOT_VERIFIED',error:'DATA UNAVAILABLE',...failure(e)});}
  });
};}
async function batch(calls){
 if(process.env.ARC_HOLDER_WORKER_RPC==='1')return require('./holder-rpc').current().batch(calls);
 if(!Array.isArray(calls)||calls.length>100||!calls.length)throw Error('RPC batch must contain 1-100 calls');if(calls.length>10){const out=[];for(let i=0;i<calls.length;i+=10)out.push(...await batch(calls.slice(i,i+10)));return out;}
 const request=calls.map((x,i)=>({jsonrpc:'2.0',id:i+1,method:x.method,params:x.params}));
 let response;for(let attempt=0;attempt<3;attempt++){try{response=await transport(request);break;}catch(e){if(attempt===2)throw e;await new Promise(r=>setTimeout(r,1000));}}
 if(!Array.isArray(response)||response.length!==calls.length||new Set(response.map(x=>x.id)).size!==calls.length)throw Object.assign(Error('Invalid RPC batch'),{code:'MALFORMED_RPC_BATCH'});
 return request.map(x=>{const r=response.find(y=>y.id===x.id);if(!r||r.error||!Object.hasOwn(r,'result'))throw Object.assign(Error('RPC batch item failed'),{code:'RPC_BATCH_ITEM_FAILED',rpcCode:r?.error?.code});return r.result;});
}
const exported={BURNS,json,rpc,batch,uint,units,addressWord,string,call,context,unknown,fact,route,failure,chainId,chainLabel,runWithChain,rpcProviders};
Object.defineProperties(exported,{RPC:{enumerable:true,get:()=>rpcProviders()[0]||null},CHAIN:{enumerable:true,get:chainId}});
module.exports=exported;
