'use strict';
// Separate streaming transport. The established JSON report API is unchanged;
// each progress snapshot still contains all five cards and twenty identifiers.
const handler=require('./report');
module.exports=async function(req,res){
 let started=false,closed=false;
 res.once?.('close',()=>{closed=true});
 const send=event=>{
  if(closed||res.writableEnded)return;
  if(!started){
   res.setHeader('Content-Type','application/x-ndjson; charset=utf-8');
   res.setHeader('Cache-Control','no-store, no-transform');res.setHeader('X-Accel-Buffering','no');
   res.flushHeaders?.();started=true;
  }
  res.write(JSON.stringify(event)+'\n');
 };
 const child=Object.create(req);child.onSearchProgress=send;
 const wrapper={
  setHeader:(...args)=>res.setHeader(...args),
  status(code){if(!started)res.statusCode=code;return wrapper},
  json(body){
   if(closed||res.writableEnded)return body;
   if(!started)return res.json(body);
   send(body.ok?{phase:'complete',report:body}:{phase:'error',error:body.error||'CHAIN_SCAN_UNAVAILABLE'});
   if(!closed)res.end();return body;
  }
 };
 return handler(child,wrapper);
};
