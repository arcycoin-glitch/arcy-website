// Supplemental events require explicit, current project-published dates and amounts.
// Do not derive future releases from charts, recurrences, or emission formulas.
export const VERIFIED_EVENTS = [];
export const COVERAGE_REVIEWS = [
    { projectId: 'capricorn', name: 'Capricorn', symbols: ['APR'], date: '2026-10-23', status: 'cross-source-float-percent-conflict', reason: 'CoinBell publishes 56.33M APR as 20.28% of float for 23 October, while DefiLlama lists approximately 33.6% of float for the same event. Keep the source-reported date/amount, but withhold the disputed circulating-supply percentage.', sources: ['https://api.coinbell.in/token-unlocks?sort=impact&window=30', 'https://defillama.com/calendar'] },
  { projectId: 'arbitrum', name: 'Arbitrum', symbols: ['ARB'], date: '2026-10-15', status: 'cross-source-date-allocation-conflict', reason: 'CoinBell lists 92.65M ARB on 15 October 2026 (Team), while Tokenomist lists the next unlock on 16 October 2026 and Arbitrum DAO documents monthly team/investor releases from the 16th. Neither the date nor allocation can be independently verified as this exact row; suppress the disputed calendar event until primary evidence is reviewed.', sources: ['https://api.coinbell.in/token-unlocks?sort=soonest&window=30', 'https://tokenomist.ai/arbitrum', 'https://docs.arbitrum.foundation/token-supply'] },
  { projectId:"io-net", name:"io.net", symbols:["IO"], status:"insufficient-evidence", reason:"Monthly vesting is documented, but no explicit current event date and amount have been verified.", sources:["https://io.net/docs/guides/coin/coin-restrictions"] },
  { projectId:"plume", name:"Plume", symbols:["PLUME"], status:"estimated-schedule", reason:"Published release chart is estimated; do not convert it into exact monthly unlocks.", sources:["https://www.plume.org/blog/tokenomics","https://defillama.com/unlocks/plume-mainnet"] },
  { projectId:"mantra", name:"MANTRA", symbols:["OM","MANTRA"], status:"migration-review-required", reason:"Legacy OM and native MANTRA use different units following a 1:4 conversion; current event evidence is required.", sources:["https://docs.mantrachain.io/mantra-chain-tokenomics"] },
  {"projectId":"sui","name":"Sui","names":["Sui"],"symbols":["SUI"],"status":"estimated-schedule","reason":"The official Sui chart is expressly an estimated schedule. Third-party November 2026 calendars disagree on exact amounts and dates; do not publish a dated exact amount from an estimated chart.","sources":["https://sui.io/token-schedule","https://tokenomist.ai/sui/unlock-events","https://defillama.com/unlocks/sui-foundation"]},
  {"projectId":"zksync","name":"ZKsync","names":["ZKsync","zkSync","ZKsync Era","zkSync Era"],"symbols":["ZK"],"status":"official-cap-review","maxTokensPerEvent":"168000000","capAllocationPattern":"investor|team|insider|contributor","reason":"ZK Nation documents a maximum 0.8% of the 21 billion supply released monthly to investors and team through June 2028 (168 million ZK). Calendar rows exceeding this cap are withheld; smaller rows are still third-party source published, not project confirmed.","sources":["https://docs.zknation.io/zk-token/zk-token","https://app.tokenomics.com/tokenomics/zksync/unlocks"]},
  {"projectId":"ethena","name":"Ethena","symbols":["ENA"],"dates":["2026-11-01","2026-11-02","2026-11-05"],"status":"cross-source-date-amount-conflict","reason":"Third-party sources disagree on early November 2026 Ethena event dates, allocation labels and amounts after the 2026 investor buyout. The official schedule does not verify these specific dated amounts.","sources":["https://docs.ethena.fi/ena/tokenomics","https://tokenomist.ai/ethena","https://cryptoticker.io/en/ena-unlock-november-1-buyback-threshold/"]},
  {"projectId":"arbitrum","name":"Arbitrum","symbols":["ARB"],"date":"2026-11-15","status":"cross-source-date-allocation-conflict","reason":"Official Arbitrum documentation states the cadence begins on the 16th; a November 15 entry conflicts with the issuer's stated cadence.","sources":["https://docs.arbitrum.foundation/token-supply","https://tokenomist.ai/arbitrum"]}
];


 // Match exact token and, when supplied, date and project name so unrelated
 // projects sharing a ticker are not suppressed.
 export const reviewApplies=(review,row)=>{
  if(!review||!Array.isArray(review.symbols)||!review.symbols.includes(row?.symbol))return false;
  export const name=String(row.name||'').trim().toLowerCase(),dates=review.dates||(review.date?[review.date]:null);
  if(dates&&!dates.includes(row.date))return false;
  if(Array.isArray(review.names))return review.names.some(n=>String(n).toLowerCase()===name);
  return dates?String(review.name).toLowerCase()===name:true;
 };
 export const amountExceeds=(text,cap)=>{
  export const m=String(text||'').trim().match(/^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*([KMB])?\s+[A-Z0-9._-]+$/);
  if(!m||!/^\d+$/.test(String(cap)))return true;
  export const fraction=m[2]||'',scale=({K:3,M:6,B:9}[m[3]]||0)-fraction.length;
  export const digits=BigInt(m[1].replace(/,/g,'')+fraction),limit=BigInt(cap);
  return scale>=0?digits*10n**BigInt(scale)>limit:digits>limit*10n**BigInt(-scale);
 };
 export const NON_SUPPRESSING_REVIEWS=['cross-source-float-percent-conflict','official-cap-review'];
 export const suppressingReview=(row,reviews=COVERAGE_REVIEWS)=>reviews.find(r=>reviewApplies(r,row)&&
   (!NON_SUPPRESSING_REVIEWS.includes(r.status)||(r.status==='official-cap-review'&&
   (!r.capAllocationPattern||new RegExp(r.capAllocationPattern,'i').test(String(row.allocation||'')))&&
   amountExceeds(row.amount,r.maxTokensPerEvent))))||null;
