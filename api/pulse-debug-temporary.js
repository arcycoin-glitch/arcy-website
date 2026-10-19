module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 const url='https://community.arc.io/public/content?category=video';
 try{
  const r=await fetch(url,{signal:AbortSignal.timeout(6500),headers:{'user-agent':'ARCY-Pulse/1.0'}});
  const t=await r.text();
  const names=['public/videos/','/public/videos/','href=','move-supported','\\u002fpublic','\\/public','__NEXT_DATA__'];
  const counts=Object.fromEntries(names.map(k=>[k,t.split(k).length-1]));
  const sample=t.indexOf('move-supported');
  return res.status(200).json({http:r.status,length:t.length,counts,fragment:sample>=0?t.slice(Math.max(0,sample-140),sample+220):null,head:t.slice(0,240)});
 }catch(e){return res.status(200).json({error:String(e).slice(0,160)})}
};
