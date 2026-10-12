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
const explorerDiscovery=require('./discover');
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
 // Artwork is locally-hosted, strictly chain+contract matched decoration.
 const logoUrl=logos.localLogo(network,result.address);
 if(logoUrl)result.token={...result.token,logoUrl};
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
 const candidates=network==='robinhood'?await robinhood.discover({query}):[];
 let indexed=[],providerError=false;
 try{indexed=await explorerDiscovery.searchExplorer(network,query)}catch(error){providerError=true;console.warn('Explorer discovery unavailable:',String(error?.code||error?.name||'UNKNOWN').slice(0,64));}
 // Issuer-curated Arc/Ethereum addresses and the first-party Robinhood asset
 // registry remain searchable; no market-data catalog is queried.
 const ranked=identities.rank(network,query,candidates);
 const verified=await logos.enhance(network,ranked);
 const seen=new Set(verified.map(item=>String(item.address||'').toLowerCase()));
 const matches=[...verified];
 for(const item of indexed){if(seen.has(item.address))continue;seen.add(item.address);
  matches.push({...item,identity:{status:'NOT_VERIFIED'},identityVerified:false,logoUrl:null});
  if(matches.length>=24)break;
 }
 return {ok:true,query,chainId:chains.chain(network).chainId,network,
  matches,source:'First-party issuer/asset registries and network explorer index',providerError,
  note:'Official contract matches require an exact chain+address match to first-party sources. Other search results remain NOT VERIFIED; contract identity does not establish investment safety.'};
}
module.exports={parseChain,report,token,discover,engine};
