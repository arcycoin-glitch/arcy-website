const {test}=require('node:test'),assert=require('node:assert/strict'),c=require('../lib/core');
const a='0x'+'a'.repeat(40),b='0x'+'b'.repeat(40),pool='0x'+'c'.repeat(64);
test('blank market numbers do not become verified zero-volume data',()=>{const m=require('../lib/market-activity');for(const value of ['', ' ', '\t',null,undefined,{},false,'NaN'])assert.equal(m.finite(value),null);assert.equal(m.finite('0'),0);assert.equal(m.finite('-2.5'),-2.5);});
test('Gecko pool normalization rejects wrong-chain, ticker-only and wrong pool identities, deduplicates and preserves zero volume',()=>{
 const g=require('../lib/gecko-pairs'),row={type:'pool',id:'arc_'+pool,attributes:{address:pool,reserve_in_usd:'12',volume_usd:{h24:'0'}},relationships:{base_token:{data:{id:'arc_'+a}},quote_token:{data:{id:'arc_'+b}},dex:{data:{id:'uniswap-v4-arc'}}}};
 const invalid=structuredClone(row);invalid.relationships.base_token.data.id='ethereum_'+a;
 const mismatch={...row,id:'arc_'+b};const r=g.normalize({data:[row,row,invalid,mismatch]},a);assert.equal(r.length,1);assert.equal(r[0].volume.h24,0);assert.equal(r[0].liquidity.usd,12);assert.equal(r[0].dexId,'uniswap');assert.deepEqual(r[0].labels,['v4']);assert.throws(()=>g.normalize({data:null},a));
});
test('liquidity API isolates a failed DexScreener source and uses exact-contract Gecko pool evidence',async()=>{
 const m=require('../lib/market-activity'),g=require('../lib/gecko-pairs'),lp=require('../lib/lp-status'),go=require('../lib/goplus'),identity=require('../lib/token-identity'),old=[m.dexPairs,g.read,lp.inspect,go.read,identity.inspect];
 try{identity.inspect=async()=>({address:a,chainId:5042,block:'0x1'});m.dexPairs=async()=>{throw Object.assign(Error(),{httpStatus:503});};g.read=async()=>({pairs:[{chainId:'arc',pairAddress:pool,dexId:'uniswap',baseToken:{address:a},quoteToken:{address:b},liquidity:{usd:12},volume:{h24:0}}],evidence:[{source:'GeckoTerminal',address:a,chainId:5042}]});lp.inspect=async()=>c.unknown();go.read=async()=>({});
 const r=await require('../api/liquidity')({query:{address:a}},{setHeader(){},status(){return this},json(x){return x}});assert.equal(r.ok,true);assert.equal(r.volume24h,0);assert.equal(r.pairCount,1);assert.equal(r.fields.pairCount.source,'GeckoTerminal');assert.equal(r.fields.pairCount.evidence[0].address,a);assert.equal(r.marketAttempts[0].dataState,'SOURCE_API_FAILED');assert.equal(r.lpStatus.value,null);
 }finally{[m.dexPairs,g.read,lp.inspect,go.read,identity.inspect]=old;}
});
test('HTTP-200 JSON-RPC rate limits retry with backoff instead of becoming negative evidence',async()=>{
 const old=global.fetch;let calls=0;try{global.fetch=async()=>({ok:true,json:async()=>++calls<3?{id:1,error:{code:-32005,message:'request limit exceeded'}}:{id:1,result:'0x42'}});assert.equal(await c.rpc('audit_rate_limit',[]),'0x42');assert.ok(calls>=3);}finally{global.fetch=old;}
});
test('RPC rejects a response for a different request ID',async()=>{
 const old=global.fetch;try{global.fetch=async()=>({ok:true,json:async()=>({id:99,result:'0x1'})});await assert.rejects(c.rpc('audit_wrong_id',[]),e=>e.code==='MALFORMED_RPC_RESPONSE');}finally{global.fetch=old;}
});
test('RPC batch errors and malformed responses cannot become verified values',async()=>{
 const old=global.fetch;try{global.fetch=async()=>({ok:true,json:async()=>[{id:1,result:'0x1'},{id:2,error:{code:3,message:'execution reverted'}}]});await assert.rejects(c.batch([{method:'x',params:[]},{method:'y',params:[]}]));}finally{global.fetch=old;}
});
test('explorer ABI fallback computes selectors locally and supports enumerable admin roles',async()=>{
 const old=global.fetch,oldKey=process.env.ETHERSCAN_API_KEY;
 try{process.env.ETHERSCAN_API_KEY='test-only';global.fetch=async()=>({ok:true,json:async()=>({status:'1',result:[{SourceCode:'contract Example {}',ABI:JSON.stringify([{type:'function',name:'getRoleMember',inputs:[{type:'bytes32'},{type:'uint256'}],outputs:[{type:'address'}],stateMutability:'view'}])}]})});const r=await require('../lib/explorer-source').lookup(a,'0x6000');assert.equal(r.signatures.function[0].signature,'getRoleMember(bytes32,uint256)');assert.equal(r.signatures.function[0].signatureHash4,require('../lib/keccak')(Buffer.from('getRoleMember(bytes32,uint256)')).slice(0,10));assert.equal(r.runtimeMatch,'EXPLORER_ATTESTATION');assert.equal(r.profile,null);
 }finally{global.fetch=old;if(oldKey===undefined)delete process.env.ETHERSCAN_API_KEY;else process.env.ETHERSCAN_API_KEY=oldKey;}
});
test('market token identity rejects EOA, non-ERC20 and out-of-range decimals instead of trusting external records',async()=>{
 const identity=require('../lib/token-identity'),old=[c.context,c.call];const word=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
 try{c.context=async()=>{throw Object.assign(Error(),{code:'NO_CONTRACT'});};await assert.rejects(identity.inspect(a),e=>e.code==='NO_CONTRACT');c.context=async()=>({block:'0x42'});c.call=async()=>{throw Object.assign(Error(),{code:'GETTER_REVERTED'});};await assert.rejects(identity.inspect(a),e=>e.code==='TOKEN_IDENTITY_NOT_VERIFIED');c.call=async(_a,data,block)=>{assert.equal(block,'0x42');return word(data==='0x18160ddd'?100:256);};await assert.rejects(identity.inspect(a));c.call=async(_a,data)=>word(data==='0x18160ddd'?100:18);const r=await identity.inspect(a);assert.equal(r.decimals,18);assert.equal(r.totalSupplyRaw,'100');assert.equal(r.block,'0x42');
 }finally{[c.context,c.call]=old;}
});
test('V4 PoolManager fallback requires the PositionManager sender before exposing a transferable NFT witness',async()=>{
 const lp=require('../lib/lp-positions'),k=require('../lib/keccak'),word=n=>BigInt(n).toString(16).padStart(64,'0'),owner='0x'+'e'.repeat(40),key=a.slice(2).padStart(64,'0')+b.slice(2).padStart(64,'0')+word(3000)+word(60)+word(0),id=k(Buffer.from(key,'hex')),topic=k(Buffer.from('ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)')),old=[c.context,c.rpc,c.batch];let correct=true;
 try{c.context=async()=>({block:'0x123',code:'0x6000'});c.batch=async()=>['0x'+key+word(0),'0x'+word(100),'0x'+owner.slice(2).padStart(64,'0')];c.rpc=async(method,params)=>{if(method==='eth_getLogs'){if(params[0].address===lp.MANAGER)return [];assert.equal(params[0].topics[2],'0x'+lp.MANAGER.slice(2).padStart(64,'0'));return [{address:lp.POOL_MANAGER,topics:[topic,id,'0x'+(correct?lp.MANAGER:a).slice(2).padStart(64,'0')],data:'0x'+word(0)+word(60)+word(100)+word(1)}];}if(method==='eth_getCode')return '0x';if(method==='eth_call')return '0x';throw Error('Unexpected request');};const pair={dexId:'uniswap',labels:['v4'],pairAddress:id,baseToken:{address:a},quoteToken:{address:b}};assert.equal((await lp.witness(pair,a)).value,'UNLOCKED (POSITION)');correct=false;assert.equal((await lp.witness(pair,a)).value,null);
 }finally{[c.context,c.rpc,c.batch]=old;}
});
test('V3 custody requires a matching factory pool, positive position and successful owner transfer simulation',async()=>{
 const lp=require('../lib/lp-v3-positions'),k=require('../lib/keccak'),word=n=>BigInt(n).toString(16).padStart(64,'0'),owner='0x'+'e'.repeat(40),factory='0x'+'f'.repeat(40),address='0x'+'c'.repeat(40),old=[c.context,c.call,c.rpc,c.batch];let matches=true;
 try{c.context=async()=>({block:'0x42'});c.call=async(_a,data)=>'0x'+(data===k(Buffer.from('factory()')).slice(0,10)?factory:matches?address:b).slice(2).padStart(64,'0');c.rpc=async method=>method==='eth_getLogs'?[{address:lp.MANAGER,topics:[k(Buffer.from('IncreaseLiquidity(uint256,uint128,uint256,uint256)')),'0x'+word(1)],data:'0x'+word(10)+word(1)+word(1)}]:method==='eth_getCode'?'0x':'0x';c.batch=async()=>['0x'+[0,0,BigInt(a),BigInt(b),3000,0,60,100,0,0,0,0].map(word).join(''),'0x'+owner.slice(2).padStart(64,'0')];const pair={dexId:'uniswap',labels:['v3'],pairAddress:address,baseToken:{address:a},quoteToken:{address:b}};assert.equal((await lp.witness(pair,a)).value,'UNLOCKED (POSITION)');matches=false;assert.equal((await lp.witness(pair,a)).value,null);assert.throws(()=>lp.position('0x00'));
 }finally{[c.context,c.call,c.rpc,c.batch]=old;}
});
