'use strict';
const {report}=require('../search/server/lib/multichain-service');
const checks=[
 {network:'arc',label:'ARCY',address:'0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b'},
 {network:'arc',label:'Circle USDC',address:'0x3600000000000000000000000000000000000000'},
 {network:'ethereum',label:'ONDO',address:'0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3'},
 {network:'robinhood',label:'APLD',address:'0xb8dbf92f9741c9ac1c32115e78581f23509916fd'}
];
async function main(){
 let good=0;
 for(const spec of checks){
  const t=Date.now();
  try{
   const data=await report(spec);
   if(!data.ok||data.network!==spec.network||data.address!==spec.address||
    ![5042,1,4663].includes(data.chainId)||Object.keys(data.cards||{}).length!==5)
    throw Error('Wrong chain / contract / 5-card report');
   let present=0;
   const cards={};
   for(const [name,card] of Object.entries(data.cards)){
    const verified=Object.values(card.fields).filter(x=>x.dataState==='DATA_FOUND');
    if(verified.some(x=>x.network!==data.network||x.chainId!==data.chainId||
     !Array.isArray(x.evidence)||!x.evidence.length))throw Error('Cross-chain or unsupported field');
    cards[name]=verified.length;present+=verified.length;
   }
   console.log(JSON.stringify({label:spec.label,network:spec.network,correctContract:true,
    sourced:present,metrics:20,cards,seconds:Math.round((Date.now()-t)/100)/10}));
   good++;
  }catch(e){console.log(JSON.stringify({label:spec.label,network:spec.network,failed:String(e.message||e).slice(0,160)}));}
 }
 console.log('Other real token report identity checks: '+good+'/'+checks.length);
 if(good!==checks.length)process.exitCode=1;
}
main().catch(e=>{console.error(String(e));process.exitCode=1});
