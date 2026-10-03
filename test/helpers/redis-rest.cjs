// Isolated Redis REST protocol fixture; not a substitute for hosted Redis acceptance.
const http=require('node:http');
async function create(){
 const data=new Map(),expiry=new Map(),queue=new Map(),commands=[];
 const get=k=>{if(expiry.has(k)&&expiry.get(k)<=Date.now()){data.delete(k);expiry.delete(k);}return data.get(k)??null;};
 const server=http.createServer(async(req,res)=>{try{let body='';for await(const chunk of req)body+=chunk;const args=JSON.parse(body),[cmd,...v]=args;commands.push(args);let result;
 if(cmd==='GET')result=get(v[0]);
 else if(cmd==='SET'){result=v.includes('NX')&&get(v[0])!==null?null:'OK';if(result){data.set(v[0],v[1]);if(v.includes('PX'))expiry.set(v[0],Date.now()+Number(v[v.indexOf('PX')+1]));}}
 else if(cmd==='ZRANGEBYSCORE')result=[...queue].filter(([,at])=>at<=Number(v[2])).sort((a,b)=>a[1]-b[1]).slice(Number(v[4]),Number(v[4])+Number(v[5])).map(([k])=>k);
 else if(cmd==='EVAL'){const [script,n,...rest]=v,keys=rest.slice(0,n),argv=rest.slice(n);if(script.includes('ZSCORE')){if(!queue.has(argv[0])&&queue.size>=1000)result=0;else{if(argv[2]==='1'||!queue.has(argv[0]))queue.set(argv[0],Number(argv[1]));result=1;}}else if(get(keys[0])!==argv[0])result=0;else if(n===2){data.set(keys[1],argv[1]);expiry.set(keys[0],Date.now()+Number(argv[2]));result=1;}else{data.delete(keys[0]);expiry.delete(keys[0]);result=1;}}
 else throw Error('Unsupported test command');res.setHeader('content-type','application/json');res.end(JSON.stringify({result}));}catch{res.statusCode=500;res.end('{}');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {url:'http://127.0.0.1:'+server.address().port,data,queue,commands,close:()=>new Promise(resolve=>server.close(resolve))};
}
module.exports={create};
