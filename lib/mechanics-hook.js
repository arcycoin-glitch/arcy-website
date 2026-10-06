const c=require('./core'),source=require('./verified-source'),keccak=require('./keccak');
const reviewed={portal:'af84a7227361feee271e215898d1bddf584c1477c3bf89feaffe16200a94910d',hook:'3151e4ee36fd54044a94a9f0ef2a691e386560dffb85c8a927b4cfa7b8ea610c'};
const template=require('./mechanics-hook-template.json');
function templateMatch(code){
 if(template.sourceDigest!==reviewed.hook||!/^0x[0-9a-f]+$/i.test(code)||code.length!==template.runtimeBytecode.length)return false;
 const bytes=Buffer.from(code.slice(2),'hex'),expected=Buffer.from(template.runtimeBytecode.slice(2),'hex');
 for(const ranges of Object.values(template.immutableReferences)){let value;for(const {start,length} of ranges){if(length!==32||start<0||start+length>bytes.length)return false;const current=bytes.subarray(start,start+length).toString('hex');if(value&&current!==value)return false;value=current;bytes.fill(0,start,start+length);expected.fill(0,start,start+length);}}
 return bytes.equals(expected);
}
function matched(s,digest){return s.dataState==='DATA_FOUND'&&['match','exact_match'].includes(s.runtimeMatch)&&s.sourceDigest===digest;}
function selector(s,signature){const value=source.selector(s,signature);if(!value)throw Object.assign(Error('Missing verified ABI getter'),{code:'HOOK_ABI_UNAVAILABLE'});return value;}
async function inspect(a,block,tokenSource){
 if(tokenSource?.profile?.id!=='ARGUS_V4_LAUNCH_TOKEN_7'||tokenSource.sourceDigest!=='f4abba6aa7071125168a9b9ea39cdfd08f01835d3c59aa74c55173c71e50daa1')throw Object.assign(Error('Unreviewed token'),{code:'HOOK_TOKEN_NOT_REVIEWED'});
 // The caller has already established the current implementation profile. The
 // clone itself has no ABI; selectors come from the reviewed token interface.
 const get=signature=>keccak(Buffer.from(signature)).slice(0,10);
 const values=await Promise.all(['portal()','poolManager()','quoteAsset()'].map(s=>c.call(a,get(s),block).then(c.addressWord)));
 const [portal,manager,quote]=values;
 if([portal,manager,quote].some(x=>c.BURNS.includes(x)))throw Object.assign(Error('Unbound token'),{code:'HOOK_LINK_NOT_ESTABLISHED'});
 const p=await source.lookup(portal,await c.rpc('eth_getCode',[portal,block]));
 if(!matched(p,reviewed.portal))throw Object.assign(Error('Unreviewed portal'),{code:'HOOK_PORTAL_NOT_REVIEWED'});
 const raw=await c.call(portal,selector(p,'launches(address)')+a.slice(2).padStart(64,'0'),block);
 if(!/^0x[0-9a-f]{704}$/i.test(raw))throw Object.assign(Error('Invalid launch tuple'),{code:'HOOK_LAUNCH_INVALID'});
 const word=i=>'0x'+raw.slice(2+i*64,2+(i+1)*64),hook=c.addressWord(word(4)),splitter=c.addressWord(word(5));
 if(c.BURNS.includes(hook)||c.addressWord(word(10))!==quote)throw Object.assign(Error('Invalid launch identity'),{code:'HOOK_LINK_NOT_ESTABLISHED'});
 const hookCode=await c.rpc('eth_getCode',[hook,block]);
 const h=templateMatch(hookCode)?{dataState:'DATA_FOUND',runtimeMatch:'exact_match',sourceDigest:template.sourceDigest,signatures:template.signatures}:await source.lookup(hook,hookCode);
 if(!matched(h,reviewed.hook))throw Object.assign(Error('Unreviewed hook'),{code:'HOOK_SOURCE_NOT_REVIEWED'});
 const signatures=['token()','portal()','poolManager()','quoteAsset()','splitter()','buyTaxBps()','sellTaxBps()','currentSnipeTaxBps()','poolFee()','tickSpacing()','poolId()'];
 const reads=await c.batch(signatures.map(s=>({method:'eth_call',params:[{to:hook,data:selector(h,s)},block]})));
 if([a,portal,manager,quote,splitter].some((v,i)=>c.addressWord(reads[i])!==v))throw Object.assign(Error('Hook identity mismatch'),{code:'HOOK_IDENTITY_MISMATCH'});
 const [buy,sell,snipe,fee]=reads.slice(5,9).map(c.uint);
 if(buy!==c.uint(word(6))||sell!==c.uint(word(7))||buy>1000n||sell>1000n||snipe>9900n||fee>1000000n)throw Object.assign(Error('Hook rate mismatch'),{code:'HOOK_RATE_INVALID'});
 c.uint(reads[9]);c.uint(reads[10]);
 const currencies=[a,quote].sort(),encoded=currencies.map(x=>x.slice(2).padStart(64,'0')).join('')+reads[8].slice(2)+reads[9].slice(2)+hook.slice(2).padStart(64,'0');
 if(keccak(Buffer.from(encoded,'hex')).toLowerCase()!==reads[10].toLowerCase())throw Object.assign(Error('Pool mismatch'),{code:'HOOK_POOL_MISMATCH'});
 const evidence=[{source:'Sourcify bytecode-matched reviewed V4 hook + Arc RPC',address:a,chainId:c.CHAIN,block,portal,hook,poolManager:manager,poolId:reads[10],quoteAsset:quote,portalSourceDigest:p.sourceDigest,hookSourceDigest:h.sourceDigest,runtimeMatch:templateMatch(hookCode)?'REVIEWED_COMPILER_TEMPLATE_IMMUTABLES_ONLY':h.runtimeMatch,runtimeCodeHash:keccak(Buffer.from(hookCode.slice(2),'hex')),methods:signatures,baseBuyBps:buy.toString(),baseSellBps:sell.toString(),antiSnipeBps:snipe.toString(),lpFeeMillionths:fee.toString(),scope:'Exact launch pool hook tax on the unspecified swap leg. LP/protocol fees are separate; other pools are not covered. Portal/splitter senders are exempt from anti-sniping only. Integer rounding applies.'}];
 const field=(base,direction)=>({...c.fact(Number(base+(snipe>9900n-base?9900n-base:snipe))/100,evidence,'ON_CHAIN_VERIFIED_UNITS'),unit:'percent',scope:direction+' tax at this pinned block for ordinary senders in the verified launch pool; not an all-pool effective execution fee.',basePercent:Number(base)/100,antiSnipePercent:Number(snipe>9900n-base?9900n-base:snipe)/100});
 return {buyTax:field(buy,'Buy'),sellTax:field(sell,'Sell'),hookEvidence:evidence};
}
module.exports={inspect,matched,reviewed,templateMatch};
