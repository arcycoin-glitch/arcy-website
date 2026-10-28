'use strict';
const CHAIN_ID=1;
function resolveRpcUrl(value){
  let url;
  try{url=new URL(value)}catch{throw Error('ETH_RPC_URL must be a valid HTTPS URL or loopback HTTP URL')}
  const host=url.hostname.replace(/^\[|\]$/g,'').toLowerCase();
  const loopback=['localhost','127.0.0.1','::1'].includes(host);
  if(url.username||url.password||!(url.protocol==='https:'||(url.protocol==='http:'&&loopback)))throw Error('ETH_RPC_URL must use HTTPS (or loopback HTTP) and cannot contain URL credentials');
  return url.toString();
}
const RPC_URL=resolveRpcUrl(process.env.ETH_RPC_URL||'https://ethereum-rpc.publicnode.com');
const DEFAULT_FALLBACK='https://eth.drpc.org';
function providers(env=process.env){
 const primary=resolveRpcUrl(env.ETH_RPC_URL||'https://ethereum-rpc.publicnode.com');
 const backup=env.ETH_RPC_FALLBACK_URL==='disabled'?null:
  resolveRpcUrl(env.ETH_RPC_FALLBACK_URL||DEFAULT_FALLBACK);
 return backup&&backup!==primary?[primary,backup]:[primary];
}
const BURN=['0x0000000000000000000000000000000000000000','0x000000000000000000000000000000000000dead'];
const ADDRESS=/^0x[0-9a-fA-F]{40}$/;
const {readJson}=require('./http');
let rpcId=0;
function retryable(error){
 return Boolean(error?.retryable)||[403,429,502,503,504].includes(error?.httpStatus)||
  error?.code==='RPC_RATE_LIMIT'||['TypeError','AbortError','TimeoutError'].includes(error?.name);
}
async function rawRpc(endpoint,method,params,{timeoutMs=12000}={}){
  const id=++rpcId;
  // Ref-counted timeout: Node's unref'd AbortSignal.timeout can leave promises unresolved in CI.
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(new DOMException('RPC request timed out','TimeoutError')),timeoutMs);
  let response,result;
  const deadline=Date.now()+timeoutMs;
  try{
   for(let attempt=0;;attempt++){
    try{
     response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params}),signal:controller.signal});
     if(!response.ok){await response.body?.cancel?.();throw Object.assign(Error('Ethereum RPC HTTP '+response.status),{httpStatus:response.status,code:'RPC_HTTP_ERROR'})}
     result=await readJson(response,1024*1024);
     if([-32005,-32016].includes(result?.error?.code))throw Object.assign(Error('Ethereum RPC rate limited'),{code:'RPC_RATE_LIMIT'});
     break;
    }catch(error){
     if(attempt>=1||!retryable(error)||controller.signal.aborted)throw error;
     const raw=response?.headers?.get?.('retry-after');
     const retry=raw?(Number.isFinite(Number(raw))?Number(raw)*1000:Date.parse(raw)-Date.now()):250;
     const delay=Math.max(250,Number.isFinite(retry)?retry:250);
     if(Date.now()+delay>=deadline)throw error;
     await new Promise(resolve=>setTimeout(resolve,delay));
    }
   }
  }finally{clearTimeout(timer)}
  if(!result||typeof result!=='object'||Array.isArray(result)||result.jsonrpc!=='2.0'||result.id!==id)throw Error('Ethereum RPC response identity mismatch');
  if(result.error)throw Error('Ethereum RPC method failed: '+method+(Number.isInteger(result.error.code)?' ('+result.error.code+')':''));
  if(!Object.hasOwn(result,'result'))throw Error('Ethereum RPC response missing result: '+method);
  return result.result;
}
function requestAt(endpoint,method,params,options={}){
 return require('./analysis-scope').read('ethereum',endpoint,method,params,options,()=>rawRpc(endpoint,method,params,options));
}
async function rpc(method,params,options={}){
 const scope=require('./analysis-scope'),pinned=scope.pinnedProvider('ethereum');
 const endpoints=pinned?[pinned]:providers();let last;
 for(let i=0;i<endpoints.length;i++){
  try{
   if(i>0&&method!=='eth_chainId')require('./chains').verifyChainId('ethereum',await requestAt(endpoints[i],'eth_chainId',[],options));
   const value=await requestAt(endpoints[i],method,params,options);
   if(i>0&&method==='eth_chainId')require('./chains').verifyChainId('ethereum',value);
   return value;
  }catch(error){last=error;if(!retryable(error))throw error;}
 }
 throw last;
}
function uint(hex){
  if(typeof hex!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(hex))throw Error('Invalid 32-byte ABI result');
  return BigInt(hex);
}
function units(raw,decimals){
  if(!Number.isInteger(decimals)||decimals<0||decimals>36)throw Error('Invalid token decimals');
  const s=raw.toString().padStart(decimals+1,'0');
  return decimals?(s.slice(0,-decimals)+'.'+s.slice(-decimals)).replace(/\.?0+$/,'')||'0':s;
}
function abiString(hex){
  if(typeof hex!=='string'||!/^0x(?:[0-9a-fA-F]{2})+$/.test(hex))return null;
  const bytes=Buffer.from(hex.slice(2),'hex');
  if(bytes.length===32)return bytes.toString('utf8').replace(/\0+$/,'').trim()||null;
  if(bytes.length<64)return null;
  const offset=Number(BigInt('0x'+bytes.subarray(0,32).toString('hex')));
  if(!Number.isSafeInteger(offset)||offset<32||offset+32>bytes.length)return null;
  const len=Number(BigInt('0x'+bytes.subarray(offset,offset+32).toString('hex')));
  return Number.isSafeInteger(len)&&len>=0&&len<=512&&offset+32+len<=bytes.length?bytes.subarray(offset+32,offset+32+len).toString('utf8').trim()||null:null;
}
const status=(value,method,block)=>({value,status:'ON_CHAIN',source:'Ethereum RPC',method,block});
const unknown=reason=>({value:null,status:'NOT_VERIFIED',source:null,reason});
async function inspectAt(endpoint,address){
  const callRpc=(method,params)=>requestAt(endpoint,method,params);
  const chain=await callRpc('eth_chainId',[]);
  require('./chains').verifyChainId('ethereum',chain);
  const block=await callRpc('eth_blockNumber',[]);
  if(!/^0x[0-9a-f]+$/i.test(block))throw Error('Invalid Ethereum block');
  const normalized=address.toLowerCase();
  const code=await callRpc('eth_getCode',[normalized,block]);
  if(code==='0x')throw Error('No contract deployed at this address');
  if(typeof code!=='string'||!/^0x[0-9a-fA-F]+$/.test(code))throw Error('Invalid contract bytecode');
  const call=data=>callRpc('eth_call',[{to:normalized,data},block]);
  // All getters use the already verified chain, code and pinned block.
  const [s,d,addresses,names]=await Promise.all([
    call('0x18160ddd'),call('0x313ce567'),
    Promise.allSettled(BURN.map(a=>call('0x70a08231'+a.slice(2).padStart(64,'0')).then(uint))),
    Promise.allSettled([call('0x06fdde03'),call('0x95d89b41')])
  ]);
  const raw=uint(s),decimals=Number(uint(d));
  const supply=status(units(raw,decimals),'totalSupply()',block);
  const burnRaw=addresses.every(x=>x.status==='fulfilled')?addresses.reduce((n,x)=>n+x.value,0n):null;
  const burn=burnRaw!==null?status(units(burnRaw,decimals),'balanceOf(zero/dead)',block):unknown('One or both standard burn-address balances were unavailable.');
  const name=names[0].status==='fulfilled'?abiString(names[0].value):null;
  const symbol=names[1].status==='fulfilled'?abiString(names[1].value):null;
  return {
    ok:true,chainId:CHAIN_ID,address:normalized,block,scannedAt:new Date().toISOString(),token:{name,symbol,decimals},totalSupplyRaw:raw.toString(),burnAddressRaw:burnRaw?.toString()??null,
    fields:{
      totalSupply:supply,burnAddressBalance:burn,
      circulatingSupply:unknown('On-chain total supply is not verified circulating supply. External contract-matched evidence is required.')
    },
    methodology:'Read-only calls at one Ethereum block. Burn balance is current custody at 0x0 and 0xdead; not lifetime burned or verified buyback activity.'
  };
}
async function inspect(address){
 if(!ADDRESS.test(address))throw Error('Invalid Ethereum contract address');
 let last;
 for(const endpoint of providers()){
  try{
   const result=await inspectAt(endpoint,address);
   require('./analysis-scope').pinProvider('ethereum',endpoint);
   return result;
  }catch(error){last=error;if(!retryable(error))throw error;}
 }
 throw last;
}
module.exports={CHAIN_ID,BURN,ADDRESS,RPC_URL,resolveRpcUrl,providers,retryable,requestAt,rpc,uint,units,abiString,inspect,inspectAt};
