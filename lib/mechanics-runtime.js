const c=require('./core'),keccak=require('./keccak');
// Conservative control-flow over the complete runtime, without stripping bytes.
// Every valid JUMPDEST is a root, including ones that may actually be unreachable.
// Bytes after a terminating opcode can execute only through a valid JUMPDEST.
function nonDelegating(code){
 if(!/^0x(?:[0-9a-f]{2})+$/i.test(code)||/^0xef/i.test(code))return false;
 const bytes=Buffer.from(code.slice(2),'hex'),instructions=[],roots=[0];
 for(let i=0;i<bytes.length;){const op=bytes[i],n=op>=0x60&&op<=0x7f?op-0x5f:0;instructions.push({offset:i,op,truncated:i+n>=bytes.length});if(op===0x5b)roots.push(instructions.length-1);i+=1+n;}
 const seen=new Set();
 for(const root of roots)for(let j=root;j<instructions.length&&!seen.has(j);j++){seen.add(j);const x=instructions[j];if([0xf2,0xf4,0xff].includes(x.op)||x.truncated)return false;if([0x00,0x56,0xf3,0xfd,0xfe].includes(x.op))break;}
 return true;
}
async function enrich(result,a){
 const block=result.block;
 if(result.proxy?.value===null){try{const code=await c.rpc('eth_getCode',[a,block]);if(nonDelegating(code))result.proxy=c.fact(false,[{source:'Arc RPC / conservative runtime control-flow inspection',address:a,chainId:c.CHAIN,block,runtimeCodeHash:keccak(Buffer.from(code.slice(2),'hex')),method:'No reachable DELEGATECALL, CALLCODE or SELFDESTRUCT; all valid JUMPDESTs treated as potential entry points',scope:'Current outer runtime cannot delegate token execution or destroy itself. External contract permissions are not inferred. Full runtime analyzed, including metadata; no bytes discarded.'}],'NOT_DETECTED');}catch(e){result.architectureReadFailure=c.failure(e);}}
 const s=result.verifiedSource;
 if(s?.profile?.id!=='FIXED_SUPPLY_CAPPED_ERC20'||!['match','exact_match'].includes(s.runtimeMatch))return result;
 const proof=[{source:'Sourcify bytecode-matched reviewed source',address:a,chainId:c.CHAIN,block,sourceDigest:s.sourceDigest,profile:s.profile.id,scope:'Constructor-only mint; inherited ERC-20 transfers move the full amount without deductions. No delegatecall, owner, role or upgrade path. Temporary max-wallet restrictions can revert transfers; DEX pool fees are separate.'}];
 result.mint=c.fact(false,proof,'NOT_DETECTED');
 result.transferTax={...c.fact(0,proof,'VERIFIED_SOURCE'),unit:'percent',scope:'Token-level ERC-20 transfers, not DEX execution fees.'};
 result.buyTax={...result.transferTax};result.sellTax={...result.transferTax};
 result.burnMechanism=c.fact(false,proof,'NOT_DETECTED');
 try{const pool=c.addressWord(await c.call(a,keccak(Buffer.from('pool()')).slice(0,10),block));const pad=c.addressWord(await c.call(a,keccak(Buffer.from('pad()')).slice(0,10),block));
  result.launchRegistration={pool,pad,block,scope:'Reviewed immutable pad can register a pool only once; this is not ownership.'};
  if(!c.BURNS.includes(pool)){result.ownerAbsence=c.fact(false,proof.concat({method:'pool() is nonzero: only privileged setPool path is permanently closed',pool,pad,block}),'NOT_DETECTED');result.ownerAuthority=result.ownerAbsence;}
  else result.ownerAbsence=c.unknown('Immutable launchpad still has one-time pool registration authority.','LAUNCH_REGISTRATION_PENDING');
 }catch(e){result.launchRegistrationFailure=c.failure(e);}
 result.analysisCoverage='REVIEWED_TOKEN_PROFILE';return result;
}
module.exports={enrich,nonDelegating};
