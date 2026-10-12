'use strict';

const REASON='Market-data provider pending commercial-use verification. No market value or history is served until the source is approved.';
function field(){
 return {value:null,status:'NOT_VERIFIED',dataState:'NOT_VERIFIED',reasonCode:'PROVIDER_DISABLED_LICENSE_UNVERIFIED',reason:REASON,source:null,evidence:[]};
}
function fields(){
 return {liquidityUsd:field(),volume24h:field(),dexPairCount:field(),lpStatus:field(),
  priceUsd:field(),valuation:{...field(),kind:null},change24h:field()};
}
function card(){return {fields:fields(),description:REASON,status:'NOT_VERIFIED'};}
module.exports={REASON,field,fields,card};
