'use strict';
// Verified contract-creation block for chains whose public RPC is not an archive node (Ethereum, #337).
// A full Transfer ledger may start at the creation block (no Transfer of this contract can precede its creation), which
// saves ~13,000 empty eth_getLogs windows per Ethereum token. The block is NEVER taken from an explorer alone:
//   1. the explorer names a creation transaction hash (lead only);
//   2. eth_getTransactionReceipt on the chain's own RPC must show status 0x1 AND contractAddress == the token address;
//   3. the receipt's blockNumber is the start block.
// Factory-created contracts (receipt.contractAddress != token) and any mismatch fail closed with a stable code; the caller
// keeps the token NOT_VERIFIED (no scan from an unproven start, no partial ledger is ever published).
const ADDRESS=/^0x[0-9a-f]{40}$/,HASH=/^0x[0-9a-f]{64}$/;
const EXPLORERS=Object.freeze({1:'https://eth.blockscout.com/api/v2/addresses/'});
const fail=(code,extra={})=>Object.assign(Error(code),{code,...extra});
async function creationBlock(address,{chainId,rpc,getJson}){
 const a=String(address||'').toLowerCase();
 if(!ADDRESS.test(a))throw fail('CREATION_ADDRESS_INVALID');
 const base=EXPLORERS[chainId];if(!base)throw fail('CREATION_LOOKUP_UNSUPPORTED_CHAIN');
 let meta;try{meta=await getJson(base+a);}catch{throw fail('CREATION_EXPLORER_UNAVAILABLE');}
 const tx=String(meta?.creation_transaction_hash||meta?.creation_tx_hash||'').toLowerCase();
 if(String(meta?.hash||'').toLowerCase()!==a)throw fail('CREATION_EXPLORER_IDENTITY_MISMATCH');
 if(!HASH.test(tx))throw fail('CREATION_TRANSACTION_UNKNOWN');
 const receipt=await rpc('eth_getTransactionReceipt',[tx]);
 if(!receipt||String(receipt.transactionHash||'').toLowerCase()!==tx)throw fail('CREATION_RECEIPT_UNAVAILABLE');
 if(receipt.status!=='0x1')throw fail('CREATION_RECEIPT_FAILED');
 if(String(receipt.contractAddress||'').toLowerCase()!==a)throw fail('CREATION_NOT_DIRECT_DEPLOYMENT');
 if(!/^0x[0-9a-f]+$/i.test(String(receipt.blockNumber||'')))throw fail('CREATION_BLOCK_INVALID');
 const block=Number(BigInt(receipt.blockNumber));
 if(!Number.isSafeInteger(block)||block<0)throw fail('CREATION_BLOCK_INVALID');
 return {block,transactionHash:tx,method:'explorer creation tx hash + RPC receipt (status 0x1, contractAddress == token)',explorer:base+a};
}
module.exports={creationBlock,EXPLORERS};
