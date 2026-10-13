'use strict';
// Compact editorial safety net. These are clearly labeled reference utilities,
// never fabricated current-week announcements. Do not change the signed
// publisher's five-slot storage schema or the immutable Pulse #003 archive.
const edition=require('./pulse-edition');
const KINDS=Object.freeze(['week','new','unlock']);
const ITEMS=Object.freeze([
 Object.freeze({
  owner:'OFFICIAL ARC · PRIMARY SOURCES',kind:'week',
  title:'What really changed on Arc this week?',
  summary:'Open dated Arc announcements and check what shipped. Planned integrations are not evidence of live user adoption.',
  url:'https://www.arc.io/blog',linkLabel:'VERIFY ARC UPDATES ↗'
 }),
 Object.freeze({
  owner:'PROJECTS & ONCHAIN ACTIVITY',kind:'new',
  title:'Follow launches with measurable on-chain activity.',
  summary:'Review transactions, users and contract activity on Arc Explorer before treating a new launch as proven adoption.',
  url:'https://explorer.arc.io',linkLabel:'EXPLORE ACTIVITY ↗'
 }),
 Object.freeze({
  owner:'TOKEN UNLOCKS & RISK',kind:'unlock',
  title:'Check upcoming verified unlocks and supply risks.',
  summary:'Use source-matched unlock schedules and compare supply facts. A missing schedule is not evidence that no unlock exists.',
  url:'#unlocks',linkLabel:'CHECK TOKEN UNLOCKS ↗'
 })
]);
const take='A release announcement is the starting point, not the result. This week, verify live usage, liquidity and exact-contract unlock schedules before drawing conclusions.';
function fallback(now=Date.now(),{reasonCode='PULSE_SOURCE_CHECK_PENDING',lastEdition=null}={}){
 const current=edition.cycle(now);
 const cards=ITEMS.map(item=>({...item,publishedAt:null,verifiedCurrentWeek:false,contentType:'SOURCE_GUIDE'}));
 const audit={sourcesAttempted:edition.SOURCES.length,sourcesSuccessfullyChecked:0,
  currentWeekVerified:false,reasonCode,
  lastSuccessful:lastEdition?{number:lastEdition.number,status:lastEdition.status,generatedAt:lastEdition.generatedAt}:null,
  nextScheduledAt:edition.nextRun(now)};
 return {ok:true,number:edition.number(now),status:'source_pending',
  generatedAt:null,cycle:{start:new Date(current.start).toISOString(),end:new Date(current.end).toISOString()},
  cards,take,sources:edition.SOURCES.map(x=>x.url),audit,
  note:'Three source-linked research utilities, not dated news; historical #003 remains at /pulse/003.html.'};
}
module.exports={ITEMS,KINDS,fallback};
