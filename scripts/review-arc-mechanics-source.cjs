'use strict';
// Read-only reviewer of Sourcify's already public exact-match source.
// No wallet, no keys, no writes, no Vercel/worker interaction.
const crypto=require('node:crypto');
const targets=[
 ['POLL','0xf76b1d00bd3d63a37246b5f512074e864010e33d'],
 ['USDT-Arc','0x3b0d0f9825850d3ab1491253b86c4cc26ff1250a']
];
(async()=>{
 for(const [name,address]of targets){
  const url='https://sourcify.dev/server/v2/contract/5042/'+address+'?fields=abi,sources,compilation,runtimeBytecode';
  try{
   const response=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)});
   console.log('TOKEN',name,'HTTP',response.status);
   if(!response.ok)continue;
   const body=await response.json();
   const sources=body.sources||{};
   const fingerprint=crypto.createHash('sha256').update(JSON.stringify(
    Object.entries(sources).map(([p,v])=>[p,v.content]).sort(([a],[b])=>a.localeCompare(b))
   )).digest('hex');
   console.log('META',JSON.stringify({name,chainId:body.chainId,address:body.address,
    runtimeMatch:body.runtimeMatch,hash:fingerprint,files:Object.keys(sources),
    codeBytes:(body.runtimeBytecode?.onchainBytecode?.length||0)/2,
    compiler:body.compilation?.compilerVersion}));
   const funcs=(body.abi||[]).filter(x=>x.type==='function')
    .map(x=>({signature:x.name+'('+(x.inputs||[]).map(y=>y.type).join(',')+')',
     mutability:x.stateMutability}));console.log('FUNCTIONS',JSON.stringify(funcs));
   for(const [file,obj]of Object.entries(sources)){
    const content=String(obj.content||'');
    if(!content)continue;
    console.log('FILE',file,'length',content.length);
    // Reviewed snippets are bounded, with exact line references.
    const lines=content.split('\n');
    const patterns=/\b(contract|function|modifier)\s+[A-Za-z0-9_]+|\b(_mint|mint\(|transfer\(|_update\(|_transfer\(|onlyOwner|onlyRole|tax|fee|blacklist|owner|renounce)\b/i;
    const shown=new Set();let budget=80;
    for(let i=0;i<lines.length&&budget>0;i++){
     if(!patterns.test(lines[i]))continue;
     for(let j=Math.max(0,i-2);j<=Math.min(lines.length-1,i+7)&&budget>0;j++){
      if(shown.has(j))continue;shown.add(j);budget--;
      console.log('SRC',file,Number(j)+1,lines[j].slice(0,300));
     }
    }
   }
  }catch(error){console.log('ERROR',name,error?.name||'ERROR');}
 }
})().catch(e=>{console.error(e?.name||'ERROR');process.exitCode=1;});
