'use strict';
// Read-only canonical Robinhood Stock Token identity adapter (offline parser).
// Only the official /rhj/assets registry can label a Stock Token as registry matched.
// Token ticker/name alone never establishes authenticity.
const ADDRESS=/^0x[0-9a-f]{40}$/i,MAINNET=4663;
const QUERY=/^[\p{L}\p{N}\s.$_+\-&]{2,48}$/u;
// Only issuer-registry-provided Robinhood Stock Token artwork. A logo is
// decorative; the registry still needs an exact chain 4663 contract match.
const OFFICIAL_CDN=/^https:\/\/cdn\.robinhood\.com\/ncw_assets\/logos\/0x[0-9a-f]{40}\.png$/i;
function registryLogo(raw,address){return typeof raw==='string'&&OFFICIAL_CDN.test(raw)&&
 (!address||ADDRESS.test(address)&&new URL(raw).pathname.toLowerCase()==='/ncw_assets/logos/'+address.toLowerCase()+'.png')?raw:null;}
function parseAssets(body){
 if(!body||typeof body!=='object'||!Array.isArray(body.assets))throw Error('Invalid Robinhood asset registry');
 const byAddress=new Map();
 for(const item of body.assets.slice(0,10000)){
  if(!item||typeof item!=='object'||!Array.isArray(item.deployments))continue;
  const symbol=typeof item.tokenSymbol==='string'?item.tokenSymbol.trim().slice(0,30):'';
  const name=typeof item.tokenName==='string'?item.tokenName.trim().slice(0,100):'';
  if(!symbol||!name)continue;
  for(const deployment of item.deployments.slice(0,20)){
   if(deployment?.chainId!==MAINNET)continue;
   const address=String(deployment.contractAddress||'').toLowerCase();
   if(!ADDRESS.test(address))continue;
   const record={address,symbol,name,chainId:MAINNET,network:'Robinhood Chain',
    source:'Robinhood official asset registry',registryMatched:true,
    logoUrl:registryLogo(item.logoUrl,address),
    assetStatus:typeof item.status==='string'?item.status:null,
    multiplier:typeof item.currentMultiplier==='string'&&/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(item.currentMultiplier)?item.currentMultiplier:null};
   const previous=byAddress.get(address);
   if(previous&&(previous.name!==record.name||previous.symbol!==record.symbol))throw Error('Conflicting Stock Token identity in registry');
   byAddress.set(address,record);
  }
 }
 return [...byAddress.values()];
}
function byContract(body,address){
 if(typeof address!=='string'||!ADDRESS.test(address))return null;
 return parseAssets(body).find(x=>x.address===address.toLowerCase())||null;
}
function search(body,rawQuery){
 if(typeof rawQuery!=='string')return [];
 const query=rawQuery.normalize('NFKC').trim().replace(/\s+/g,' ');
 if(!QUERY.test(query))return [];
 const q=query.toLocaleLowerCase('en-US');
 return parseAssets(body).filter(x=>x.name.toLocaleLowerCase('en-US').includes(q)||x.symbol.toLocaleLowerCase('en-US').includes(q))
  .sort((a,b)=>Number(b.symbol.toLowerCase()===q)-Number(a.symbol.toLowerCase()===q)||a.symbol.localeCompare(b.symbol)||a.address.localeCompare(b.address))
  .slice(0,12);
}
module.exports={parseAssets,byContract,search,registryLogo};
