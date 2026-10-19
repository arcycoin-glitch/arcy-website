'use strict';
// Small exact-chain discovery hints from previously observed public market
// results. NOT an official-issuer registry and NOT evidence of current trading.
const CANDIDATES=Object.freeze([
 Object.freeze({network:'arc',chainId:5042,address:'0xf76b1d00bd3d63a37246b5f512074e864010e33d',
  name:'Polly',symbol:'POLL',observedAt:'2026-10-19',
  source:'Previously observed Arc DEX token-index candidate (19 Oct 2026; identity NOT VERIFIED)'})
]);
function discover(network,query){
 const needle=String(query||'').normalize('NFKC').trim().toLowerCase();
 if(needle.length<2||needle.length>48)return [];
 return CANDIDATES.filter(x=>x.network===network&&
  [x.name.toLowerCase(),x.symbol.toLowerCase()].some(v=>v.startsWith(needle)))
  .map(x=>({...x,identityVerified:false,registryMatched:false,logoUrl:null}));
}
module.exports={CANDIDATES,discover};
