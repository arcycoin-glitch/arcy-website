(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ARCYModel=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const labels={supply:['Total Supply','Circulating Supply','Burn Address Balance','Next Unlock'],whales:['Holder Count','Largest Wallet %','Top 10 Concentration','Top 20 Concentration'],control:['Mint Capability','Pause Capability','Blacklist Capability','Owner / Admin'],liquidity:['Liquidity USD','24H Volume','DEX / Pair Count','LP Status'],activity:['Price','Market Cap / FDV','24H Change','24H Volume'],mechanics:['Buy Tax','Sell Tax','Transfer Tax','Burn / Buyback']};
 const paths={supply:['supply.totalSupply.amount','market.circulatingSupply','supply.burnAddressBalance.amount','unlock.nextUnlock.date'],whales:['holderCount','largestWalletPct','top10Pct','top20Pct'],control:['mint','pause','blacklist','owner / admin (proxy in badge/evidence)'],liquidity:['liquidityUsd','volume24h','dexCount / pairCount','lpStatus'],claims:['counts.checked','counts.verified','counts.mismatch','counts.unverified'],mechanics:['buyTax','sellTax','transferTax','burnMechanism / buybackAndBurn']};
 paths.activity=['priceUsd','valuation','change24h','volume24h'];
 const zero='0x0000000000000000000000000000000000000000';
 function compact(v){if(v===null||v===undefined||v==='')return 'NOT VERIFIED';const n=Number(v);if(!Number.isFinite(n))return 'NOT VERIFIED';for(const [d,s]of [[1e9,'B'],[1e6,'M'],[1e3,'K']])if(Math.abs(n)>=d)return (n/d).toFixed(1).replace(/\.0$/,'')+s;return new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(n);}
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
  return {text:format(x.value),dataState:'DATA_FOUND'};
 }
 function fact(d,path,format){
  if(!d||d.ok===false)return read(d,path);
  const x=get(d,path);if(!x.exists||!x.value||!Object.hasOwn(x.value,'value')||typeof x.value.status!=='string')return missing(d,'Expected evidence object at '+path+'.');
  const f=x.value;
  if(f.value===null||f.status==='NOT_VERIFIED')return {text:'NOT VERIFIED',dataState:f.dataState||'NOT_VERIFIED',reasonCode:f.reasonCode||'INSUFFICIENT_EVIDENCE',reason:f.reason||'Evidence does not establish this fact.'};
  return {text:format?format(f):typeof f.value==='boolean'?(f.value?'DETECTED':f.status==='NOT_DETECTED'?'NOT DETECTED':'NO'):String(f.value),dataState:'DATA_FOUND'};
 }
 function percent(f){if(typeof f.value!=='number'||!Number.isFinite(f.value)||f.value<0||f.value>100)return 'NOT VERIFIED';return compact(f.value)+'%';}
 function detected(f){return !!(f&&typeof f.status==='string'&&f.status!=='NOT_VERIFIED'&&f.value!==null&&f.value!==undefined&&f.value!==zero&&f.value!==false);}
 function summarize(name,d){let fields=[];
  if(name==='supply'){
   fields=[read(d?.supply,'totalSupply.amount'),read(d?.market,'circulatingSupply'),read(d?.supply,'burnAddressBalance.amount')];
   if(fields[1].dataState==='DATA_FOUND'&&(d.market.status!=='SOURCE_REPORTED'||d.market.contractMatched!==true||Number(d.market.circulatingSupply)<=0))fields[1]={text:'NOT VERIFIED',dataState:'NOT_VERIFIED',reasonCode:'CIRCULATING_IDENTITY_OR_STATUS_UNVERIFIED',reason:'Circulating supply needs positive contract-matched source-reported data.'};
   const u=d?.unlock;
   let unlock;if(!u)unlock={text:'…',dataState:'LOADING'};else if(u.ok===false)unlock=read(u,'nextUnlock.date');else {const x=get(u,'nextUnlock.date');unlock=!x.exists?missing(u,'Expected nextUnlock.date.') :x.value===null?{text:'NO SOURCE-REPORTED SCHEDULE',dataState:u.dataState||'NOT_VERIFIED',reasonCode:u.reasonCode||'NO_CONTRACT_MATCHED_SCHEDULE_SOURCE',reason:u.reason}:/^\d{4}-\d{2}-\d{2}/.test(x.value)?{text:x.value,dataState:'DATA_FOUND'}:missing(u,'Invalid schedule date.');}fields.push(unlock);
  }else if(name==='whales')fields=paths.whales.map((p,i)=>read(d,p,i?x=>compact(x)+'%':compact));
  else if(name==='control'){
   fields=['mint','pause','blacklist'].map(p=>fact(d,p));
   const owner=fact(d,'owner'),admin=fact(d,'admin');fields.push(d?.ok!==false&&[d?.owner,d?.admin].some(detected)?{text:'DETECTED',dataState:'DATA_FOUND'}:owner.dataState==='FRONTEND_MAPPING_FAILED'?owner:admin.dataState==='FRONTEND_MAPPING_FAILED'?admin:{text:'NOT VERIFIED',dataState:d?.dataState==='SOURCE_API_FAILED'?'SOURCE_API_FAILED':'NOT_VERIFIED',reasonCode:'NO_VALIDATED_OWNER_ADMIN',reason:'No nonzero owner/admin authority getter established. Proxy evidence is shown separately.'});
  }else if(name==='liquidity'){
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
   fields=['buyTax','sellTax','transferTax'].map(p=>fact(d,p,percent));
   for(let i=0;i<3;i++)if(fields[i].text==='NOT VERIFIED'&&fields[i].dataState==='DATA_FOUND')fields[i]=missing(d,'Invalid percentage at '+paths.mechanics[i]+'.value.');
   const burn=fact(d,'burnMechanism'),buyback=fact(d,'buybackAndBurn');fields.push(burn.dataState==='FRONTEND_MAPPING_FAILED'?burn:buyback.dataState==='FRONTEND_MAPPING_FAILED'?buyback:burn.dataState==='DATA_FOUND'||buyback.dataState==='DATA_FOUND'?{text:'Burn '+burn.text+' · Buyback '+buyback.text,dataState:burn.dataState==='DATA_FOUND'&&buyback.dataState==='DATA_FOUND'?'DATA_FOUND':'NOT_VERIFIED',reason:buyback.reason||burn.reason}:burn);
  }
  const states=fields.map(f=>f.dataState);let badge=states.includes('FRONTEND_MAPPING_FAILED')?'MAPPING FAILED':states.includes('LOADING')?'SCANNING':states.every(x=>x==='SOURCE_API_FAILED')?'SOURCE/API FAILED':states.includes('DATA_FOUND')?'PARTIAL EVIDENCE':states.includes('SOURCE_API_FAILED')?'SOURCE/API FAILED':states.every(x=>x==='SOURCE_HAS_NO_DATA')?'SOURCE HAS NO DATA':'NOT VERIFIED';
  if(name==='claims'&&d?.statusId==='NO_CLAIMS_SUPPLIED')badge='NO CLAIMS SUPPLIED';
  if(name==='control'&&d?.ok!==false&&detected(d?.proxy))badge='PROXY DETECTED';
  return {fields:fields.map((f,i)=>({...f,label:(labels[name]||['Claims Checked','Verified','Mismatch','Unverified'])[i],path:paths[name][i]})),badge,data:d};
 }
 return {labels,paths,compact,summarize};
});
