(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ARCYModel=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const labels={supply:['Total Supply','Circulating Supply','Burn Address Balance','Next Unlock'],whales:['Holder Count','Largest Wallet %','Top 10 Concentration','Top 20 Concentration'],liquidity:['Liquidity USD','24H Volume','DEX / Pair Count','LP Status'],activity:['Price','Market Cap / FDV','24H Change','24H Volume'],mechanics:['Buy Tax','Sell Tax','Transfer Tax','Burn Mechanism','Buyback Mechanism','Mint Capability','Pause Capability','Blacklist / Restrictions','Owner / Admin','Proxy / Upgradeable']};
 const paths={supply:['supply.totalSupply.amount','market.circulatingSupply','supply.burnAddressBalance.amount','unlock.nextUnlock.date'],whales:['holderCount','largestWalletPct','top10Pct','top20Pct'],liquidity:['liquidityUsd','volume24h','dexCount / pairCount','lpStatus'],claims:['counts.checked','counts.verified','counts.mismatch','counts.unverified'],mechanics:['buyTax','sellTax','transferTax','burnMechanism','buybackMechanism','mint','pause','blacklist','ownerAdmin','proxyUpgradeable'].map(k=>'contractFields.'+k)};
 paths.activity=['priceUsd','valuation','change24h','volume24h'];
 const zero='0x0000000000000000000000000000000000000000';
 function compact(v){if(v===null||v===undefined||v==='')return 'NOT VERIFIED';const n=Number(v);if(!Number.isFinite(n))return 'NOT VERIFIED';if(n!==0&&Math.abs(n)<0.000001)return Number(n.toPrecision(4)).toString();for(const [d,s]of [[1e9,'B'],[1e6,'M'],[1e3,'K']])if(Math.abs(n)>=d)return (n/d).toFixed(1).replace(/\.0$/,'')+s;return new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(n);}
 const money=v=>'$'+compact(v);
 function get(obj,path){let value=obj;for(const k of path.split('.')){if(!value||!Object.hasOwn(value,k))return {exists:false};value=value[k];}return {exists:true,value};}
 function missing(d,reason){return {text:'NOT VERIFIED',dataState:'FRONTEND_MAPPING_FAILED',reasonCode:'API_SCHEMA_MISMATCH',reason};}
 function read(d,path,format=compact){
  if(!d)return {text:'…',dataState:'LOADING'};
  if(d.ok===false)return {text:'NOT VERIFIED',dataState:d.dataState||'SOURCE_API_FAILED',reasonCode:d.reasonCode||'API_REQUEST_FAILED',reason:d.reason||'Request failed.'};
  const x=get(d,path);if(!x.exists)return missing(d,'Expected response property '+path+' is missing.');
  if(x.value===null){const parts=path.split('.');const parent=parts.length>1?get(d,parts.slice(0,-1).join('.')).value:d,field=d.fields?.[path],state=field?.dataState||parent?.dataState||d.dataState;return {text:'NOT VERIFIED',dataState:state&&state!=='DATA_FOUND'?state:'NOT_VERIFIED',reasonCode:field?.reasonCode||parent?.reasonCode||d.reasonCode||'INSUFFICIENT_EVIDENCE',reason:field?.reason||parent?.reason||d.reason||'Value has not been established.'};}
  if(typeof x.value!=='number'&&!(typeof x.value==='string'&&/^\d+(?:\.\d+)?$/.test(x.value)))return missing(d,'Expected numeric value at '+path+'.');
  if(!Number.isFinite(Number(x.value))||Number(x.value)<0)return missing(d,'Invalid numeric value at '+path+'.');
  const parent=path.includes('.')?get(d,path.split('.').slice(0,-1).join('.')).value:d,freshness=d.fields?.[path]?.freshness||parent?.freshness||d.freshness;
  return {text:format(x.value),dataState:'DATA_FOUND',...(freshness?.state==='LAST_VERIFIED'?{freshness,reason:'Last verified data'+(freshness.observedAt?' from '+freshness.observedAt:'')+'; live refresh has not established a replacement.'}:{})};
 }
 function fact(d,path,format){
  if(!d||d.ok===false)return read(d,path);
  const x=get(d,path);if(!x.exists||!x.value||!Object.hasOwn(x.value,'value')||typeof x.value.status!=='string')return missing(d,'Expected evidence object at '+path+'.');
  const f=x.value;
  if(f.value===null||f.status==='NOT_VERIFIED')return {text:'NOT VERIFIED',dataState:f.dataState||'NOT_VERIFIED',reasonCode:f.reasonCode||'INSUFFICIENT_EVIDENCE',reason:f.reason||'Evidence does not establish this fact.'};
  const freshness=f.freshness||d.freshness;
  return {text:format?format(f):typeof f.value==='boolean'?(f.value?'DETECTED':f.status==='NOT_DETECTED'?'NOT DETECTED':'NO'):String(f.value),dataState:'DATA_FOUND',...(freshness?.state==='LAST_VERIFIED'?{freshness,reason:'Last verified data'+(freshness.observedAt?' from '+freshness.observedAt:'')+'; refresh is separate.'}:{})};
 }
 function percent(f){if(typeof f.value!=='number'||!Number.isFinite(f.value)||f.value<0||f.value>100)return 'NOT VERIFIED';return compact(f.value)+'%';}
 function detected(f){return !!(f&&typeof f.status==='string'&&f.status!=='NOT_VERIFIED'&&f.value!==null&&f.value!==undefined&&f.value!==zero&&f.value!==false);}
 function summarize(name,d){let fields=[];
  if(name==='supply'){
   fields=[read(d?.supply,'totalSupply.amount'),read(d?.market,'circulatingSupply'),read(d?.supply,'burnAddressBalance.amount')];
   if(fields[1].dataState==='DATA_FOUND'&&(d.market.status!=='SOURCE_REPORTED'||d.market.contractMatched!==true||Number(d.market.circulatingSupply)<=0))fields[1]={text:'NOT VERIFIED',dataState:'NOT_VERIFIED',reasonCode:'CIRCULATING_IDENTITY_OR_STATUS_UNVERIFIED',reason:'Circulating supply needs positive contract-matched source-reported data.'};
   const u=d?.unlock;
   let unlock;if(!u)unlock={text:'…',dataState:'LOADING'};else if(u.ok===false)unlock=read(u,'nextUnlock.date');else {const x=get(u,'nextUnlock.date');unlock=!x.exists?missing(u,'Expected nextUnlock.date.') :x.value===null?{text:'NO SOURCE-REPORTED SCHEDULE',dataState:u.dataState||'NOT_VERIFIED',reasonCode:u.reasonCode||'NO_CONTRACT_MATCHED_SCHEDULE_SOURCE',reason:u.reason}:/^\d{4}-\d{2}-\d{2}/.test(x.value)?{text:x.value,dataState:'DATA_FOUND'}:missing(u,'Invalid schedule date.');}fields.push(unlock);
   if(unlock.dataState==='DATA_FOUND'&&u?.freshness?.state==='LAST_VERIFIED')Object.assign(unlock,{freshness:u.freshness,reason:'Last verified source-reported schedule; refresh failed.'});
  }else if(name==='whales')fields=paths.whales.map((p,i)=>d?read(d,p,i?x=>compact(x)+'%':compact):({text:'NOT VERIFIED',dataState:'NOT_VERIFIED',reasonCode:'HOLDER_SNAPSHOT_BUILDING',reason:'Building a complete reconciled holder snapshot; partial metrics are not displayed.'}));
  else if(name==='liquidity'){
   fields=[read(d,'liquidityUsd',money),read(d,'volume24h',money)];const dex=read(d,'dexCount'),pairs=read(d,'pairCount');fields.push(dex.dataState==='DATA_FOUND'&&pairs.dataState==='DATA_FOUND'?{text:d.dexCount+' DEX · '+d.pairCount+' pairs',dataState:'DATA_FOUND'}:dex.dataState!=='DATA_FOUND'?dex:pairs);fields.push(fact(d,'lpStatus'));
  }else if(name==='activity'){
   const price=f=>Number.isFinite(f.value)&&f.value>0?'$'+(f.value<0.01?Number(f.value.toPrecision(6)).toString():compact(f.value)):'NOT VERIFIED';
   fields=[fact(d,'priceUsd',price),fact(d,'valuation',f=>['MARKET_CAP','FDV'].includes(f.kind)&&Number.isFinite(f.value)&&f.value>0?(f.kind==='FDV'?'FDV ':'MC ')+money(f.value):'NOT VERIFIED'),fact(d,'change24h',f=>Number.isFinite(f.value)?(f.value>0?'+':'')+compact(f.value)+'%':'NOT VERIFIED'),fact(d,'volume24h',f=>Number.isFinite(f.value)&&f.value>=0?money(f.value):'NOT VERIFIED')];
   fields=fields.map((f,i)=>f.text==='NOT VERIFIED'&&f.dataState==='DATA_FOUND'?missing(d,'Invalid market value at '+paths.activity[i]):f);
  }else if(name==='claims'){
   if(!d||d.ok===false)fields=paths.claims.map(p=>read(d,p));
   else if(d.statusId==='NO_CLAIMS_SUPPLIED')fields=paths.claims.map(()=>({text:'—',dataState:'SOURCE_HAS_NO_DATA',reasonCode:d.reasonCode,reason:d.reason}));
   else if(typeof d.statusId!=='string')fields=paths.claims.map(()=>missing(d,'Missing application statusId.'));
   else fields=paths.claims.map(p=>read(d,p));
  }else if(name==='mechanics'){
   fields=paths.mechanics.map((p,i)=>fact(d,p,f=>i<3?percent(f)+' · '+f.status:i===9&&f.status==='VERIFIED'?(f.upgradeable?.value===true?'UPGRADEABLE · VERIFIED':'PROXY · VERIFIED'):f.status.replaceAll('_',' ')));
   for(let i=0;i<3;i++)if(fields[i].text.startsWith('NOT VERIFIED')&&fields[i].dataState==='DATA_FOUND')fields[i]=missing(d,'Invalid verified tax percentage.');
  }
  const combined=name==='liquidity'?['dexCount','pairCount']:[],combinedIndex=name==='liquidity'?2:3;
  const historical=combined.map(k=>d?.[k]?.freshness||d?.fields?.[k]?.freshness||d?.freshness).find(f=>f?.state==='LAST_VERIFIED');if(historical&&fields[combinedIndex]?.dataState==='DATA_FOUND')Object.assign(fields[combinedIndex],{freshness:historical,reason:'Includes last verified data; refresh has not established a replacement.'});
  const states=fields.map(f=>f.dataState);let badge=states.includes('FRONTEND_MAPPING_FAILED')?'MAPPING FAILED':states.includes('LOADING')?'SCANNING':states.every(x=>x==='SOURCE_API_FAILED')?'SOURCE/API FAILED':states.includes('DATA_FOUND')?'PARTIAL EVIDENCE':states.includes('SOURCE_API_FAILED')?'SOURCE/API FAILED':states.every(x=>x==='SOURCE_HAS_NO_DATA')?'SOURCE HAS NO DATA':'NOT VERIFIED';
  if(name==='claims'&&d?.statusId==='NO_CLAIMS_SUPPLIED')badge='NO CLAIMS SUPPLIED';
  if(name==='whales'&&!d)badge='BUILDING VERIFIED HOLDER SNAPSHOT';
  if(name==='whales'&&d?.snapshot?.freshness==='LAST_VERIFIED'&&states.every(s=>s==='DATA_FOUND'))badge='LAST VERIFIED SNAPSHOT';
  if(name==='whales'&&d?.ok!==false&&d?.coverage?.complete===false&&!states.includes('DATA_FOUND')&&!states.includes('FRONTEND_MAPPING_FAILED'))badge='BUILDING VERIFIED HOLDER SNAPSHOT';

  if(name!=='whales'&&states.includes('DATA_FOUND')&&(d?.freshness?.state==='LAST_VERIFIED'||fields.some(f=>f.dataState==='DATA_FOUND'&&f.freshness?.state==='LAST_VERIFIED')))badge='LAST VERIFIED DATA';
  return {fields:fields.map((f,i)=>({...f,label:(labels[name]||['Claims Checked','Verified','Mismatch','Unverified'])[i],path:paths[name][i]})),badge,data:d};
 }
 return {labels,paths,compact,summarize};
});
