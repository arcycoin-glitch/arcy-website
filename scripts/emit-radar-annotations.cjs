'use strict';
// CI helper: publish part of radar-v3-out.json (written by probe-radar-v2.cjs) as workflow annotations.
// usage: node scripts/emit-radar-annotations.cjs <net,net,...>   (<=10 annotations per workflow step, ~4 KB each)
const fs=require('fs');
const nets=(process.argv[2]||'').split(',').filter(Boolean);
if(!fs.existsSync('radar-v3-out.json')){console.log('no radar-v3-out.json');process.exit(0);}
const all=JSON.parse(fs.readFileSync('radar-v3-out.json','utf8'));
const esc=x=>x.replace(/%/g,'%25').replace(/\r/g,'').replace(/\n/g,'%0A');
let n=0;
const emit=(title,obj)=>{if(n++<10)console.log('::notice title='+title+'::'+esc(JSON.stringify(obj)));};
function chunk(list,size){const out=[];let cur=[];for(const t of list){if(JSON.stringify([...cur,t]).length>size&&cur.length){out.push(cur);cur=[];}cur.push(t);}if(cur.length)out.push(cur);return out;}
for(const net of nets){
 const r=all[net];if(!r){continue;}
 emit('v3-cov-'+net,{net,asOf:r.asOf,cov:r.cov});
 chunk(r.t,3300).forEach((c,i)=>emit('v3-tok-'+net+'-'+i,{net,i,t:c}));
 chunk(r.ex,3300).forEach((c,i)=>emit('v3-ex-'+net+'-'+i,{net,i,x:c}));
}
