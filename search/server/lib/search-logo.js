'use strict';
// Locally stored CC0 artwork mapped by EXACT network + contract.
// Token pictures are decorative and never establish issuer authenticity.
// Source: spothq/cryptocurrency-icons (CC0-1.0).
const LOCAL=Object.freeze({
 arc:Object.freeze({
  '0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b':'/assets/hero-arcy.png',
  '0x3600000000000000000000000000000000000000':'/search/assets/token-icons/usdc.svg'
 }),
 ethereum:Object.freeze({
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2':'/search/assets/token-icons/eth.svg',
  '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9':'/search/assets/token-icons/aave.svg',
  '0x0d8775f648430679a709e98d2b0cb6250d2887ef':'/search/assets/token-icons/bat.svg',
  '0xd533a949740bb3306d119cc777fa900ba034cd52':'/search/assets/token-icons/crv.svg',
  '0xc00e94cb662c3520282e6f5717214004a7f26888':'/search/assets/token-icons/comp.svg',
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48':'/search/assets/token-icons/usdc.svg',
  '0xdac17f958d2ee523a2206206994597c13d831ec7':'/search/assets/token-icons/usdt.svg',
  '0x514910771af9ca656af840dff83e8264ecf986ca':'/search/assets/token-icons/link.svg',
  '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984':'/search/assets/token-icons/uni.svg',
  '0x6b175474e89094c44da98b954eedeac495271d0f':'/search/assets/token-icons/dai.svg',
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599':'/search/assets/token-icons/wbtc.svg',
  '0x45804880de22913dafe09f4980848ece6ecbaf78':'/search/assets/token-icons/paxg.svg'
 }),
 robinhood:Object.freeze({})
});
function localLogo(network,address){
 if(typeof network!=='string'||typeof address!=='string'||!/^0x[0-9a-f]{40}$/i.test(address))return null;
 return LOCAL[network]?.[address.toLowerCase()]||null;
}
async function enhance(network,items){
 if(!Array.isArray(items))return [];
 return items.slice(0,24).map(item=>{
  const local=localLogo(network,item.address);
  const registry=network==='robinhood'&&item.network==='robinhood'&&
   item.chainId===4663&&item.registryMatched===true&&
   item.source==='Robinhood official asset registry'?
    require('./robinhood-assets').registryLogo(item.logoUrl):null;
  // Public DEX/explorer images do not prove identity; only the authenticated
  // issuer/chain registry may supply the remote Stock Token logo.
  const logo=local||registry;
  return {...item,logoUrl:logo,logoSource:local?
   (local.endsWith('/hero-arcy.png')?'ARCY site-owned mascot':'CC0 cryptocurrency-icons; contract-matched'):
   registry?'Robinhood official asset registry (chain 4663) · artwork only':null};
 });
}
module.exports={imageFromPairs:()=>null,contractLogo:async(network,address)=>localLogo(network,address),localLogo,enhance};
