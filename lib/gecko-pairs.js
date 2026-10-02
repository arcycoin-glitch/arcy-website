const c=require('./core'),f=require('./fields'),market=require('./market-activity');
function normalize(data,address){
  if(!Array.isArray(data?.data))throw Object.assign(Error('Malformed pool response'),{code:'MALFORMED_GECKO_POOLS'});
  const rows=[];
  for(const pool of data.data){
    const p=pool.attributes,base=pool.relationships?.base_token?.data?.id,quote=pool.relationships?.quote_token?.data?.id,dex=pool.relationships?.dex?.data?.id;
    if(pool.type!=='pool'||!/^arc_0x[0-9a-f]{40}$/i.test(base||'')||!/^arc_0x[0-9a-f]{40}$/i.test(quote||'')||![base.toLowerCase(),quote.toLowerCase()].includes('arc_'+address))continue;
    if(!/^0x[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(p?.address||'')||pool.id?.toLowerCase()!=='arc_'+p.address.toLowerCase()||typeof dex!=='string'||!dex)continue;
    const nonnegative=v=>{const n=market.finite(v);return n!==null&&n>=0?n:null;};
    rows.push({chainId:'arc',pairAddress:p.address.toLowerCase(),dexId:['uniswap-v4-arc','uniswap-v3-arc'].includes(dex)?'uniswap':dex,
      labels:dex==='uniswap-v4-arc'?['v4']:dex==='uniswap-v3-arc'?['v3']:[],baseToken:{address:base.slice(4).toLowerCase()},quoteToken:{address:quote.slice(4).toLowerCase()},
      liquidity:{usd:nonnegative(p.reserve_in_usd)},volume:{h24:nonnegative(p.volume_usd?.h24)},
      source:'GeckoTerminal',sourceDexId:dex,sourcePoolId:pool.id});
  }
  return [...new Map(rows.map(p=>[p.pairAddress,p])).values()];
}
async function read(address){const url='https://api.geckoterminal.com/api/v2/networks/arc/tokens/'+address+'/pools';
  return f.cached('gecko-pairs:'+address,60000,async()=>({pairs:normalize(await c.json(url),address),evidence:[{source:'GeckoTerminal',url,chainId:5042,address,fetchedAt:new Date().toISOString(),scope:'Exact-contract first page of source-returned pools; not a complete chain-wide inventory.'}]}));
}
module.exports={read,normalize};
