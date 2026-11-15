'use strict';
// Read-only measurement of Production Arc Radar coverage and of one named candidate (POLL) through the same public
// provider the Radar already uses (GeckoTerminal token/pool endpoints). No writes, no keys, no ranking changes.
const BASE=process.env.ARCY_BASE||'https://www.arcyusdc.xyz',POLL='0xf76b1d00bd3d63a37246b5f512074e864010e33d';
const h={accept:'application/json',referer:BASE+'/','sec-fetch-site':'same-origin'};
const get=async(u,headers=h)=>{const t=Date.now();const r=await fetch(u,{headers,signal:AbortSignal.timeout(45000)});return {status:r.status,ms:Date.now()-t,json:await r.json().catch(()=>null)};};
(async()=>{
 for(const chain of ['arc','ethereum','robinhood']){
  const r=await get(BASE+'/api/search?action=radar&chain='+chain),d=r.json||{};
  console.log('::notice title=radar-'+chain+'::'+JSON.stringify({status:r.status,ms:r.ms,ranked:(d.tokens||[]).length,watchlist:(d.watchlist||[]).length,coverage:d.coverage&&{...d.coverage},
   excludedCounts:d.discovery?.excludedCounts,poolWindow:d.discovery?.poolWindow,channels:d.discovery?.channels,
   logos:(d.tokens||[]).filter(t=>t.logo).length,poll:(d.tokens||[]).some(t=>String(t.address).toLowerCase()===POLL)?'RANKED':(d.watchlist||[]).some(t=>String(t.address).toLowerCase()===POLL)?'WATCHLIST':
    (d.excluded||[]).find(x=>String(x.address).toLowerCase()===POLL)||'NOT_IN_CANDIDATE_WINDOW'}).slice(0,3800));
  if(chain==='arc')console.log('::notice title=radar-arc-excluded::'+JSON.stringify((d.excluded||[]).slice(0,40).map(x=>[x.symbol,x.reason,Math.round(x.volume24hUsd||0),Math.round(x.liquidityUsd||0),x.ageHours??null])).slice(0,3800));
  await new Promise(s=>setTimeout(s,3000));
 }
 const g=await get('https://api.geckoterminal.com/api/v2/networks/arc/tokens/'+POLL+'/pools?page=1',{accept:'application/json'});
 const pools=(g.json?.data||[]).map(p=>({pool:p.attributes?.address,name:p.attributes?.name,dex:p.relationships?.dex?.data?.id,liq:Math.round(Number(p.attributes?.reserve_in_usd)||0),
  vol24:Math.round(Number(p.attributes?.volume_usd?.h24)||0),tx24:p.attributes?.transactions?.h24,created:p.attributes?.pool_created_at,chg24:p.attributes?.price_change_percentage?.h24}));
 console.log('::notice title=poll-gecko::'+JSON.stringify({status:g.status,pools}).slice(0,3800));
})();
