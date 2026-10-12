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
const BURN=['0x0000000000000000000000000000000000000000','0x000000000000000000000000000000000000dead'];
const ADDRESS=/^0x[0-9a-fA-F]{40}$/;
const {readJson}=require('./http');
let rpcId=0;
async function rpc(method,params,{timeoutMs=12000}={}){
  const id=++rpcId;
  // Ref-counted timeout: Node's unref'd AbortSignal.timeout can leave promises unresolved in CI.
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(new DOMException('RPC request timed out','TimeoutError')),timeoutMs);
  let response;
  try{response=await fetch(RPC_URL,{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({jsonrpc:'2.0',id,method,params}),signal:controller.signal})}
  finally{clearTimeout(timer)}
  if(!response.ok)throw Error('Ethereum RPC HTTP '+response.status);
  const result=await readJson(response,1024*1024);
  if(!result||typeof result!=='object'||Array.isArray(result)||result.jsonrpc!=='2.0'||result.id!==id)throw Error('Ethereum RPC response identity mismatch');
  if(result.error)throw Error('Ethereum RPC method failed: '+method+(Number.isInteger(result.error.code)?' ('+result.error.code+')':''));
  if(!Object.hasOwn(result,'result'))throw Error('Ethereum RPC response missing result: '+method);
  return result.result;
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
async function inspect(address){
  if(!ADDRESS.test(address))throw Error('Invalid Ethereum contract address');
  const normalized=address.toLowerCase();
  const chain=await rpc('eth_chainId',[]);
  if(Number(BigInt(chain))!==CHAIN_ID)throw Error('RPC chain ID is not Ethereum mainnet');
  const block=await rpc('eth_blockNumber',[]);
  const code=await rpc('eth_getCode',[normalized,block]);
  if(code==='0x')throw Error('No contract deployed at this address');
  if(typeof code!=='string'||!/^0x[0-9a-fA-F]+$/.test(code))throw Error('Invalid contract bytecode');
  const call=data=>rpc('eth_call',[{to:normalized,data},block]);
  const [s,d]=await Promise.all([call('0x18160ddd'),call('0x313ce567')]);
  const raw=uint(s);
  const decimals=Number(uint(d));
  const supply=status(units(raw,decimals),'totalSupply()',block);
  const addresses=await Promise.allSettled(BURN.map(a=>call('0x70a08231'+a.slice(2).padStart(64,'0')).then(uint)));
  const burnRaw=addresses.every(x=>x.status==='fulfilled')?addresses.reduce((n,x)=>n+x.value,0n):null;
  const burn=burnRaw!==null?status(units(burnRaw,decimals),'balanceOf(zero/dead)',block):unknown('One or both standard burn-address balances were unavailable.');
  const [nameResult,symbolResult]=await Promise.allSettled([call('0x06fdde03'),call('0x95d89b41')]);
  const name=nameResult.status==='fulfilled'?abiString(nameResult.value):null;
  const symbol=symbolResult.status==='fulfilled'?abiString(symbolResult.value):null;
  return {
    ok:true,chainId:CHAIN_ID,address:normalized,block,scannedAt:new Date().toISOString(),token:{name,symbol,decimals},totalSupplyRaw:raw.toString(),burnAddressRaw:burnRaw?.toString()??null,
    fields:{
      totalSupply:supply,burnAddressBalance:burn,
      circulatingSupply:unknown('On-chain total supply is not verified circulating supply. External contract-matched evidence is required.')
    },
    methodology:'Read-only calls at one Ethereum block. Burn balance is current custody at 0x0 and 0xdead; not lifetime burned or verified buyback activity.'
  };
}
module.exports={CHAIN_ID,BURN,ADDRESS,RPC_URL,resolveRpcUrl,rpc,uint,units,abiString,inspect};
