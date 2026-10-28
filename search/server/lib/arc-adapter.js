'use strict';
// Arc mainnet read-only intelligence adapter. Unsupported assertions fail closed.
// Do not confuse this lightweight lab adapter with the production durable holder worker.
const {chain}=require('./chains');
const {ADDRESS}=require('./eth');
const rpcClient=require('./arc-rpc');
const market=require('./arc-market');
const original=require('./arc-legacy-evidence');
const cfg=chain('arc');
const ARCY='0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b';
const NO=(reason,reasonCode='INSUFFICIENT_EVIDENCE')=>({
 value:null,status:'NOT_VERIFIED',dataState:'NOT_VERIFIED',
 reason,reasonCode,source:null,evidence:[],chainId:cfg.chainId,network:cfg.id
});
const proof=(value,source,evidence,status='SOURCE_REPORTED')=>({
 value,source,evidence:[{chainId:cfg.chainId,network:cfg.id,...evidence}],
 status,dataState:'DATA_FOUND',chainId:cfg.chainId,network:cfg.id
});
const marketPending=new Map();
function marketFor(address){
 if(marketPending.has(address))return marketPending.get(address);
 const work=market.inspect(address);
 marketPending.set(address,work);
 const done=()=>{if(marketPending.get(address)===work)marketPending.delete(address)};
 work.then(done,done);
 return work;
}
async function inspectToken({address}){return rpcClient.inspectToken({address})}
async function supply(base){
 const details={address:base.address,block:base.block,method:'pinned ERC-20 calls'};
 const total=BigInt(base.totalSupplyRaw);
 const burned=base.burnAddressRaw===null?null:BigInt(base.burnAddressRaw);
 const valid=burned!==null&&total>0n&&burned>=0n&&burned<=total;
 const precision=10n**80n;
 const pct=valid?Number((burned*100n*precision+total/2n)/total)/1e80:null;
 // The original website market route queries CoinGecko and GeckoTerminal.
 // Search must not bridge into it while commercial-use scope is unresolved.
 const circ=NO('No permitted, exact-contract circulating-supply source is currently approved. Total supply is not circulating supply.','PROVIDER_DISABLED_LICENSE_UNVERIFIED');
 const supplyResearch=await require('./supply-insights').inspect({network:'arc',base});
 return {description:'Four source-checked token supply research indicators; total and dead-address balances are retained only as supporting on-chain context.',fields:{...supplyResearch,
  totalSupply:proof(base.totalSupply,'Arc RPC',{...details,method:'totalSupply()'},'ON_CHAIN'),
  circulatingSupply:circ,
  burnAddressBalance:burned===null?NO('Pinned zero/dead address reads failed.','BURN_BALANCE_READ_FAILED'):
   proof(base.burnAddressBalance,'Arc RPC',{...details,method:'balanceOf(0x0,0xdead)'},'ON_CHAIN'),
  burnAddressPct:pct===null?NO('Cannot reconcile current burn-address custody to supply.','BURN_SHARE_UNAVAILABLE'):
   proof(pct,'Arc RPC',{...details,method:'burn balance / totalSupply()',scope:'Current address custody only, not total historical burn.'},'ON_CHAIN_DERIVED')
 }};
}
const censusPending=new Map();
const censusReader=require('./source-request').createReader({ttlMs:15000,maxEntries:128});
function currentCensus(address){
 if(!censusPending.has(address)){
  const task=require('../../../lib/holder-index').explorer(address.toLowerCase(),{getJson:url=>censusReader.json(url,{timeoutMs:1800,maxBytes:1024*1024})});
  censusPending.set(address,task);const done=()=>{if(censusPending.get(address)===task)censusPending.delete(address)};task.then(done,done);
 }
 return require('./timeout').withTimeout(censusPending.get(address),6000,'Optional Arc census deadline');
}
const holderRefreshAttempts=new Map();
async function requestStaleHolderRefresh(address,completedAt){
 const stamp=Date.parse(completedAt||'');
 if(!Number.isFinite(stamp)||Date.now()-stamp<24*3600000||
    !process.env.ARC_HOLDER_QUEUE_URL||!process.env.ARC_HOLDER_QUEUE_TOKEN)return false;
 const now=Date.now();
 if((holderRefreshAttempts.get(address)||0)>now)return false;
 holderRefreshAttempts.set(address,now+10*60000);
 while(holderRefreshAttempts.size>64)holderRefreshAttempts.delete(holderRefreshAttempts.keys().next().value);
 try{
  const result=await Promise.race([
   require('../../../lib/holder-queue-client').enqueue(address),
   new Promise(resolve=>setTimeout(()=>resolve({queued:false}),1500))
  ]);
  if(result?.queued===true){
   holderRefreshAttempts.set(address,Date.now()+6*3600000);
   return true;
  }
 }catch{}
 return false;
}
async function holders({address}={}){
 const reportedWork=require('./arc-holder-count').fetchCount(address).catch(()=>null);

 // Prefer a fresh exact-chain census when the A/X indexer can enumerate the
 // entire small holder set. The existing reader pins every balance and only
 // succeeds when those balances reconcile exactly to totalSupply().
 try{
  const current=await currentCensus(address);
  const snapshot=current?.value, proof=snapshot?.evidence?.[0];
  const valid=current?.dataState==='DATA_FOUND'&&current?.status==='ONCHAIN_VERIFIED'&&
   snapshot?.coverage?.complete===true&&snapshot?.block&&proof?.block===snapshot.block&&
   proof?.indexerCompletenessNotAssumed===true&&
   ['holderCount','largestWalletPct','top10Pct','top20Pct'].every(key=>
    snapshot.fields?.[key]?.dataState==='DATA_FOUND'&&snapshot.fields[key].status==='ONCHAIN_VERIFIED');
  if(valid){
   const anchored=await rpcClient.rpc('eth_getBlockByNumber',[snapshot.block,false]);
   if(!/^0x[0-9a-f]{64}$/i.test(anchored?.hash||''))throw Error('Pinned Arc holder block hash unavailable');
   const observedAt=new Date().toISOString();
   const evidence={...proof,network:cfg.id,chainId:cfg.chainId,address:address.toLowerCase(),
    block:snapshot.block,anchor:anchored.hash,checkedAt:observedAt,
    candidateSetComplete:true,supplyReconciled:true,
    scope:'All A/X Explorer holder candidates were re-read with Arc RPC at this pinned block; their balances sum exactly to totalSupply. Complete positive-holder set for this ERC-20 snapshot.'};
   return {description:'Current complete Arc holder snapshot: A/X Explorer enumeration reconciled to Arc RPC totalSupply at one pinned block.',
    snapshot:{block:snapshot.block,completedAt:observedAt,freshness:'FRESH'},
    fields:Object.fromEntries(['holderCount','largestWalletPct','top10Pct','top20Pct'].map(key=>{
     const field=snapshot.fields[key];
     return [key,{...field,source:'A/X Explorer + Arc RPC',chainId:cfg.chainId,network:cfg.id,
      evidence:[evidence],freshness:{state:'FRESH',observedAt,block:snapshot.block}}];
    }))};
  }
 }catch{} // Fall through to signed/current-count and explicitly historical evidence.
 const signed=await require('./arc-holder-publication').load(address);
 if(signed.fields?.holderCount?.dataState==='DATA_FOUND'){
  const [currentCount,refreshRequested]=await Promise.all([
   reportedWork,requestStaleHolderRefresh(address,signed.snapshot?.completedAt)
  ]);
  const retained=currentCount?{...signed,fields:{...signed.fields,holderCount:currentCount}}:signed;
  return refreshRequested?{...retained,
   description:retained.description+' A background refresh has been requested; historical whale percentages remain historical until a new signed COMPLETE snapshot is verified.'}:retained;
 }
 // Preserve the original site's durable COMPLETE Arc holder worker/read path.
 const prior=await original.callOriginal('holders',address,{action:'published'}).then(data=>({
  fields:original.holders(data,address),completedAt:data.snapshot?.completedAt||null
 })).catch(()=>null);
 const reported=await reportedWork;
 if(prior&&Object.values(prior.fields).some(v=>v.dataState==='DATA_FOUND'))
  return {description:'Original Arc reconciled COMPLETE holder snapshot as of '+
   prior.completedAt+'. Historical evidence, not current wallet-balance proof. Publication signature is not asserted.',
   fields:reported?{...prior.fields,holderCount:reported}:prior.fields};
 // Explorer-reported count is separately sourced, never presented as full whale proof.

 if(reported)return {...signed,
  description:'Arc Blockscout current holder count; whale metrics require signed, reconciled COMPLETE publication.',
  fields:{...signed.fields,holderCount:reported}};
 // Arc Blockscout can return 403. GoPlus explicitly supports chain 5042,
 // but its limited ranked sample must NEVER be called an on-chain verified census.
 const detected=await require('./goplus-evidence').inspectHolders('arc',address);
 const backed=Object.fromEntries(Object.entries(detected).filter(([,f])=>f.dataState==='DATA_FOUND'));
 if(!Object.keys(backed).length)return signed;
 return {...signed,
  description:'GoPlus exact-contract Arc holder count and limited ranked sample; source-reported, not complete pinned-wallet proof.',
  fields:{...signed.fields,...backed}};
}
function validateArcMarketCap(valuation,base,priceUsd){
 if(valuation?.dataState!=='DATA_FOUND'||valuation.kind!=='MARKET_CAP')return valuation;
 const supply=Number(base?.totalSupply),price=Number(priceUsd?.value),cap=Number(valuation.value);
 const exactPrice=ADDRESS.test(base?.address||'')&&priceUsd?.chainId===cfg.chainId&&
  priceUsd?.network===cfg.id&&priceUsd?.evidence?.some(e=>e?.address?.toLowerCase()===base.address.toLowerCase()&&e?.chainId===cfg.chainId);
 if(!Number.isFinite(supply)||supply<=0||!Number.isFinite(price)||price<=0||
  !Number.isFinite(cap)||cap<0||!exactPrice)return NO(
   'Provider market cap is withheld because exact-contract total supply and USD price could not validate its chain scope.',
   'MARKET_CAP_SCOPE_UNVERIFIED');
 // A chain-scoped circulating market cap cannot exceed this contract's total
 // on-chain supply multiplied by the exact-token price (allowing small rounding).
 if(cap>supply*price*1.05)return NO(
  'Market cap exceeds this Arc contract total supply multiplied by its exact-token price; chain scope could not be verified.',
  'MARKET_CAP_EXCEEDS_ONCHAIN_SUPPLY_VALUE');
 return valuation;
}
function deriveArcFullyDilutedValue(valuation,base,priceUsd){
 // Never carry a provider's market-cap/FDV through this Arc route: the source
 // may map a chain contract to a global CoinGecko asset or return FDV based on
 // a stale supply. Derive only this contract's full-supply value.
 const price=Number(priceUsd?.value);
 const exactPrice=ADDRESS.test(base?.address||'')&&priceUsd?.chainId===cfg.chainId&&
  priceUsd?.network===cfg.id&&priceUsd?.evidence?.some(e=>e?.address?.toLowerCase()===base.address.toLowerCase()&&e?.chainId===cfg.chainId);
 if(priceUsd?.dataState!=='DATA_FOUND'||!Number.isFinite(price)||price<=0||!exactPrice)
  return NO('FDV withheld: an exact-contract positive USD price is unavailable.','VALUATION_NOT_VERIFIED');
 let value=null;
 const raw=base?.totalSupplyRaw,decimals=base?.token?.decimals;
 if(typeof raw==='string'&&/^\d+$/.test(raw)&&Number.isInteger(decimals)&&decimals>=0&&decimals<=36){
  const match=String(priceUsd.value).match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if(match){
   const digits=(match[2]||'').length,exponent=Number(match[3]||0),scale=digits-exponent;
   const numerator=BigInt(match[1]+(match[2]||''))*(exponent>digits?10n**BigInt(exponent-digits):1n);
   const denominator=10n**BigInt(decimals+Math.max(0,scale));
   const scaled=(BigInt(raw)*numerator*100n+denominator/2n)/denominator;
   value=Number(scaled)/100;
  }
 }
 if(value===null){
  const supply=Number(base?.totalSupply),fallback=supply*price;
  if(Number.isFinite(supply)&&supply>0&&Number.isFinite(fallback))value=Math.round(fallback*100)/100;
 }
 if(!Number.isFinite(value)||value<=0)return NO(
  'FDV withheld: pinned totalSupply and token decimals could not be calculated safely.',
  'VALUATION_NOT_VERIFIED');
 return {value,kind:'FDV',status:'ON_CHAIN_DERIVED',dataState:'DATA_FOUND',
  source:'Arc RPC totalSupply() × '+(priceUsd.source||'exact-contract price'),network:cfg.id,chainId:cfg.chainId,
  evidence:[{chainId:cfg.chainId,network:cfg.id,address:base?.address,block:base?.block,
    method:'totalSupply()',totalSupplyRaw:base?.totalSupplyRaw??null,decimals:base?.token?.decimals??null},...(priceUsd.evidence||[]),
   {chainId:cfg.chainId,network:cfg.id,address:base?.address,block:base?.block,
    method:'totalSupply() × exact-contract USD price, rounded to USD cents',
    scope:'Fully diluted value from this contract total supply at the report block; not circulating-supply market capitalization.'}],
  scope:'Calculated using the exact Arc contract total supply and exact-contract USD price. This is FDV, not circulating-supply market cap.'};
}
async function activity({address,base},cardId){
 const keys=cardId==='liquidity'?['liquidityUsd','volume24h','dexPairCount','lpStatus']:
  ['priceUsd','valuation','change24h','volume24h'];
 // Keep the existing Arc Search route path: it validates exact Arc contract
 // market responses and adds the already-used GeckoTerminal fallback. The
 // DEX flag remains the server-side gate for DEX Screener requests.
 let restored={};
 try{
  const route=cardId==='liquidity'?'liquidity':'activity';
  const legacy=await original.callOriginal(route,address,cardId==='liquidity'?{summary:'1'}:{});
  const from=legacy.fields||{};
  const mapping=cardId==='liquidity'?{
   liquidityUsd:'liquidityUsd',volume24h:'volume24h',dexPairCount:'pairCount',lpStatus:'lpStatus'
  }:{priceUsd:'priceUsd',valuation:'valuation',change24h:'change24h',volume24h:'volume24h'};
  restored=Object.fromEntries(keys.map(key=>[key,original.sourceField(from[mapping[key]],address,
   'Existing Arc Search exact-contract '+route+' source response.')]));
 }catch{} // The alternate exact-contract DEX reader remains available on failure.
 const fallback=await marketFor(address);
 const fields=Object.fromEntries(keys.map(k=>[k,
  restored[k]?.dataState==='DATA_FOUND'?restored[k]:
   fallback[k]||NO('Exact-contract evidence unavailable.','MARKET_SOURCE_NOT_VERIFIED')]));
 if(cardId==='activity'){
  fields.valuation=validateArcMarketCap(fields.valuation,base,fields.priceUsd);
  fields.valuation=deriveArcFullyDilutedValue(fields.valuation,base,fields.priceUsd);
 }
 const checkedAt=new Date().toISOString();
 for(const key of keys){
  const field=fields[key];
  if(field?.dataState==='DATA_FOUND')fields[key]={...field,
   freshness:{retrievedAt:checkedAt,basis:'Search retrieval time; provider publication timestamp was not supplied.'},
   evidence:(field.evidence||[]).map(item=>({...item,checkedAt,
    checkedAtBasis:'Search retrieval time; provider publication timestamp was not supplied.'}))};
 }
 return {description:'Arc Search market fields are restricted to the separately permission-gated provider path; missing market values remain NOT VERIFIED.',fields};
}

