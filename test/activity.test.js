const {test}=require('node:test'),assert=require('node:assert/strict'),m=require('../lib/market-activity'),b=require('../lib/balance-reader'),ui=require('../ui-model');const a='0x'+'a'.repeat(40),x='0x'+'b'.repeat(40),word=n=>BigInt(n).toString(16).padStart(64,'0');
test('GeckoTerminal market fields preserve FDV, negative change and explicit zero volume only for the exact chain and token',()=>{
 const pool='0x'+'c'.repeat(64),network='arc';
 const row={type:'pool',id:network+'_'+pool,attributes:{address:pool,reserve_in_usd:'10',
  volume_usd:{h24:'0'},base_token_price_usd:'0.0000123',fdv_usd:'1000',market_cap_usd:null,
  price_change_percentage:{h24:'-12.5'}},relationships:{base_token:{data:{id:network+'_'+a}},
  quote_token:{data:{id:network+'_'+x}},dex:{data:{id:'uniswap-v3-arc'}}}};
 const result=require('../search/server/lib/gecko-market').parseMarket({data:[row]},'arc',a);
 assert.equal(result.fields.valuation.kind,'FDV');assert.equal(result.fields.valuation.value,1000);
 assert.equal(result.fields.change24h.value,-12.5);assert.equal(result.fields.volume24h.value,0);
 assert.equal(result.fields.priceUsd.value,.0000123);assert.equal(result.fields.priceUsd.source,'GeckoTerminal');
 const wrong=require('../search/server/lib/gecko-market').parseMarket({data:[row]},'ethereum',a);
 assert.equal(wrong.fields.priceUsd.dataState,'NOT_VERIFIED');
});
test('multicall encoding preserves targets and strict decoder rejects truncated, wrong-block and duplicate return slots',()=>{const encoded=b.encode(a,[x,a]);assert.ok(encoded.startsWith('0x252dba42'));const valid='0x'+word(10)+word(64)+word(2)+word(64)+word(128)+word(32)+word(7)+word(32)+word(3);assert.deepEqual(b.decode(valid,2,'0xa'),['0x'+word(7),'0x'+word(3)]);assert.throws(()=>b.decode(valid,2,'0xb'));assert.throws(()=>b.decode(valid.slice(0,-64),2,'0xa'));const duplicate='0x'+word(10)+word(64)+word(2)+word(64)+word(64)+word(32)+word(7);assert.throws(()=>b.decode(duplicate,2,'0xa'));});

test('local Ethereum keccak handles canonical selectors and empty input without provider web3_sha3',()=>{const k=require('../lib/keccak');assert.equal(k(Buffer.alloc(0)),'0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');assert.equal(k(Buffer.from('transfer(address,uint256)')).slice(0,10),'0xa9059cbb');assert.equal(k(Buffer.from('ownerOf(uint256)')).slice(0,10),'0x6352211e');});

test('V4 custody requires exact pool key, positive position liquidity, EOA ownership and successful transfer simulation',async()=>{const c=require('../lib/core'),lp=require('../lib/lp-positions'),k=require('../lib/keccak'),original={context:c.context,batch:c.batch,rpc:c.rpc},owner='0x'+'e'.repeat(40),key=a.slice(2).padStart(64,'0')+x.slice(2).padStart(64,'0')+word(3000)+word(60)+word(0),pool=k(Buffer.from(key,'hex')),topic=k(Buffer.from('ModifyPosition(bytes32,address,int24,int24,int256,bytes32)'));let canTransfer=true;try{c.context=async()=>({block:'0x64',code:'0x6000'});c.batch=async()=>['0x'+key+word(0),'0x'+word(100),'0x'+owner.slice(2).padStart(64,'0')];c.rpc=async(method)=>{if(method==='eth_getLogs')return [{address:lp.MANAGER,topics:[topic,pool],data:'0x'+word(0)+word(60)+word(100)+word(1)}];if(method==='eth_getCode')return '0x';if(method==='eth_call'){if(!canTransfer)throw Error('restricted');return '0x';}throw Error('Unexpected method');};const pair={dexId:'uniswap',labels:['v4'],pairAddress:pool,baseToken:{address:a},quoteToken:{address:x}};const yes=await lp.witness(pair,a);assert.equal(yes.value,'UNLOCKED (POSITION)');assert.ok(yes.evidence.at(-1).scope.includes('Other positions'));canTransfer=false;assert.equal((await lp.witness(pair,a)).value,null);assert.equal((await lp.witness({...pair,pairAddress:'0x'+'f'.repeat(64)},a)).value,null);}finally{Object.assign(c,original);}});
