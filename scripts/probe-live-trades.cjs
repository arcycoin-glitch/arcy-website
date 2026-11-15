'use strict';
// Read-only probe: GeckoTerminal pool candidates + RPC getLogs capability per chain (design input for Live Trading).
const gecko=require('../search/server/lib/gecko-market');
const RPC={ethereum:require('../search/server/lib/eth').rpc,arc:require('../search/server/lib/arc-rpc').rpc,robinhood:require('../search/server/lib/robinhood-rpc').rpc};
const V2='0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822',V3='0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',V4='0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f';
const SAMPLES=[['arc','0x73e5F588d27d6B5EC89C89c82692D1E7fECBd38b'],['arc','0xbc43ce8dec648ea298c4275559b81d6261c90b67'],['arc','0xece5ca8bf9220718e5727754026757512212cb3c'],
 ['ethereum','0x6982508145454Ce325dDbE47a25d4ec3d2311933'],['ethereum','0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984'],['ethereum','0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE'],
 ['robinhood','0x6dbe95076584f869dd09a44131e9a3c13f34d7d6'],['robinhood','0x18e674231a58c239dc7daedcffe15ec3a24cff5c'],['robinhood','0x39dbed3a2bd333467115de45665cc57f813c4571']];
(async()=>{
 for(const [net,a] of SAMPLES){
  try{const id=gecko.NETWORK_IDS[net];const body=await gecko.json('https://api.geckoterminal.com/api/v2/networks/'+id+'/tokens/'+a.toLowerCase()+'/pools?page=1&include=base_token,quote_token,dex');
   const pools=gecko.normalizePools(body,net,a.toLowerCase()).slice(0,4);
   const rpc=RPC[net];const head=BigInt(await rpc('eth_blockNumber',[]));
   const out=[];
   for(const p of pools){
    const r={pool:p.pool.slice(0,18),len:(p.pool.length-2)/2,dex:p.dex,reserve:Number(p.attributes.reserve_in_usd||0)|0,tx24:p.attributes.transactions?.h24};
    if(r.len===20){
     for(const span of [500n,5000n]){try{const logs=await rpc('eth_getLogs',[{address:p.pool,fromBlock:'0x'+(head-span).toString(16),toBlock:'0x'+head.toString(16),topics:[[V2,V3]]}]);r['logs'+span]=logs.length;r.topic=logs[0]?.topics?.[0]===V2?'V2':logs[0]?'V3':null;}catch(e){r['logs'+span]='ERR:'+String(e.message).slice(0,60);}}
    }
    out.push(r);
   }
   console.log('POOLS '+JSON.stringify({net,a:a.slice(0,10),head:head.toString(),n:pools.length,out}));
  }catch(e){console.log('POOLS '+JSON.stringify({net,a:a.slice(0,10),error:String(e.message).slice(0,120)}));}
  await new Promise(r=>setTimeout(r,2500));
 }
 // V4 PoolManager candidates per chain (Swap topic on any address in a short window)
 for(const net of ['arc','robinhood','ethereum']){try{const rpc=RPC[net];const head=BigInt(await rpc('eth_blockNumber',[]));const logs=await rpc('eth_getLogs',[{fromBlock:'0x'+(head-50n).toString(16),toBlock:'0x'+head.toString(16),topics:[V4]}]);const by={};for(const l of logs)by[l.address]=(by[l.address]||0)+1;console.log('V4 '+net+' '+JSON.stringify(by));}catch(e){console.log('V4 '+net+' ERR '+String(e.message).slice(0,100));}}
 // batch support
 for(const net of ['arc','robinhood','ethereum']){try{const r=await RPC[net]('eth_getBlockByNumber',['latest',false]);console.log('BLOCK '+net+' ts='+parseInt(r.timestamp,16)+' age='+(Date.now()/1000-parseInt(r.timestamp,16)).toFixed(1)+'s');}catch(e){console.log('BLOCK '+net+' ERR '+e.message);}}
})();
