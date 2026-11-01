'use strict';
// Classifies a JSON-RPC error object. Only provider-side, temporary conditions
// (rate limit, capacity, upstream timeout) are transient. Contract reverts and
// malformed requests are deterministic: retrying or failing over cannot change
// them, so they must never be re-sent or hidden behind another provider.
const TRANSIENT_CODES=new Set([-32005,-32016,-32029,-32097,-32098,-32099]);
const TRANSIENT_TEXT=/rate.?limit|too many requests|capacity|overload|temporar|try again|timed? ?out|busy|unavailable|throttl/i;
function transientRpcError(error){
 if(!error||typeof error!=='object')return false;
 const message=typeof error.message==='string'?error.message.slice(0,300):'';
 if(error.code===3||/revert|invalid opcode|out of gas|stack|missing trie node|header not found|block not found|unknown block|pruned|state .*not available/i.test(message))return false;
 if(TRANSIENT_CODES.has(error.code))return true;
 // Generic server errors (-32000/-32603) only count when the text says why.
 return [-32000,-32603].includes(error.code)&&TRANSIENT_TEXT.test(message);
}
module.exports={transientRpcError};
