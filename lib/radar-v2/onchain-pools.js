'use strict';
// ARCY Radar V3 — on-chain pool discovery ("Follow the DEX"). Reads factory / PoolManager creation events directly from the
// chain so Radar is not limited to a provider's first page. DISCOVERY ONLY: a creation event proves that a pool was created,
// not that the token or the DEX is safe. Unreviewed factories are listed as discovery sources and labelled as such.
// Cost is bounded per refresh (MAX_LOG_CALLS eth_getLogs + 2 block reads + MAX_SYMBOLS symbol reads); Radar responses are
// edge-cached for the provider TTL, so this runs once per cycle per network, not per visitor.
const T={
 V4_INITIALIZE:'0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438',
 V3_POOL_CREATED:'0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118',
 V2_PAIR_CREATED:'0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9'
};
const ZERO='0x0000000000000000000000000000000000000000';
// reviewed = address comes from an official deployment record already used elsewhere in ARCY; discovery = on-chain registry
// only (source unpublished or not reviewed). Both are discovery sources; neither is a safety claim.
const SOURCES=Object.freeze({
 arc:[{dex:'uniswap-v4',kind:'V4',address:'0x8366a39cc670b4001a1121b8f6a443a643e40951',status:'REVIEWED_DEPLOYMENT'},
  {dex:'synthra-arc',kind:'V3',address:'0x6307fc239c7964942c1bffe51930e55606619c74',status:'DISCOVERY_ONLY_UNREVIEWED'}],
 ethereum:[{dex:'uniswap-v3',kind:'V3',address:'0x1f98431c8ad98523631ae4a59f267346ea31f984',status:'REVIEWED_DEPLOYMENT'},
  {dex:'uniswap-v2',kind:'V2',address:'0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f',status:'REVIEWED_DEPLOYMENT'},
  {dex:'sushiswap-v2',kind:'V2',address:'0xc0aee478e3658e2610c5f7a4a2e1777ce9e4f2ac',status:'REVIEWED_DEPLOYMENT'}],
 robinhood:[{dex:'uniswap-v4',kind:'V4',address:'0x8366a39cc670b4001a1121b8f6a443a643e40951',status:'REVIEWED_DEPLOYMENT'},
  {dex:'uniswap-v3',kind:'V3',address:'0x1f7d7550b1b028f7571e69a784071f0205fd2efa',status:'REVIEWED_DEPLOYMENT'}]
});
// Quote assets: the OTHER side of a pool is the discovered token.
const QUOTES=Object.freeze({
 arc:new Set([ZERO,'0x3600000000000000000000000000000000000000']),
 ethereum:new Set([ZERO,'0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2','0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48','0xdac17f958d2ee523a2206206994597c13d831ec7','0x6b175474e89094c44da98b954eedeac495271d0f']),
 robinhood:new Set([ZERO,'0x0bd7d308f8e1639fab988df18a8011f41eacad73'])
});
// Blocks examined per network (~6 h) and the largest span one eth_getLogs may cover.
const WINDOW=Object.freeze({arc:{blocks:130000,span:5000,maxSpan:20000},ethereum:{blocks:1800,span:1800},robinhood:{blocks:215000,span:100000}});
const MAX_LOG_CALLS=12,MAX_SYMBOLS=8;
const addrOf=w=>'0x'+String(w).slice(-40).toLowerCase();
function parse(src,l){
 const t=(l.topics||[]).map(x=>String(x).toLowerCase()),data=String(l.data||'').slice(2);
 if(src.kind==='V4'){if(t[0]!==T.V4_INITIALIZE||t.length!==4)return null;return {pool:t[1],token0:addrOf(t[2]),token1:addrOf(t[3])};}
 if(src.kind==='V3'){if(t[0]!==T.V3_POOL_CREATED||t.length!==4||data.length<128)return null;return {pool:addrOf(data.slice(64,128)),token0:addrOf(t[1]),token1:addrOf(t[2])};}
 if(t[0]!==T.V2_PAIR_CREATED||t.length!==3||data.length<64)return null;return {pool:addrOf(data.slice(0,64)),token0:addrOf(t[1]),token1:addrOf(t[2])};
}
const TOPIC_OF={V4:T.V4_INITIALIZE,V3:T.V3_POOL_CREATED,V2:T.V2_PAIR_CREATED};
async function discover(network,rpc,{maxLogCalls=MAX_LOG_CALLS}={}){
 const sources=SOURCES[network]||[],w=WINDOW[network];
 if(!sources.length||!w)return {status:'NOT_CONFIGURED',pools:[],tokens:[]};
 let calls=0;const call=async(m,p)=>{calls++;return rpc(m,p);};
 const head=await call('eth_getBlockByNumber',['latest',false]);
 const H=BigInt(head.number),from=H-BigInt(w.blocks)>0n?H-BigInt(w.blocks):0n;
 // One filter for every source of the network: addresses OR-ed, creation topics OR-ed. Newest chunk first.
 const filter={address:sources.map(s=>s.address),topics:[[...new Set(sources.map(s=>TOPIC_OF[s.kind]))]]};
 const pools=[],errors=[];let ok=0,gaps=0,hi=H,lowest=H,span=BigInt(w.span);
 while(hi>=from&&calls<maxLogCalls){
  const lo=hi-span+1n<from?from:hi-span+1n;
  try{
   const logs=await call('eth_getLogs',[{...filter,fromBlock:'0x'+lo.toString(16),toBlock:'0x'+hi.toString(16)}]);
   for(const l of Array.isArray(logs)?logs:[]){
    if(l?.removed===true)continue;const src=sources.find(s=>s.address===String(l.address).toLowerCase());if(!src)continue;
    const p=parse(src,l);if(!p)continue;pools.push({...p,dex:src.dex,kind:src.kind,sourceStatus:src.status,block:Number(BigInt(l.blockNumber)),tx:String(l.transactionHash).toLowerCase()});
   }
   ok++;lowest=lo;hi=lo-1n;if(span<BigInt(w.maxSpan||w.span))span=span*2n>BigInt(w.maxSpan||w.span)?BigInt(w.maxSpan||w.span):span*2n;
  }catch(e){errors.push(String(e?.message||e).slice(0,80));
   // Narrow first; at the minimum span a failing chunk is skipped (recorded as a gap), never silently treated as empty.
   if(span>1000n)span=span/2n;else{gaps++;hi=lo-1n;}
  }
 }
 // Base token = the side that is not a quote asset. Pools between two non-quote assets keep both, base=null.
 const quotes=QUOTES[network],byToken=new Map();
 for(const p of pools){
  const q0=quotes.has(p.token0),q1=quotes.has(p.token1),base=q0&&!q1?p.token1:q1&&!q0?p.token0:null;
  if(!base)continue;
  const cur=byToken.get(base)||{address:base,pools:[],firstSeenBlock:p.block,lastSeenBlock:p.block};
  cur.pools.push({pool:p.pool,dex:p.dex,kind:p.kind,sourceStatus:p.sourceStatus,block:p.block,quote:base===p.token0?p.token1:p.token0});
  cur.firstSeenBlock=Math.min(cur.firstSeenBlock,p.block);cur.lastSeenBlock=Math.max(cur.lastSeenBlock,p.block);byToken.set(base,cur);
 }
 const tokens=[...byToken.values()].sort((a,b)=>b.lastSeenBlock-a.lastSeenBlock);
 // Symbols for the newest few only (bounded). A token that does not answer symbol() keeps symbol null.
 for(const t of tokens.slice(0,MAX_SYMBOLS)){
  try{const r=await call('eth_call',[{to:t.address,data:'0x95d89b41'},'latest']);const s=require('../../search/server/lib/eth').abiString(r);t.symbol=typeof s==='string'&&s?s.slice(0,20):null;}catch{t.symbol=null;}
 }
 let since=null;try{const b=await call('eth_getBlockByNumber',['0x'+lowest.toString(16),false]);since=new Date(Number(BigInt(b.timestamp))*1000).toISOString();}catch{}
 const bySource={};for(const p of pools)bySource[p.dex]=(bySource[p.dex]||0)+1;
 return {status:!ok?'UNAVAILABLE':lowest>from?'PARTIAL_WINDOW':'OK',network,scanned:{fromBlock:lowest.toString(),toBlock:H.toString(),since,intendedBlocks:w.blocks,calls,errors:errors.length,gaps},
  sources:sources.map(s=>({dex:s.dex,kind:s.kind,address:s.address,status:s.status})),bySource,poolCount:pools.length,tokens,
  note:'Pools discovered from on-chain creation events. Discovery is not a safety or quality signal; unreviewed factories are labelled.'};
}
module.exports={discover,parse,SOURCES,QUOTES,TOPICS:T,WINDOW,MAX_LOG_CALLS,MAX_SYMBOLS};
