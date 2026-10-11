'use strict';
// One facade and contract-identity boundary; Ethereum retains its proven adapters.
const {createEngine}=require('./data-engine');
const ethereumReport=require('./report');
const ethereumDiscover=require('./discover');
const ethereumToken=require('./eth');
const robinhood=require('./robinhood-adapter');
const arc=require('./arc-adapter');
const chains=require('./chains');
const identities=require('./token-identity');
const logos=require('./search-logo');
const {createCache}=require('./discovery-cache');
const ethereumAdapter={
 async inspectToken({address}){
  const report=await ethereumReport.build(address);
  return {chainId:1,network:'ethereum',address:report.address,block:report.block,
   token:report.token,fullReport:report};
 },
 async inspectCard({base,cardId}){return base.fullReport.cards[cardId]},
 async discover({query}){return (await ethereumDiscover.discover(query)).map(x=>({...x,network:'ethereum',chainId:1}))}
};
const engine=createEngine({ethereum:ethereumAdapter,robinhood,arc});
const ethCache=createCache(async q=>engine.discover({network:'ethereum',query:q}).then(x=>x.candidates));
const rhCache=createCache(async q=>engine.discover({network:'robinhood',query:q}).then(x=>x.candidates));
const arcCache=createCache(async q=>engine.discover({network:'arc',query:q}).then(x=>x.candidates));
function parseChain(raw){
 const value=raw===undefined?'ethereum':raw;
 return chains.chain(value).id;
}
async function report({network='ethereum',address}){
 const cfg=chains.chain(network),normalized=typeof address==='string'?address.toLowerCase():'';
 // Source-backed art can run alongside mainnet inspection and must never
 // dictate contract identity, supply, ownership, price or security findings.
 const [result,logo]=await Promise.all([
  engine.report({network,address}),
  logos.contractLogo(cfg.id,normalized).catch(()=>null)
 ]);
 const official=identities.verified(network,result.address);
 if(official)result.tokenIdentity=official;
 if(logo&&result.token&&typeof result.token==='object'){
  result.token={...result.token,logoUrl:logo,
   logoSource:'DexScreener exact-chain base-contract pool; artwork is not issuer proof'};
 }
 return result;
}
async function token({network='ethereum',address}){
 if(network==='ethereum')return ethereumToken.inspect(address);
 const adapter=network==='arc'?arc:robinhood;
 const t=await adapter.inspectToken({address});
 const supply=await adapter.supply(t);
 return {ok:true,chainId:t.chainId,network:t.network,address:t.address,block:t.block,
  scannedAt:new Date().toISOString(),token:t.token,
  totalSupplyRaw:t.totalSupplyRaw,burnAddressRaw:t.burnAddressRaw,
  fields:{totalSupply:supply.fields.totalSupply,
   circulatingSupply:supply.fields.circulatingSupply,
   burnAddressBalance:supply.fields.burnAddressBalance,
   burnAddressPct:supply.fields.burnAddressPct}};
}
async function discover({network='ethereum',query}){
 const cache=network==='ethereum'?ethCache:network==='arc'?arcCache:rhCache;
 let response,providerError=false;
 try{response=await cache.find(query)}
 catch(error){
  // An exact issuer-sourced contract may be offered even if market search is down.
  if(!identities.knownMatches(network,query).length)throw error;
  response={matches:[],fetchedAt:Date.now(),cacheAgeMs:0};
  providerError=true;
 }
 const ranked=identities.rank(network,query,response.matches);
 const matches=await logos.enhance(network,ranked);
 return {ok:true,query,chainId:chains.chain(network).chainId,network,
  matches,sourceFetchedAt:new Date(response.fetchedAt).toISOString(),
  cacheAgeMs:response.cacheAgeMs,providerError,
  note:'Official contract matches require an exact chain+address match to first-party sources. Other search results remain NOT VERIFIED; contract identity does not establish investment safety.'};
}
module.exports={parseChain,report,token,discover,engine};
