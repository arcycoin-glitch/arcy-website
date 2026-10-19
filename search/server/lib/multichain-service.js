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
async function buildReport({network='ethereum',address}){
 chains.chain(network);
 // Logos are decorative and never contribute to on-chain identity or research evidence.
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
   require('./robinhood-assets').registryLogo(issuer.logoUrl,result.address):null;
  if(logoUrl)logoUrl=(await require('./logo-validation').validate(logoUrl,{registry:true,address:result.address}))?.url||null;
 }
 if(!logoUrl&&(network!=='robinhood'||result.tokenIdentity?.status!=='REGISTRY_MATCHED')){
  const [decorated]=await logos.enhance(network,[{network,chainId:chains.chain(network).chainId,
   address:result.address,logoUrl:null}]);
  logoUrl=decorated?.logoUrl||null;
 }
 if(logoUrl)result.token={...result.token,logoUrl};
 return result;
}
function report({network='ethereum',address,onProgress}){
 chains.chain(network);
 if(typeof address!=='string'||!/^0x[0-9a-f]{40}$/i.test(address))return Promise.reject(Error('Invalid token address'));
 const policy=['VERCEL','DEXSCREENER_PUBLIC_DISPLAY_APPROVED','GOPLUS_PUBLIC_DISPLAY_APPROVED','ETH_RPC_URL','ARC_RPC_URL','ARC_RPC_FALLBACK_URL','ROBINHOOD_RPC_URL','ROBINHOOD_RPC_FALLBACK_URL'].map(k=>process.env[k]||'');
 const key=JSON.stringify([network,address.toLowerCase(),policy]);
 return require('./analysis-scope').report(key,()=>require('./progress').run(async()=>{
  const start=Date.now(),d=require('./diagnostics');try{const result=await buildReport({network,address});d.record('report',network,'ok',Date.now()-start,Object.values(result.cards).flatMap(c=>Object.values(c.fields)).filter(f=>f.dataState==='DATA_FOUND').length);return result}catch(error){d.record('report',network,d.category(error),Date.now()-start);throw error}
 }),onProgress);
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
 const deadline=operation=>require('./timeout').withTimeout(Promise.resolve().then(operation),1000,'Optional discovery provider deadline');
 const [registry,indexed,dexSearch,prefix]=await Promise.allSettled([
  deadline(()=>network==='robinhood'?robinhood.discover({query}):[]),
  deadline(()=>explorerDiscovery.searchExplorer(network,query)),
  deadline(()=>dexMarket.discover(network,query)),
  // Arcscan's token-name prefix index is independent of Blockscout and DEX;
  // it never grants official identity or economic verification.
  network==='arc'?require('./timeout').withTimeout(
   require('./arc-prefix').discover(query),2000,'Arc prefix index deadline'):Promise.resolve([])
 ]);
 const providers=[
  {name:'Robinhood official registry',response:registry},
  {name:'Blockscout explorer index',response:indexed},
  {name:'DEX Screener exact-chain pair index',response:dexSearch},
  {name:'Arcscan public prefix index',response:prefix}
 ];
 const errors=providers.filter(p=>p.response.status==='rejected').map(p=>p.name);
 const candidates=providers.flatMap(p=>p.response.status==='fulfilled'&&Array.isArray(p.response.value)?
  p.response.value:[]);
 const ranked=identities.rank(network,query,candidates);
 let matches;
 try{matches=await require('./timeout').withTimeout(logos.enhance(network,ranked),350,'Optional discovery artwork deadline')}
 catch{matches=ranked.map(item=>({...item,logoUrl:logos.localLogo(network,item.address),logoSource:null}))}

 return {ok:true,query,chainId:chains.chain(network).chainId,network,
  matches,source:'Issuer/Robinhood registries, explorer and DEX Screener source-scoped candidates',
  providerError:errors.length>0,unavailableSources:errors,
  note:'Official contract matches require exact chain+address identity. DEX pools and explorer names are NOT VERIFIED issuer identities. Names, logos and market activity do not establish investment safety.'};
}

module.exports={parseChain,report,token,discover,engine};
