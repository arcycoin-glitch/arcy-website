'use strict';
// Read-only post-deploy check: live Arc/other Radar API counts + rows actually rendered on a mobile viewport.
const {chromium,devices}=require('playwright');
const BASE='https://www.arcyusdc.xyz',H={accept:'application/json','sec-fetch-site':'same-origin',referer:BASE+'/search/'};
(async()=>{
 const st=await (await fetch(BASE+'/api/search?action=status',{headers:{accept:'application/json'}})).json().catch(()=>null);
 console.log('LIVE|status|'+JSON.stringify({version:st?.version}));
 for(const c of ['arc','ethereum','robinhood','pons']){const d=await (await fetch(BASE+'/api/search?action=radar&chain='+c,{headers:H})).json().catch(()=>null);
  console.log('LIVE|api-'+c+'|'+JSON.stringify({ok:d?.ok,asOf:d?.asOf,freshness:d?.freshness,ranked:d?.tokens?.length,excludedCounts:d?.discovery?.excludedCounts,usage:d?.usage,tokens:(d?.tokens||[]).map(t=>({s:t.symbol,a:t.address,p:t.priceUsd,v:t.volume24hUsd,l:t.liquidityUsd,c:t.change24hPct,logo:!!t.logo,nv:t.verification?.counts?.NOT_VERIFIED}))}));}
 const b=await chromium.launch(),ctx=await b.newContext({...devices['iPhone 13']}),pg=await ctx.newPage();
 const seen=[];pg.on('response',async r=>{if(/action=radar/.test(r.url())){try{const j=await r.json();seen.push({url:r.url().replace(/^.*\?/,''),n:j.tokens?.length});}catch{}}});
 await pg.goto(BASE+'/search/',{waitUntil:'networkidle',timeout:60000});
 await pg.waitForTimeout(6000);
 const dom=await pg.evaluate(()=>{const q=s=>[...document.querySelectorAll(s)];return {overviewRows:q('.arcy-radar-overview-token-name').length,radarRows:q('[class*="arcy-radar"] tr, [class*="arcy-radar-row"]').length,arcText:(document.body.innerText.match(/ARCOON|FAZE|ARGUS|TOLLY|ASTOCK|Arcflow/g)||[])};});
 console.log('LIVE|mobile|'+JSON.stringify({seen,dom}));
 await b.close();
})().catch(e=>{console.log('LIVE|error|'+JSON.stringify({m:e.message}));process.exitCode=1;});
