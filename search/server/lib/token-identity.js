'use strict';
// Curated canonical token identity: a chain AND a full contract address must
// exactly match a token issuer's public, first-party contract documentation.
// Market lists, ticker/logo matching, popularity and search ranking are NOT proof.
const ADDRESS=/^0x[0-9a-f]{40}$/i;
const {safeLogoUrl}=require('./token-image');
const OFFICIAL=Object.freeze([
 // First-party ARCY contract from the existing official website repository.
 // Do not apply this identity to other Arc lookalikes or other EVM chains.
 Object.freeze({
  network:'arc',chainId:5042,address:'0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b',
  name:'ARCY',symbol:'ARCY',issuer:'ARCY',
  proofUrl:'https://github.com/arcycoin-glitch/arcy-website/blob/main/test/live.cjs'
 }),
 // Circle's first-party Arc documentation identifies this same fixed native
 // USDC predeploy on Arc mainnet (chainId 5042).
 Object.freeze({
  network:'arc',chainId:5042,address:'0x3600000000000000000000000000000000000000',
  name:'USD Coin',symbol:'USDC',issuer:'Circle',
  proofUrl:'https://developers.circle.com/stablecoins/usdc-contract-addresses'
 }),
 // First-party Argus token page plus the live Arc RPC metadata call confirms
 // this name, symbol and contract. The token's actual ticker is ARCARG (not
 // ARGUS); the name match supports searching for "Argus" without relabelling it.
 Object.freeze({
  network:'arc',chainId:5042,address:'0x7d10b4331a990017938d66542f43fa4a72aacb73',
  name:'angel of arc argus',symbol:'ARCARG',issuer:'Argus',
  proofUrl:'https://argus.world/token/0x7D10b4331A990017938d66542f43fa4A72AACB73'
 }),
 // floki.com itself specifies its Ethereum contract. BNB token has a different
 // address and is deliberately NOT a match on the Ethereum Search network.
 Object.freeze({
  network:'ethereum',chainId:1,address:'0xcf0c122c6b73ff809c693db761e7baebe62b6a2e',
  name:'Floki',symbol:'FLOKI',issuer:'Floki',
  proofUrl:'https://floki.com/'
 }),
 Object.freeze({
  network:'ethereum',chainId:1,address:'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  name:'USD Coin',symbol:'USDC',issuer:'Circle',
  proofUrl:'https://developers.circle.com/stablecoins/usdc-contract-addresses'
 }),
 Object.freeze({
  network:'ethereum',chainId:1,address:'0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
  name:'Uniswap',symbol:'UNI',issuer:'Uniswap',
  proofUrl:'https://developers.uniswap.org/docs/ecosystem/governance/uni'
 }),
 Object.freeze({
  network:'ethereum',chainId:1,address:'0x514910771af9ca656af840dff83e8264ecf986ca',
  name:'Chainlink',symbol:'LINK',issuer:'Chainlink',
  proofUrl:'https://docs.chain.link/resources/link-token-contracts'
 }),
 Object.freeze({
  network:'ethereum',chainId:1,address:'0xdac17f958d2ee523a2206206994597c13d831ec7',
  name:'Tether USD',symbol:'USDT',issuer:'Tether',
  proofUrl:'https://tether.to/en/supported-protocols/'
 }),
 Object.freeze({network:'ethereum',chainId:1,address:'0x6b175474e89094c44da98b954eedeac495271d0f',
  name:'Dai Stablecoin',symbol:'DAI',issuer:'Sky / Maker',
  proofUrl:'https://github.com/sky-ecosystem/developerguides/blob/master/dai/dai-token/dai-token.md'}),
 Object.freeze({network:'ethereum',chainId:1,address:'0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
  name:'Wrapped BTC',symbol:'WBTC',issuer:'WBTC',
  proofUrl:'https://www.wbtc.network/transparency'}),
 Object.freeze({network:'ethereum',chainId:1,address:'0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce',
  name:'Shiba Inu',symbol:'SHIB',issuer:'Shiba Inu',
  proofUrl:'https://shib.io/developers'}),
 Object.freeze({network:'ethereum',chainId:1,address:'0x9813037ee2218799597d83d4a5b6f3b6778218d9',
  name:'Bone ShibaSwap',symbol:'BONE',issuer:'Shiba Inu',
  proofUrl:'https://shib.io/developers'}),
 Object.freeze({network:'ethereum',chainId:1,address:'0x27c70cd1946795b66be9d954418546998b546634',
  name:'Doge Killer',symbol:'LEASH',issuer:'Shiba Inu',
  proofUrl:'https://shib.io/developers'}),
 Object.freeze({network:'ethereum',chainId:1,address:'0xa02c49da76a085e4e1ee60a6b920ddbc8db599f4',
  name:'Shiba Inu TREAT',symbol:'TREAT',issuer:'Shiba Inu',
  proofUrl:'https://shib.io/developers'}),
 Object.freeze({network:'ethereum',chainId:1,address:'0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3',
  name:'Ondo',symbol:'ONDO',issuer:'Ondo Foundation',
  proofUrl:'https://docs.ondo.foundation/ondo-token'}),
 Object.freeze({network:'ethereum',chainId:1,address:'0x45804880de22913dafe09f4980848ece6ecbaf78',
  name:'PAX Gold',symbol:'PAXG',issuer:'Paxos',
  proofUrl:'https://paxos.com/wp-content/uploads/2019/09/PAX-Gold-Whitepaper.pdf'})
]);
function verified(network,address){
 if(typeof network!=='string'||typeof address!=='string'||!ADDRESS.test(address))return null;
 const token=OFFICIAL.find(x=>x.network===network&&x.address===address.toLowerCase());
 return token?{status:'OFFICIAL_CONTRACT_MATCHED',type:'TOKEN',chainId:token.chainId,
  address:token.address,issuer:token.issuer,source:'Official issuer contract documentation',
  proofUrl:token.proofUrl}:null;
}
function knownMatches(network,query){
 if(typeof query!=='string')return [];
 const q=query.normalize('NFKC').trim().toLocaleLowerCase('en-US');
 if(q.length<2)return [];
 const inNetwork=OFFICIAL.filter(x=>x.network===network);
 const exact=inNetwork.filter(x=>x.symbol.toLowerCase()===q||x.name.toLowerCase()===q);
 const prefix=inNetwork.filter(x=>x.symbol.toLowerCase().startsWith(q)||x.name.toLowerCase().startsWith(q));
 const matches=exact.length?exact:prefix.length?prefix:inNetwork.filter(x=>
  x.symbol.toLowerCase().includes(q)||x.name.toLowerCase().includes(q));
 return matches.map(x=>({address:x.address,network:x.network,chainId:x.chainId,
  name:x.name,symbol:x.symbol,source:'Official issuer contract documentation',
  identity:verified(network,x.address),identityVerified:true}));
}
function rank(network,query,candidates){
 if(!Array.isArray(candidates))throw Error('Invalid token search candidates');
 const known=knownMatches(network,query);
 const ordered=new Map();
 // First-party canonical records always win over provider-supplied display names.
 for(const x of known)ordered.set(x.address,x);
 const trustedStock=(item)=>network==='robinhood'&&item.registryMatched===true&&
  item.source==='Robinhood official asset registry';
 for(const item of candidates){
  if(!item||item.network!==network||item.chainId!==require('./chains').chain(network).chainId)continue;
  const address=typeof item.address==='string'?item.address.toLowerCase():'';
  if(!ADDRESS.test(address))continue;
  if(ordered.has(address)){
   const previous=ordered.get(address);
   // An issuer-authenticated token can reuse marketplace artwork by EXACT
   // contract address, but artwork NEVER conveys verification status.
   const logoUrl=previous.logoUrl||safeLogoUrl(item.logoUrl);
   if(logoUrl&&!previous.logoUrl)ordered.set(address,{...previous,logoUrl});
   continue;
  }
  const official=verified(network,address);
  const stock=trustedStock(item);
  const stockArt=stock?require('./robinhood-assets').registryLogo(item.logoUrl):null;
  const identity=official||(stock?{
   status:'REGISTRY_MATCHED',type:'STOCK_TOKEN',chainId:4663,address,
   issuer:'Robinhood Chain official asset registry',
   source:'Robinhood official asset registry',
   proofUrl:'https://api.robinhood.com/rhj/assets'
  }:{status:'NOT_VERIFIED',type:null,source:null,proofUrl:null});
  const canonical=OFFICIAL.find(x=>x.network===network&&x.address===address);
  ordered.set(address,{address,network,chainId:item.chainId,
   name:canonical?.name||String(item.name||'').slice(0,90),
   symbol:canonical?.symbol||String(item.symbol||'').slice(0,30),
   source:canonical?'Official issuer contract documentation':String(item.source||'').slice(0,100),
   registryMatched:stock,logoUrl:stockArt,identityVerified:identity.status==='OFFICIAL_CONTRACT_MATCHED'||identity.status==='REGISTRY_MATCHED',identity});
 }
 const rows=[...ordered.values()];
 rows.sort((a,b)=>{
   const importance=x=>x.identity?.status==='OFFICIAL_CONTRACT_MATCHED'?0:
   x.identity?.status==='REGISTRY_MATCHED'?1:2;
  return importance(a)-importance(b);
 });
 return rows.slice(0,12);
}
module.exports={OFFICIAL,verified,knownMatches,rank};
