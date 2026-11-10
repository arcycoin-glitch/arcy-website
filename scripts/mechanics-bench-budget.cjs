'use strict';

// JSON-RPC block tags are quantity hex strings, not 32-byte ABI words. Require
// an explicit height so budgeted role reads cannot silently use `latest`.
function isPinnedBlockTag(value){
 return typeof value==='string'&&/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(value);
}

function customRoleEvidence(card){
 const allowed=new Set(['PAUSER_ROLE','BLACKLISTER_ROLE','UPGRADER_ROLE','BURNER_ROLE']),found=new Map();
 for(const field of Object.values(card?.fields||{}))for(const evidence of field?.evidence||[])for(const item of evidence?.observations||[]){
  if(!allowed.has(item?.role)||!['getRoleAdmin','getRoleMemberCount','hasRole'].includes(item.method))continue;
  const key=[item.role,item.method,item.member||'',item.count??'',item.block||''].join('|');
  found.set(key,{role:item.role,method:item.method,roleId:item.roleId||null,member:item.member||null,count:item.count??null,value:item.value??null,block:item.block||null,sourceDigest:item.sourceDigest||null,scope:item.scope||null});
 }
 return [...found.values()].sort((a,b)=>[a.role,a.method,a.member||'',a.block||''].join('|').localeCompare([b.role,b.method,b.member||'',b.block||''].join('|')));
}

module.exports={isPinnedBlockTag,customRoleEvidence};
