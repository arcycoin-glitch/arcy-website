const crypto=require('node:crypto');
function urlFor(value){try{const url=new URL(value);return url.protocol==='https:'?url:null;}catch{return null;}}
function publishedBase(){return urlFor(process.env.ARC_PULSE_PUBLISHED_URL||process.env.ARC_HOLDER_PUBLISHED_URL||process.env.ARC_HOLDER_QUEUE_URL);}
function queueBase(){return urlFor(process.env.ARC_PULSE_QUEUE_URL||process.env.ARC_HOLDER_QUEUE_URL);}
function token(){return process.env.ARC_PULSE_QUEUE_TOKEN||process.env.ARC_HOLDER_QUEUE_TOKEN||null;}
function endpoint(path,base){return base?new URL(path,base.origin).href:null;}
function publicKey(){return process.env.ARC_PULSE_PUBLIC_KEY||process.env.ARC_HOLDER_PUBLIC_KEY||null;}
function unpack(data){try{const key=publicKey();if(!data?.payload||!key||!data.signature||!crypto.verify(null,Buffer.from(data.payload),key,Buffer.from(data.signature,'base64')))return null;const edition=JSON.parse(data.payload);return require('./pulse-storage').valid(edition)?edition:null;}catch{return null;}}
async function latest(){const url=endpoint('/pulse/latest',publishedBase());if(!url)return null;try{const r=await fetch(url,{cache:'no-store',headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(5000)});return r.ok?unpack(await r.json()):null;}catch{return null;}}
async function refresh(trigger){const url=endpoint('/pulse/refresh',queueBase()),secret=token();if(!url||!secret)return {ok:false,reasonCode:'PULSE_WORKER_NOT_CONFIGURED'};try{const r=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+secret,'content-type':'application/json'},body:JSON.stringify({trigger}),signal:AbortSignal.timeout(45000)});const data=await r.json();return r.ok&&data.ok?{ok:true,edition:unpack(data.edition)}:{ok:false,reasonCode:data?.reasonCode||'PULSE_REFRESH_FAILED'};}catch{return {ok:false,reasonCode:'PULSE_REFRESH_UNAVAILABLE'};}}
async function audit(){const url=endpoint('/pulse/audit',queueBase()),secret=token();if(!url||!secret)return null;try{const r=await fetch(url,{headers:{authorization:'Bearer '+secret},signal:AbortSignal.timeout(5000)});return r.ok?await r.json():null;}catch{return null;}}
module.exports={latest,refresh,audit};
