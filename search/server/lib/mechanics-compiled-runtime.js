'use strict';
// Full recompiled runtime fingerprint, NOT a selector/name heuristic.
// Only solc-declared constructor immutable words may vary. Metadata is retained.
// Review/reproduction: docs/V8_BURNMINT_RUNTIME_PROOF.md.
const crypto=require('node:crypto');
const DIGEST='817024e6aba5757bf907b1fccd09ee06cc83ed2caf620f3ec7e9463a70fe6558';
const HASH='f7d5d6b4b79d57aa53c042cabe1dc571d89908566c23cf0d698566235f7ed593';
const SOURCE='https://sourcify.dev/server/v2/contract/421614/0xa8c0c11bf64af62cdca6f93d3769b88bdd7cb93d?fields=all';
function fingerprint(code){
 if(typeof code!=='string'||!/^0x[0-9a-f]{15512}$/i.test(code))return null;
 const bytes=Buffer.from(code.slice(2),'hex'),word=start=>bytes.subarray(start,start+32).toString('hex');
 const decimals=BigInt('0x'+word(625)),caps=[1095,2243,2285].map(word);
 if(decimals>36n||new Set(caps).size!==1)return null;
 for(const start of[625,1095,2243,2285])bytes.fill(0,start,start+32);
 return {hash:crypto.createHash('sha256').update(bytes).digest('hex'),decimals:Number(decimals),maxSupplyRaw:BigInt('0x'+caps[0]).toString()};
}
function match(code){
 const proof=fingerprint(code);if(!proof||proof.hash!==HASH)return null;
 const fn=(name,type,inputs=[])=>({type:'function',name,stateMutability:'view',inputs:inputs.map(type=>({type})),outputs:[{type}]});
 return {digest:DIGEST,url:SOURCE,retrievedAt:null,runtimeMatch:'LOCALLY_RECOMPILED_EXACT_RUNTIME_IMMUTABLES_ONLY',
  abi:[fn('owner','address'),fn('getMinters','address[]'),fn('maxSupply','uint256'),fn('isMinter','bool',['address'])],
  runtimeReview:{compiler:'0.8.19+commit.7dd6d404',optimizerRuns:26000,evmVersion:'paris',metadataHash:'none',
   normalizedRuntimeSha256:HASH,sourceDigest:DIGEST,referenceChainId:421614,
   referenceAddress:'0xa8c0c11bf64af62cdca6f93d3769b88bdd7cb93d',
   compiledContract:'src/v0.8/shared/token/ERC677/BurnMintERC677.sol:BurnMintERC677',
   decimals:proof.decimals,maxSupplyRaw:proof.maxSupplyRaw,
   scope:'Reference supplies source dependencies only; local parent-contract recompilation matches this exact deployed runtime. No constructor/storage or cross-chain token identity equivalence is assumed.'}};
}
module.exports={match,fingerprint,DIGEST,HASH};
