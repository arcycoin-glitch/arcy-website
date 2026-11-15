'use strict';
// Read-only review probe for DEX venues Live Trading currently excludes (UNREVIEWED_FACTORY). For each excluded pool:
// factory(), Sourcify records of factory and pool (exact chain/address, runtime identity re-validated with the production
// validator), the Swap event declaration + emit sites and the factory's pool-registration function. Evidence for human
// review only; nothing here changes production behaviour.
const lt=require('../search/server/lib/live-trades'),gecko=require('../search/server/lib/gecko-market'),deep=require('../search/server/lib/mechanics-deep');
const oz=require('../search/server/lib/oz-template');
const RPC={ethereum:require('../search/server/lib/eth').rpc,arc:require('../search/server/lib/arc-rpc').rpc,robinhood:require('../search/server/lib/robinhood-rpc').rpc};
const CHAIN={ethereum:1,arc:5042,robinhood:4663};
const TOKENS=[['arc','0xf76b1d00bd3d63a37246b5f512074e864010e33d','POLL'],['arc','0xbc43ce8dec648ea298c4275559b81d6261c90b67','TOLLY'],['arc','0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b','ARCY'],
 ['robinhood','0x39dbed3a2bd333467115de45665cc57f813c4571','PONS-L'],['ethereum','0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce','SHIB'],['ethereum','0x6982508145454ce325ddbe47a25d4ec3d2311933','PEPE']];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function src(chainId,address,code){
 const r=await fetch('https://sourcify.dev/server/v2/contract/'+chainId+'/'+address+'?fields=abi,sources,compilation,runtimeBytecode',{signal:AbortSignal.timeout(15000)});
 if(!r.ok)return {status:r.status};const d=await r.json();
 try{const v=deep.validateSource(d,{chainId,address,code});return {status:200,match:d.runtimeMatch,name:d.compilation?.name,compiler:d.compilation?.compilerVersion,digest:v.digest,d};}catch(e){return {status:200,invalid:e.message};}
}
function excerpts(d){
 const out=[];
 for(const [p,f] of Object.entries(d.sources)){
  const s=oz.strip(f.content);
  for(const m of s.matchAll(/event\s+(Swap|PoolCreated|PairCreated)\s*\([^)]*\)/g))out.push(p.split('/').pop()+': '+m[0].replace(/\s+/g,' '));
  for(const m of s.matchAll(/emit\s+Swap\s*\([^;]*\);/g))out.push(p.split('/').pop()+': '+m[0].replace(/\s+/g,' ').slice(0,300));
  const cs=oz.contracts(s)||[];for(const c of cs){if(c.kind==='interface'||c.kind==='library')continue;for(const fn of oz.functions(c.body)||[])if(/^(getPool|getPair|createPool|createPair|swap|setOwner|enableFeeAmount|setFeeProtocol|collectProtocol)$/.test(fn.name))
   out.push(p.split('/').pop()+':'+c.name+'.'+fn.name+'('+fn.params.replace(/\s+/g,' ').trim()+') '+fn.header.replace(/\s+/g,' ').trim()+' { '+fn.body.replace(/\s+/g,' ').trim().slice(0,700)+' }');}
 }
 return out;
}
(async()=>{
 const seenFactory=new Set();
 for(const [network,address,label] of TOKENS){
  const rpc=RPC[network],chainId=CHAIN[network];
  const body=await gecko.json('https://api.geckoterminal.com/api/v2/networks/'+gecko.NETWORK_IDS[network]+'/tokens/'+address+'/pools?page=1&include=base_token,quote_token,dex');
  const pools=gecko.normalizePools(body,network,address);
  console.log('POOLS '+JSON.stringify({label,network,pools:pools.map(p=>({pool:p.pool,dex:p.dex,liq:Math.round(+p.attributes.reserve_in_usd||0),vol24:Math.round(+p.attributes.volume_usd?.h24||0),tx24:(p.attributes.transactions?.h24?.buys||0)+(p.attributes.transactions?.h24?.sells||0),created:p.attributes.pool_created_at}))}));
  const block=await rpc('eth_blockNumber',[]);
  for(const p of pools.filter(p=>/^0x[0-9a-f]{40}$/.test(p.pool)).slice(0,6)){
   const fw=await rpc('eth_call',[{to:p.pool,data:'0xc45a0155'},block]).catch(()=>null);const factory=/^0x0{24}[0-9a-f]{40}$/i.test(fw||'')?'0x'+fw.slice(26).toLowerCase():null;
   if(!factory)continue;const key=network+':'+factory;
   const poolCode=await rpc('eth_getCode',[p.pool,block]);const ps=await src(chainId,p.pool,poolCode);await sleep(400);
   const keccak=require('../lib/keccak');
   console.log('VENUE '+JSON.stringify({label,network,dex:p.dex,pool:p.pool,factory,poolCodeHash:keccak(Buffer.from(poolCode.slice(2),'hex')),pool_src:{status:ps.status,match:ps.match,name:ps.name,compiler:ps.compiler,digest:ps.digest,invalid:ps.invalid}}));
   if(seenFactory.has(key))continue;seenFactory.add(key);
   const fcode=await rpc('eth_getCode',[factory,block]);const fs=await src(chainId,factory,fcode);await sleep(400);
   console.log('FACTORY '+JSON.stringify({network,dex:p.dex,factory,codeHash:keccak(Buffer.from(fcode.slice(2),'hex')),src:{status:fs.status,match:fs.match,name:fs.name,compiler:fs.compiler,digest:fs.digest,invalid:fs.invalid}}));
   for(const l of [...(ps.d?excerpts(ps.d):[]),...(fs.d?excerpts(fs.d):[])])console.log('  X '+l);
   // Live log check: does the pool emit the canonical V2/V3 Swap topic?
   const head=BigInt(block),from='0x'+(head-5000n>0n?head-5000n:0n).toString(16);
   const logs=await rpc('eth_getLogs',[{address:p.pool,fromBlock:from,toBlock:block}]).catch(e=>({error:String(e.message).slice(0,80)}));
   const topics=Array.isArray(logs)?logs.reduce((m,l)=>(m[l.topics[0]]=(m[l.topics[0]]||0)+1,m),{}):logs;
   console.log('TOPICS '+JSON.stringify({pool:p.pool,v2Swap:lt.TOPIC.V2,v3Swap:lt.TOPIC.V3,seen:topics}));
  }
  await sleep(2500);
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
