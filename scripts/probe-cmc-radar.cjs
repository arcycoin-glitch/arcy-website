'use strict';
// CI research probe only. Returns only coverage/error summaries, no public market feed.
// CoinMarketCap documents DEX rankings /v4/dex/spot-pairs/latest with volume_24h sort.
const BASE='https://pro-api.coinmarketcap.com/public-api';
const CHAINS=[['arc',5042],['ethereum',1],['robinhood-chain',4663],['robinhood',4663]];
async function get(path){
 const response=await fetch(BASE+path,{headers:{accept:'application/json'},signal:AbortSignal.timeout(16000)});
 const raw=await response.text(),json=JSON.parse(raw);
 return {http:response.status,body:json};
}
(async()=>{
 try{
  const p=await get('/v1/dex/platform/list');
  let arr=Array.isArray(p.body.data)?p.body.data:[];
  console.log('PLATFORMS HTTP '+p.http+' code '+p.body.status?.error_code+' total='+arr.length);
  console.log('RELEVANT '+JSON.stringify(arr.filter(x=>[5042,4663,1].includes(Number(x.chId))||/robinhood|^arc$|ethereum/i.test(x.n||'')).map(x=>({name:x.n,chainId:x.chId,id:x.id,acronym:x.pltA})).slice(0,20)));
 }catch(e){console.log('PLATFORMS ERROR '+String(e.message).slice(0,140))}
 for(const [slug,chain] of CHAINS){
  try{
   const url='/v4/dex/spot-pairs/latest?network_slug='+encodeURIComponent(slug)+'&sort=volume_24h&sort_dir=desc&limit=20';
   const x=await get(url);
   const rows=Array.isArray(x.body.data)?x.body.data:[];
   console.log('PAIR '+slug+' chain='+chain+' HTTP='+x.http+' code='+x.body.status?.error_code+' msg='+String(x.body.status?.error_message||'').slice(0,100)+' rows='+rows.length+
    ' observedSlugs='+JSON.stringify([...new Set(rows.map(r=>r.network_slug))].slice(0,4))+
    ' withContract='+rows.filter(r=>/^0x[0-9a-f]{40}$/i.test(r.base_asset_contract_address)).length+
    ' withVolume='+rows.filter(r=>Number(r.quote?.[0]?.volume_24h)>0).length);
  }catch(e){console.log('PAIR '+slug+' ERROR '+String(e.message).slice(0,140))}
 }
})();
