'use strict';
// Synthetic chain shared by Market Radar tests: speaks real JSON-RPC / ABI shapes.
const keccak=require('../lib/keccak');
const onchain=require('../lib/market-radar-onchain');
const {CHAINS,SWAP_TOPIC,SEL}=onchain;
const ZERO='0x'+'0'.repeat(40);
const w=(n)=>(BigInt(n)<0n?(1n<<256n)+BigInt(n):BigInt(n)).toString(16).padStart(64,'0');
const a32=(a)=>a.slice(2).padStart(64,'0');
const tokenAddr=i=>'0x'+i.toString(16).padStart(40,'0');
const b32=(text)=>'0x'+Buffer.from(text).toString('hex').padEnd(64,'0');
const sqrtOf=ratio=>BigInt(Math.floor(Math.sqrt(ratio)*2**96));

// ---- synthetic chain ------------------------------------------------------
function makeChain(network,{head=1000000,blockSeconds=12,tokens={},pools=[],feedAnswers={},staleFeeds=false,failLogsAtSingle=false,
  badLogs=[],chainId,brokenKeys=new Set(),usdc,weth}={}){
 const cfg=CHAINS[network],nowSec=Math.floor(Date.now()/1000);
 const ts=b=>nowSec-(head-b)*blockSeconds;
 const keyOf=p=>'0x'+a32(p.c0)+a32(p.c1)+w(p.fee||3000)+w(p.spacing||60)+a32(p.hooks||ZERO);
 const ids=new Map();for(const p of pools){p.id=keccak(Buffer.from(keyOf(p).slice(2),'hex'));ids.set(p.id.slice(2,52),p);}
 const logs=[];let logIndex=0;
 for(const p of pools)for(const s of p.swaps){
  logs.push({address:cfg.poolManager,topics:[SWAP_TOPIC,p.id,'0x'+a32('0x'+'ab'.repeat(20))],
   data:'0x'+w(s.a0)+w(s.a1)+w(s.sqrt)+w(1000)+w(0)+w(3000),blockNumber:'0x'+s.block.toString(16),logIndex:'0x'+(logIndex++).toString(16),
   transactionHash:'0x'+(logIndex).toString(16).padStart(64,'0'),removed:false});
 }
 logs.push(...badLogs);
 const calls={logs:0,coingecko:0,total:0};
 const feedRound=(ans)=>'0x'+w(1)+w(ans)+w(0)+w(nowSec-(staleFeeds?400000:60))+w(1);
 const feeds={'0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419':feedAnswers.ETH??300000000000n,'0x8fffffd4afb6115b954bd326cbe7b4ba576818f6':feedAnswers.USDC??99990000n};
 return async function fetcher(url,init){
  calls.total++;
  if(String(url).includes('coingecko'))calls.coingecko++;
  const req=JSON.parse(init.body),{method,params}=req;
  const reply=result=>({ok:true,json:async()=>({jsonrpc:'2.0',id:req.id,result})});
  const err=message=>({ok:true,json:async()=>({jsonrpc:'2.0',id:req.id,error:{code:-32000,message}})});
  const isEthSide=String(url).includes('publicnode')&&network!=='ethereum';
  if(method==='eth_chainId')return reply('0x'+(isEthSide?1:(chainId??cfg.chainId)).toString(16));
  if(method==='eth_getBlockByNumber'){
   const b=params[0]==='latest'?head:Number(BigInt(params[0]));
   return reply({number:'0x'+b.toString(16),timestamp:'0x'+ts(b).toString(16)});
  }
  if(method==='eth_getLogs'){
   calls.logs++;
   const f=params[0],from=Number(BigInt(f.fromBlock)),to=Number(BigInt(f.toBlock));
   if(failLogsAtSingle)return err('query returned more than 10000 results');
   return reply(logs.filter(l=>{const b=Number(BigInt(l.blockNumber));return b>=from&&b<=to;}));
  }
  if(method==='eth_call'){
   const {to,data}=params[0],target=String(to).toLowerCase();
   if(feeds[target]!==undefined){
    if(data===SEL.decimals)return reply('0x'+w(8));
    return reply(feedRound(feeds[target]));
   }
   if(target===cfg.positionManager&&data.startsWith(SEL.poolKeys)){
    const p=ids.get(data.slice(10,60));if(!p||brokenKeys.has(p.id))return reply('0x');
    return reply(brokenKeys.has('wrong:'+p.id)?'0x'+w(1).repeat(5):keyOf(p));
   }
   if(cfg.bridgedUsdc&&target===cfg.bridgedUsdc.router&&data.startsWith(SEL.calculateL2TokenAddress))return reply('0x'+a32(usdc));
   const meta=tokens[target]||(weth&&target===weth.address?weth:null)||(usdc&&target===usdc?{decimals:6,symbol:'USDC',name:'USD Coin'}:null);
   if(meta){
    if(data===SEL.decimals)return meta.decimals===null?err('execution reverted'):reply('0x'+w(meta.decimals));
    if(data===SEL.symbol)return meta.symbol===null?err('execution reverted'):reply(b32(meta.symbol));
    if(data===SEL.name)return reply(b32(meta.name||meta.symbol||''));
   }
   if(network==='ethereum'&&(target==='0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'||target==='0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2')){
    const six=target.startsWith('0xa0');
    if(data===SEL.decimals)return reply('0x'+w(six?6:18));
    if(data===SEL.symbol)return reply(b32(six?'USDC':'WETH'));
   }
   return err('execution reverted');
  }
  return err('method not found');
 };
}
const USDC_ETH='0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
// Token (18 dec) priced `price` USDC, token = currency0 (lower address than USDC).
function usdcPool(i,usdcVol,{price=2,swaps=2,usdcAddr=USDC_ETH,block0=999000,tokenIsZero=true}={}){
 const t=tokenAddr(i),half=Math.round(usdcVol/swaps*1e6);
 const sw=[];
 for(let k=0;k<swaps;k++){
  const p=price*(1+k*0.1); // price rises 10% per swap
  const tokenRaw=BigInt(Math.round(half/p/1e6*1e18));
  const ratio=tokenIsZero?(half/Number(tokenRaw)):(Number(tokenRaw)/half);
  sw.push(tokenIsZero?{a0:-tokenRaw,a1:BigInt(half),sqrt:sqrtOf(ratio),block:block0+k*10}:{a0:BigInt(half),a1:-tokenRaw,sqrt:sqrtOf(ratio),block:block0+k*10});
 }
 return tokenIsZero?{c0:t,c1:usdcAddr,swaps:sw}:{c0:usdcAddr,c1:t,swaps:sw};
}
const tokenMeta=(n)=>Object.fromEntries(Array.from({length:n},(_,k)=>[tokenAddr(k+1),{decimals:18,symbol:'TK'+(k+1),name:'Token '+(k+1)}]));
module.exports={ZERO,w,a32,tokenAddr,b32,sqrtOf,makeChain,USDC_ETH,usdcPool,tokenMeta};
