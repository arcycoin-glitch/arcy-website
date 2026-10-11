'use strict';
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {mkdirSync}=require('node:fs');
const base='http://127.0.0.1:33119';
const token='0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b';
const chainIds={arc:5042,ethereum:1,robinhood:4663};
const schema=require('../search/schema');
async function main(){
 const server=spawn(process.execPath,['dev.cjs'],{
  cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:'33119'},stdio:'ignore'
 });
 let browser;const outcomes=[];
 try{
  for(let j=0;j<90;j++){
   try{const r=await fetch(base);if(r.ok)break;}catch{}
   await new Promise(r=>setTimeout(r,120));
  }
  browser=await chromium.launch({headless:true});
  for(const width of [320,390,768,1440]){
   const page=await browser.newPage({viewport:{width,height:840}});
   const errors=[];const consoleErrors=[];const badResponses=[];let weeklyBackendRequests=0;
   page.on('pageerror',e=>errors.push(e.message));
   page.on('console',message=>{if(message.type()==='error')consoleErrors.push({text:message.text(),url:message.location().url})});
   page.on('response',response=>{if(response.status()>=400)badResponses.push({status:response.status(),url:response.url()})});
   // The original homepage's optional CoinGecko logo lookup is unrelated to
   // Search acceptance. Keep it deterministic and avoid browser CORS noise.
   await page.route('https://api.coingecko.com/api/v3/coins/markets**',route=>
    route.fulfill({status:200,contentType:'application/json',body:'[]'}));
   await page.route('**/api/search*',async route=>{
    const url=new URL(route.request().url()),action=url.searchParams.get('action'),
     network=url.searchParams.get('chain')||'arc',id=chainIds[network];
    let data={ok:false,error:'UNKNOWN'};
    if(action==='discover'){
     const q=(url.searchParams.get('q')||'').toLowerCase();
     const candidates=[{name:'ARCY Demo',symbol:'ARCY',address:token,network,chainId:id,
      identityVerified:network==='arc'&&q==='arcy',source:'Browser deterministic test',
      identity:network==='arc'&&q==='arcy'?{status:'OFFICIAL_CONTRACT_MATCHED',issuer:'ARCY',
       proofUrl:'https://github.com/arcycoin-glitch/arcy-website'}:
       q==='catalog'?{status:'INDEXED_ON_COINGECKO',proofUrl:'https://www.coingecko.com'}:
       {status:'NOT_VERIFIED'}}];
     if(q==='duplicate')candidates.push({...candidates[0],name:'<img src=x onerror=alert(1)>',address:'0x1234567890123456789012345678901234567890',logoUrl:'javascript:alert(1)'});
     data={ok:true,network:q==='wrongnetwork'?'ethereum':network,chainId:id,matches:q==='none'?[]:candidates};
    }else if(action==='report'){
     const fields=Object.fromEntries(schema.map(x=>[x.id,{description:'Test source only',fields:
      Object.fromEntries(x.fields.map(([key])=>[key,{value:null,dataState:'NOT_VERIFIED',status:'NOT_VERIFIED',
       reason:'Fixture has no evidence',reasonCode:'NO_SOURCE'}]))}]));
     if(network==='robinhood'){
      fields.supply.fields.totalSupply={value:'23456000000',dataState:'DATA_FOUND',status:'ON_CHAIN',source:'Robinhood RPC'};
      fields.supply.fields.burnAddressBalance={value:'120000000',dataState:'DATA_FOUND',status:'ON_CHAIN',source:'Robinhood RPC'};
      fields.supply.fields.burnAddressPct={value:0.5116,dataState:'DATA_FOUND',status:'ON_CHAIN',source:'Robinhood RPC'};
      fields.activity.fields.valuation={value:302700,kind:'MARKET_CAP',dataState:'DATA_FOUND',
       status:'SOURCE_REPORTED',source:'DexScreener'};
     }else{
      fields.activity.fields.priceUsd={value:.00032632,dataState:'DATA_FOUND',status:'SOURCE_REPORTED',source:'DexScreener'};
      fields.liquidity.fields.liquidityUsd={value:2659000,dataState:'DATA_FOUND',status:'SOURCE_REPORTED',source:'DexScreener'};
      fields.holders.fields.holderCount={value:215700,dataState:'DATA_FOUND',status:'SOURCE_REPORTED',source:'Blockscout'};
      fields.activity.fields.valuation={value:302700,kind:'MARKET_CAP',dataState:'DATA_FOUND',
       status:'SOURCE_REPORTED',source:'DexScreener'};
      fields.activity.fields.change24h={value:-3.47,dataState:'DATA_FOUND',
       status:'SOURCE_REPORTED',source:'DexScreener'};
      fields.activity.fields.volume24h={value:6169,dataState:'DATA_FOUND',
       status:'SOURCE_REPORTED',source:'DexScreener'};
     }
     data={ok:true,network,chainId:id,address:token,block:'0x12345',schemaVersion:1,cardCount:5,
      scannedAt:'2026-10-11T10:00:00.000Z',
      token:{name:'ARCY Demo',symbol:'ARCY',decimals:18},tokenIdentity:{status:'NOT_VERIFIED'},cards:fields};
    }else if(action==='chart'){
     const range=url.searchParams.get('range')||'30D';
     if(range==='1W')weeklyBackendRequests++;
     const frames={ '30D':{length:30,interval:'1d',step:86400000,start:Date.UTC(2026,8,12)},
      '1W':{length:7,interval:'1d',step:86400000,start:Date.UTC(2026,9,5)},
      '1D':{length:24,interval:'1h',step:3600000,start:Date.UTC(2026,9,10,20)},
      '4H':{length:16,interval:'15m',step:900000,start:Date.UTC(2026,9,11,15,45)}};
     const cfg=frames[range];
     if(!cfg)throw Error('Unsupported chart test range: '+range);
     const points=Array.from({length:cfg.length},(_,i)=>({
      time:(cfg.start+i*cfg.step)/1000,close:.45+.04*Math.sin(i/3)+.0015*i
     }));
     data={ok:true,network,chainId:id,address:token,range,interval:cfg.interval,
      sourceUrl:'https://www.geckoterminal.com/'+
      (network==='ethereum'?'eth':network)+'/pools/'+token,
      lastCandleTime:points.at(-1).time,points};
    }else if(action==='token'){
     data={ok:true,network,chainId:id,address:token,block:'0x12345',
      fields:{totalSupply:{value:null,dataState:'NOT_VERIFIED'}}};
    }
    if(action==='report'&&network==='arc')
     await new Promise(resolve=>setTimeout(resolve,800));
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
   });
   await page.goto(base+'/search/',{waitUntil:'domcontentloaded'});
   await page.waitForURL('**/#search');
   assert.equal(new URL(page.url()).pathname,'/','Legacy /search/ links return to the homepage search anchor');
   await page.goto(base+'/',{waitUntil:'domcontentloaded'});
   await page.locator('#homeSearchQuery').waitFor();
   for(const id of ['hero','burn','unlocks','pulse','buy']){
    assert.equal(await page.locator('#'+id).count(),1,'Existing section '+id+' must remain');
   }
   assert.equal(await page.locator('#search .home-search').isVisible(),true);
   assert.equal(await page.locator('#search .home-search-brand').getAttribute('aria-label'),'ARCY Search');
   assert.equal(await page.locator('#search .home-search-arcy').innerText(),'ARCY');
   assert.equal(await page.locator('#search .home-search-y').evaluate(el=>getComputedStyle(el).color),'rgb(255, 138, 61)',
    'Only the Y is orange in the product wordmark');
   assert.equal(await page.locator('#search .home-search-search').evaluate(el=>getComputedStyle(el).color),'rgb(56, 217, 244)',
    'SEARCH uses the cyan product color');
   const owlReady=await page.locator('#search .home-search-owl').evaluate(async img=>{
    await img.decode();const r=img.getBoundingClientRect();
    return {loaded:img.naturalWidth===320&&img.naturalHeight===217,width:r.width,height:r.height};
   });
   assert.equal(owlReady.loaded,true,'Selected neon owl asset loads at its native source dimensions');
   assert.ok(owlReady.width<=80&&owlReady.height<=55,'Product owl stays compact and is never enlarged');
   assert.equal(await page.getByRole('link',{name:'Powered by CoinGecko'}).count(),1,
    'CoinGecko source attribution is visible on the home search');
   assert.equal(await page.locator('#search .search').isVisible(),false,'Retired Arc-only form must not be visible');
   assert.equal(await page.locator('a[href="#search"]').count()>0,true,'Home Search shortcuts stay on the integrated section');
   assert.equal(await page.locator('#hero .hero-flight img').getAttribute('src'),'/assets/hero-arcy.png',
    'Original cute ARCY homepage mascot remains unchanged');
   const mascot=await page.locator('#hero .hero-flight img').evaluate(async img=>{await img.decode();return img.naturalWidth>0&&img.naturalHeight>0});
   assert.equal(mascot,true);
   const searchBounds=await page.locator('#search .home-search-form').evaluate(el=>{
    const r=el.getBoundingClientRect();return {width:r.width,left:r.left,right:r.right,viewport:innerWidth};
   });
   assert.ok(searchBounds.width>250&&searchBounds.left>=0&&searchBounds.right<=width+1,
    'Functional search field must stay within viewport: '+JSON.stringify(searchBounds));
   if(width===320||width===390||width===1440){
    const folder=path.resolve(__dirname,'../artifacts/search-preview');
    mkdirSync(folder,{recursive:true});
    await page.screenshot({path:path.join(folder,'home-search-'+width+'-REAL-UI.png'),
     fullPage:true,animations:'disabled'});
    await page.locator('#search').screenshot({path:path.join(folder,'search-module-'+width+'.png'),
     animations:'disabled'});
   }
   assert.equal(await page.locator('select').count(),0,'No native white Android picker');
   assert.equal(await page.locator('#homeNetworkMenu [role="option"]').count(),3);
   await page.locator('#homeNetworkPicker .home-network-trigger').click();
   const labels=await page.locator('#homeNetworkMenu [role="option"]').allInnerTexts();
   assert.deepEqual(labels,['ARC\nArc','ETH\nEthereum','RH\nRobinhood Chain']);
   const color=await page.locator('#homeNetworkMenu').evaluate(x=>getComputedStyle(x).backgroundColor);
   assert.notEqual(color,'rgb(255, 255, 255)');
   await page.keyboard.press('Escape');
   assert.equal(await page.locator('#homeNetworkMenu').isVisible(),false,'Escape closes the dark network menu');
   await page.locator('#homeSearchQuery').fill('duplicate');
   await page.locator('.home-search-submit').click();
   await page.locator('.home-search-result').first().waitFor();
   assert.equal(await page.locator('.home-search-result').count(),2,'Duplicate ticker candidates are not silently collapsed');
   assert.equal(await page.locator('.home-search-result img').count(),0,'Untrusted logo URLs are not loaded');
   assert.equal(await page.locator('.home-search-result strong').nth(1).innerText(),'<img src=x onerror=alert(1)>',
    'Token metadata is rendered as text, never markup');
   assert.equal(await page.locator('.home-result-status').first().innerText(),'NOT VERIFIED',
    'Logo/symbol match does not prove the issuer');
   await page.locator('#homeSearchQuery').fill('arcy');
   await page.locator('.home-search-submit').click();
   await page.locator('.home-search-result').first().waitFor();
   assert.equal(await page.locator('.home-result-status').first().innerText(),'OFFICIAL CONTRACT');
   assert.match(await page.locator('.home-result-proof').first().innerText(),/Issuer: ARCY/);
   await page.locator('#homeSearchQuery').fill('catalog');
   await page.locator('.home-search-submit').click();
   await page.locator('.home-search-result').first().waitFor();
   assert.equal(await page.locator('.home-result-status').first().innerText(),'COINGECKO LISTED',
    'Catalog listing is not proof of the issuing project');

   await page.locator('#homeSearchQuery').fill('none');
   await page.locator('.home-search-submit').click();
   await page.waitForFunction(()=>document.querySelector('#homeSearchState').textContent.includes('No Arc'));
   assert.equal(await page.locator('.home-search-result').count(),0);
   await page.locator('#homeSearchQuery').fill('wrongnetwork');
   await page.locator('.home-search-submit').click();
   await page.waitForFunction(()=>document.querySelector('#homeSearchState').textContent.includes('Search unavailable'));
   assert.equal(await page.locator('.home-search-result').count(),0,'Mismatched chain responses fail closed');
   for(const [network,label] of [['ethereum','Ethereum'],['robinhood','Robinhood Chain'],['arc','Arc']]){
    if(network!=='arc'){
     await page.locator('#homeNetworkPicker .home-network-trigger').click();
     await page.locator('#homeNetworkMenu [data-network="'+network+'"]').click();
    }
    assert.equal(await page.locator('#homeNetworkPicker .home-network-name').innerText(),label);
    await page.locator('#homeSearchQuery').fill('ARCY');
    await page.locator('.home-search-submit').click();
    await page.locator('.home-search-result').first().waitFor();
    assert.equal(await page.locator('.home-search-result').first().getAttribute('href'),
     '/search/token/'+network+'/'+token);
    assert.equal(await page.locator('.home-result-status').first().innerText(),
     network==='arc'?'OFFICIAL CONTRACT':'NOT VERIFIED',
     'Only a chain and exact-address source match may verify the ARCY candidate');
    await page.locator('.home-search-result').first().click();
    await page.waitForURL('**/search/token/'+network+'/'+token);
    if(network==='arc'){
     await page.waitForFunction(()=>document.querySelector('#chartPlot')?.hidden===false,{timeout:12000});
     assert.match(await page.locator('#detailState').innerText(),/Reading/,
      'Arc price chart must load while slower LP/holder/control checks continue');
    }
    await page.waitForFunction(()=>document.querySelector('#detailState').textContent.includes('Snapshot complete'),{timeout:12000});
    assert.equal(await page.locator('#tokenDetail').isVisible(),true);
    assert.equal(await page.locator('#tokenDetail #backSearch').count(),1);
    assert.equal(await page.locator('header .return-arcy').count(),0,
     'The token report offers only one Back to Search control');
    const brandMark=page.locator('.brand-owl-mark');
    await brandMark.evaluate(async image=>{await image.decode();if(!image.naturalWidth)throw Error('Vector Search mark unavailable')});
    const markSize=await brandMark.evaluate(image=>({width:image.getBoundingClientRect().width,height:image.getBoundingClientRect().height}));
    assert.deepEqual(markSize,{width:38,height:26},'Crisp vector owl stays a compact token-page brand mark');
    assert.equal(await page.locator('#tokenDetail .search-detail-brand').count(),0,
     'The compact header is the sole report-page brand mark');
    assert.equal(await page.getByRole('link',{name:'Powered by CoinGecko'}).count(),1,
     'CoinGecko source attribution remains visible in report footer');
    assert.equal(await page.locator('#deepResearch').evaluate(x=>x.open),false,
      'Newly selected token must not inherit an expanded previous report');
    await page.locator('#deepResearch > summary').click();
    assert.equal(await page.locator('#deepResearch').evaluate(x=>x.open),true);
    assert.equal(await page.locator('#cards .card').count(),5);
    assert.equal(await page.locator('#cards .metric').count(),20);
    assert.equal(await page.locator('#moreResearch').count(),0,'Unfinished marketing-only tools must not appear');
    const collapsed=page.locator('#cards .unverifiedModules');
    assert.equal(await collapsed.count(),1,'Unsourced categories should share one quiet disclosure');
    const unsourced=network==='robinhood'?3:2;
    assert.equal(await collapsed.locator('.card').count(),unsourced);
    assert.equal(await page.locator('#cards > .card').count(),5-unsourced);
    if(width===1440&&network==='arc'){
     const reportTops=await page.locator('#cards > .card').evaluateAll(xs=>
      xs.map(x=>x.getBoundingClientRect().top));
     assert.ok(reportTops.every(t=>Math.abs(t-reportTops[0])<3),
      'Three supported desktop research cards should fill one premium row');
    }
    assert.match(await collapsed.locator(':scope > summary').textContent(),new RegExp(String(unsourced)+' research'));
    await collapsed.locator(':scope > summary').click();
    assert.equal(await collapsed.locator('.missingGroup').count(),unsourced);
    await collapsed.locator(':scope > summary').click();
    assert.equal(await page.locator('#cards .exactValue').count(),0,
     'Full values remain in evidence, not repetitive buttons');
    if(network==='robinhood'){
     assert.match(await page.locator('#cards > .card .statusLine').first().innerText(),/PARTIALLY SOURCE-BACKED/);
     assert.equal((await page.locator('#quickFacts .quick-label').allInnerTexts()).some(x=>/MARKET CAP/i.test(x)),false,
      'Market Cap is not repeated in the headline summary');
     const market=page.locator('#cards > .card').filter({has:page.locator('h2:text("Market Activity")')});
     assert.equal(await market.locator('.metric').filter({has:page.locator('span:text-is("Market Cap")')}).count(),1,
      'Market Cap appears once in the detailed Market Activity card');
    }else{
     const market=page.locator('#cards > .card').filter({has:page.locator('h2:text("Market Activity")')});
     assert.match(await market.locator('.statusLine').innerText(),/ALL 4 FIELDS SOURCE-BACKED/);
     assert.match(await market.locator('.statusLine').innerText(),/4 \/ 4 sourced/);
     assert.equal(await market.locator('.missingGroup').count(),0);
     const valuation=market.locator('.metric').filter({has:page.locator('span:text-is("Market Cap")')});
     assert.equal(await valuation.count(),1);
     assert.equal(await valuation.locator('b').innerText(),'\u0024302.7K');
     assert.equal((await valuation.innerText()).includes('Market Cap Market Cap'),false);
    }
    assert.equal(await page.locator('#quickFacts .quick').count(),3);
    if(network!=='robinhood'){
     assert.match(await page.locator('#quickFacts .quick-value').first().innerText(),/\$0\.0003263/);
    }
    const headings=await page.locator('#quickFacts .quick-label').allInnerTexts();
    if(network==='robinhood'){
     assert.deepEqual(headings,['TOTAL SUPPLY','DEAD-ADDRESS BALANCE','DEAD-ADDRESS %']);
     assert.equal(await page.locator('#quickFacts').innerText().then(x=>x.includes('NOT VERIFIED')),false);
    }else{
     assert.deepEqual(headings,['PRICE','TRACKED LIQUIDITY','HOLDER COUNT']);
    }
    const tops=await page.locator('#quickFacts .quick').evaluateAll(xs=>xs.map(x=>x.getBoundingClientRect().top));
    assert.ok(tops.every(t=>Math.abs(t-tops[0])<2),'Three key metrics must share one premium row');
    await page.waitForFunction(()=>document.querySelector('#chartPlot')?.hidden===false);
    assert.equal(await page.locator('#chartPlot svg path').count(),2);
    assert.equal(await page.locator('#chartAxis span').count(),2);
    assert.match(await page.locator('#chartStats').innerText(),/daily intervals/);
    assert.match(await page.locator('#marketLink').getAttribute('href'),new RegExp('/'+(network==='ethereum'?'eth':network)+'/pools/'));
    assert.deepEqual(await page.locator('#chartRanges .chart-range').allInnerTexts(),['4H','1D','1W','30D']);
    assert.equal(await page.locator('#chartRanges .chart-range[aria-pressed="true"]').innerText(),'30D');
    for(const [range,count,caption,time] of [
     ['4H',16,'15-minute','UTC'],['1D',24,'hourly','UTC'],
     ['1W',7,'daily','UTC'],['30D',30,'daily','UTC']]){
     await page.locator('#chartRanges [data-range="'+range+'"]').click();
     await page.waitForFunction(r=>document.querySelector('#chartNote').textContent.includes(
      r==='4H'?'16 15-minute':r==='1D'?'24 hourly':r==='1W'?'7 daily':'30 daily'),range);
     assert.equal(await page.locator('#chartRanges [aria-pressed="true"]').count(),1);
     assert.equal(await page.locator('#chartRanges [aria-pressed="true"]').innerText(),range);
     assert.match(await page.locator('#chartNote').innerText(),new RegExp('GeckoTerminal · '+count));
     assert.match(await page.locator('#chartStats').innerText(),new RegExp(caption+' intervals'));
     assert.equal(await page.locator('#chartAxis span').count(),2);
     if(range==='1W')assert.equal(weeklyBackendRequests,0,
      '1W should reuse contract-verified 30D candles, not spend another API call');
     if(range==='4H'||range==='1D')assert.match(await page.locator('#chartAxis').innerText(),/Oct 11|Oct 10/);
    }
    const callToAction=page.locator('#deepResearch > summary');
    await callToAction.scrollIntoViewIfNeeded();
    assert.equal(await callToAction.isVisible(),true);
    assert.match(await callToAction.innerText(),/Explore full on-chain report/);
    assert.match(await callToAction.innerText(),/20 checks/);
    const visibleCTA=await callToAction.evaluate(el=>{
     const r=el.getBoundingClientRect();return r.width>210&&r.right<=innerWidth+1&&r.left>=-1;
    });
    assert.equal(visibleCTA,true,'Report must remain fully readable and in viewport on mobile');
    await page.locator('#chartPlot').focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('#chartInspector').isVisible(),true);
    assert.match(await page.locator('#chartInspector strong').innerText(),/^\$/);
    await page.keyboard.press('Home');
    assert.match(await page.locator('#chartInspector').innerText(),/Sep 12/);
    await page.locator('#chartPlot').blur();
    // Reviewable deterministic browser snapshots. TEST FIXTURES, not live
    // quoted token prices; no production data or credentials are captured.
    if(network==='arc'&&(width===320||width===390||width===1440)){
     const folder=path.resolve(__dirname,'../artifacts/search-preview');
     mkdirSync(folder,{recursive:true});
     await page.screenshot({path:path.join(folder,'arc-'+width+'-MOCK-DATA.png'),fullPage:true,
      animations:'disabled'});
    }
    await page.locator('#backSearch').click();
    await page.waitForURL('**/#search');
    await page.locator('#homeSearchQuery').waitFor();
    assert.equal(await page.locator('#search .home-search').isVisible(),true);
    if(width===320&&network==='arc'){
     await page.goBack();
     await page.waitForURL('**/search/token/arc/'+token);
     assert.equal(await page.locator('#tokenDetail').isVisible(),true,'Browser Back restores the token URL');
     await page.goForward();
     await page.waitForURL('**/#search');
     assert.equal(await page.locator('#homeSearchQuery').isVisible(),true,'Browser Forward restores home search');
    }
   }
   // A temporary upstream outage must not be misreported as a nonexistent chart.
   await page.route('**/api/search?action=chart&**',route=>route.fulfill({
    status:503,contentType:'application/json',
    body:JSON.stringify({ok:false,error:'CHART_PROVIDER_TEMPORARILY_UNAVAILABLE',network:'arc',address:token})
   }));
   await page.goto(base+'/search/token/arc/'+token,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>document.querySelector('#detailState').textContent.includes('Snapshot complete'));
   await page.waitForFunction(()=>document.querySelector('#chartNote').textContent.includes('temporarily unavailable'));
   assert.equal(await page.locator('#chartPlot').isVisible(),false);
   await page.unroute('**/api/search?action=chart&**');
   assert.equal(await page.locator('#currentChainName').innerText(),'Arc');
   assert.equal(await page.locator('#tokenDetail').isVisible(),true);
   // A lone valuation stays in its detailed card instead of being duplicated
   // in headline tiles; do not manufacture a quick-fact row for it.
   await page.evaluate(()=>{
    window.renderQuickFacts({cards:{
     activity:{fields:{valuation:{value:302700,kind:'MARKET_CAP',
      dataState:'DATA_FOUND',source:'DexScreener'}}}
    }});
   });
   assert.equal(await page.locator('#quickFacts .quick').count(),0);
   assert.match(await page.locator('#quickFacts').innerText(),/No source-backed headline metrics/);
   const sparseTops=await page.locator('#quickFacts .quick').evaluateAll(xs=>
    xs.map(x=>x.getBoundingClientRect().top));
   assert.ok(sparseTops.every(t=>Math.abs(t-sparseTops[0])<2),'Sparse cards must share a row');
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
   assert.equal(overflow,false,'No sideways phone page overflow');
   assert.deepEqual(errors,[],'No new browser errors');
   // Exactly one deliberately injected HTTP 503 above is expected.
   // A browser can attribute its resource-loading console warning to the
   // page rather than the API endpoint. All other errors still fail CI.
   const expectedChartOutage=badResponses.filter(x=>x.status===503&&
    new URL(x.url).searchParams.get('action')==='chart');
   assert.equal(expectedChartOutage.length,1,'Outage case must trigger exactly one chart HTTP 503');
   assert.deepEqual(badResponses.filter(x=>!expectedChartOutage.includes(x)),[],'No unexpected HTTP responses');
   const unexpectedConsoleErrors=consoleErrors.filter(error=>!(
    /Failed to load resource/i.test(error.text)&&/503/.test(error.text)&&expectedChartOutage.length===1
   ));
   assert.deepEqual(unexpectedConsoleErrors,[],'No unexpected browser console errors');
   outcomes.push({width,status:'PASS',networks:3,reportCards:5,reportFields:20});
   await page.close();
  }
  outcomes.forEach(x=>console.log(JSON.stringify(x)));
  console.log('Same-domain original-site to premium multichain Search: '+outcomes.length+'/4 browsers PASS');
 }finally{
  await browser?.close();server.kill('SIGTERM');
 }
}
main().catch(e=>{console.error('BROWSER_GATE_FAILED '+e.stack);process.exitCode=1});
