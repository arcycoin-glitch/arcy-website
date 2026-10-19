module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 try{
  const response=await fetch('https://community.arc.io/public/content?category=video',{signal:AbortSignal.timeout(5000)});
  const html=await response.text();
  const matches=Array.from(html.matchAll(/\/public\/videos\/[a-z0-9-]+/gi)).slice(0,8).map(x=>x[0]);
  return res.status(200).json({status:response.status,size:html.length,hasKnownSlug:html.includes('move-supported'),hrefCount:html.split('href=').length-1,matches,head:html.slice(0,180)});
 }catch(error){return res.status(200).json({error:String(error).slice(0,160)})}
};