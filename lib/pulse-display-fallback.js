'use strict';
// Compact editorial safety net. These are clearly labeled reference utilities,
// never fabricated current-week announcements. Do not change the signed
// publisher's five-slot storage schema or the immutable Pulse #003 archive.
const edition=require('./pulse-edition');
const KINDS=Object.freeze(['week','new','unlock']);
const ITEMS=Object.freeze([
 Object.freeze({
  owner:'ARC · OFFICIAL PROJECT UPDATES',kind:'week',
  title:'Which teams are building on Arc?',
  summary:'Explore new integrations, partner spotlights and developer releases in Arc’s official blog. This is a source directory, not an unverified launch announcement.',
  url:'https://www.arc.io/blog',linkLabel:'DISCOVER ARC PROJECTS ↗'
 }),
 Object.freeze({
  owner:'ARC EXPLORER · LIVE CHAIN DATA',kind:'new',
  title:'Where is real onchain activity happening?',
  summary:'Check actual transactions, wallets and contract interactions on Arc. A project announcement alone cannot establish liquidity or recurring users.',
  url:'https://explorer.arc.io',linkLabel:'EXPLORE ARC TRANSACTIONS ↗'
 }),
 Object.freeze({
  owner:'ARCY SEARCH · TOKEN UNLOCK CALENDAR',kind:'unlock',
  title:'Which tokens have upcoming unlocks?',
  summary:'Jump to the separate Token Unlocks calendar for dated, source-linked events. Unknown schedules stay unknown; an article is not unlock evidence.',
  url:'#unlocks',linkLabel:'SEE TOKEN UNLOCKS ↗'
 })
]);
const take='Source-led Arc discovery: explore official announcements, inspect onchain activity and check the independently maintained unlock calendar. Reference links are not new announcements.';
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
