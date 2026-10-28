'use strict';
// Live provider connectivity probe for GitHub CI only.
// Does not expose raw provider data publicly or create a reusable data feed.
const radar=require('../lib/market-radar');
(async()=>{
 let bad=0;
 for(const network of ['arc','ethereum','robinhood']){
  const id=radar.IDS[network].id;
  const url='https://api.geckoterminal.com/api/v2/networks/'+id+
    '/pools?page=1&sort=h24_volume_usd_desc&include=base_token,quote_token';
  try{
   const response=await fetch(url,{headers:{accept:'application/json;version=20230203'},signal:AbortSignal.timeout(13000)});
   if(!response.ok)throw Error('HTTP_'+response.status);
   const body=await response.json();
   const tokens=radar.takePage(body,network);
   if(tokens.length===0)throw Error('NO_CONTRACT_MATCHED_POOL_RESULTS');
   console.log(network+': HTTP 200; '+body.data.length+' inspected pools; '+tokens.length+' chain-matched candidate tokens; top-volume endpoint available.');
  }catch(e){bad++;console.error(network+': '+String(e.message).slice(0,130));}
 }
 if(bad)process.exitCode=1;
})();
