'use strict';
// Read-only Production browser verification (Final Engine): real pages, real data, no mocks, no writes.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const BASE=process.env.ARCY_BASE||'https://www.arcyusdc.xyz';
const TOKENS=[['ethereum','0x6982508145454ce325ddbe47a25d4ec3d2311933','PEPE'],['robinhood','0x18e674231a58c239dc7daedcffe15ec3a24cff5c','UERC20'],['arc','0xece5ca8bf9220718e5727754026757512212cb3c','ARGUS-TAX'],['arc','0xf76b1d00bd3d63a37246b5f512074e864010e33d','POLL']];
// Third-party embeds (the GeckoTerminal chart iframe) are reported separately; they are not ARCY page errors.
const THIRD_PARTY=/geckoterminal\.com|cables\.geckoterminal/i;
const ORDER=['Live Trading','Liquidity & Trading','Holder & Whale','Contract & Mechanics','Supply & Burn','Market Activity'];
(async()=>{const browser=await chromium.launch({headless:true,channel:process.env.ARCY_BROWSER_CHANNEL||'chrome'});let fail=0;
 for(const width of[1440,390])for(const [network,address,label] of TOKENS){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[],timing={};
  page.on('pageerror',e=>errors.push(e.message.slice(0,160)));const thirdParty=[];page.on('console',m=>{if(m.type()!=='error'||/Failed to load resource|favicon/i.test(m.text()))return;const own=m.location()?.url||'';(THIRD_PARTY.test(m.text())||THIRD_PARTY.test(own)?thirdParty:errors).push(m.text().slice(0,160));});
  page.on('requestfinished',async r=>{const u=new URL(r.url());if(u.pathname==='/api/search'){const t=r.timing();const a=u.searchParams.get('action');(timing[a]||=[]).push(Math.round(t.responseEnd));}});
  const row={label,network,width};
  try{
   await page.goto(BASE+'/search/token/'+network+'/'+address,{waitUntil:'domcontentloaded',timeout:60000});
   await page.waitForFunction(()=>/Snapshot complete/.test(document.querySelector('#detailState')?.textContent||''),null,{timeout:120000});
   await page.locator('#deepResearch').evaluate(e=>e.open=true);
   await page.waitForFunction(()=>{const b=document.querySelector('#cards [data-card-id="trades"] .lt-badge');return b&&!b.classList.contains('lt-busy');},null,{timeout:90000});
   row.nav=(await page.locator('#reportNavigation a span:not([aria-hidden])').allInnerTexts()).map(s=>s.trim());
   assert.deepEqual(row.nav,ORDER);
   const tops=await page.locator('#reportNavigation a').evaluateAll(a=>a.map(x=>Math.round(x.getBoundingClientRect().top)));
   row.oneRow=new Set(tops).size===1;if(width>=1024)assert.ok(row.oneRow,'one desktop row');
   row.position=await page.locator('.report-carousel-controls [role="status"]').innerText();assert.match(row.position,/^1 \/ \d — Live Trading$/);
   row.slides=await page.locator('#cards .report-carousel-slide').count();
   row.badge=await page.locator('#cards [data-card-id="trades"] .lt-badge').innerText();
   row.trades=await page.locator('#cards [data-card-id="trades"] tbody tr').count();
   row.sides=await page.locator('#cards [data-card-id="trades"] .lt-side').allInnerTexts().then(x=>x.reduce((m,s)=>(m[s]=(m[s]||0)+1,m),{}));
   row.firstRow=row.trades?(await page.locator('#cards [data-card-id="trades"] tbody tr').first().innerText()).replace(/\s+/g,' ').slice(0,140):null;
   for(const h of await page.locator('#cards [data-card-id="trades"] a').evaluateAll(a=>a.map(x=>x.href)))assert.match(h,/^https:\/\//);
   row.evidence=await page.locator('#evidenceCount').innerText();assert.match(row.evidence,/20 checks/);
   row.metrics=await page.locator('#cards .metric').count();
   row.overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(row.overflow,false);
   const tc='#cards [data-card-id="trades"]';
   row.status=(await page.locator(tc+' .lt-status').innerText()).replace(/\s+/g,' ').slice(0,160);
   row.evidenceCollapsed=await page.locator(tc+' .lt-evidence').evaluate(e=>e.open===false).catch(()=>null);assert.equal(row.evidenceCollapsed,true);
   await page.locator(tc+' .lt-evidence > summary').click();row.evidenceDetails=(await page.locator(tc+' .lt-evidence-body').innerText()).replace(/\s+/g,' ').slice(0,600);
   if(label==='POLL')assert.ok(['COVERAGE INCOMPLETE','LIVE','DELAYED'].includes(row.badge),'POLL shows honest coverage, never a bare NO RECENT SWAPS when active pools are uncovered');
   row.timing=timing;row.errors=errors;row.thirdPartyErrors=thirdParty.length;assert.deepEqual(errors,[]);
  }catch(e){fail++;row.error=String(e.message).slice(0,220);row.errors=errors;row.timing=timing;}
  console.log('::notice title=prod-'+label+'-'+width+'::'+JSON.stringify(row).slice(0,3800));
  if(width===1440&&label==='PEPE')await page.screenshot({path:'prod-1440.png'}).catch(()=>{});
  await page.close();
 }
 await browser.close();if(fail)process.exitCode=1;
})();
