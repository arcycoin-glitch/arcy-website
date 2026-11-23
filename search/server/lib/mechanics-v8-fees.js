'use strict';
const {address,recorder}=require('./mechanics-v8-evidence');
const {reviewed}=require('../../../lib/mechanics-hook');
const DIGEST=/^[0-9a-f]{64}$/i, HASH=/^0x[0-9a-f]{64}$/i;
const TRIPLET='Buy 0% · Sell 0% · Transfer 0%';
const PARTIAL='Transfer 0% · DEX/hook fees NOT VERIFIED';
const FEE_KINDS=['TOKEN_CONTRACT_TAX','DEX_PROTOCOL_FEE','POOL_SWAP_FEE','ROUTER_FEE','HOOK_FEE','AGGREGATOR_FEE','SLIPPAGE','GAS'];
const UNAVAILABLE={
 TOKEN_CONTRACT_TAX:'Executed token deduction has not been established for all transfer directions.',
 DEX_PROTOCOL_FEE:'No pinned protocol fee for a specific swap route.',
 POOL_SWAP_FEE:'No pinned, identified pool fee configuration.',
 ROUTER_FEE:'No router and calldata bound to a swap.',
 HOOK_FEE:'No verified hook and pool for this fee.',
 AGGREGATOR_FEE:'No identified aggregation route and fee recipient.',
 SLIPPAGE:'Requires an ordered quote and execution for a specific trade.',
 GAS:'Requires transaction or gas estimate context.'
};
const ALL='TOKEN_TAX_ALL_TRANSFERS', ONLY='TOKEN_CONTRACT_ONLY';
const STRICT=new Set(['VERIFIED_SOURCE_AND_STATE','ONCHAIN_VERIFIED','ON_CHAIN_VERIFIED_UNITS']);
const same=(e,c)=>e?.chainId===c.chainId&&address(e.address)===address(c.address)&&e.block===c.block;

function directZero(fact,proof,scope){
 return fact(TRIPLET,'Reviewed unconditional full-amount token transfers + pinned non-delegating runtime',{
  ...proof,coverage:ALL,tokenTaxScope:ONLY,sourceBoundNonDelegatingRuntime:true,mutable:false,
  tokenTax:{classification:'CURRENT_VERIFIED_TAX',denominator:'100',buy:'0',sell:'0',transfer:'0',
   rounding:'NO_DEDUCTION',scope:ONLY,externalFees:{dex:'NOT_VERIFIED',pool:'NOT_VERIFIED',router:'NOT_VERIFIED',hook:'NOT_VERIFIED',aggregator:'NOT_VERIFIED'}},
  scope
 },'VERIFIED_SOURCE_AND_STATE');
}
// Existing deep enrichment preserves verified fields. Refine the displayed
// transfer-only result only when it already contains the matching direct
// proof, with its original source, value and status recorded as an observation.
function strengthen(card,context){
 const field=card?.fields?.tradingTaxes;
 if(field?.status!=='VERIFIED_SOURCE'||field.value!==PARTIAL)return card;
 const raw=field.evidence||[];
 const proof=raw.find(p=>same(p,context)&&p.observationValue===TRIPLET&&p.observationStatus==='VERIFIED_SOURCE_AND_STATE'&&
  p.coverage===ALL&&p.tokenTaxScope===ONLY&&p.sourceBoundNonDelegatingRuntime===true&&DIGEST.test(p.sourceDigest||'')&&
  raw.some(e=>!e.observationStatus&&same(e,context)&&e.sourceDigest===p.sourceDigest));
 if(!proof)return card;
 const {observationStatus,observationValue,retainedFrom,...direct}=proof;
 return {...card,fields:{...card.fields,tradingTaxes:{...field,value:TRIPLET,status:observationStatus,evidence:[
  direct,...raw.filter(e=>e!==proof)
 ]}}};
}
const integer=(x,max)=>typeof x==='string'&&/^(?:0|[1-9][0-9]{0,76})$/.test(x)&&BigInt(x)<=BigInt(max);
const sourcePair=e=>e?.hookSourceDigest===reviewed.hook&&e?.portalSourceDigest===reviewed.portal;

