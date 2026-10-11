'use strict';
const {rpc,uint}=require('./eth');
const {found,unknown,card,error}=require('./evidence');
const PROXY_IMPLEMENTATION='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const ZERO='0x0000000000000000000000000000000000000000';
const addrWord=word=>{
  if(typeof word!=='string'||!/^0x[0-9a-f]{64}$/i.test(word))return null;
  const a='0x'+word.slice(-40).toLowerCase();
  return a===ZERO?null:a;
};
async function inspect(address,block){
  const reads=await Promise.allSettled([
    rpc('eth_call',[{to:address,data:'0x8da5cb5b'},block]), // owner()
    rpc('eth_call',[{to:address,data:'0x5c975abb'},block]), // paused()
    rpc('eth_getStorageAt',[address,PROXY_IMPLEMENTATION,block])
  ]);
  const owner=reads[0].status==='fulfilled'?addrWord(reads[0].value):null;
  const paused=reads[1].status==='fulfilled'&&/^0x[0-9a-f]{64}$/i.test(reads[1].value)&&[0n,1n].includes(uint(reads[1].value))?uint(reads[1].value)===1n:null;
  const proxy=reads[2].status==='fulfilled'?addrWord(reads[2].value):null;
  const fields={
    owner:owner?found(owner,'Ethereum RPC',[{method:'owner()',block,address}],'GETTER_REPORTED'):unknown('An owner getter was not proven. This does not prove ownership was renounced.','OWNER_NOT_ESTABLISHED'),
    paused:paused===null?unknown('A boolean paused() getter could not be read.','PAUSED_NOT_ESTABLISHED'):found(paused,'Ethereum RPC',[{method:'paused()',block,address}],'GETTER_REPORTED'),
    proxyImplementation:proxy?found(proxy,'Ethereum RPC',[{method:'EIP-1967 implementation slot',block,address}],'ON_CHAIN'):unknown('No nonzero EIP-1967 implementation slot proven. This does not rule out other proxy designs.','PROXY_NOT_ESTABLISHED'),
    mintAuthority:unknown('Verified source and role analysis required to establish mint authority.','MINT_AUTHORITY_NOT_VERIFIED'),
    blacklistAuthority:unknown('Verified source and role analysis required to establish blacklist authority.','BLACKLIST_AUTHORITY_NOT_VERIFIED')
  };
  return card(fields,'Owner/paused getters and proxy storage are evidence, not proof of all permissions.');
}
function failure(e){return card({
  owner:error(e,'Ethereum RPC'),paused:error(e,'Ethereum RPC'),proxyImplementation:error(e,'Ethereum RPC'),
  mintAuthority:unknown('Mint authority not inspected.'),blacklistAuthority:unknown('Blacklist authority not inspected.')
},'Contract-control data unavailable.');}
module.exports={inspect,failure,addrWord,PROXY_IMPLEMENTATION};
