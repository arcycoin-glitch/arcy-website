'use strict';
// Extremely narrow, manually reviewed exact-deployment evidence. The published source
// must independently match deployed bytecode via mechanics-deep.sourceFor; no ticker
// or function-selector heuristic is allowed to make a contract safety claim.
const ID=Object.freeze({
 network:'ethereum',chainId:1,address:'0xa258f0980959dc337aca08575d1f3ffd0a6aa2e5',
 sourceDigest:'cdc28723db0bf52fc3738c7e97c7babfc7f2df1cfc44bed4a6d2c2161ff54304',
 creator:'0xeac777fe137b2fb6c78074aca2843432af4168cc',
 proofBlock:'0x191fb69'
});
function apply({network,address,source,fields,details,fact}){
 if(network!==ID.network||address?.toLowerCase()!==ID.address||
    source?.digest!==ID.sourceDigest||!['match','exact_match'].includes(source.runtimeMatch))return false;
 // This source is NOT unmodified OpenZeppelin. In its custom ERC20._transfer,
 // maxWalletLimits executes returnTx() after _update. For tx.origin previously
 // marked isExile in the constructor, assembly return exits transferFrom before
 // _spendAllowance runs. A pinned read-only eth_call from the EOA deployer
 // returned true for a positive self-transfer despite allowance=0. No transaction
 // was broadcast. Do not label the token as unprivileged or standard ERC20.
 const proof={address:ID.address,chainId:ID.chainId,sourceUrl:source.url,
   sourceDigest:ID.sourceDigest,runtimeMatch:source.runtimeMatch,
   creator:ID.creator,simulatedBlock:ID.proofBlock,method:'Manually reviewed exact Solidity source + read-only eth_call',
   scope:'Deployer-origin privilege is demonstrated for a zero-allowance self-transfer. This is not evidence of any actual unauthorized transfer or loss; independent pools and hooks are outside token scope.'};
 fields.ownerAdmin=fact('Deployer-origin privileged transferFrom path',
   'Exact source: tx.origin-gated assembly return skips transferFrom allowance enforcement',
   {...proof,control:'CREATOR_ORIGIN_ALLOWANCE_BYPASS',verifiedReadOnly:true},'VERIFIED_SOURCE_AND_STATE');
 fields.mintCapability=fact('Constructor-only mint · no runtime issuance entry point',
   'Reviewed exact derived token source and modified ERC20 implementation',
   {...proof,scope:'Only the constructor calls _mint in this reviewed source. No external mint endpoint or source path is exposed; separate contracts and future unrelated versions are not assessed.'},'VERIFIED_SOURCE');
 fields.tradingTaxes=fact('Token transfer 0% · privileged control detected',
   'Reviewed full-value _update path with no token transfer fee',
   {...proof,coverage:'TOKEN_TRANSFER_ONLY',scope:'_update moves the full value with no fee deduction. A deployer-origin allowance bypass is independently reported; DEX/pool/hook fees remain NOT VERIFIED. This is not a safety endorsement.'},'VERIFIED_SOURCE');
 details.observations.push({method:'Exact reviewed GTA6 implementation special transfer control',
   ...proof,control:'CREATOR_ORIGIN_ALLOWANCE_BYPASS',allowanceRaw:'0',
   ethCallResult:'0x'+'0'.repeat(63)+'1',
   scope:'Read-only call at pinned block returned true with creator self-allowance zero. Real transfer privileges or harms to other wallets have not been measured.'});
 return true;
}
module.exports={ID,apply};