const IMPLEMENTATION='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
function addressWord(raw){
 return typeof raw==='string'&&/^0x0{24}[0-9a-f]{40}$/i.test(raw)&&
  !/^0{40}$/.test(raw.slice(-40))?'0x'+raw.slice(-40).toLowerCase():null;
}
async function mechanics({address,base}){
 const legacyWork=require('../../../lib/search-request').withRpc((method,params)=>method==='eth_blockNumber'?Promise.resolve(base.block):rpcClient.rpc(method,params),()=>original.callOriginal('mechanics',address,{refresh:'1',scanId:'v5-'+base.block})).catch(()=>null);
 const results=await Promise.allSettled([
  rpcClient.rpc('eth_call',[{to:address,data:'0x8da5cb5b'},base.block]),
  rpcClient.rpc('eth_getStorageAt',[address,IMPLEMENTATION,base.block])
 ]);
 const owner=results[0].status==='fulfilled'?addressWord(results[0].value):null;
 // Optional ABI-less getter observations are read-only. They never imply
 // the full admin model or verified mint/upgrade permissions.
 let alternativeOwner=null,alternativeMethod=null;
 if(!owner){
  const selector=name=>require('../../../lib/keccak')(Buffer.from(name)).slice(0,10);
  const signatures=['getOwner()','admin()'];
  const probes=await Promise.allSettled(signatures.map(name=>require('./timeout').withTimeout(
   rpcClient.rpc('eth_call',[{to:address,data:selector(name)},base.block],{timeoutMs:1600}),
   1900,'Optional owner getter deadline')));
  for(let i=0;i<signatures.length;i++){
   const value=probes[i].status==='fulfilled'?addressWord(probes[i].value):null;
   if(value){alternativeOwner=value;alternativeMethod=signatures[i];break}
  }
 }
 const implementation=results[1].status==='fulfilled'?addressWord(results[1].value):null;
 const context={address,block:base.block};
 const preliminary={
  tradingTaxes:NO('Taxes need source-reviewed contract getter or exact-chain security evidence.','TAX_NOT_VERIFIED'),
  mintCapability:NO('A generic getter cannot establish mint privileges.','MINT_NOT_VERIFIED'),
  ownerAdmin:(owner||alternativeOwner)?proof((owner?'owner()':alternativeMethod)+' getter: '+(owner||alternativeOwner),'Arc RPC',
   {...context,method:owner?'owner()':alternativeMethod,scope:'Getter-reported observation only; actual admin rights and other roles are not established.'},'GETTER_REPORTED'):
   NO('No reliable owner or admin getter established.','OWNER_ADMIN_NOT_VERIFIED'),
  contractArchitecture:implementation?proof('EIP-1967 implementation: '+implementation,'Arc RPC',
   {...context,method:'EIP-1967 implementation slot',
    scope:'Observed implementation only; upgrade authority separately unverified.'},'ON_CHAIN'):
   NO('EIP-1967 slot alone does not establish immutable or non-proxy architecture.','PROXY_NOT_VERIFIED')
 };
 let fields=preliminary;
 // Restore the previous exact-contract Arc RPC/Sourcify mechanics bridge.
 // The legacy route's GoPlus fallback is fail-closed on Vercel unless its
 // separate explicit permission flag is enabled.
 try{
  const legacy=await legacyWork;
  const reviewed=original.contract(legacy,address);
  fields=Object.fromEntries(Object.entries(preliminary).map(([key,value])=>[
   key,value.dataState==='DATA_FOUND'?value:
    reviewed[key]?.dataState==='DATA_FOUND'?reviewed[key]:value
  ]));
 }catch{} // Keep direct RPC observations if source verification is unavailable.
 // Search's own GoPlus adapter is separately fail-closed without approval.
 if(Object.values(fields).some(f=>f.dataState!=='DATA_FOUND')){
  const detected=await require('./goplus-evidence').inspect('arc',address);
  const isARCY=address==='0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b';
  fields=Object.fromEntries(Object.entries(fields).map(([key,existing])=>[
   key,existing.dataState==='DATA_FOUND'?existing:
    // GoPlus currently reports 0% taxes for ARCY, contrary to the project's
    // reviewed 3%/3% source. Never silently overwrite with conflicting claims.
    isARCY&&key==='tradingTaxes'?existing:
    require('./goplus-evidence').mergeMissing(existing,detected[key])
  ]));
 }
 const expanded=await require('./mechanics-deep').enrich({network:'arc',address,block:base.block,rpc:rpcClient.rpc,
  card:{description:'Verified Arc contract mechanics with pinned-RPC/source fallback; external detection never overrides stronger first-party evidence.',fields}});
 // Separate reviewed immutable hook-tax evidence from ordinary ERC20 transfers.
 // The direct source re-read must prove the exact chain, token, hook and
 // nearby observed block. Never copy fee values by project name or ticker.
 if(address===ARCY&&
   !/^Buy\s+\d+(?:\.\d+)?%\s*·\s*Sell\s+\d+(?:\.\d+)?%/.test(String(expanded.fields?.tradingTaxes?.value||''))){
  try{
   const legacy=await require('./timeout').withTimeout(
     original.callOriginal('mechanics',address),15000,'Reviewed Arc hook fallback deadline');
   const recovered=require('./arc-mechanics-recovery').recover(legacy,{address,block:base.block});
   if(recovered)expanded.fields.tradingTaxes={...recovered,evidence:[...recovered.evidence,
    ...(expanded.fields?.tradingTaxes?.evidence||[]).map(e=>({...e,
     retainedFrom:'Current ordinary token transfer review; separate from verified launch-pool fee rates'}))]};
  }catch{} // Keep the original evidence state; do not invent fees.
 }
 return expanded;
}
async function inspectCard({base,address,cardId}){
 switch(cardId){
 case 'supply':return supply(base);
 case 'holders':return holders({address});
 case 'liquidity':case 'activity':return activity({address,base},cardId);
 case 'mechanics':return mechanics({address,base});
 default:throw Error('Invalid Arc card ID');
 }
}
const SEARCH=/^[\p{L}\p{N}\s.$_+\-&]{2,48}$/u;
async function discover({query}){
 if(typeof query!=='string')throw Error('Invalid search query');
 const normalized=query.normalize('NFKC').trim().replace(/\s+/g,' ');
 if(!SEARCH.test(normalized)||ADDRESS.test(normalized))throw Error('Invalid search query');
 return [];
}
module.exports={inspectToken,inspectCard,supply,holders,activity,mechanics,discover,addressWord,marketFor,validateArcMarketCap,deriveArcFullyDilutedValue};
