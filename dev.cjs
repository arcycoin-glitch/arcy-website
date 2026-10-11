'use strict';
const http=require('http'),fs=require('fs'),path=require('path');
http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost');
 res.status=n=>(res.statusCode=n,res);
 res.json=d=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(d));};
 if(/^\/api\/[a-z]+$/.test(u.pathname)){
  const name=u.pathname.slice(5),file=path.join(__dirname,'api',(name==='search'?'search/index':name==='activity'?'market':name)+'.js');
  if(!fs.existsSync(file)){res.status(404).end();return;}
  try{const loaded=await import(require('url').pathToFileURL(file).href);await loaded.default({method:req.method,headers:req.headers,query:{...Object.fromEntries(u.searchParams),...(name==='activity'?{_arcyRoute:'activity'}:{})}},res)}
  catch{res.status(500).json({ok:false,error:'DATA UNAVAILABLE'})}return;
 }
 if(u.pathname==='/search'||u.pathname==='/search/'){
  res.statusCode=308;res.setHeader('Location','/#search');res.end();return;
 }
 if(u.pathname==='/_vercel/insights/script.js'){
  res.setHeader('Content-Type','application/javascript; charset=utf-8');res.end('/* Vercel Analytics is injected by the deployed platform. */');return;
 }
 const isToken=/^\/search\/token\/(?:arc|ethereum|robinhood)\/0x[0-9a-f]{40}\/?$/i.test(u.pathname);
 const file=path.resolve(__dirname,u.pathname==='/'?'index.html':isToken?'search/index.html':'.'+decodeURIComponent(u.pathname));
 if(!file.startsWith(__dirname+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.status(404).end();return;}
 const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.mp4':'video/mp4'};
 res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
}).listen(Number(process.env.PORT||3000),'127.0.0.1',()=>console.log('ARCY unified local preview'));
