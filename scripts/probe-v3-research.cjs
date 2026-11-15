'use strict';
// Read-only V3 research probe (CI only): (1) Synthra/POLL pool architecture — code identity vs canonical UniswapV3Pool,
// events actually emitted, the transactions behind provider-reported trades; (2) exact CoinGecko identities and
// reachable images for the Unlocks tokens missing from assets/unlock-logos.json. No writes, no keys.
const arc=require('../search/server/lib/arc-rpc').rpc;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const note=(t,o)=>console.log('::notice title='+t+'::'+JSON.stringify(o).slice(0,3900));
const J=async(u,o={})=>{for(let i=0;i<3;i++){try{const r=await fetch(u,{headers:{accept:'application/json'},signal:AbortSignal.timeout(20000),...o});if(r.status===429){await sleep(15000);continue;}return {status:r.status,json:r.ok?await r.json():null};}catch(e){if(i===2)return {status:0,error:String(e.message).slice(0,100)};}}return {status:429};};
const POOL='0x5bc5ced48bec9260c8d626269f44e22808b8d2c1',CANON='0x162df51c504e7b8321e07387932f333d9be16a72',POLL='0xf76b1d00bd3d63a37246b5f512074e864010e33d';
const call=(to,data,b='latest')=>arc('eth_call',[{to,data},b]).catch(e=>'ERR:'+String(e.message).slice(0,60));
const addr=w=>/^0x0{24}[0-9a-f]{40}$/i.test(w||'')?'0x'+w.slice(26).toLowerCase():w;
async function synthra(){
 const head=await arc('eth_blockNumber',[]);const code=await arc('eth_getCode',[POOL,head]);const canon=await arc('eth_getCode',[CANON,head]);
 let same=0;const n=Math.min(code.length,canon.length);for(let i=2;i<n;i+=2)if(code.slice(i,i+2)===canon.slice(i,i+2))same++;
 const sel={factory:'0xc45a0155',token0:'0x0dfe1681',token1:'0xd21220a7',fee:'0xddca3f43',tickSpacing:'0xd0c93a7c',liquidity:'0x1a686502',slot0:'0x3850c7bd'};
 const reads={};for(const [k,s] of Object.entries(sel))reads[k]=await call(POOL,s);
 const factory=addr(reads.factory);
 const fcode=factory&&factory.startsWith('0x')?await arc('eth_getCode',[factory,head]):null;
 note('synthra-pool',{pool:POOL,head:parseInt(head,16),codeBytes:(code.length-2)/2,canonicalBytes:(canon.length-2)/2,sameBytePct:+(100*same/((Math.max(code.length,canon.length)-2)/2)).toFixed(2),
  factory,factoryCodeBytes:fcode?(fcode.length-2)/2:null,token0:addr(reads.token0),token1:addr(reads.token1),fee:reads.fee,tickSpacing:reads.tickSpacing,liquidity:reads.liquidity,slot0:String(reads.slot0).slice(0,140)});
 // factory getPool(token0,token1,fee) cross-check (UniswapV3Factory selector 0x1698ee82)
 if(factory){const t0=addr(reads.token0),t1=addr(reads.token1),fee=reads.fee;
  if(t0?.startsWith('0x')&&t1?.startsWith('0x')&&/^0x[0-9a-f]{64}$/.test(fee||'')){const d='0x1698ee82'+t0.slice(2).padStart(64,'0')+t1.slice(2).padStart(64,'0')+fee.slice(2);note('synthra-factory-getPool',{registered:addr(await call(factory,d))});}}
 for(const [k,a] of [['pool',POOL],['factory',factory]]){if(!a)continue;
  const s=await J('https://sourcify.dev/server/v2/contract/5042/'+a);note('synthra-sourcify-'+k,{status:s.status,match:s.json?.runtimeMatch||s.json?.match||null});
  const b=await J('https://explorer.arc.io/api/v2/smart-contracts/'+a);note('synthra-explorer-'+k,{status:b.status,verified:b.json?.is_verified??null,name:b.json?.name||null,compiler:b.json?.compiler_version||null,hasAbi:Array.isArray(b.json?.abi)});
  const ai=await J('https://explorer.arc.io/api/v2/addresses/'+a);note('synthra-explorer-addr-'+k,{status:ai.status,name:ai.json?.name||null,isContract:ai.json?.is_contract??null,creator:ai.json?.creator_address_hash||null,creationTx:ai.json?.creation_tx_hash||null,implementations:ai.json?.implementations||null});
 }
 // logs emitted by the pool: topic histogram over the recent window (chunked)
 const topics={};let scanned=0,errors=0;const H=parseInt(head,16);
 for(let to=H;to>H-40000&&scanned<40000;to-=2000){
  try{const logs=await arc('eth_getLogs',[{address:POOL,fromBlock:'0x'+(to-1999).toString(16),toBlock:'0x'+to.toString(16)}]);for(const l of logs)topics[l.topics[0]]=(topics[l.topics[0]]||0)+1;}catch(e){errors++;}
  scanned+=2000;
 }
 note('synthra-pool-logs',{blocksScanned:scanned,errors,topics});
 // provider-reported trades for this pool → receipts: which contract emits what
 const t=await J('https://api.geckoterminal.com/api/v2/networks/arc/pools/'+POOL+'/trades');
 const trades=(t.json?.data||[]).slice(0,6).map(x=>x.attributes);
 note('synthra-gecko-trades',{status:t.status,count:(t.json?.data||[]).length,sample:trades.map(a=>({tx:a.tx_hash,block:a.block_number,kind:a.kind,usd:Number(a.volume_in_usd).toFixed(2),from:a.tx_from_address,at:a.block_timestamp}))});
 for(const a of trades.slice(0,4)){
  const rc=await arc('eth_getTransactionReceipt',[a.tx_hash]).catch(()=>null);const tx=await arc('eth_getTransactionByHash',[a.tx_hash]).catch(()=>null);
  note('synthra-receipt',{tx:a.tx_hash,to:tx?.to||null,input4:tx?.input?.slice(0,10)||null,status:rc?.status||null,
   logs:(rc?.logs||[]).map(l=>({emitter:l.address.toLowerCase()===POOL?'POOL':l.address.toLowerCase()===POLL?'POLL':l.address.slice(0,12),topic0:l.topics[0],nTopics:l.topics.length,dataBytes:(l.data.length-2)/2}))});
 }
}
async function logos(){
 const WANT=[['Aster','ASTER'],['Big Time','BIGTIME'],['GRVT Token','GRVT'],['Gunz','GUN'],['Layer3','L3']];
 for(const [name,symbol] of WANT){
  const s=await J('https://api.coingecko.com/api/v3/search?query='+encodeURIComponent(symbol));await sleep(7000);
  const cands=(s.json?.coins||[]).filter(c=>String(c.symbol).toUpperCase()===symbol).slice(0,5);
  const out=[];
  for(const c of cands.slice(0,3)){
   const d=await J('https://api.coingecko.com/api/v3/coins/'+c.id+'?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false');await sleep(7000);
   const img=d.json?.image?.large||null;let head=null;
   if(img){try{const r=await fetch(img,{signal:AbortSignal.timeout(15000)});const b=Buffer.from(await r.arrayBuffer());head={status:r.status,type:r.headers.get('content-type'),bytes:b.length,magic:b.slice(0,4).toString('hex')};}catch(e){head={error:String(e.message).slice(0,60)};}}
   out.push({id:c.id,name:d.json?.name||c.name,symbol:d.json?.symbol,rank:c.market_cap_rank,homepage:(d.json?.links?.homepage||[]).filter(Boolean)[0]||null,platforms:d.json?.platforms||null,image:img,head});
  }
  note('logo-'+symbol,{wantName:name,status:s.status,candidates:out});
 }
}
async function transferProbe(){
 const t=await J('https://api.geckoterminal.com/api/v2/networks/arc/pools/'+POOL+'/trades');
 const a=(t.json?.data||[])[0]?.attributes;if(!a)return note('xfer-none',{status:t.status});
 const b='0x'+Number(a.block_number).toString(16),T='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',P='0x'+'0'.repeat(24)+POOL.slice(2),U='0x3600000000000000000000000000000000000000';
 const tries={arrayAddrNestedTopic:{address:[U,POLL],topics:[T,[P]]},arrayAddrPlainTopic:{address:[U,POLL],topics:[T,P]},pollOnly:{address:POLL,topics:[T,P]},usdcOnly:{address:U,topics:[T,P]},usdcTo:{address:U,topics:[T,null,P]},anyTo:{topics:[T,null,P]}};
 const out={tx:a.tx_hash,block:a.block_number};
 for(const [k,f] of Object.entries(tries)){try{const l=await arc('eth_getLogs',[{...f,fromBlock:b,toBlock:b}]);out[k]={n:l.length,emitters:[...new Set(l.map(x=>x.address.slice(0,10)))],inTx:l.filter(x=>x.transactionHash===a.tx_hash).length};}catch(e){out[k]={error:String(e.message).slice(0,140)};}await sleep(300);}
 try{const rc=await arc('eth_getTransactionReceipt',[a.tx_hash]);out.receipt={from:rc?.from,blockHash:rc?.blockHash?.slice(0,12),logs:(rc?.logs||[]).map(l=>[l.address.slice(0,10),l.topics[0].slice(0,10),l.topics.length,(l.data.length-2)/2])};}catch(e){out.receipt={error:String(e.message).slice(0,140)};}
 try{const all=await arc('eth_getLogs',[{fromBlock:b,toBlock:b}]);out.allLogsInBlock=all.filter(x=>x.transactionHash===a.tx_hash).map(l=>[l.address.slice(0,10),l.topics[0].slice(0,10),l.topics.length]);}catch(e){out.allLogsInBlock={error:String(e.message).slice(0,140)};}
 note('xfer-probe',out);
}
(async()=>{try{await transferProbe();}catch(e){note('xfer-error',{error:String(e.stack||e).slice(0,300)});}
 try{await synthra();}catch(e){note('synthra-error',{error:String(e.stack||e).slice(0,400)});}
 })();
