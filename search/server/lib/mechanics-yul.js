'use strict';
// #337 (TENDIES 4663:0x4524…fcf9): a Sourcify record whose chain, address and exact runtime bytecode match the deployed contract
// but which is a hand-written Yul object without a Solidity ABI. Used only to name that failure precisely; mechanics-deep's
// validateSource stays byte-identical (PR26 freeze) and the field stays NOT_VERIFIED.
const CODE=/^0x(?:[0-9a-f]{2})+$/i;
function matchedYul(d,{chainId,address,code}){
 return String(d?.chainId)===String(chainId)&&typeof d?.address==='string'&&d.address.toLowerCase()===String(address).toLowerCase()&&
  ['match','exact_match'].includes(d?.runtimeMatch)&&CODE.test(code||'')&&d.runtimeBytecode?.onchainBytecode?.toLowerCase()===code.toLowerCase()&&
  String(d.compilation?.language||'').toLowerCase()==='yul'&&!Array.isArray(d.abi);
}
module.exports={matchedYul};
