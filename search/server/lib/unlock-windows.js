'use strict';
// Known published events only. Missing events/coverage never become a zero unlock.
const {chain}=require('./chains');
const ADDRESS=/^0x[0-9a-f]{40}$/i,DAY=86400000;
function amount(raw){if(typeof raw!=='string'||raw.length>120||!/^(?:0|[1-9]\d*)(?:\.\d{1,36})?$/.test(raw)||!/[1-9]/.test(raw))return null;const [whole,fraction='']=raw.split('.');return {raw:BigInt(whole+fraction),places:fraction.length};}
function sum(values){const parts=values.map(amount),places=Math.max(...parts.map(p=>p.places)),total=parts.reduce((n,p)=>n+p.raw*10n**BigInt(places-p.places),0n),digits=total.toString().padStart(places+1,'0');return places?(digits.slice(0,-places)+'.'+digits.slice(-places)).replace(/\.?0+$/,''):digits;}
function utcDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))return null;const time=Date.parse(value);return Number.isFinite(time)&&new Date(time).toISOString()===value.replace(/(?<!\.\d{3})Z$/,'.000Z')?time:null;}
function windows({network,address,events=[],now=Date.now()}={}){
 const cfg=chain(network);if(!ADDRESS.test(address||'')||!Number.isFinite(now)||!Array.isArray(events))throw Error('INVALID_UNLOCK_WINDOW_IDENTITY');
 const d=new Date(now),start=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()),groups=new Map(),rejected=[];
 for(const event of events){let url;try{url=new URL(event.sourceUrl)}catch{}
  const time=utcDate(event.date),quantity=amount(event.amount);
  if(event.chainId!==cfg.chainId||typeof event.contract!=='string'||event.contract.toLowerCase()!==address.toLowerCase()||time===null||!quantity||url?.protocol!=='https:'||url.username||url.password||event.status!=='SOURCE_REPORTED'){rejected.push('INVALID_OR_UNVERIFIED_EVENT');continue;}
  const key=[time,event.allocation||'source-unspecified'].join(':');if(!groups.has(key))groups.set(key,[]);groups.get(key).push({...event,date:new Date(time).toISOString()});
 }
 const accepted=[];for(const group of groups.values()){const normalized=new Set(group.map(e=>{const a=amount(e.amount);return a.raw.toString().replace(/0+$/,'')+':'+(a.places-(a.raw.toString().match(/0+$/)?.[0].length||0))}));if(normalized.size!==1){rejected.push('CONFLICTING_PUBLISHED_EVENT');continue;}accepted.push(group[0]);}
 const result={};for(const [name,days]of [['today',1],['days7',7],['days30',30]]){const end=start+days*DAY,selected=accepted.filter(e=>Date.parse(e.date)>=start&&Date.parse(e.date)<end);result[name]={value:selected.length?{eventCount:selected.length,knownScheduledAmount:sum(selected.map(x=>x.amount)),events:selected}:null,dataState:selected.length?'DATA_FOUND':'NOT_VERIFIED',status:selected.length?'SOURCE_REPORTED':'NOT_VERIFIED',reasonCode:selected.length?null:'NO_VERIFIED_EVENTS_IN_WINDOW',window:{start:new Date(start).toISOString(),end:new Date(end).toISOString(),timezone:'UTC'},coverage:'KNOWN_PUBLISHED_EVENTS_ONLY',scope:'Source-reported scheduled amounts, not proof of executed transfers or a complete global unlock calendar. An empty window is unknown, not verified zero.'};}
 return {network,chainId:cfg.chainId,address:address.toLowerCase(),...result,rejected};
}
function attach(field,{network,address,now=Date.now()}={}){
 if(field?.dataState!=='DATA_FOUND'||!Array.isArray(field.evidence))return field;
 const proof=field.evidence.find(x=>x.eventAmount&&x.sourceUrl);if(!proof)return field;
 const data=windows({network,address,now,events:[{chainId:chain(network).chainId,contract:address,date:field.value,amount:String(proof.eventAmount),sourceUrl:proof.sourceUrl,status:'SOURCE_REPORTED'}]});
 return {...field,evidence:field.evidence.map((p,i)=>i? p:{...p,knownScheduleWindows:data})};
}
module.exports={windows,attach,amount,sum,utcDate};
