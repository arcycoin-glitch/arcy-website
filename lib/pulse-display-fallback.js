'use strict';
// Display-only editorial fallback. No unverifiable headline, unlock or adoption
// claim is synthesized. Always keeps five navigable Pulse panels + ARCY Take.
const edition=require('./pulse-edition');
const KINDS=['week','new','watch','reality','unlock'];
const ITEMS=[
 {owner:'OFFICIAL ARC · SOURCE HUB',kind:'week',
  title:'This week’s official developments are being verified.',
  summary:'Live edition not yet verified. Open the Arc blog for dated releases; no archived headline is presented as fresh news.',
  url:'https://www.arc.io/blog',linkLabel:'ARC BLOG ↗'},
 {owner:'OFFICIAL ARC COMMUNITY',kind:'new',
  title:'Find newly published Arc ecosystem updates.',
  summary:'The current-cycle source scan is pending or unavailable. Browse the Arc community’s original dated announcements.',
  url:'https://community.arc.io/public/blogs',linkLabel:'ARC COMMUNITY ↗'},
 {owner:'RESEARCH WATCHLIST',kind:'watch',
  title:'Watch real adoption, not just announcements.',
  summary:'Review settlement transactions, product access and actual usage before treating a planned launch as executed.',
  url:'https://explorer.arc.io',linkLabel:'ARC EXPLORER ↗'},
 {owner:'RISK / REALITY CHECK',kind:'reality',
  title:'Source coverage is incomplete — no claims inferred.',
  summary:'A missing verified Pulse source is not evidence of zero activity or low risk. Compare the primary source and on-chain evidence.',
  url:'https://www.arc.io/blog',linkLabel:'VERIFY AT SOURCE ↗'},
 {owner:'UNLOCK RESEARCH',kind:'unlock',
  title:'Check the source-matched unlock schedule.',
  summary:'No current-week unlock is asserted here without verified timing and contract identity. Explore the dedicated Unlocks list.',
  url:'#unlocks',linkLabel:'OPEN TOKEN UNLOCKS ↗'}
];
const take='ARCY TAKE — Source verification is pending. Until this week’s updates are confirmed, use the official Arc sources and archived research for context; do not interpret past announcements as new activity.';
function fallback(now=Date.now(),{reasonCode='PULSE_SOURCE_CHECK_PENDING',lastEdition=null}={}){
 const current=edition.cycle(now);
 const cards=ITEMS.map(i=>({...i,publishedAt:null,verifiedCurrentWeek:false}));
 const audit={sourcesAttempted:edition.SOURCES.length,sourcesSuccessfullyChecked:0,
  currentWeekVerified:false,reasonCode,
  lastSuccessful:lastEdition?{number:lastEdition.number,status:lastEdition.status,generatedAt:lastEdition.generatedAt}:null,
  nextScheduledAt:edition.nextRun(now)};
 return {ok:true,number:edition.number(now),status:'source_pending',
  generatedAt:null,cycle:{start:new Date(current.start).toISOString(),end:new Date(current.end).toISOString()},
  cards,take,sources:edition.SOURCES.map(x=>x.url),audit,
  note:'Editorial navigation fallback, not a dated news edition. Past Pulse #003 remains at /pulse/003.html.'};
}
module.exports={ITEMS,KINDS,fallback};
