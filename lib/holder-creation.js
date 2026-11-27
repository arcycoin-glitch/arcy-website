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
 const receipt=await rpc('eth_getTransactionReceipt',[tx]).catch(()=>null);
 if(receipt&&String(receipt.transactionHash||'').toLowerCase()===tx){
  if(receipt.status!=='0x1')throw fail('CREATION_RECEIPT_FAILED');
  if(String(receipt.contractAddress||'').toLowerCase()!==a)throw fail('CREATION_NOT_DIRECT_DEPLOYMENT');
  return {block:blockOf(receipt.blockNumber),transactionHash:tx,method:'explorer creation tx hash + RPC receipt (status 0x1, contractAddress == token)',explorer:base+a};
 }
 // Public non-archive endpoints may prune old receipts (CI run 46011743606: 6/6 CREATION_RECEIPT_UNAVAILABLE on rpc.flashbots.net).
 // Receipt-free proof: the transaction itself (eth_getTransactionByHash) is a plain CREATE (to == null) whose deterministic address
 // keccak256(rlp([from, nonce]))[12:] equals the token, AND the token has code now. Only that (from, nonce) can ever create this
 // address, so a contract existing at it was created by this transaction, in its block. CREATE2/factory deployments fail closed.
 const t=await rpc('eth_getTransactionByHash',[tx]).catch(()=>null);
 if(!t||String(t.hash||'').toLowerCase()!==tx||!t.blockNumber)throw fail('CREATION_RECEIPT_UNAVAILABLE');
 if(t.to!==null&&t.to!==undefined)throw fail('CREATION_NOT_DIRECT_DEPLOYMENT');
 if(!ADDRESS.test(String(t.from||'').toLowerCase())||!/^0x[0-9a-f]+$/i.test(String(t.nonce||'')))throw fail('CREATION_TRANSACTION_INVALID');
 if(createAddress(t.from,BigInt(t.nonce))!==a)throw fail('CREATION_NOT_DIRECT_DEPLOYMENT');
 const code=await rpc('eth_getCode',[a,'latest']);
 if(!/^0x(?:[0-9a-f]{2})+$/i.test(code||''))throw fail('CREATION_CODE_ABSENT');
 return {block:blockOf(t.blockNumber),transactionHash:tx,method:'explorer creation tx hash + RPC transaction (to == null, keccak256(rlp([from, nonce])) == token) + current code',explorer:base+a};
}
function blockOf(hex){if(!/^0x[0-9a-f]+$/i.test(String(hex||'')))throw fail('CREATION_BLOCK_INVALID');const b=Number(BigInt(hex));if(!Number.isSafeInteger(b)||b<0)throw fail('CREATION_BLOCK_INVALID');return b;}
// CREATE address: keccak256(rlp([sender, nonce]))[12:] (Ethereum Yellow Paper eq. 85).
function rlpBytes(buf){if(buf.length===1&&buf[0]<0x80)return buf;if(buf.length<56)return Buffer.concat([Buffer.from([0x80+buf.length]),buf]);const l=Buffer.from(buf.length.toString(16).padStart(2,'0').replace(/^(.(..)*)$/,'0$1'),'hex');return Buffer.concat([Buffer.from([0xb7+l.length]),l,buf]);}
function createAddress(from,nonce){
 const sender=Buffer.from(String(from).toLowerCase().slice(2),'hex');
 let n=nonce.toString(16);if(n==='0')n='';if(n.length%2)n='0'+n;
 const payload=Buffer.concat([rlpBytes(sender),rlpBytes(Buffer.from(n,'hex'))]);
 const list=Buffer.concat([Buffer.from([0xc0+payload.length]),payload]);
 return '0x'+require('./keccak')(list).slice(-40).toLowerCase();
}
module.exports={creationBlock,createAddress,EXPLORERS};
