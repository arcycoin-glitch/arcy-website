'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const logos=require('../search/server/lib/search-logo');
const chart=require('../search/server/api/chart');
const history=require('../search/server/lib/price-history');
const ARCY='0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b';
const USDC='0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const ROGUE='0x'+'f'.repeat(40);
function reply(){
 return {statusCode:200,headers:{},body:null,
  setHeader(k,v){this.headers[k]=v;return this},
  status(n){this.statusCode=n;return this},
  json(obj){this.body=obj;return this}};
}
const request=(network,address,range='30D')=>({
 method:'GET',query:{chain:network,address,range},headers:{},
 socket:{remoteAddress:'127.0.0.1'}
});
test('Site-owned mascot and CC0 token art are exact-network/exact-contract only',async()=>{
 assert.equal(logos.localLogo('arc',ARCY),'/assets/hero-arcy.png');
 assert.equal(logos.localLogo('ethereum',ARCY),null);
 assert.equal(logos.localLogo('ethereum',USDC),'/search/assets/token-icons/usdc.svg');
 assert.equal(logos.localLogo('arc',USDC),null);
 assert.equal(logos.localLogo('ethereum',ROGUE),null);
 const rows=await logos.enhance('ethereum',[{
  network:'ethereum',address:USDC,logoUrl:'https://untrusted.example/false.svg'
 },{
  network:'ethereum',address:ROGUE,logoUrl:'https://untrusted.example/false.svg'
 }]);
 assert.equal(rows[0].logoUrl,'/search/assets/token-icons/usdc.svg');
 assert.equal(rows[1].logoUrl,null);
 for(const id of ['usdc','usdt','link','uni','dai','wbtc','paxg']){
  const filename=path.join(__dirname,'../search/assets/token-icons/'+id+'.svg');
  const content=fs.readFileSync(filename,'utf8');
  assert.match(content,/^<svg\b/);
  assert.doesNotMatch(content,/<script|onload\s*=/i);
 }
});
test('Premium chart does not use unlicensed source or fake values',async()=>{
 const previous=process.env.ARCY_CHART_DATA_LICENSE_APPROVED;
 delete process.env.ARCY_CHART_DATA_LICENSE_APPROVED;
 const original=history.load;let calls=0;
 history.load=async()=>{calls++;throw Error('must remain disabled')};
 try{
  const res=reply();await chart(request('arc',ARCY),res);
  assert.equal(res.statusCode,503);
  assert.equal(res.body.error,'CHART_SOURCE_PENDING');
  assert.equal(calls,0);
 }finally{
  history.load=original;
  if(previous===undefined)delete process.env.ARCY_CHART_DATA_LICENSE_APPROVED;
  else process.env.ARCY_CHART_DATA_LICENSE_APPROVED=previous;
 }
});
test('Premium chart permits only source-backed, matching licensed candles',async()=>{
 const previous=process.env.ARCY_CHART_DATA_LICENSE_APPROVED;
 process.env.ARCY_CHART_DATA_LICENSE_APPROVED='true';
 const original=history.load;
 const dataset={ok:true,network:'arc',chainId:5042,address:ARCY,range:'1D',currency:'USD',
  poolAddress:'0x'+'b'.repeat(40),
  source:'GeckoTerminal',sourceUrl:'https://www.geckoterminal.com/arc/pools/0x'+'b'.repeat(40),
  lastCandleTime:1770000000,points:[{time:1769996400,close:2},{time:1770000000,close:3}]};
 let called=null;
 history.load=async(network,address,opts)=>{called={network,address,range:opts.range};return dataset};
 try{
  const res=reply();await chart(request('arc',ARCY,'1D'),res);
  assert.equal(res.statusCode,200);
  assert.equal(res.body.source,'GeckoTerminal');
  assert.deepEqual(called,{network:'arc',address:ARCY,range:'1D'});
  history.load=async()=>({...dataset,address:ROGUE});
  const invalid=reply();await chart(request('arc',ARCY,'1D'),invalid);
  assert.equal(invalid.statusCode,503);
  assert.equal(invalid.body.error,'CHART_SOURCE_UNAVAILABLE');
 }finally{
  history.load=original;
  if(previous===undefined)delete process.env.ARCY_CHART_DATA_LICENSE_APPROVED;
  else process.env.ARCY_CHART_DATA_LICENSE_APPROVED=previous;
 }
});
test('Official GeckoTerminal iframe embed replaces custom chart fetch without removing supported presets',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../search/index.html'),'utf8');
 assert.match(html,/PRICE HISTORY · GECKOTERMINAL LIVE EMBED/);
 assert.match(html,/createElement\(['"]iframe['"]\)/);
 assert.match(html,/www\.geckoterminal\.com/);
 assert.match(html,/chart_type:'price'/);
 assert.match(html,/The provider controls the visible date range/);
 assert.match(html,/Open GeckoTerminal source chart/);
 for(const preset of ['4H','1D','1W','30D'])assert.match(html,new RegExp('data-range="'+preset+'"'));
 assert.match(html,/const supported=Object\.freeze\(\{arc:'arc',ethereum:'eth',robinhood:'robinhood'\}\)/);
 const fn=html.slice(html.indexOf('async function loadVerifiedChart('),html.indexOf('function renderQuickFacts(',html.indexOf('async function loadVerifiedChart(')));
 assert.doesNotMatch(fn,/fetch\(/);
});
