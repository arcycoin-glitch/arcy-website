'use strict';
// Reviewed complete-source profiles for individual verified token sources (Ethereum and Robinhood).
// Keyed ONLY by the full Sourcify source digest (mechanics-deep.digest), never by token address, name or ticker. A profile
// applies only after mechanics-deep has verified the exact source against the pinned deployed runtime, and its absence
// claims (no mint path, no owner) additionally require a direct, non-delegating runtime.
// Review notes and the exact source excerpts: docs/MECHANICS_FINAL_20261106.md.
const {addressWord}=require('./admin-getters');
const PROFILES=Object.freeze({
 // Ethereum PEPE (PepeToken.sol, solc 0.8.0, flattened OZ 4.x ERC20 + Ownable)
 'fc4c77a3813f94c125321da195005e43dd65aabdf97b7cfefc0056b4e1d9ca09':'OWNER_RULES_BLACKLIST_FIXED_SUPPLY',
 // Ethereum SPX6900 (SPX.sol, solc 0.8.19, custom ERC20 with launch buy/sell tax)
 'b898a411f0d2a803636e5fdc63e79ceadd4bc5495fd76c4e88c0014d54605cad':'LAUNCH_TAX_DECAY_FIXED_SUPPLY',
 // Ethereum SuperVerse SUPER (contracts/Token.sol, solc 0.6.12, OZ 3.x ERC20Capped + Ownable + vote checkpoints)
 '0e3f0eca8f9f87a3443b61158871d439cf88bea88d3db258b462fed7e00000e3':'OWNER_CAPPED_MINT_VOTES',
 // Ethereum BEAM (contracts/BeamToken.sol, solc 0.8.6, pinned OZ AccessControlEnumerable + ERC20Votes)
 'df2d7e984cfcd9e0a0e366e0d3caa33f5bf1cc92a61c00e0edfb0f6f87778dc9':'ROLE_MINTER_BURNER_VOTES',
 // Robinhood MowCat MOW (project/contracts/MowCat.sol, solc 0.8.26, self-contained ERC20)
 'ed77a6f1460d227f210f622309bcfdb45c449b045c946ecf2c802d505d7797e4':'FIXED_SUPPLY_NO_ADMIN',
 // Robinhood TorchToken (src/TorchToken.sol, solc 0.8.26, OZ 5.x ERC20 + ERC20Permit, immutable pool buy tax)
 'ca5d5fac92a6000b4bcc5e5f5de8f68d62d7264b57738b2a918cacb23e365109':'IMMUTABLE_POOL_BUY_TAX'
});
// Bounded reads that only these profiles issue (benchmark budget kind "augReviewed"). Everything else they use is a read
// the generic verified-source path already made at the same pinned block (owner(), cap(), role enumeration).
const SPX_SLOTS=Object.freeze({packed:6,initialBuy:7,initialSell:8,finalBuy:9,finalSell:10,reduceBuyAt:11,reduceSellAt:12,buyCount:14});
const TORCH_GETTERS=Object.freeze(['BUY_TAX_BPS()','buyTaxBps()','FEE_ROUTER()']);
const REVIEWED_BUDGET=8;
const slotKey=i=>'0x'+i.toString(16).padStart(64,'0');
const ZERO='0x'+'0'.repeat(40);
const pct=bps=>Number(bps)/100;
function observed(details,method){return details.observations.find(x=>x.method===method);}
async function apply({profile,fields,details,proof,fact,word,storage,address,block,direct=false}){
 if(!Object.values(PROFILES).includes(profile))return;
 const p={...proof,reviewedTokenProfile:profile};
 const transferOnly=scope=>fact('Transfer 0% · DEX/hook fees NOT VERIFIED','Reviewed complete token transfer execution',{...p,coverage:'TOKEN_TRANSFER_ONLY',mutable:false,scope},'VERIFIED_SOURCE');
 const noMint=scope=>fact('NONE DETECTED ✓','Reviewed complete source: no runtime supply-increase path',{...p,scope},'VERIFIED_SOURCE');
 // owner() is already read by the generic verified-source getter pass; this re-read is served from the same cache.
 const ownerWord=async()=>{const raw=await word(address,'owner()');if(!raw)return null;return BigInt(raw)===0n?ZERO:addressWord(raw);};
 if(profile==='OWNER_RULES_BLACKLIST_FIXED_SUPPLY'){
  fields.tradingTaxes=transferOnly('Unmodified OpenZeppelin ERC20 transfer moves the full amount; the token has no fee code or fee setter. The added _beforeTokenTransfer hook only blocks blacklisted addresses and, while the owner-configured rule is on, limits buys from the configured pair. Pool fees are separate.');
  if(!direct)return;
  fields.mintCapability=noMint('The only _mint call is in the constructor. burn(uint256) lets a holder destroy their own tokens (reduces total supply); no address can create new supply.');
  const owner=await ownerWord();
  if(owner===ZERO)fields.ownerAdmin=fact('Ownership renounced · blacklist and trading rules frozen','Reviewed onlyOwner blacklist/setRule + pinned owner() = 0x0',{...p,owner:ZERO,scope:'blacklist(address,bool) and setRule(...) are the only privileged functions and both require the owner, which is the zero address. Renouncing is irreversible in this source, so the current blacklist entries and holding rule can no longer change; addresses already blacklisted stay blocked.'},'VERIFIED_SOURCE_AND_STATE');
  else if(owner)fields.ownerAdmin=fact('Owner-governed (blacklist, setRule) · '+owner,'Reviewed onlyOwner blacklist/setRule + pinned owner()',{...p,owner,scope:'This owner can blacklist any address (blocking its transfers) and change the holding-limit rule. Whether the owner is an EOA, multisig or contract is not inferred.'},'VERIFIED_SOURCE_AND_STATE');
  details.observations.push({method:'Reviewed PEPE-style restriction paths',block,...p,status:'VERIFIED_SOURCE',burn:'Holder self-burn reduces totalSupply; no burn or buyback execution is claimed.',blacklist:'Owner-only blacklist(address,bool).',taxMutable:false,buyback:'No buyback path in this token.'});
 }
 if(profile==='LAUNCH_TAX_DECAY_FIXED_SUPPLY'){
  if(!direct||typeof storage!=='function')return;
  const owner=await ownerWord();
  const keys=Object.keys(SPX_SLOTS),raw=await Promise.all(keys.map(k=>storage(slotKey(SPX_SLOTS[k]))));
  const s={};for(let i=0;i<keys.length;i++){if(!/^0x[0-9a-f]{64}$/i.test(raw[i]||''))return;s[keys[i]]=BigInt(raw[i]);}
  // Layout anchors: values with no setter in the reviewed source must equal their source initialisers, and the two
  // thresholds can only be (69,420) or, after onlyOwner removeLimits(), (20,20). Anything else fails closed.
  const thresholds=s.reduceBuyAt+','+s.reduceSellAt;
  if(s.initialBuy!==15n||s.initialSell!==70n||s.finalBuy!==0n||s.finalSell!==0n||!['69,420','20,20'].includes(thresholds)||(s.packed>>168n)!==0n||(s.packed&0xffn)>1n){details.observations.push({method:'Reviewed SPX storage layout check',block,status:'LAYOUT_MISMATCH',scope:'Pinned storage did not match the reviewed source layout; no tax value published.'});return;}
  if(!owner)return;
  const taxWallet=addressWord('0x'+(s.packed>>8n).toString(16).padStart(64,'0'));
  const buy=s.buyCount>s.reduceBuyAt?0:15,sell=s.buyCount>s.reduceSellAt?0:70;
  const settled=s.buyCount>s.reduceBuyAt&&s.buyCount>s.reduceSellAt,fixed=settled&&owner===ZERO;
  const slotsProof={buyCount:s.buyCount.toString(),reduceBuyTaxAt:s.reduceBuyAt.toString(),reduceSellTaxAt:s.reduceSellAt.toString(),initialBuyTax:'15',initialSellTax:'70',finalBuyTax:'0',finalSellTax:'0',storageSlots:SPX_SLOTS};
  fields.tradingTaxes=fact('Buy '+buy+'% · Sell '+sell+'% · Transfer '+buy+'%','Reviewed _transfer tax formula + pinned storage (buy counter and thresholds)',{...p,...slotsProof,mutable:!fixed,coverage:'TOKEN_TAX_ALL_TRANSFERS',scope:'Token tax only. Buys and wallet-to-wallet transfers use the buy rate; sells into the configured Uniswap V2 pair use the sell rate. The launch rates (15%/70%) fell to the permanent final rates (0%/0%) once the buy counter passed the thresholds; the counter only increases'+(fixed?' and the owner is renounced, so these rates can no longer change.':'. The owner can only lower the thresholds (removeLimits); no function can raise the final rates.')+' Uniswap pool (LP) fees are separate and not included.'},'VERIFIED_SOURCE_AND_STATE');
  fields.mintCapability=noMint('totalSupply() is a compile-time constant and no function credits new balances; the whole supply was assigned in the constructor.');
  if(owner===ZERO)fields.ownerAdmin=fact('Ownership renounced · tax wallet can only swap collected fees','Reviewed onlyOwner/taxWallet paths + pinned owner() = 0x0 and tax wallet slot',{...p,owner:ZERO,taxWallet,scope:'removeLimits, runitturbo, addBots and delBots require the owner, which is the zero address (no transferOwnership exists). The fee wallet'+(taxWallet?' '+taxWallet:'')+' can only call manualSwap to sell tokens already held by the contract and forward the ETH to itself; it cannot move holder balances.'},'VERIFIED_SOURCE_AND_STATE');
  else fields.ownerAdmin=fact('Owner-governed (removeLimits, bot list) · '+owner,'Reviewed onlyOwner paths + pinned owner()',{...p,owner,taxWallet,scope:'This owner can block or unblock addresses through the bot list and remove limits. The fee wallet can swap contract-held fees. EOA/multisig status not inferred.'},'VERIFIED_SOURCE_AND_STATE');
  details.observations.push({method:'Reviewed SPX fee and burn paths',block,...p,status:'VERIFIED_SOURCE_AND_STATE',burn:'No burn function; supply is constant.',buyback:'Collected tax is swapped for ETH to the fee wallet; this is not a buyback or burn.',taxMutable:!fixed});
 }
 if(profile==='OWNER_CAPPED_MINT_VOTES'){
  fields.tradingTaxes=transferOnly('OpenZeppelin 3.x ERC20 transfer moves the full amount; the transfer override only updates vote checkpoints. No fee code or setter exists. Pool fees are separate.');
  if(!direct)return;
  const owner=await ownerWord(),cap=observed(details,'cap()')?.raw||null;
  if(owner===ZERO){
   fields.mintCapability=fact('NONE ACTIVE ✓ · owner renounced','Reviewed onlyOwner mint + pinned owner() = 0x0',{...p,cap,scope:'mint(address,uint256) is the only supply-increase path and requires the owner, which is the zero address; renouncing is irreversible in this source.'},'VERIFIED_SOURCE_AND_STATE');
   fields.ownerAdmin=fact('Ownership renounced · owner 0x0','Reviewed Ownable paths + pinned owner() = 0x0',{...p,scope:'mint is the only owner-gated function; no other privileged function exists in this source.'},'VERIFIED_SOURCE_AND_STATE');
  }else if(owner){
   fields.mintCapability=fact('Owner-authorized mint · capped','Reviewed onlyOwner mint + ERC20Capped check + pinned owner()',{...p,owner,capRaw:cap,scope:'The owner can create new tokens at any time up to the fixed cap'+(cap?' ('+cap+' base units)':'')+'. No mint transaction was executed.'},'VERIFIED_SOURCE_AND_STATE');
   fields.ownerAdmin=fact('Owner-governed (mint) · '+owner,'Reviewed Ownable + pinned owner()',{...p,owner,scope:'The owner can mint up to the cap and transfer or renounce ownership. No pause, blacklist or fee control exists. EOA/multisig status not inferred.'},'VERIFIED_SOURCE_AND_STATE');
  }
  details.observations.push({method:'Reviewed SUPER burn paths',block,...p,status:'VERIFIED_SOURCE',burn:'burn/burnFrom let holders (or approved spenders) destroy tokens and reduce supply; no burn or buyback execution is claimed.',taxMutable:false});
 }
 if(profile==='ROLE_MINTER_BURNER_VOTES'){
  fields.tradingTaxes=transferOnly('Pinned OpenZeppelin ERC20 transfer moves the full amount; the _transfer override only rejects transfers to the token contract itself. No fee code or setter exists. Pool fees are separate.');
  if(!direct)return;
  // Uses the bounded role enumeration already performed by the generic AccessControlEnumerable pass.
  const count=role=>{const o=details.observations.find(x=>x.method==='getRoleMemberCount'&&x.role===role&&x.sourceDigest===proof.sourceDigest);return o?BigInt(o.count):null;};
  const members=role=>details.observations.filter(x=>x.method==='hasRole'&&x.role===role&&x.value===true&&x.member).map(x=>x.member);
  const minters=count('MINTER_ROLE'),admins=count('DEFAULT_ADMIN_ROLE'),adminList=[...new Set(members('DEFAULT_ADMIN_ROLE'))];
  if(minters!==null)fields.mintCapability=fact(minters>0n?'Role-gated mint · '+minters+' MINTER_ROLE holder'+(minters===1n?'':'s'):'No current minter · admin can grant MINTER_ROLE','Reviewed MINTER_ROLE mint + pinned role member count',{...p,minterCount:minters.toString(),minters:members('MINTER_ROLE').slice(0,4),scope:'Holders of MINTER_ROLE can mint without a supply cap. DEFAULT_ADMIN_ROLE holders can grant or revoke the role. No mint transaction was executed.'},'VERIFIED_SOURCE_AND_STATE');
  else fields.mintCapability=fact('Role-gated mint (MINTER_ROLE)','Reviewed MINTER_ROLE mint path',{...p,scope:'Holders of MINTER_ROLE can mint without a supply cap; current role holders were not enumerated.'},'VERIFIED_SOURCE');
  if(admins!==null&&adminList.length)fields.ownerAdmin=fact('Role-governed · DEFAULT_ADMIN_ROLE: '+adminList[0]+(admins>1n?' (+'+(admins-1n)+')':'')+' · burner can burn any wallet','Reviewed AccessControlEnumerable roles + pinned role membership',{...p,admins:adminList.slice(0,4),adminCount:admins.toString(),scope:'DEFAULT_ADMIN_ROLE grants and revokes MINTER_ROLE and BURNER_ROLE. burn(address,uint256) lets a BURNER_ROLE holder destroy tokens from ANY address without approval. No pause, blacklist or fee control exists. EOA/multisig status not inferred.'},'VERIFIED_SOURCE_AND_STATE');
  details.observations.push({method:'Reviewed BEAM privileged burn path',block,...p,status:'VERIFIED_SOURCE',burn:'BURNER_ROLE burn(address,uint256) can reduce any holder balance and total supply without allowance; capability only, no burn execution claimed.',taxMutable:false});
 }
 if(profile==='FIXED_SUPPLY_NO_ADMIN'){
  fields.tradingTaxes=transferOnly('The self-contained ERC20 moves the full amount in every transfer; no fee code, exemption list or setter exists. Pool fees are separate.');
  if(!direct)return;
  fields.mintCapability=noMint('The only _mint call is in the constructor; no function can create supply and no burn function is exposed.');
  fields.ownerAdmin=fact('No token owner/admin','Reviewed complete source: no privileged function',{...p,scope:'The only extra state is a wallet address recorded at deployment and returned by a view function; it has no special permission. No pause, blacklist, fee or upgrade path exists. Pools and launchpads are separate contracts.'},'VERIFIED_SOURCE');
 }
 if(profile==='IMMUTABLE_POOL_BUY_TAX'){
  if(!direct)return;
  const [baseRaw,currentRaw,routerRaw]=await Promise.all(TORCH_GETTERS.map(s=>word(address,s)));
  if(baseRaw&&currentRaw){
   const base=BigInt(baseRaw),current=BigInt(currentRaw),router=routerRaw?addressWord(routerRaw):null;
   if(base>=1n&&base<=1000n&&current>=base&&current<=8000n){
    fields.tradingTaxes=fact('Buy '+pct(current)+'% · Sell 0% · Transfer 0%','Reviewed _update buy-tax path + pinned buyTaxBps()/BUY_TAX_BPS()',{...p,buyTaxBps:current.toString(),baseBuyTaxBps:base.toString(),feeRouter:router,mutable:false,coverage:'TOKEN_TAX_ALL_TRANSFERS',scope:'Token tax only. Tokens leaving a recognised pool (the Uniswap V4 PoolManager or a contract whose token0/token1 is this token) pay the buy tax to the fee router'+(router?' '+router:'')+'; sells and wallet transfers pay none. The rate is fixed at deployment'+(current>base?'; it is currently in the launch anti-snipe window and falls to '+pct(base)+'% when it ends':'')+'. No function can change it. Pool or hook swap fees are separate and not included.'},'VERIFIED_SOURCE_AND_STATE');
   }
  }
  fields.mintCapability=noMint('The only _mint call is in the constructor; no burn function is exposed.');
  fields.ownerAdmin=fact('No token owner/admin · fixed fee router','Reviewed complete source: immutable configuration, no privileged function',{...p,scope:'Pool manager, factory, fee router and tax rate are immutable constructor values. No owner, role, pause, blacklist or upgrade path exists in the token. The fee router and launch factory are separate contracts and are NOT audited here.'},'VERIFIED_SOURCE');
  details.observations.push({method:'Reviewed Torch fee path',block,...p,status:'VERIFIED_SOURCE',burn:'No exposed burn path.',buyback:'Buy tax is sent to the fee router; what the router does with it (including any buyback) is not verified.',taxMutable:false});
 }
}
module.exports={PROFILES,SPX_SLOTS,TORCH_GETTERS,REVIEWED_BUDGET,slotKey,apply};