function ledger(field,context){
 const raw=Array.isArray(field?.evidence)?field.evidence:[];
 const stamp=recorder(context);
 const evidence=(e,type,status,method,value,extra={})=>stamp({...extra,value,sourceDigest:e?.sourceDigest||e?.hookSourceDigest||null,
  sourceReference:e?.sourceUrl||e?.sourceReference||null},type,method,status);
 const fees=Object.fromEntries(FEE_KINDS.map(k=>[k,evidence(null,k,'UNKNOWN','Scope check',null,{reason:UNAVAILABLE[k]})]));
 const bound=raw.filter(e=>same(e,context)&&DIGEST.test(e.sourceDigest||'')&&!e.observationStatus);
 const p=bound.find(e=>e.coverage===ALL&&e.tokenTax&&STRICT.has(field.status)&&
  integer(e.tokenTax.denominator,1000000)&&e.tokenTax.denominator!=='0'&&
  ['buy','sell','transfer'].every(k=>integer(e.tokenTax[k],e.tokenTax.denominator)));
 if(p){
  const v=p.tokenTax, classification=v.classification||(v.launch||v.rateBasis?'VERIFIED_CONDITIONAL_TAX':'CURRENT_VERIFIED_TAX');
  fees.TOKEN_CONTRACT_TAX=evidence(p,'TOKEN_CONTRACT_TAX','VERIFIED',p.method,v,{classification,scope:p.scope});
 }else{
  const transfer=bound.find(e=>e.coverage==='TOKEN_TRANSFER_ONLY')||raw.find(e=>same(e,context)&&e.coverage==='TOKEN_TRANSFER_ONLY'&&DIGEST.test(e.sourceDigest||''));
  if(transfer){
   const v=transfer.tokenTax;
   const configurable=v?.classification==='VERIFIED_CONFIGURABLE_TAX';
   fees.TOKEN_CONTRACT_TAX=evidence(transfer,'TOKEN_CONTRACT_TAX','PARTIALLY_VERIFIED',transfer.method,
    configurable?v:{buy:null,sell:null,transfer:v?.transfer??null},{classification:configurable?v.classification:'PARTIALLY_VERIFIED',scope:transfer.scope});
  }
 }
 // The reviewed Arc hook read independently binds the launch tuple, portal,
 // token, hook, PoolKey hash and contemporaneous values. Never parse rates
 // from a mixed-basis displayed triplet or copy them onto another block.
 const hooks=raw.filter(e=>same(e,context)&&context.chainId===5042&&sourcePair(e)&&address(e.hook)&&address(e.poolManager)&&
  HASH.test(e.poolId||'')&&['REVIEWED_COMPILER_TEMPLATE_IMMUTABLES_ONLY','match','exact_match'].includes(e.runtimeMatch)&&
  integer(e.baseBuyBps,1000)&&integer(e.baseSellBps,1000)&&integer(e.antiSnipeBps,9900)&&integer(e.lpFeeMillionths,1000000));
 if(hooks.length){
  const key=e=>JSON.stringify([e.hook,e.poolId,e.baseBuyBps,e.baseSellBps,e.antiSnipeBps,e.lpFeeMillionths]);
  if(new Set(hooks.map(key)).size!==1){
   for(const type of ['HOOK_FEE','POOL_SWAP_FEE'])fees[type]=evidence(null,type,'CONFLICTED','Multiple pinned launch observations',null,{reason:'CONFLICTING_HOOK_OR_POOL_EVIDENCE',
    observations:[...new Set(hooks.map(key))].slice(0,6).map(JSON.parse)});
  }else{
   const h=hooks[0],base=Number(h.baseBuyBps),sell=Number(h.baseSellBps),extra=Number(h.antiSnipeBps);
   const scope={contractAddress:h.hook,poolId:h.poolId,poolManager:h.poolManager,portalSourceDigest:h.portalSourceDigest,runtimeMatch:h.runtimeMatch};
   fees.HOOK_FEE=evidence(h,'HOOK_FEE','VERIFIED','Reviewed hook and portal + pinned source-checked launch pool',{
    denominator:'10000',ordinaryBuy:String(Math.min(9900,base+extra)),ordinarySell:String(Math.min(9900,sell+extra)),
    baseBuyBps:h.baseBuyBps,baseSellBps:h.baseSellBps,antiSnipeBps:h.antiSnipeBps
   },{...scope,classification:'VERIFIED_CONDITIONAL_TAX',scope:'Ordinary senders in this pool. Interface, route and launcher exemptions apply.'});
   fees.POOL_SWAP_FEE=evidence(h,'POOL_SWAP_FEE','VERIFIED','Pinned poolFee() bound to reviewed PoolKey',{rate:h.lpFeeMillionths,denominator:'1000000'},
    {...scope,scope:'Configured LP fee in this PoolKey. Independent protocol fee and effective trade cost are not established.'});
  }
 }
 return fees;
}
function attach(card,context){
 card=strengthen(card,context);
 const field=card?.fields?.tradingTaxes;
 if(!field)return card;
 const evidence=(Array.isArray(field.evidence)?field.evidence:[]).filter(e=>e.evidenceType!=='FEE_ATTRIBUTION');
 const fees=ledger({...field,evidence},context);
 const proof=recorder(context)({fees},'FEE_ATTRIBUTION','Independent fee attribution by charged mechanism','OBSERVED');
 return {...card,fields:{...card.fields,tradingTaxes:{...field,evidence:[...evidence,proof]}}};
}
module.exports={directZero,strengthen,ledger,attach,TRIPLET};
