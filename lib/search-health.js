// Internal, bounded operational telemetry. Never log URLs, headers, errors or secrets.
const counts={},recent=[];
function record(event,details={}){counts[event]=(counts[event]||0)+1;const item={event,at:new Date().toISOString()};for(const k of ['chainId','contract','phase','reasonCode','httpStatus','block','staleAgeSeconds'])if(details[k]!==undefined)item[k]=details[k];recent.push(item);if(recent.length>100)recent.shift();if(process.env.ARC_SEARCH_HEALTH_LOG==='1')console.info(JSON.stringify({arcySearch:item}));}
function read(){return {counts:{...counts},recent:structuredClone(recent)};}
module.exports={record,read};
