'use strict';
const {unknown}=require('./evidence');
const {ADDRESS}=require('./eth');
function parse(){
 return unknown('CoinGecko data is disabled for ARCY SEARCH until the applicable commercial-use rights are verified.','PROVIDER_DISABLED_LICENSE_UNVERIFIED');
}
async function inspect(address,totalSupply,options={}){
 if(!ADDRESS.test(address))return unknown('Invalid Ethereum contract address.','INVALID_ADDRESS');
 const circle=await require('./circle-circulating').inspect(address,totalSupply,options);
 if(circle)return circle;
 const issuer=await require('./issuer-circulating').inspect(address,totalSupply,options);
 if(issuer)return issuer;
 return parse();
}
module.exports={parse,inspect};
