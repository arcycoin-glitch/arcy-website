const c=require('./core'),f=require('./fields'),k=require('./keccak');
// Official Arc infrastructure deployment, shared by arbitrary tokens.
const MANAGER='0x39654a85a4c05127f5fd6ed22caec077a0fb1377',DOC='https://developers.uniswap.org/deployments';
const selector=s=>k(Buffer.from(s)).slice(0,10),word=n=>BigInt(n).toString(16).padStart(64,'0');
function position(raw){if(!/^0x[0-9a-f]{768}$/i.test(raw))throw Error('Invalid position tuple');const w=raw.slice(2).match(/.{64}/g),fee=c.uint('0x'+w[4]),liquidity=c.uint('0x'+w[7]);if(fee>=2n**24n||liquidity>=2n**128n)throw Error('Invalid position units');return {tokens:[c.addressWord('0x'+w[2]),c.addressWord('0x'+w[3])],fee,liquidity};}
async function witness(pair,address){
 if(pair.dexId!=='uniswap'||!pair.labels?.includes('v3'))return c.unknown('No supported V3 deployment.', 'V3_POSITION_MANAGER_UNSUPPORTED');
 const ctx=await c.context(MANAGER),head=Number(BigInt(ctx.block)),topic=k(Buffer.from('IncreaseLiquidity(uint256,uint128,uint256,uint256)'));
 const evidence=[{source:'Uniswap official Arc V3 deployment + Arc RPC',url:DOC,manager:MANAGER,chainId:5042,pair:pair.pairAddress,block:ctx.block,scanFromBlock:Math.max(0,head-5000),complete:false}];
 let logs;try{logs=await c.rpc('eth_getLogs',[{address:MANAGER,topics:[topic],fromBlock:'0x'+Math.max(0,head-5000).toString(16),toBlock:ctx.block}]);if(!Array.isArray(logs)||logs.length>=1000)throw Object.assign(Error(),{code:'LP_POSITION_LOGS_INCOMPLETE'});}catch(e){return {...c.unknown('V3 position discovery failed; no custody inferred.','V3_POSITION_DISCOVERY_FAILED',c.failure(e).dataState),failure:c.failure(e),evidence};}
 const ids=[...new Set(logs.filter(l=>!l.removed&&l.address?.toLowerCase()===MANAGER&&l.topics?.length===2&&l.topics[0]?.toLowerCase()===topic&&/^0x[0-9a-f]{64}$/i.test(l.topics[1])&&/^0x[0-9a-f]{192}$/i.test(l.data)).reverse().map(l=>c.uint(l.topics[1]).toString()))].slice(0,12);
 const factory=c.addressWord(await c.call(MANAGER,selector('factory()'),ctx.block));
 for(const id of ids){try{
 const [raw,ownerRaw]=await c.batch([{method:'eth_call',params:[{to:MANAGER,data:selector('positions(uint256)')+word(id)},ctx.block]},{method:'eth_call',params:[{to:MANAGER,data:selector('ownerOf(uint256)')+word(id)},ctx.block]}]);
 const p=position(raw),owner=c.addressWord(ownerRaw);if(!p.tokens.includes(address)||!p.tokens.every(t=>[pair.baseToken?.address,pair.quoteToken?.address].some(a=>String(a).toLowerCase()===t))||p.liquidity<=0n||c.BURNS.includes(owner))continue;
 const pool=c.addressWord(await c.call(factory,selector('getPool(address,address,uint24)')+p.tokens.map(t=>t.slice(2).padStart(64,'0')).join('')+word(p.fee),ctx.block));
 if(pool!==pair.pairAddress.toLowerCase()||await c.rpc('eth_getCode',[owner,ctx.block])!=='0x')continue;
 const transfer=await c.rpc('eth_call',[{from:owner,to:MANAGER,data:selector('transferFrom(address,address,uint256)')+owner.slice(2).padStart(64,'0')+address.slice(2).padStart(64,'0')+word(id)},ctx.block]);
 if(transfer==='0x')return f.field('UNLOCKED (POSITION)','ONCHAIN_VERIFIED','Arc RPC + Uniswap V3 deployment',evidence.concat({tokenId:id,owner,factory,pool,fee:p.fee.toString(),liquidityRaw:p.liquidity.toString(),scope:'At least one exact-pool positive-liquidity position is owned by an EOA and transferable in a read-only simulation. Other positions and aggregate custody remain unknown.'}));
 }catch(e){evidence.push({tokenId:id,...c.failure(e)});}}
 return {...c.unknown('No positive transferable witness in bounded V3 position history; absence is not lock or burn proof.','V3_POSITION_WITNESS_NOT_FOUND'),evidence};
}
module.exports={witness,position,MANAGER};
