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
function parseChain(raw){
 const value=raw===undefined?'ethereum':raw;
 return chains.chain(value).id;
}
async function report({network='ethereum',address}){
 chains.chain(network);
 // Provider artwork is disabled until reuse terms are cleared. This report
 // uses on-chain identity and source evidence only.
 const result=await engine.report({network,address});
 const official=identities.verified(network,result.address);
 if(official)result.tokenIdentity=official;
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
 chains.chain(network);
 const explorerDiscover=require('./discover').searchExplorer;
 const sources=[explorerDiscover(network,query)];
 if(network==='robinhood')sources.push(robinhood.discover({query}));
 const settled=await Promise.allSettled(sources);
 const candidates=settled.filter(x=>x.status==='fulfilled').flatMap(x=>x.value);
 const providerError=settled.some(x=>x.status==='rejected');
 // The explorer index is used only for token discovery. Its icon, market,
 // exchange-rate, and verification fields are deliberately discarded.
 // Issuer identity remains exact chain + contract evidence only.
 const ranked=identities.rank(network,query,candidates);
 if(!ranked.length&&providerError&&settled.every(x=>x.status==='rejected')){
  const failure=settled.find(x=>x.status==='rejected')?.reason;
  const error=Error('Token discovery sources are temporarily unavailable');
  error.code=String(failure?.code||failure?.cause?.code||failure?.name||'DISCOVERY_SOURCE_UNAVAILABLE').slice(0,64);
  throw error;
 }
 const matches=await logos.enhance(network,ranked);
 return {ok:true,query,chainId:chains.chain(network).chainId,network,
  matches,source:'Official issuer records, Robinhood asset registry, and Blockscout explorer index',providerError,
  note:'An indexed result is a discovery candidate, not proof of issuer identity. OFFICIAL CONTRACT requires an exact chain+address match to first-party issuer documentation; registry matches are separately labeled.'};
}
module.exports={parseChain,report,token,discover,engine};
