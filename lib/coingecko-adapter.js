'use strict';
// CoinGecko API calls stay disabled until commercial-use rights for this
// product are verified. Never replace unknown circulation with total supply.
module.exports=async function disabledCoinGecko(){
 return {status:'NOT_VERIFIED',dataState:'SOURCE_HAS_NO_DATA',value:null,
  circulatingSupply:null,contractMatched:false,source:null,
  reasonCode:'PROVIDER_DISABLED_LICENSE_UNVERIFIED',
  reason:'CoinGecko API is disabled until applicable commercial-use rights are verified.'};
};
