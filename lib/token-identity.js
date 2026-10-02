const c=require('./core');
async function inspect(address){
 const {block}=await c.context(address);
 try{const [s,d]=await Promise.all([c.call(address,'0x18160ddd',block),c.call(address,'0x313ce567',block)]);
 const total=c.uint(s),decimals=c.uint(d);if(decimals>255n)throw Error('Unsupported decimals');
 return {address,chainId:c.CHAIN,block,totalSupplyRaw:total.toString(),decimals:Number(decimals),scope:'Arc bytecode plus valid totalSupply/decimals getter responses at one block; token symbols are not identity.'};
 }catch(error){if(error.code==='GETTER_REVERTED'||!error.code)error.code='TOKEN_IDENTITY_NOT_VERIFIED';throw error;}
}
module.exports={inspect};
