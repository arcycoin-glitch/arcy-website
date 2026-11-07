'use strict';
// Deterministic, conservative claim classification for Arc Pulse cards. It reads only the published title, the source
// family and the publication date; it never invents a fact. Output stays short (one card line) so the three-card layout is
// unchanged: "<what kind of claim> · <date>. <why it matters>. <main uncertainty>."
const RULES=[
 ['TESTNET',/\btestnet\b|\bdevnet\b|\bsepolia\b/i,'Testnet work','Signals capability being prepared for Arc','Testnet activity does not prove a mainnet launch'],
 ['PLANNED',/\broadmap\b|\bupcoming\b|\bcoming soon\b|\bwill\b|\bplans?\b|\bproposal\b|\bproposed\b|\bpreview\b/i,'Planned or proposed','Indicates direction for the Arc ecosystem','Not shipped; dates and scope can change'],
 ['PARTNERSHIP',/\bpartner(?:s|ship)?\b|\bintegrat(?:es|ed|ion)\b|\bcollaborat|\bjoins?\b|\bteams? up\b/i,'Partnership or integration announcement','May widen Arc distribution or liquidity','An announcement is not proof of users or volume'],
 ['RELEASE',/\blaunch(?:es|ed)?\b|\bnow (?:live|available)\b|\bis live\b|\bgoes live\b|\bmainnet\b|\brelease[sd]?\b|\bships?\b|\bintroduc(?:es|ing|ed)\b|\bunveil/i,'Release announcement','Describes a capability builders or users can try now','First-party claim; on-chain adoption is not independently verified']
];
const RESEARCH=['Developer','Developer update','Gives builders concrete implementation detail','Documentation of a feature, not evidence of usage'];
function classify({title='',type='',family='',owner=''}={}){
 const text=String(title);
 if(type==='research-article'&&/bitquery|independent|investigation/i.test(family+' '+owner))return {claimType:'INDEPENDENT_RESEARCH',label:'Independent research',why:'Third-party view of Arc on-chain activity',risk:'Findings depend on the report\'s sample and method'};
 for(const [claimType,re,label,why,risk] of RULES)if(re.test(text))return {claimType,label,why,risk};
 if(type==='research-article')return {claimType:'DEVELOPER_UPDATE',label:RESEARCH[1],why:RESEARCH[2],risk:RESEARCH[3]};
 return {claimType:'ANNOUNCEMENT',label:'Official update','why':'Primary-source news from the Arc ecosystem',risk:'First-party source; impact is not independently measured'};
}
// What the source itself establishes (never on-chain usage): a dated publication of the given kind.
const EVIDENCE=Object.freeze({INDEPENDENT_RESEARCH:'INDEPENDENT_REPORT',DEVELOPER_UPDATE:'PUBLISHED_DOCUMENTATION',PLANNED:'PUBLISHED_PLAN',TESTNET:'PUBLISHED_TESTNET_ANNOUNCEMENT',RELEASE:'PUBLISHED_ANNOUNCEMENT',PARTNERSHIP:'PUBLISHED_ANNOUNCEMENT',ANNOUNCEMENT:'PUBLISHED_ANNOUNCEMENT'});
function day(iso){const t=Date.parse(iso||'');return Number.isFinite(t)?new Date(t).toISOString().slice(0,10):null;}
// One concise line for the existing summary slot plus additive machine-readable fields.
function describe(item,source={}){
 const c=classify({title:item.title,type:source.type,family:source.family||item.source,owner:item.owner});
 const d=day(item.publishedAt);
 // When the official source publishes an informative excerpt, show what the
 // project actually announced instead of repeating a generic category label.
 // Treat it as a first-party claim, never as independent adoption evidence.
 const excerpt=typeof item.summary==='string'?item.summary.replace(/\s+/g,' ').trim():'';
 const useful=excerpt.length>=40&&!/^(official update|primary-source news|no verified detail)/i.test(excerpt)&&
   excerpt.toLowerCase()!==String(item.title||'').toLowerCase();
 const detail=useful?(excerpt.length>220?excerpt.slice(0,220).replace(/\s+\S*$/,'').replace(/[,;:\s]+$/,'')+'…':excerpt).replace(/[.\s]+$/,''):c.why;
 const evidence=EVIDENCE[c.claimType]||'PUBLISHED_ANNOUNCEMENT';
 return {summary:c.label+(d?' · '+d:'')+'. '+detail+(detail.endsWith('…')?' ':'. ')+(useful?'Not proven: ':'')+c.risk+'.',
  claimType:c.claimType,uncertainty:c.risk,whyItMatters:c.why,
  research:{whatChanged:useful?detail:null,whyItMatters:c.why,evidence,notProven:c.risk},
  ...(useful?{sourceExcerpt:true}: {})};
}
module.exports={classify,describe,RULES};
