'use strict';
// Read-only comparison of real token reports, with all application credentials removed.
const fs = require('node:fs');
const path = require('node:path');
const [repo, output] = process.argv.slice(2);
if (!repo || !output) throw Error('Usage: node coverage-audit.cjs <repo> <output>');
const keep = new Set(['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP']);
for (const key of Object.keys(process.env)) if (!keep.has(key)) delete process.env[key];
process.env.VERCEL = '1';
const service = require(path.join(path.resolve(repo), 'search/server/lib/multichain-service.js'));
const tokens = [
  ['arc','ARCY','0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b'],
  ['ethereum','USDT','0xdac17f958d2ee523a2206206994597c13d831ec7'],
  ['robinhood','AAPL','0xaf3d76f1834a1d425780943c99ea8a608f8a93f9'],
  ['arc','ARGUS','0xece5ca8bf9220718e5727754026757512212cb3c'],
  ['ethereum','USDC','0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'],
  ['robinhood','TSLA','0x322f0929c4625ed5bad873c95208d54e1c003b2d'],
  ['arc','USDT-Arc','0x3b0d0f9825850d3ab1491253b86c4cc26ff1250a'],
  ['ethereum','UNI','0x1f9840a85d5af5bf1d1762f925bdaddc4201f984'],
  ['robinhood','LINK','0x492641f648a4986844848e0befe66d14817bce34']
];
function compact(fields) {
  return Object.fromEntries(Object.entries(fields || {}).map(([key, f]) => [key, {
    dataState: f?.dataState || null, status: f?.status || null,
    reasonCode: f?.reasonCode || null, source: f?.source || null
  }]));
}
async function run([network,symbol,address]) {
  const started=Date.now();
  try {
    const report=await service.report({network,address});
    return {network,symbol,address,block:report.block,ms:Date.now()-started,
      mechanics:compact(report.cards.mechanics.fields),
      supply:compact(report.cards.supply.fields),
      supplyContext:compact(report.cards.supply.context)};
  } catch (error) {
    return {network,symbol,address,ms:Date.now()-started,error: error.code || error.name || 'ERROR'};
  }
}
(async()=>{
 const results=[];
 for(let i=0;i<tokens.length;i+=3){
  const batch=await Promise.all(tokens.slice(i,i+3).map(run));
  results.push(...batch);
  for(const result of batch) console.log(JSON.stringify({network:result.network,symbol:result.symbol,ms:result.ms,error:result.error||null}));
  fs.writeFileSync(output,JSON.stringify({mode:'read-only public providers; no credentials; no deployment',results},null,2));
 }
})().catch(error=>{console.error(error.name);process.exitCode=1});
