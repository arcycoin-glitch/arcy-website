'use strict';
// Compact editorial safety net. These are clearly labeled reference utilities,
// never fabricated current-week announcements. Do not change the signed
// publisher's five-slot storage schema or the immutable Pulse #003 archive.
const edition=require('./pulse-edition');
const KINDS=Object.freeze(['week','new','unlock']);
const ITEMS=Object.freeze([
 Object.freeze({
  owner:'OFFICIAL ARC · PRIMARY SOURCES',kind:'week',
  title:'Current-week Arc updates not verified',
  summary:'No dated current-week Arc development is confirmed in this response. Check the primary Arc announcement source directly.',
  url:'https://www.arc.io/blog',linkLabel:'VERIFY ARC UPDATES ↗'
 }),
 Object.freeze({
  owner:'PROJECTS & ONCHAIN ACTIVITY',kind:'new',
  title:'Current-week launches not verified',
  summary:'No current-week launch passed the configured source checks. Arc Explorer is a research reference, not proof of a new launch.',
  url:'https://explorer.arc.io',linkLabel:'EXPLORE ACTIVITY ↗'
 }),
 Object.freeze({
  owner:'TOKEN UNLOCKS & RISK',kind:'unlock',
  title:'No Pulse-specific unlock report verified',
  summary:'No current-week unlock item was confirmed for Arc Pulse. Token Unlocks is a separate, source-published calendar with its own verification limits.',
  url:'#unlocks',linkLabel:'CHECK TOKEN UNLOCKS ↗'
 })
]);
const take='No current-week Arc Pulse findings have been verified in this response. This is a source-status notice, not a weekly research conclusion.';
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
