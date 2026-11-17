'use strict';
// #262 read-only: verify Ethereum Uniswap V4 deployments on-chain and how V4 PoolIds of real tokens resolve to PoolKeys.
const eth=require('../search/server/lib/eth').rpc,keccak=require('../lib/keccak'),v4=require('../lib/liquidity-exit-v4');
const PM='0x000000000004444c5dc75cb358380d2e3de08a90',POSM='0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e',SV='0x7ffe42c4a5deea5b0fec41c94c136cf115597227',Q='0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203';
const INIT='0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438';
const out=(k,v)=>console.log('V4 '+k+' '+JSON.stringify(v));const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const J=async u=>{const r=await fetch(u,{headers:{accept:'application/json'},signal:AbortSignal.timeout(20000)});return r.ok?r.json():{status:r.status};};
const h=x=>{const r=keccak(Buffer.from(x.slice(2),'hex'));return typeof r==='string'?r.toLowerCase():'0x'+Buffer.from(r).toString('hex');};
const word=v=>BigInt(v).toString(16).padStart(64,'0'),aw=a=>a.slice(2).toLowerCase().padStart(64,'0'),iw=v=>(BigInt(v)<0n?(1n<<256n)+BigInt(v):BigInt(v)).toString(16).padStart(64,'0');
(async()=>{
 const head=await eth('eth_blockNumber',[]);
 for(const [k,a] of Object.entries({PoolManager:PM,PositionManager:POSM,StateView:SV,Quoter:Q})){const c=await eth('eth_getCode',[a,head]);out('code',{k,a,bytes:(c.length-2)/2});}
 for(const [k,a] of [['PositionManager',POSM],['StateView',SV],['Quoter',Q]]){const r=await eth('eth_call',[{to:a,data:'0xdc4c90d3'},head]).catch(e=>'ERR '+e.message);out('poolManager()',{k,returns:typeof r==='string'?'0x'+r.slice(-40):r,equalsPM:typeof r==='string'&&('0x'+r.slice(-40)).toLowerCase()===PM});}
 const s=await J('https://api.geckoterminal.com/api/v2/search/pools?query=WASTED&network=eth&include=base_token,dex');
 const pools=(s.data||[]).map(p=>({id:p.attributes.address,name:p.attributes.name,dex:p.relationships?.dex?.data?.id,base:p.relationships?.base_token?.data?.id,created:p.attributes.pool_created_at,tx24:(p.attributes.transactions?.h24?.buys||0)+(p.attributes.transactions?.h24?.sells||0),liq:Math.round(+p.attributes.reserve_in_usd||0)}));
 out('wasted-search',{status:s.status||200,pools});
 const cands=pools.filter(p=>/^0x[0-9a-f]{64}$/.test(p.id)).slice(0,6);
 for(const p of cands){
  await sleep(1500);
  // 1) PositionManager.poolKeys(bytes25)
  let viaPosm=null;try{const raw=await eth('eth_call',[{to:POSM,data:v4.poolKeyData(p.id)},head]);const k=v4.decodePoolKey(raw,p.id);viaPosm={c0:k.currency0,c1:k.currency1,fee:k.fee,hooks:k.hooks};}catch(e){viaPosm={error:e.code||e.message.slice(0,60)};}
  // 2) PoolManager Initialize(id) near the provider-reported creation time (provider is only a search hint)
  let viaInit=null;
  try{
   const created=Date.parse(p.created);const headN=Number(BigInt(head)),headTs=Number(BigInt((await eth('eth_getBlockByNumber',[head,false])).timestamp));
   const est=headN-Math.round((headTs-created/1000)/12);const from=Math.max(0,est-1500),to=Math.min(headN,est+1500);
   const logs=await eth('eth_getLogs',[{address:PM,topics:[INIT,p.id],fromBlock:'0x'+from.toString(16),toBlock:'0x'+to.toString(16)}]);
   if(logs.length){const l=logs[0],d=l.data.slice(2),w=i=>d.slice(i*64,(i+1)*64);
    const c0='0x'+l.topics[2].slice(26),c1='0x'+l.topics[3].slice(26),fee=Number(BigInt('0x'+w(0))),ts=BigInt('0x'+w(1)),tick=ts>=(1n<<255n)?ts-(1n<<256n):ts,hooks='0x'+w(2).slice(24);
    const id=v4.poolIdForKey({currency0:c0,currency1:c1,fee,tickSpacing:Number(tick),hooks});
    viaInit={block:Number(BigInt(l.blockNumber)),c0,c1,fee,tickSpacing:Number(tick),hooks,keyHashMatchesPoolId:id===p.id};}
   else viaInit={found:false,range:[from,to]};
  }catch(e){viaInit={error:String(e.message).slice(0,80)};}
  out('pool',{pool:p.id,name:p.name,dex:p.dex,tx24:p.tx24,viaPositionManager:viaPosm,viaInitialize:viaInit});
 }
})().catch(e=>out('error',{e:String(e.stack).slice(0,300)}));
// Cross-check this branch's Live Trading rows for WASTED (Ethereum V4) against the provider's own trade feed (tx/side/wallet).
(async()=>{await new Promise(r=>setTimeout(r,20000));
 const lt=require('../search/server/lib/live-trades');
 const r=await lt.analyze({network:'ethereum',address:'0x0f08046cf0f51616be643f8434232c51c2189edc'});
 const pools=[...new Set((r.trades||[]).map(t=>t.pool))];const gt=new Map();
 for(const p of pools){const g=await J('https://api.geckoterminal.com/api/v2/networks/eth/pools/'+p+'/trades');for(const x of g.data||[])gt.set(String(x.attributes.tx_hash).toLowerCase(),x.attributes);}
 const rows=(r.trades||[]).map(t=>{const g=gt.get(t.txHash);return {tx:t.txHash,block:t.block,side:t.side,wallet:t.wallet,token:t.tokenAmount,counter:t.counterAmount+' '+t.counterSymbol,usd:t.usd,provider:g?{kind:g.kind,from:String(g.tx_from_address).toLowerCase(),usd:Number(g.volume_in_usd).toFixed(2)}:null};});
 const checked=rows.filter(x=>x.provider);
 out('wasted-crosscheck',{status:r.status,pools:r.pools,excluded:r.excludedPools,rpc:r.cost?.rpcCalls,n:rows.length,providerChecked:checked.length,
  sideAgree:checked.filter(x=>x.side.toLowerCase()===x.provider.kind).length,walletAgree:checked.filter(x=>x.wallet===x.provider.from).length,
  dupTxLog:rows.length-new Set((r.trades||[]).map(t=>t.txHash+':'+t.logIndex)).size});
 for(const x of rows.slice(0,8))out('wasted-row',x);
})().catch(e=>out('xerror',{e:String(e.stack).slice(0,300)}));
