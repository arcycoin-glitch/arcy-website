'use strict';
// Final Engine: six-card navigation + Live Trading rendering at 320/390/800/1440 px on arc/ethereum/robinhood.
// All API responses are mocked fixtures (never Production data); the fixture trades exist only inside this test.
const {chromium}=require('playwright'),{spawn}=require('node:child_process'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..'),schema=require('../search/server/schema');
const origin='http://127.0.0.1:3128',address='0x'+'1'.repeat(40),block='0x10';
const ORDER=['Live Trading','Liquidity & Trading','Holder & Whale','Contract & Mechanics','Supply & Burn','Market Activity'];
function trades(network,status='LIVE'){
 const explorer={arc:'https://explorer.arc.io',ethereum:'https://eth.blockscout.com',robinhood:'https://robinhoodchain.blockscout.com'}[network];
 const row=(side,i)=>({side,tokenAmount:String(1000+i),counterAmount:'0.5',counterSymbol:'WETH',usd:i%2?1500.5:null,usdStatus:i%2?'ORACLE_PRICED':'USD_NOT_VERIFIED',usdBasis:'x',
  wallet:'0x'+String(i).padStart(40,'a'),route:'ROUTER',txHash:'0x'+String(i).padStart(64,'b'),logIndex:i,block:String(100-i),blockHash:'0x'+'c'.repeat(64),timestamp:new Date(Date.now()-i*60000).toISOString(),
  pool:'0x'+'d'.repeat(40),poolKind:'V3',protocol:'uniswap-v3',explorerUrl:explorer+'/tx/0x'+String(i).padStart(64,'b'),verification:'ONCHAIN_VERIFIED'});
 return status==='LIVE'?{ok:true,network,status,tokenSymbol:'TEST',headBlock:'100',headAgeSeconds:2,window:{fromBlock:'1',toBlock:'100'},trades:['BUY','SELL','SWAP','BUY'].map(row)}:
  {ok:true,network,status:'UNSUPPORTED',reasonCode:'NO_VERIFIED_POOL',trades:[]};
}
(async()=>{let browser;const server=spawn(process.execPath,['dev.cjs'],{cwd:root,env:{...process.env,PORT:'3128'},windowsHide:true,stdio:['ignore','pipe','pipe']});
try{await new Promise((r,j)=>{server.stdout.once('data',r);server.once('error',j);});
 browser=await chromium.launch({headless:true,channel:process.env.ARCY_BROWSER_CHANNEL||'chrome'});let views=0;
 for(const width of[320,390,800,1440])for(const [network,chainId]of Object.entries({arc:5042,ethereum:1,robinhood:4663}))for(const mode of width===1440?['LIVE','UNSUPPORTED']:['LIVE']){
  const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});
  const unknown=()=>({value:null,dataState:'NOT_VERIFIED',status:'NOT_VERIFIED',reason:'Unknown fixture',evidence:[]});
  const cards=Object.fromEntries(schema.map(c=>[c.id,{fields:Object.fromEntries(c.fields.map(([k])=>[k,unknown()]))}]));
  cards.supply.fields.totalSupply={value:'1000',status:'ON_CHAIN',dataState:'DATA_FOUND',chainId,network,source:'Fixture',evidence:[{address,chainId,block,method:'Fixture'}]};
  // Mechanics is shown only with evidence (existing policy): one source-backed architecture row keeps it visible.
  cards.mechanics.fields.contractArchitecture={value:'NON-PROXY · runtime verified',status:'ON_CHAIN',dataState:'DATA_FOUND',chainId,network,source:'Fixture',evidence:[{address,chainId,block,method:'Fixture'}]};
  const data={ok:true,chainId,network,address,block,cardCount:5,token:{name:'Fixture',symbol:'TEST'},cards};
  let tradeRequests=0;
  await page.route('**/api/search?**',r=>{const u=new URL(r.request().url());if(u.searchParams.get('action')==='trades'){tradeRequests++;assert.equal(u.searchParams.get('chain'),network);assert.equal(u.searchParams.get('address'),address);return r.fulfill({json:trades(network,mode)});}return r.fulfill({json:data});});
  await page.route('https://www.geckoterminal.com/**',r=>r.fulfill({contentType:'text/html',body:'Fixture chart'}));
  await page.goto(origin+'/search/token/'+network+'/'+address);await page.waitForFunction(()=>document.querySelector('#detailState').textContent.includes('Snapshot complete'));
  await page.locator('#deepResearch').evaluate(e=>e.open=true);
  await page.waitForFunction(()=>document.querySelector('#cards [data-card-id="trades"] .lt-badge')?.textContent!=='BUSY');
  // navigation: six shortcuts in the required order
  const labels=await page.locator('#reportNavigation a span:not([aria-hidden])').allInnerTexts();
  assert.deepEqual(labels.map(x=>x.trim()),ORDER,'six shortcuts in order at '+width);
  assert.equal(await page.locator('#reportNavigation a svg.lt-icon').count(),1,'original Live Trading SVG mark');
  const tops=await page.locator('#reportNavigation a').evaluateAll(a=>a.map(x=>Math.round(x.getBoundingClientRect().top)));
  if(width>=1024){assert.equal(new Set(tops).size,1,'one desktop row');
   const h=await page.locator('#reportNavigation a').evaluateAll(a=>a.map(x=>Math.round(x.getBoundingClientRect().height)));assert.equal(new Set(h).size,1,'equal heights');}
  else assert.ok(await page.locator('#reportNavigation').evaluate(n=>n.scrollWidth>=n.clientWidth),'accessible horizontal scroll on narrow screens');
  // carousel: 1/6 Live Trading first, next/previous and shortcut click
  const pos=()=>page.locator('.report-carousel-controls [role="status"]').innerText();
  assert.equal(await page.locator('#cards .report-carousel-slide').count(),6);
  assert.equal(await pos(),'1 / 6 — Live Trading');
  await page.locator('.report-carousel-controls button').last().click();await page.waitForTimeout(150);
  assert.equal(await pos(),'2 / 6 — Liquidity & Trading');
  await page.locator('#reportNavigation a').nth(3).click();await page.waitForTimeout(250);
  assert.equal(await pos(),'4 / 6 — Contract & Mechanics');
  await page.locator('.report-carousel-controls button').first().click();await page.waitForTimeout(150);
  assert.equal(await pos(),'3 / 6 — Holder & Whale');
  await page.locator('#reportNavigation a').first().click();await page.waitForTimeout(250);
  assert.equal(await pos(),'1 / 6 — Live Trading');
  // Live Trading content
  const card='#cards [data-card-id="trades"]';
  if(mode==='LIVE'){
   assert.equal(await page.locator(card+' .lt-badge').innerText(),'LIVE');
   assert.equal(await page.locator(card+' tbody tr').count(),4);
   assert.equal(await page.locator(card+' tr.lt-buy .lt-side').first().innerText(),'Buy');
   assert.equal(await page.locator(card+' tr.lt-sell .lt-side').first().evaluate(e=>getComputedStyle(e).color),'rgb(255, 107, 107)');
   assert.equal(await page.locator(card+' tr.lt-buy .lt-side').first().evaluate(e=>getComputedStyle(e).color),'rgb(47, 211, 138)');
   for(const href of await page.locator(card+' a').evaluateAll(a=>a.map(x=>x.href)))assert.match(href,/^https:\/\//);
   assert.match(await page.locator(card+' tbody tr').first().innerText(),/WETH/);
    assert.deepEqual(await page.locator(card+' .lt-table-head th').allInnerTexts(),['Trade','Wallet','Amount','Time'],'visible four-column headings');
    assert.ok(await page.locator(card+' .lt-table-head').isVisible(),'column headings are shown');
    assert.equal(await page.locator(card+' tbody tr').first().locator('td').count(),4,'each trade has four aligned cells');
    const columns=await page.locator(card+' .lt-table').evaluate(table=>{
     const th=[...table.querySelectorAll('thead th')],td=[...table.querySelector('tbody tr').children];
     return th.map((h,i)=>({header:h.getBoundingClientRect().left,cell:td[i].getBoundingClientRect().left}));
    });
    for(const {header,cell} of columns)assert.ok(Math.abs(header-cell)<2,'header lines up with row at '+width+'px');
    assert.equal(await page.locator(card+' .lt-wallet').count(),4,'wallet shown without a Holders tab');
    assert.equal(await page.locator(card+' .lt-scope, '+card+' .description, '+card+' .lt-tx, '+card+' .lt-pool').count(),0,'no technical fields in compact feed');
    assert.ok(await page.locator(card+' .lt-table-wrap').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'no horizontal trade tape scroll');
  }else{
   assert.equal(await page.locator(card+' .lt-badge').innerText(),'LIMITED COVERAGE');
   assert.equal(await page.locator(card+' tbody tr').count(),0);assert.ok(await page.locator(card+' .lt-table-wrap').isHidden());
   assert.match(await page.locator(card+' .lt-status').innerText(),/No reviewed pool available/);
  }
  assert.ok(tradeRequests>=1&&tradeRequests<=2,'bounded trade requests ('+tradeRequests+')');
  assert.match(await page.locator('#evidenceCount').innerText(),/20 checks|\/20|of 20/,'20-check tally unchanged');
  assert.equal(await page.locator('#cards [data-card-id]').count(),6,'five analysis cards + Live Trading');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no page overflow at '+width);
  assert.deepEqual(errors,[]);await page.close();views++;
 }
 console.log('PASS: six-card navigation + Live Trading at 320/390/800/1440 px on arc/ethereum/robinhood ('+views+' views): order, 1/6 positions, next/previous/click, one desktop row, equal heights, BUY/SELL colours, https links, unsupported state, 20-check tally, aligned 4-column headings, no overflow or console errors. Mocked fixtures only.');
}finally{await browser?.close();server.kill();}})().catch(e=>{console.error(e);process.exit(1);});
