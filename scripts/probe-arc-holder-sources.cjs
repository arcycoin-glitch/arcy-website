'use strict';
// Read-only probe of Arc (5042) holder-discovery sources. No credentials, no writes, bounded requests (each <= 20 s).
const T={stuck:'0x4c9b47dbd5933aa4574b2c27f82419e4dbbd0222',arcy:'0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b'};
const AX='https://arcexplorer.org',BS='https://explorer.arc.io',RPCS=['https://rpc.mainnet.arc.io','https://rpc.quicknode.mainnet.arc.io','https://rpc.blockdaemon.mainnet.arc.io'];
const pick=(o,keys)=>o&&typeof o==='object'?Object.fromEntries(keys.filter(k=>k in o).map(k=>[k,o[k]])):o;
async function get(url,ms=20000){const t=Date.now();try{const r=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(ms)});const text=await r.text();let body=null;try{body=JSON.parse(text);}catch{}return {url,http:r.status,ms:Date.now()-t,bytes:text.length,body,snippet:body?undefined:text.slice(0,160)};}catch(e){return {url,error:e.name,message:String(e.message).slice(0,120),ms:Date.now()-t};}}
async function rpc(url,method,params){const t=Date.now();try{const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(15000)});const d=await r.json();return {http:r.status,ms:Date.now()-t,result:typeof d.result==='string'&&d.result.length>200?d.result.length+' chars':d.result,error:d.error};}catch(e){return {error:e.name,ms:Date.now()-t};}}
const log=(k,v)=>console.log(k+' '+JSON.stringify(v));
(async()=>{
 for(const [label,u] of [['AX_STATS',AX+'/api/v1/stats'],['BS_STATS',BS+'/api/v2/stats'],['BS_V1_RPC_BLOCK',BS+'/api?module=block&action=eth_block_number']]){const r=await get(u);log(label,{...r,body:pick(r.body,['chainId','latestIndexedBlock','indexedBlocks','total_blocks','total_addresses','network_utilization_percentage','result','message'])});}
 for(const [name,a] of Object.entries(T)){
  const ax=await get(AX+'/api/v1/tokens/'+a);log('AX_TOKEN_'+name,{...ax,body:pick(ax.body,['address','chainId','symbol','holders','totalSupply'])});
  const axh=await get(AX+'/api/v1/tokens/'+a+'/holders?limit=1000&offset=0');log('AX_HOLDERS_'+name,{...axh,body:axh.body&&{items:axh.body.items?.length,total:axh.body.total,nextOffset:axh.body.nextOffset}});
  const bt=await get(BS+'/api/v2/tokens/'+a);log('BS_TOKEN_'+name,{...bt,body:pick(bt.body,['address','address_hash','symbol','type','holders','holders_count','total_supply','decimals'])});
  const bc=await get(BS+'/api/v2/tokens/'+a+'/counters');log('BS_COUNTERS_'+name,{...bc});
  const bh=await get(BS+'/api/v2/tokens/'+a+'/holders');const items=bh.body?.items;log('BS_HOLDERS_'+name,{...bh,body:bh.body&&{items:items?.length,first:items?.[0]&&{address:items[0].address?.hash,value:items[0].value,token:items[0].token?.address||items[0].token?.address_hash},next_page_params:bh.body.next_page_params}});
  if(bh.body?.next_page_params){const q=new URLSearchParams(bh.body.next_page_params).toString();const p2=await get(BS+'/api/v2/tokens/'+a+'/holders?'+q);log('BS_HOLDERS_P2_'+name,{http:p2.http,ms:p2.ms,items:p2.body?.items?.length,next:p2.body?.next_page_params,error:p2.error});}
  const ba=await get(BS+'/api/v2/addresses/'+a);log('BS_ADDRESS_'+name,{http:ba.http,ms:ba.ms,body:pick(ba.body,['hash','is_contract','creation_transaction_hash','creation_tx_hash','creator_address_hash','is_verified','implementations','proxy_type'])});
  const tx=ba.body?.creation_transaction_hash||ba.body?.creation_tx_hash;if(tx){const t=await get(BS+'/api/v2/transactions/'+tx);log('BS_CREATION_TX_'+name,{http:t.http,block:t.body?.block_number??t.body?.block,timestamp:t.body?.timestamp});}
  const v1=await get(BS+'/api?module=token&action=getTokenHolders&contractaddress='+a+'&page=1&offset=100');log('BS_V1_HOLDERS_'+name,{http:v1.http,ms:v1.ms,status:v1.body?.status,message:v1.body?.message,count:Array.isArray(v1.body?.result)?v1.body.result.length:null,error:v1.error});
 }
 for(const u of RPCS){log('RPC',{url:u,chainId:await rpc(u,'eth_chainId',[]),head:await rpc(u,'eth_blockNumber',[]),supply:await rpc(u,'eth_call',[{to:T.stuck,data:'0x18160ddd'},'latest']),code:await rpc(u,'eth_getCode',[T.stuck,'latest'])});}
})();
