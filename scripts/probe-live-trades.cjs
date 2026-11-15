'use strict';
// Read-only probe: log-range limits, V4 Initialize full-range lookup, tx lookup (design input for Live Trading).
const RPC={ethereum:require('../search/server/lib/eth').rpc,arc:require('../search/server/lib/arc-rpc').rpc,robinhood:require('../search/server/lib/robinhood-rpc').rpc};
const V3='0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',V4='0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f',INIT='0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438';
const PM={ethereum:'0x000000000004444c5dc75cb358380d2e3de08a90',arc:'0x8366a39cc670b4001a1121b8f6a443a643e40951',robinhood:'0x8366a39cc670b4001a1121b8f6a443a643e40951'};
const V3POOL={arc:'0x162df51c504e7b83',ethereum:'0x1d42064fc4beb5f8'};
const hex=n=>'0x'+n.toString(16);
(async()=>{
 for(const net of ['arc','robinhood','ethereum']){
  const rpc=RPC[net];const head=BigInt(await rpc('eth_blockNumber',[]));
  // recent V4 swaps on the PoolManager: spans
  for(const span of [200n,2000n,10000n,50000n]){const t=Date.now();try{const logs=await rpc('eth_getLogs',[{address:PM[net],fromBlock:hex(head-span),toBlock:hex(head),topics:[V4]}]);console.log('SPAN '+JSON.stringify({net,span:String(span),n:logs.length,ms:Date.now()-t}));
    if(span===200n&&logs[0]){const id=logs[0].topics[1];
     const t2=Date.now();try{const init=await rpc('eth_getLogs',[{address:PM[net],fromBlock:'0x0',toBlock:hex(head),topics:[INIT,id]}]);console.log('INIT '+JSON.stringify({net,id:id.slice(0,12),n:init.length,ms:Date.now()-t2,c0:init[0]?.topics[2]?.slice(26),c1:init[0]?.topics[3]?.slice(26),blk:init[0]?parseInt(init[0].blockNumber,16):null}));}catch(e){console.log('INIT '+JSON.stringify({net,err:String(e.message).slice(0,140)}));}
     try{const tx=await rpc('eth_getTransactionByHash',[logs[0].transactionHash]);console.log('TX '+JSON.stringify({net,from:tx?.from?.slice(0,10),to:tx?.to?.slice(0,10),blk:tx?.blockNumber}));}catch(e){console.log('TX '+JSON.stringify({net,err:String(e.message).slice(0,140)}));}
    }
  }catch(e){console.log('SPAN '+JSON.stringify({net,span:String(span),err:String(e.message).slice(0,140),ms:Date.now()-t}));}}
 }
})();
