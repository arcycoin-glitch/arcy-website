const http=require('node:http'),crypto=require('node:crypto'),storage=require('./holder-storage');
function start(){const token=process.env.ARC_HOLDER_QUEUE_TOKEN;if(!process.env.PORT||!token)return null;
 return http.createServer(async(req,res)=>{res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');const reply=(status,d)=>{res.statusCode=status;res.end(JSON.stringify(d));};
 const match=/^\/snapshots\/(0x[0-9a-f]{40})\.json$/.exec(req.url||'');
 if(req.method==='GET'&&match){try{const publication=require('./holder-publication');if(!process.env.ARC_HOLDER_SIGNING_KEY||!await publication.read(match[1]))return reply(404,{});
 const file=require('node:path').join(publication.directory(),match[1]+'.json'),d=JSON.parse(await require('node:fs/promises').readFile(file,'utf8'));res.setHeader('cache-control','public, max-age=0, must-revalidate, stale-if-error=86400');return reply(200,d);
 }catch{return reply(404,{});}}
 if(req.method==='GET'&&(req.url==='/pulse/latest'||req.url==='/pulse/latest.json')){try{const d=await require('./pulse-storage').latest();if(!d)return reply(404,{});const file=require('node:path').join(require('./pulse-storage').base(),'latest.json');res.setHeader('cache-control','public, max-age=0, must-revalidate, stale-if-error=86400');return reply(200,JSON.parse(await require('node:fs/promises').readFile(file,'utf8')));}catch{return reply(404,{})}}
 const expected=Buffer.from('Bearer '+token),given=Buffer.from(req.headers.authorization||'');
 if(given.length!==expected.length||!crypto.timingSafeEqual(given,expected))return reply(401,{queued:false});
 if(req.method==='GET'&&req.url==='/pulse/audit'){try{return reply(200,await require('./pulse-storage').audit()||{});}catch{return reply(503,{ok:false});}}
 if(req.method==='POST'&&req.url==='/pulse/refresh'){try{let body='';for await(const chunk of req){body+=chunk;if(body.length>1024)return reply(413,{ok:false});}const trigger=JSON.parse(body||'{}').trigger==='cron'?'cron':'manual',pulse=require('./pulse-edition'),stored=require('./pulse-storage');try{const d=await pulse.generate({trigger});await stored.publish(d);return reply(200,{ok:true,edition:JSON.parse(await require('node:fs/promises').readFile(require('node:path').join(stored.base(),'latest.json'),'utf8'))});}catch(error){await stored.failure(error,Date.now(),trigger);return reply(503,{ok:false,reasonCode:error.code||'PULSE_REFRESH_FAILED'});}}catch{return reply(503,{ok:false,reasonCode:'PULSE_REFRESH_FAILED'});}}
 if(req.method!=='POST'||req.url!=='/queue')return reply(404,{queued:false});
 try{let body='';for await(const chunk of req){body+=chunk;if(body.length>1024)return reply(413,{queued:false});}const d=JSON.parse(body);
 if(d.chainId!==5042||!/^0x[0-9a-f]{40}$/i.test(d.address||''))return reply(400,{queued:false});
 const queued=await storage.enqueue(d.address.toLowerCase());reply(queued?202:503,{queued});
 }catch{reply(503,{queued:false});}
 }).listen(Number(process.env.PORT),'0.0.0.0');
}
module.exports={start};
