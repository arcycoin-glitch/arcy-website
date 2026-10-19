'use strict';
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 try{
  const urls=[
   'https://api.arc-scan.org/v1/search/suggest?q=po&limit=10',
   'https://api.arc-scan.org/v1/tokens/0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b/holders?limit=5'
  ];
  const output=[];
  for(const url of urls){
   try{
    const r=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(4000)});
    const raw=(await r.text()).slice(0,5000);
    output.push({http:r.status,data:raw.slice(0,2400)});
   }catch(e){output.push({error:String(e?.name||'SOURCE_ERROR')})}
  }
  return res.status(200).json({results:output});
 }catch{return res.status(503).json({ok:false})}
};