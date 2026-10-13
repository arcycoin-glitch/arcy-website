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
const dexMarket=require('./dex-market');
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
 let logoUrl=logos.localLogo(network,result.address);
 if(!logoUrl&&network==='robinhood'&&result.tokenIdentity?.status==='REGISTRY_MATCHED'){
  // Recheck directly against the issuer-operated asset registry. Never infer
  // a Stock Token logo from a ticker, DEX pair or unrelated token address.
  const issuer=await robinhood.inspectStock({address:result.address});
  logoUrl=issuer?.registryMatched===true&&issuer.address===result.address?
   require('./robinhood-assets').registryLogo(issuer.logoUrl):null;
 }
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
 chains.chain(network);
 // Providers are independent; Blockscout 403 or an unavailable official
 // registry must not blank other verified/source-scoped search candidates.
 const [registry,indexed,dexSearch]=await Promise.allSettled([
  network==='robinhood'?robinhood.discover({query}):Promise.resolve([]),
  explorerDiscovery.searchExplorer(network,query),
  dexMarket.discover(network,query)
 ]);
 const providers=[
  {name:'Robinhood official registry',response:registry},
  {name:'Blockscout explorer index',response:indexed},
  {name:'DEX Screener exact-chain pair index',response:dexSearch}
 ];
 const errors=providers.filter(p=>p.response.status==='rejected').map(p=>p.name);
 const candidates=providers.flatMap(p=>p.response.status==='fulfilled'&&Array.isArray(p.response.value)?
  p.response.value:[]);
 const ranked=identities.rank(network,query,candidates);
 const matches=await logos.enhance(network,ranked);
 return {ok:true,query,chainId:chains.chain(network).chainId,network,
  matches,source:'Issuer/Robinhood registries, explorer and DEX Screener source-scoped candidates',
  providerError:errors.length>0,unavailableSources:errors,
  note:'Official contract matches require exact chain+address identity. DEX pools and explorer names are NOT VERIFIED issuer identities. Names, logos and market activity do not establish investment safety.'};
}

module.exports={parseChain,report,token,discover,engine};
