'use strict';
// Read-only live API acceptance for issuer-disclosed custody evidence.
// This is additional source context, NOT four-field circulating/unlock coverage.
const base=process.env.ARCY_AUDIT_PREVIEW_URL;
if(!/^https:\/\/arcy-official-[a-z0-9-]+\.vercel\.app\/?$/.test(base||'')){
 console.error('Preview must be exact, explicit Vercel deployment URL');process.exitCode=2;
}else(async()=>{
 const ondo='0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3',
 usdc='0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
 for(const [name,address]of [['ONDO',ondo],['USDC',usdc]]){
  const url=new URL('/api/search',base);
  url.searchParams.set('action','report');url.searchParams.set('chain','ethereum');
  url.searchParams.set('address',address);
  const response=await fetch(url,{signal:AbortSignal.timeout(45000),headers:{accept:'application/json'}});
  if(!response.ok)throw Error(name+' API HTTP '+response.status);
  const data=await response.json();
  if(!data.ok)throw Error(name+' report unavailable '+String(data.error||'UNKNOWN'));
  const card=data.cards?.supply; if(!card)throw Error(name+' supply card missing');
  if(Object.keys(card.fields||{}).filter(k=>['totalSupply','burnAddressBalance','circulatingSupply','nextUnlock'].includes(k)).length!==4)
   throw Error('Primary supply fields changed');
  if(name==='ONDO'){
   const x=card.supplementalEvidence?.find(x=>x.kind==='ISSUER_DISCLOSED_WALLET_CURRENT_CUSTODY');
   if(!x)throw Error('ONDO issuer wallet evidence missing from live preview');
   if(x.block!==data.block||x.chainId!==1||x.address!==ondo)throw Error('Wrong contract/chain/block custody evidence');
   if(x.sourceUrl!=='https://blog.ondo.foundation/ondo-foundation-group-wallet-address-disclosure/')throw Error('Wrong issuer source');
   if(!/^\d+(?:\.\d+)?$/.test(x.balance)||BigInt(x.rawBalance)>BigInt(data.totalSupplyRaw||'0'))
    throw Error('Invalid on-chain wallet custody');
   console.log('ONDO_SUPPLEMENTAL_EVIDENCE_OK '+JSON.stringify({network:data.network,block:x.block,balance:x.balance,source:x.sourceUrl,notes:card.researchNotes?.length||0,latencyNotMeasured:'not an API timing audit'}));
  }else if(card.supplementalEvidence?.length)throw Error('Evidence leaked to unrelated USDC contract');
  else console.log('USDC_IDENTITY_ISOLATION_OK '+JSON.stringify({chain:data.network,block:data.block}));
 }
})().catch(e=>{console.error('ISSUER_PREVIEW_AUDIT_FAILED',e?.message||String(e));process.exitCode=1});
