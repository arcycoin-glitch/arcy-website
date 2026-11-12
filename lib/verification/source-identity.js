'use strict';
// Source and operator identity for ARCY verification.
//
// Independence is decided by the OPERATOR that runs a source, not by its URL or label. Two RPC endpoints on
// different hostnames can be the same company's nodes; two market "providers" can share an owner. Rules:
//  * an RPC operator is known only from the registry below (each entry cites where the operator was identified);
//  * a hostname that is not in the registry falls back to its registrable domain and is marked DOMAIN_FALLBACK;
//    a host under an official network domain falls back to that network's official operator, never to a new one;
//  * two sources count as independent only when BOTH operators come from the registry and they differ.
//    An unrecognised endpoint can be used as a second observation, but never upgrades evidence on its own.
const SLUG=/^[a-z][a-z0-9_.-]{0,63}$/;
const ARC_DOCS='https://docs.arc.io/arc/references/rpc-endpoints';
const RPC_OPERATORS=Object.freeze([
 // Arc's official endpoint list names the operator of each mainnet endpoint.
 Object.freeze({host:/^rpc\.mainnet\.arc\.io$/,operator:'circle',reference:ARC_DOCS}),
 Object.freeze({host:/^rpc\.quicknode\.mainnet\.arc\.io$/,operator:'quicknode',reference:ARC_DOCS}),
 Object.freeze({host:/^rpc\.drpc\.mainnet\.arc\.io$/,operator:'drpc',reference:ARC_DOCS}),
 Object.freeze({host:/^rpc\.blockdaemon\.mainnet\.arc\.io$/,operator:'blockdaemon',reference:ARC_DOCS}),
 // Official chain-4663 endpoint already configured in search/server/lib/chains.js; operated for the network itself.
 Object.freeze({host:/^rpc\.mainnet\.chain\.robinhood\.com$/,operator:'robinhood-chain',reference:null}),
 // Public multi-chain RPC services, identified by their own service domains.
 Object.freeze({host:/(^|\.)drpc\.org$/,operator:'drpc',reference:'https://drpc.org'}),
 Object.freeze({host:/(^|\.)publicnode\.com$/,operator:'allnodes',reference:'https://www.publicnode.com'}),
 Object.freeze({host:/(^|\.)quiknode\.pro$/,operator:'quicknode',reference:'https://www.quicknode.com'}),
 Object.freeze({host:/(^|\.)alchemy\.com$/,operator:'alchemy',reference:'https://www.alchemy.com'}),
 Object.freeze({host:/(^|\.)infura\.io$/,operator:'infura',reference:'https://www.infura.io'}),
 Object.freeze({host:/(^|\.)ankr\.com$/,operator:'ankr',reference:'https://www.ankr.com'}),
 Object.freeze({host:/(^|\.)llamarpc\.com$/,operator:'llamanodes',reference:'https://llamanodes.com'}),
 Object.freeze({host:/(^|\.)chainstack\.com$/,operator:'chainstack',reference:'https://chainstack.com'}),
 Object.freeze({host:/(^|\.)blockdaemon\.com$/,operator:'blockdaemon',reference:'https://www.blockdaemon.com'})
]);
// Unlisted hosts under an official network domain are attributed to that network's official operator.
const OFFICIAL_DOMAINS=Object.freeze({'arc.io':'circle','robinhood.com':'robinhood-chain'});
function slug(text){
 const s=String(text||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,64);
 return /^[a-z]/.test(s)?s:('x-'+s).slice(0,64);
}
function rpcOperator(url){
 let host;
 try{host=new URL(url).hostname.toLowerCase();}catch{return {operator:'unknown-endpoint',basis:'INVALID_URL',reference:null};}
 const known=RPC_OPERATORS.find(r=>r.host.test(host));
 if(known)return {operator:known.operator,basis:'REGISTRY',reference:known.reference};
 const labels=host.split('.'),domain=labels.slice(-2).join('.');
 if(Object.hasOwn(OFFICIAL_DOMAINS,domain))return {operator:OFFICIAL_DOMAINS[domain],basis:'OFFICIAL_DOMAIN_FALLBACK',reference:null};
 return {operator:slug(domain),basis:'DOMAIN_FALLBACK',reference:null};
}
function independent(a,b){
 if(!a||!b)return {independent:false,reasonCode:'MISSING_OPERATOR'};
 if(a.operator===b.operator)return {independent:false,reasonCode:'SAME_OPERATOR'};
 if(a.basis!=='REGISTRY'||b.basis!=='REGISTRY')return {independent:false,reasonCode:'OPERATOR_UNVERIFIED'};
 return {independent:true,reasonCode:null};
}
// Report field source labels are free text. Map them to {id, class, operator}. The FIRST matching rule wins, and
// composite labels ("Blockscout candidate addresses + Ethereum RPC") are attributed to the enumerating source,
// because that is the part an RPC re-read cannot confirm.
const FIELD_SOURCES=Object.freeze([
 [/chainlink/i,{id:'chainlink-feed',class:'MARKET',operator:'chainlink'}],
 [/geckoterminal|coingecko/i,{id:'coingecko',class:'MARKET',operator:'coingecko'}],   // GeckoTerminal is a CoinGecko product
 [/dex ?screener/i,{id:'dexscreener',class:'MARKET',operator:'dexscreener'}],
 [/goplus/i,{id:'goplus',class:'INDEXER',operator:'goplus'}],
 [/signed .*holder publication|holder worker/i,{id:'arcy-holder-worker',class:'WORKER',operator:'arcy'}],
 [/a\/x explorer|arc blockscout|arcexplorer/i,{id:'arc-explorer',class:'INDEXER',operator:'arc-explorer'}],
 [/blockscout/i,{id:'blockscout',class:'INDEXER',operator:'blockscout'}],
 [/sourcify/i,{id:'sourcify',class:'INDEXER',operator:'sourcify'}],
 [/etherscan/i,{id:'etherscan',class:'INDEXER',operator:'etherscan'}],
 [/tether|circle issuer|official issuer|issuer|asset registry/i,{id:'issuer-disclosure',class:'ISSUER',operator:'issuer'}],
 [/\b(arc|ethereum|robinhood) rpc\b|json-rpc|bytecode|runtime|getter|pons factory/i,{id:'report-rpc',class:'ONCHAIN_RPC',operator:'report-rpc'}]
]);
function fieldSource(label,network){
 const text=typeof label==='string'?label:'';
 for(const [pattern,s] of FIELD_SOURCES)if(pattern.test(text)){
  // The report's RPC reads may have failed over between endpoints; their operator is not known from the label.
  if(s.class==='ONCHAIN_RPC')return {id:(network+'-report-rpc').slice(0,64),class:'ONCHAIN_RPC',operator:'unattributed-report-rpc',basis:'LABEL'};
  return {...s,basis:'LABEL'};
 }
 const id=slug(text||'unlabelled-source');
 return {id,class:'INDEXER',operator:id,basis:'UNRECOGNIZED_LABEL'};
}
module.exports={RPC_OPERATORS,OFFICIAL_DOMAINS,rpcOperator,independent,fieldSource,slug,SLUG};
