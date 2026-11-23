'use strict';
// Reviewed complete-source profiles for individual verified token sources (Ethereum and Robinhood).
// Keyed ONLY by the full Sourcify source digest (mechanics-deep.digest), never by token address, name or ticker. A profile
// applies only after mechanics-deep has verified the exact source against the pinned deployed runtime, and its absence
// claims (no mint path, no owner) additionally require a direct, non-delegating runtime.
// Review notes and the exact source excerpts: docs/MECHANICS_FINAL_20261106.md.
const {addressWord}=require('./admin-getters');
const {formatTokenUnits}=require('./mechanics-amount-format');
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
 'ca5d5fac92a6000b4bcc5e5f5de8f68d62d7264b57738b2a918cacb23e365109':'IMMUTABLE_POOL_BUY_TAX',
 // Mechanics V5 (docs/MECHANICS_V5_20261115.md; excerpts from scripts/probe-mechanics-sources.cjs):
 // Uniswap UERC20 (UERC20.sol + BaseUERC20.sol + Solady ERC20): factory-parameter constructor mint, no admin
 '530718da61de5033f13e3bc6f05a6108bfd479a8714bd71c7cf7374611a1b31f':'UNISWAP_UERC20_FIXED_SUPPLY',
 // Ethereum SHIB (TokenMintERC20Token.sol): constructor-only mint, holder self-burn, no owner
 '8bcf4ef22972093fba449cf65ff46195686bba4981d36053eea94c871d42d42f':'FIXED_SUPPLY_SELF_BURN',
 // Ethereum BNB (BNB.sol, legacy solc 0.4): constructor supply, holder self-freeze/burn, owner can only withdraw ETH
 '78eedccb186c7e496700360071c4261c07797d1475a90128ea144e97b4dcf099':'LEGACY_FIXED_SUPPLY_SELF_FREEZE',
 // Ethereum NPC (NPC.sol): fixed supply held by the contract, 1:1e18 ERC1155 wrap/unwrap, Ownable with no owner powers
 '398bcb7031ade72726ba64a6b43bb9f96705f196645759b653508a1d5f9f4a7b':'ERC1155_WRAPPED_FIXED_SUPPLY',
 // Ethereum BUSD implementation (BUSDImplementation.sol) behind the reviewed ZeppelinOS AdminUpgradeabilityProxy
 'f529ab7e6bdcd5557c08a107acfb1cd33cddd4827909e6f052c6909227e34214':'PAXOS_SUPPLY_CONTROLLED',
 // Mechanics V6 (docs/MECHANICS_V6_20261122.md; complete function lists from scripts/probe-mechanics-sources.cjs PROBE_FULL):
 // Robinhood FoboToken (FoboToken.sol, OZ 5.x ERC20 + ERC20Burnable): constructor-only TOTAL_SUPPLY mint, no owner/role
 '1ed15a24e1aa9778505f1839550a0ab401464a5739ab1723034113003da54096':'FIXED_SUPPLY_OZ_BURNABLE',
 // Robinhood Chainlink CCIP BurnMintERC20 (OZ 4.x AccessControl, non-enumerable): MINTER_ROLE mint capped by i_maxSupply
 '7aa78076f05db2951a641af2664d5c88cf0296e5551dc05b6890ddf1555f73f7':'CCIP_BURN_MINT_ROLE_TOKEN',
 // Ethereum YFI (YFI.sol, solc 0.5): governance adds/removes minters; minters mint without a cap
 '028764dfc7733bb6d6d880e041991d6d9cc287873ec7917f04fed18cde858f37':'GOVERNANCE_MINTER_SET',
 // Ethereum ConvexToken (ConvexToken.sol): only `operator` mints, on a cliff schedule capped at maxSupply; operator is refreshed
 // permissionlessly from vecrvProxy.operator()
 'afb5ce3f0309dc0f8d52a25771abb7bae78815458d0247bffe4400e45a09b9c3':'OPERATOR_SCHEDULED_CAPPED_MINT',
 // Ethereum Lido DAO LDO (MiniMeToken.sol, Aragon MiniMe): the controller mints, destroys any balance, moves tokens without
 // allowance, enables/disables transfers and can veto each transfer through onTransfer
 '623789e477379e2525a57bca254d35812779e8ff8b7b186ff4ec2da483dc12dc':'MINIME_CONTROLLED',
 // GnosisToken.sol, solc 0.4.10: complete StandardToken inheritance; constructor-only allocation, no authority surface.
 '1d7a05b0de7c2f71ce081d8a80a381973dbd7749e6eef357b033aac690166ee8':'FIXED_SUPPLY_LEGACY_ALLOCATION'
});
// Bounded reads that only these profiles issue (benchmark budget kind "augReviewed"). Everything else they use is a read
// the generic verified-source path already made at the same pinned block (owner(), cap(), role enumeration).
const SPX_SLOTS=Object.freeze({packed:6,initialBuy:7,initialSell:8,finalBuy:9,finalSell:10,reduceBuyAt:11,reduceSellAt:12,buyCount:14});
const TORCH_GETTERS=Object.freeze(['BUY_TAX_BPS()','buyTaxBps()','FEE_ROUTER()']);
const PAXOS_GETTERS=Object.freeze(['supplyController()','assetProtectionRole()']);
// Every selector a reviewed profile may read beyond the generic verified-source pass (benchmark kind "augReviewed").
// Mechanics V6 profile reads (all argument-free pinned getters of the reviewed sources; <= 5 per contract, budget 8 unchanged).
const V6_GETTERS=Object.freeze(['totalSupply()','decimals()','MINTER_ROLE()','BURNER_ROLE()','maxSupply()','getCCIPAdmin()','governance()','operator()','vecrvProxy()','controller()','transfersEnabled()',
 // reviewed-v4 FIXED_LAUNCH_RESTRICTIONS getters, now also applied to a second reviewed PonsLauncherToken source digest
 'launchFactory()','poolFee()','restrictionEndBlock()','maxWalletBps()','maxTxBps()']);
const REVIEWED_GETTERS=Object.freeze([...TORCH_GETTERS,...PAXOS_GETTERS,...V6_GETTERS]);
const REVIEWED_BUDGET=8;
const slotKey=i=>'0x'+i.toString(16).padStart(64,'0');
const ZERO='0x'+'0'.repeat(40);
const pct=bps=>Number(bps)/100;
function observed(details,method){return details.observations.find(x=>x.method===method);}
// Evidence stages are independent. A role identifier or controller address proves neither role membership nor that an
// external governor can currently execute a mint. Supply capacity is a separate constraint, not permission revocation.
function mintAuthority({mechanism,entryPoint,authority=null,members=null,usable='NOT_VERIFIED',revoked='NOT_VERIFIED',constraints={}}){
 return {functionPresent:true,entryPoint,authoritySourceIdentified:true,mechanism,authorityIdentifierVerified:authority!==null,
  authority,authorizedAccountsVerified:members!==null,authorizedAccounts:members,currentUsability:usable,permissionRevoked:revoked,constraints};
}
// Same-block reuse: the card's pinned owner() getter observation (control.inspect / adapters) for this exact token and block.
// Legacy (pre-0.4.21) ABIs carry no stateMutability, so the generic verified-source getter pass does not re-read owner().
function priorOwner(prior,address,block){
 const f=prior?.ownerAdmin,m=/^owner\(\) getter: (0x[0-9a-fA-F]{40})$/.exec(String(f?.value||''));
 const e=Array.isArray(f?.evidence)&&f.evidence.find(x=>x?.method==='owner()'&&x.block===block&&String(x.address||'').toLowerCase()===String(address).toLowerCase());
 return f?.dataState==='DATA_FOUND'&&m&&e?m[1].toLowerCase():null;
}
async function apply({profile,fields,details,proof,fact,word,storage,address,block,direct=false,admin=null,kind=null,prior=null}){
 if(!Object.values(PROFILES).includes(profile))return;
 const p={...proof,reviewedTokenProfile:profile};
 const transferOnly=scope=>fact('Transfer 0% · DEX/hook fees NOT VERIFIED','Reviewed complete token transfer execution',{...p,coverage:'TOKEN_TRANSFER_ONLY',mutable:false,
  tokenTax:{transfer:'0',buy:'NOT_VERIFIED',sell:'NOT_VERIFIED',externalFees:{dex:'NOT_VERIFIED',hook:'NOT_VERIFIED'}},scope},'VERIFIED_SOURCE');
 // A complete, source-reviewed, non-delegating runtime with unconditional full-amount transfer paths
 // establishes ZERO token-contract deductions for buys, sells and wallet transfers alike. It does NOT
 // establish a zero DEX swap fee, V4 hook fee, or unrestricted trade execution.
 const noTokenTax=scope=>direct?fact('Buy 0% · Sell 0% · Transfer 0%','Reviewed unconditional full-amount transfer paths + pinned non-delegating runtime',
  {...p,coverage:'TOKEN_TAX_ALL_TRANSFERS',tokenTaxScope:'TOKEN_CONTRACT_ONLY',sourceBoundNonDelegatingRuntime:true,mutable:false,
   tokenTax:{denominator:'100',buy:'0',sell:'0',transfer:'0',rounding:'NO_DEDUCTION',scope:'TOKEN_CONTRACT_ONLY',
    externalFees:{dex:'NOT_VERIFIED',hook:'NOT_VERIFIED'}},
   scope:'Verified token-side deductions only: every permitted transfer/transferFrom debits and credits the identical token amount regardless of whether either endpoint is a liquidity pool. '+scope+' External DEX/pool and hook fees, prices, slippage and the ability to execute a trade are separate and NOT VERIFIED.'},'VERIFIED_SOURCE_AND_STATE'):transferOnly(scope);
 const noMint=scope=>fact('NONE DETECTED ✓','Reviewed complete source: no runtime supply-increase path',{...p,
  mintAuthority:{functionPresent:false,authoritySourceIdentified:false,authorityIdentifierVerified:false,authorizedAccountsVerified:false,currentUsability:'UNAVAILABLE_BY_SOURCE',permissionRevoked:'NOT_APPLICABLE'},scope},'VERIFIED_SOURCE');
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
  // An ordinary pair buy increments _buyCount BEFORE computing its tax; wallet transfers and sells do not. At the strict
  // threshold boundary, the next eligible buy has the final rate even while a wallet transfer still has the launch rate.
  const transfer=s.buyCount>s.reduceBuyAt?0:15,buy=s.buyCount+1n>s.reduceBuyAt?0:15,sell=s.buyCount>s.reduceSellAt?0:70;
  const settled=s.buyCount>s.reduceBuyAt&&s.buyCount>s.reduceSellAt,fixed=settled&&owner===ZERO;
  const slotsProof={buyCount:s.buyCount.toString(),reduceBuyTaxAt:s.reduceBuyAt.toString(),reduceSellTaxAt:s.reduceSellAt.toString(),initialBuyTax:'15',initialSellTax:'70',finalBuyTax:'0',finalSellTax:'0',storageSlots:SPX_SLOTS};
  fields.tradingTaxes=fact('Buy '+buy+'% · Sell '+sell+'% · Transfer '+transfer+'%','Reviewed _transfer tax formula + pinned storage (buy counter and thresholds)',{...p,...slotsProof,mutable:!fixed,coverage:'TOKEN_TAX_ALL_TRANSFERS',
   tokenTax:{denominator:'100',buy:String(buy),sell:String(sell),transfer:String(transfer),rounding:'FLOOR_BASE_UNITS',
    rateBasis:'NEXT_NONEXEMPT_PAIR_BUY; CURRENT_SELL_AND_WALLET_STATE',nextEligibleBuyCount:(s.buyCount+1n).toString(),
    exemptions:{ownerEndpoint:'Full tax bypass when either endpoint equals owner()',excludedFromFee:'Skips pair-buy counter and limits only; does NOT bypass the tax deduction',contractSell:'Uses the ordinary buy/transfer rate instead of the sell branch'},
    collection:{recipient:'TOKEN_CONTRACT',payout:'ETH_TO_TAX_WALLET',reflection:false,buyback:false,burn:false},externalFees:{dex:'NOT_VERIFIED',hook:'NOT_VERIFIED'}},
   scope:'Token tax only. Ordinary nonexempt buys from the configured pair increment the buy counter before calculating their buy rate; wallet transfers use the current counter without incrementing it. Sells into the pair use the sell rate, except contract-origin sells. Owner-endpoint transfers bypass tax; the excluded-from-fee mapping only exempts buy limits/counter updates, not deductions. The launch rates (15%/70%) fall to final rates (0%/0%) at strict counter thresholds; the counter only increases'+(fixed?' and the owner is renounced, so these rates can no longer change.':'. The owner can only lower the thresholds (removeLimits); no function can raise the final rates.')+' Uniswap pool (LP) fees are separate and not included.'},'VERIFIED_SOURCE_AND_STATE');
  fields.mintCapability=noMint('totalSupply() is a compile-time constant and no function credits new balances; the whole supply was assigned in the constructor.');
  if(owner===ZERO)fields.ownerAdmin=fact('Ownership renounced · tax wallet can only swap collected fees','Reviewed onlyOwner/taxWallet paths + pinned owner() = 0x0 and tax wallet slot',{...p,owner:ZERO,taxWallet,scope:'removeLimits, runitturbo, addBots and delBots require the owner, which is the zero address (no transferOwnership exists). The fee wallet'+(taxWallet?' '+taxWallet:'')+' can only call manualSwap to sell tokens already held by the contract and forward the ETH to itself; it cannot move holder balances.'},'VERIFIED_SOURCE_AND_STATE');
  else fields.ownerAdmin=fact('Owner-governed (removeLimits, bot list) · '+owner,'Reviewed onlyOwner paths + pinned owner()',{...p,owner,taxWallet,scope:'This owner can block or unblock addresses through the bot list and remove limits. The fee wallet can swap contract-held fees. EOA/multisig status not inferred.'},'VERIFIED_SOURCE_AND_STATE');
  // Transfer Restrictions from the same pinned slots: only onlyOwner removeLimits() writes (20,20), and in the same call it
  // sets max tx = max wallet = total supply and disables the transfer delay; no function can re-add them.
  const limitsRemoved=thresholds==='20,20';
  fields.transferRestrictions=fact((owner===ZERO?'Bot blocklist (frozen)':'Owner bot blocklist')+(limitsRemoved?' · limits removed':' · buy tx/wallet limits'),
   'Reviewed _transfer bot/limit checks + pinned threshold slots'+(owner===ZERO?' + owner() = 0x0':''),{...p,...slotsProof,limitsRemoved,coverage:'TOKEN_TRANSFER_PATH',
    scope:'Transfers to or from an address on the bot list revert'+(owner===ZERO?'; the owner is the zero address, so the list can no longer change and existing entries stay blocked':'; the owner can add or remove entries')+'. '+
     (limitsRemoved?'removeLimits() has run (its threshold write is observed), which set max tx and max wallet to the total supply and turned off the transfer delay; no function can restore them.':
      'Buys from the pair are capped by max tx/max wallet and a per-block transfer delay until the owner calls removeLimits().')},'VERIFIED_SOURCE_AND_STATE');
  details.observations.push({method:'Reviewed SPX fee and burn paths',block,...p,status:'VERIFIED_SOURCE_AND_STATE',burn:'No burn function; supply is constant.',buyback:'Collected tax is swapped for ETH to the fee wallet; this is not a buyback or burn.',taxMutable:!fixed});
 }
 if(profile==='OWNER_CAPPED_MINT_VOTES'){
  fields.tradingTaxes=transferOnly('OpenZeppelin 3.x ERC20 transfer moves the full amount; the transfer override only updates vote checkpoints. No fee code or setter exists. Pool fees are separate.');
  if(!direct)return;
  const owner=await ownerWord(),cap=observed(details,'cap()')?.raw||null;
  if(owner===ZERO){
   fields.mintCapability=fact('NONE ACTIVE ✓ · owner renounced','Reviewed onlyOwner mint + pinned owner() = 0x0',{...p,cap,
    mintAuthority:mintAuthority({mechanism:'ONLY_OWNER',entryPoint:'mint(address,uint256)',authority:ZERO,members:[],usable:'AUTHORITY_REVOKED',revoked:'VERIFIED',constraints:{capRaw:cap}}),scope:'mint(address,uint256) is the only supply-increase path and requires the owner, which is the zero address; renouncing is irreversible in this source.'},'VERIFIED_SOURCE_AND_STATE');
   fields.ownerAdmin=fact('Ownership renounced · owner 0x0','Reviewed Ownable paths + pinned owner() = 0x0',{...p,scope:'mint is the only owner-gated function; no other privileged function exists in this source.'},'VERIFIED_SOURCE_AND_STATE');
  }else if(owner){
   fields.mintCapability=fact('Owner-authorized mint · capped','Reviewed onlyOwner mint + ERC20Capped check + pinned owner()',{...p,owner,capRaw:cap,
    mintAuthority:mintAuthority({mechanism:'ONLY_OWNER',entryPoint:'mint(address,uint256)',authority:owner,members:[owner],constraints:{capRaw:cap,remainingRaw:'NOT_VERIFIED'}}),scope:'The owner can create new tokens at any time up to the fixed cap'+(cap?' ('+cap+' base units)':'')+'. Remaining capacity is not established without pinned total supply. No mint transaction was executed.'},'VERIFIED_SOURCE_AND_STATE');
   fields.ownerAdmin=fact('Owner-governed (mint) · '+owner,'Reviewed Ownable + pinned owner()',{...p,owner,scope:'The owner can mint up to the cap and transfer or renounce ownership. No pause, blacklist or fee control exists. EOA/multisig status not inferred.'},'VERIFIED_SOURCE_AND_STATE');
  }
  details.observations.push({method:'Reviewed SUPER burn paths',block,...p,status:'VERIFIED_SOURCE',burn:'burn/burnFrom let holders (or approved spenders) destroy tokens and reduce supply; no burn or buyback execution is claimed.',taxMutable:false});
 }
 if(profile==='ROLE_MINTER_BURNER_VOTES'){
  fields.tradingTaxes=transferOnly('Pinned OpenZeppelin ERC20 transfer moves the full amount; the _transfer override only rejects transfers to the token contract itself. No fee code or setter exists. Pool fees are separate.');
  if(!direct)return;
  // Uses the bounded role enumeration already performed by the generic AccessControlEnumerable pass.
  const sameProof=x=>x.block===block&&x.sourceDigest===proof.sourceDigest;
  const count=role=>{const o=details.observations.find(x=>sameProof(x)&&x.method==='getRoleMemberCount'&&x.role===role);return o&&/^\d+$/.test(o.count)?BigInt(o.count):null;};
  const members=role=>[...new Set(details.observations.filter(x=>sameProof(x)&&x.method==='hasRole'&&x.role===role&&x.value===true&&x.member).map(x=>x.member))];
  const minters=count('MINTER_ROLE'),admins=count('DEFAULT_ADMIN_ROLE'),adminList=[...new Set(members('DEFAULT_ADMIN_ROLE'))];
  if(minters!==null)fields.mintCapability=fact(minters>0n?'Role-gated mint · '+minters+' MINTER_ROLE holder'+(minters===1n?'':'s'):'No current minter · '+(admins>0n?'admin can grant MINTER_ROLE':'role grant capability only'),'Reviewed MINTER_ROLE mint + pinned role member count',{...p,minterCount:minters.toString(),minters:members('MINTER_ROLE').slice(0,4),
   membershipComplete:minters<=4n&&BigInt(members('MINTER_ROLE').length)===minters,
   mintAuthority:mintAuthority({mechanism:'MINTER_ROLE',entryPoint:'mint(address,uint256)',authority:'MINTER_ROLE',members:members('MINTER_ROLE').length||minters===0n?members('MINTER_ROLE').slice(0,4):null,usable:minters===0n?'NO_CURRENT_MEMBER':'NOT_VERIFIED',constraints:{activeGrantAuthority:admins>0n?'CURRENT_DEFAULT_ADMIN_ROLE':'NOT_VERIFIED'}}),scope:'Holders of MINTER_ROLE can mint without a supply cap. DEFAULT_ADMIN_ROLE holders can grant or revoke the role; current grant authority is verified only when its member count is positive. No mint transaction was executed.'},'VERIFIED_SOURCE_AND_STATE');
  else fields.mintCapability=fact('Role-gated mint (MINTER_ROLE)','Reviewed MINTER_ROLE mint path',{...p,
   mintAuthority:mintAuthority({mechanism:'MINTER_ROLE',entryPoint:'mint(address,uint256)',authority:'MINTER_ROLE'}),scope:'Holders of MINTER_ROLE can mint without a supply cap; current role holders were not enumerated.'},'VERIFIED_SOURCE');
  if(admins!==null&&adminList.length)fields.ownerAdmin=fact('Role-governed · DEFAULT_ADMIN_ROLE: '+adminList[0]+(admins>1n?' (+'+(admins-1n)+')':'')+' · burner can burn any wallet','Reviewed AccessControlEnumerable roles + pinned role membership',{...p,admins:adminList.slice(0,4),adminCount:admins.toString(),scope:'DEFAULT_ADMIN_ROLE grants and revokes MINTER_ROLE and BURNER_ROLE. burn(address,uint256) lets a BURNER_ROLE holder destroy tokens from ANY address without approval. No pause, blacklist or fee control exists. EOA/multisig status not inferred.'},'VERIFIED_SOURCE_AND_STATE');
  details.observations.push({method:'Reviewed BEAM privileged burn path',block,...p,status:'VERIFIED_SOURCE',burn:'BURNER_ROLE burn(address,uint256) can reduce any holder balance and total supply without allowance; capability only, no burn execution claimed.',
   burnAuthority:{functionPresent:true,entryPoint:'burn(address,uint256)',mechanism:'BURNER_ROLE',holderAllowanceRequired:false,arbitraryHolderBalance:true,authorizedAccounts:members('BURNER_ROLE'),currentUsability:'NOT_VERIFIED'},taxMutable:false});
 }
 if(profile==='FIXED_SUPPLY_NO_ADMIN'){
  fields.tradingTaxes=noTokenTax('The self-contained ERC20 moves the full amount in every transfer; no fee code, exemption list or setter exists. Pool fees are separate.');
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
    fields.tradingTaxes=fact('Buy '+pct(current)+'% · Sell 0% · Transfer 0%','Reviewed _update buy-tax path + pinned buyTaxBps()/BUY_TAX_BPS()',{...p,buyTaxBps:current.toString(),baseBuyTaxBps:base.toString(),feeRouter:router,mutable:false,coverage:'TOKEN_TAX_ALL_TRANSFERS',
     tokenTax:{denominator:'10000',buy:current.toString(),sell:'0',transfer:'0',rounding:'FLOOR_BASE_UNITS',rateBasis:'PINNED_BLOCK_TIMESTAMP',
      launch:{mechanism:'TIMESTAMP_LINEAR_DECAY',active:current>base,baseBuyTaxBps:base.toString(),maximumBuyTaxBps:'8000'},
      exemptions:{factoryRecipient:'Transfers to immutable FACTORY bypass tax',zeroValue:true,mint:true},
      collection:{recipient:router,creatorShareBps:'7000',shareScope:'Token event accounting only; external fee-router execution NOT VERIFIED',reflection:false,buyback:'NOT_VERIFIED',burn:'NOT_VERIFIED'},externalFees:{dex:'NOT_VERIFIED',hook:'NOT_VERIFIED'}},
     scope:'Token tax only. Tokens leaving a recognised pool (the Uniswap V4 PoolManager or a contract whose token0/token1 is this token) pay the buy tax to the fee router'+(router?' '+router:'')+'; transfers to immutable FACTORY are exempt, and ordinary wallet-origin sells and transfers pay none. The rate schedule is fixed at deployment'+(current>base?'; it is currently in the launch anti-snipe window and falls to '+pct(base)+'% when it ends':'')+'. No function can change it. Pool or hook swap fees are separate and not included.'},'VERIFIED_SOURCE_AND_STATE');
   }
  }
  fields.mintCapability=noMint('The only _mint call is in the constructor; no burn function is exposed.');
  fields.ownerAdmin=fact('No token owner/admin · fixed fee router','Reviewed complete source: immutable configuration, no privileged function',{...p,scope:'Pool manager, factory, fee router and tax rate are immutable constructor values. No owner, role, pause, blacklist or upgrade path exists in the token. The fee router and launch factory are separate contracts and are NOT audited here.'},'VERIFIED_SOURCE');
  details.observations.push({method:'Reviewed Torch fee path',block,...p,status:'VERIFIED_SOURCE',burn:'No exposed burn path.',buyback:'Buy tax is sent to the fee router; what the router does with it (including any buyback) is not verified.',taxMutable:false});
 }
 if(profile==='UNISWAP_UERC20_FIXED_SUPPLY'){
  fields.tradingTaxes=noTokenTax('Solady ERC20 transfer/transferFrom move the full amount; _beforeTokenTransfer and _afterTokenTransfer are empty and no fee code exists. Pool and hook fees are separate.');
  if(!direct)return;
  fields.mintCapability=noMint('The only _mint call is in the constructor (factory-supplied recipient and total supply); no external function creates supply and no burn function is exposed.');
  fields.ownerAdmin=fact('No token owner/admin','Reviewed complete source: no privileged function',{...p,scope:'creator, graffiti and metadata are informational constructor values with no permission; no pause, blacklist, fee or upgrade path exists. Solady gives Uniswap\'s canonical Permit2 contract a built-in infinite allowance; Permit2 still needs the holder\'s own signed approval to move tokens.'},'VERIFIED_SOURCE');
 }
 if(profile==='FIXED_SUPPLY_SELF_BURN'){
  fields.tradingTaxes=noTokenTax('_transfer moves the full amount after nonzero-address and balance checks; no fee code exists. Pool fees are separate.');
  if(!direct)return;
  fields.mintCapability=noMint('The only _mint call is in the constructor. burn(uint256) lets a holder destroy their own tokens (reduces total supply); no address can create new supply.');
  fields.ownerAdmin=fact('No token owner/admin','Reviewed complete source: no owner or privileged function',{...p,scope:'The source has no owner, role, pause, blacklist, fee or upgrade function; the deployment fee receiver has no permission.'},'VERIFIED_SOURCE');
 }
 if(profile==='LEGACY_FIXED_SUPPLY_SELF_FREEZE'){
  fields.tradingTaxes=transferOnly('transfer/transferFrom move the full amount; zero-value transfers and the zero address revert. No fee code exists. Pool fees are separate.');
  if(!direct)return;
  fields.mintCapability=noMint('Supply is set once in the constructor; no function creates supply. burn and freeze/unfreeze act only on the caller\'s own balance.');
  const owner=priorOwner(prior,address,block)||await ownerWord();
  if(owner&&owner!==ZERO)fields.ownerAdmin=fact('Owner: ETH withdrawal only · '+owner,'Reviewed complete source + pinned owner()',{...p,owner,scope:'withdrawEther(uint256) is the only owner function: it sends ETH held by this contract to the owner. The owner cannot move, freeze or create tokens, and no function changes the owner.'},'VERIFIED_SOURCE_AND_STATE');
 }
 if(profile==='ERC1155_WRAPPED_FIXED_SUPPLY'){
  fields.tradingTaxes=transferOnly('_transfer moves the full amount with empty transfer hooks; Transform/Respawn swap one ERC1155 item for 1e18 tokens held by the contract. No fee code exists. Pool fees are separate.');
  if(!direct)return;
  fields.mintCapability=noMint('The only _mint call is in the constructor, to the contract itself; tokens leave it only through Transform (ERC1155 deposit). No function creates supply.');
  const owner=await ownerWord();
  if(owner)fields.ownerAdmin=fact(owner===ZERO?'Ownership renounced · owner had no token powers':'Owner has no token powers · '+owner,'Reviewed complete source + pinned owner()',{...p,owner,scope:'The only owner-gated functions are transferOwnership and renounceOwnership; the owner cannot mint, pause, block or change fees. The ERC1155 contract is fixed at deployment and is NOT audited here.'},'VERIFIED_SOURCE_AND_STATE');
 }
 if(profile==='PAXOS_SUPPLY_CONTROLLED'){
  // Authority claims only for the direct runtime or the reviewed ZeppelinOS legacy proxy binding (mechanics-deep).
  if(!direct&&kind!=='Legacy implementation slot')return;
  fields.tradingTaxes=transferOnly('transfer/transferFrom move the full amount. Signed betaDelegatedTransfer fees are amounts the signer authorises for a whitelisted relayer, not a token tax. Pause and freeze checks can revert. Pool fees are separate.');
  const [ownerRaw,supplyRaw,protectionRaw]=await Promise.all([word(address,'owner()'),word(address,'supplyController()'),word(address,'assetProtectionRole()')]);
  const owner=ownerRaw?addressWord(ownerRaw):null,supplyController=supplyRaw?addressWord(supplyRaw):null,protection=protectionRaw&&BigInt(protectionRaw)!==0n?addressWord(protectionRaw):null;
  const upgrade=admin?' Proxy admin '+admin+' can replace this implementation.':' The implementation sits behind an upgradeable proxy.';
  if(supplyController)fields.mintCapability=fact('Supply-controller mint · '+supplyController,'Reviewed increaseSupply + pinned supplyController()',{...p,supplyController,proxyAdmin:admin,
   mintAuthority:mintAuthority({mechanism:'SUPPLY_CONTROLLER',entryPoint:'increaseSupply(uint256)',authority:supplyController,members:[supplyController],constraints:{capped:false,externalControllerExecution:'NOT_VERIFIED',proxyAdmin:admin}}),scope:'The supply controller can create an unlimited amount (increaseSupply) and burn its own balance; the owner can replace it. No mint transaction was executed.'+upgrade},'VERIFIED_SOURCE_AND_STATE');
  if(owner)fields.ownerAdmin=fact('Owner-governed (pause, freeze role, supply controller) · '+owner,'Reviewed onlyOwner paths + pinned owner()/assetProtectionRole()',{...p,owner,assetProtectionRole:protection,proxyAdmin:admin,scope:'The owner can pause/unpause, set the asset-protection role and supply controller, and reclaim tokens held by the contract. The asset-protection role'+(protection?' '+protection:'')+' can freeze addresses and wipe a frozen balance. Ownership moves only through propose/claim.'+upgrade},'VERIFIED_SOURCE_AND_STATE');
 }
 if(profile==='FIXED_SUPPLY_OZ_BURNABLE'){
  fields.tradingTaxes=noTokenTax('Unmodified OpenZeppelin 5.x ERC20 _update moves the full amount; the token has no fee code or fee setter. Pool/hook fees are separate.');
  if(!direct)return;
  fields.mintCapability=noMint('The only _mint call is the constructor TOTAL_SUPPLY mint; no role, owner or function can create supply later. burn/burnFrom only reduce supply, burnFrom needs the holder\'s allowance.');
  fields.ownerAdmin=fact('No token owner/admin','Reviewed complete source: no owner, role or privileged function',{...p,scope:'The token source has no owner, role, pause, blacklist, fee or upgrade function; burn and burnFrom act only on the caller\'s own balance or an approved allowance. Pool/launchpad contracts can hold separate privileges.'},'VERIFIED_SOURCE');
  details.observations.push({method:'Reviewed allowance burn paths',block,...p,status:'VERIFIED_SOURCE',burnAuthority:{functionPresent:true,entryPoints:['burn(uint256)','burnFrom(address,uint256)'],holderSelfBurn:true,holderAllowanceRequired:true,arbitraryHolderBalance:false,currentUsability:'NOT_VERIFIED'}});
 }
 if(profile==='FIXED_SUPPLY_LEGACY_ALLOCATION'){
  fields.tradingTaxes=noTokenTax('Complete StandardToken transfer/transferFrom debit and credit the same amount; only balance and allowance checks apply. No fee setter, reflection or callback exists. External pool/hook fees are separate.');
  if(!direct)return;
  fields.mintCapability=noMint('The constructor sets totalSupply and distributes all initial balances. No runtime function changes totalSupply or creates balances without debiting another balance; no burn entry point exists.');
  fields.ownerAdmin=fact('No token owner/admin','Reviewed complete non-delegating StandardToken/GnosisToken source',{...p,scope:'Constructor owners[] are allocation recipients, not administrators. Runtime exposes only ERC20 transfer, approve and getters; no mint, burn, pause, blacklist, fee setter, ownership or upgrade authority exists.'},'VERIFIED_SOURCE');
 }
 if(profile==='CCIP_BURN_MINT_ROLE_TOKEN'){
  fields.tradingTaxes=noTokenTax('Inherited OpenZeppelin ERC20 _transfer moves the full amount; the only override rejects the token contract itself as recipient. Pool/hook fees are separate.');
  if(!direct)return;
  const [minterRole,burnerRole,cap,total,decimals]=await Promise.all(['MINTER_ROLE()','BURNER_ROLE()','maxSupply()','totalSupply()','decimals()'].map(x=>word(address,x)));
  const k=n=>require('../../../lib/keccak')(Buffer.from(n)).toLowerCase();
  if(minterRole?.toLowerCase()===k('MINTER_ROLE')&&burnerRole?.toLowerCase()===k('BURNER_ROLE')&&cap&&total){
   const c=BigInt(cap),t=BigInt(total),d=decimals?Number(BigInt(decimals)):null,fmt=v=>d===null||!Number.isInteger(d)||d<0||d>36?v.toString()+' raw':formatTokenUnits(v,d,2);
   const value=c===0n?'Role-gated mint · uncapped':t>=c?'Role-gated mint · cap reached ('+fmt(c)+')':'Role-gated mint · cap '+fmt(c)+' · '+fmt(c-t)+' remaining';
   fields.mintCapability=fact(value,'Reviewed onlyRole(MINTER_ROLE) mint + pinned MINTER_ROLE/maxSupply/totalSupply',{...p,minterRole,burnerRole,maxSupplyRaw:c.toString(),totalSupplyRaw:t.toString(),
    mintAuthority:mintAuthority({mechanism:'MINTER_ROLE',entryPoint:'mint(address,uint256)',authority:minterRole,usable:c!==0n&&t>=c?'NO_POSITIVE_CAPACITY':'NOT_VERIFIED',constraints:{maxSupplyRaw:c.toString(),remainingRaw:c===0n?null:(c>t?c-t:0n).toString(),burnCanRestoreCapacity:true}}),
    remainingRaw:c===0n?null:(c>t?c-t:0n).toString(),scope:'MINTER_ROLE holders may mint up to maxSupply (0 = no cap); DEFAULT_ADMIN_ROLE holders can grant MINTER_ROLE and BURNER_ROLE (grantMintAndBurnRoles). AccessControl is not enumerable here, so current minter membership and an executable mint are not claimed. Burning reduces supply and can re-open capacity.'},'VERIFIED_SOURCE_AND_STATE');
   details.observations.push({method:'Reviewed CCIP privileged burn paths',block,...p,status:'VERIFIED_SOURCE',burnAuthority:{functionPresent:true,entryPoints:['burn(uint256)','burn(address,uint256)','burnFrom(address,uint256)'],mechanism:'BURNER_ROLE',holderAllowanceRequired:true,arbitraryHolderBalance:false,currentUsability:'NOT_VERIFIED'},scope:'Burner role is source-defined; current burner membership is not enumerable. Burning another wallet still spends its allowance.'});
   const ccip=addressWord(await word(address,'getCCIPAdmin()'));
   fields.ownerAdmin=fields.ownerAdmin||fact('AccessControl roles'+(ccip?' · CCIP admin '+ccip:''),'Reviewed AccessControl authority + pinned getCCIPAdmin()',{...p,ccipAdmin:ccip||null,scope:'DEFAULT_ADMIN_ROLE grants/revokes MINTER_ROLE and BURNER_ROLE and sets the CCIP admin (an informational registry address with no token permission by itself). Role holders are not enumerable; the deployer received DEFAULT_ADMIN_ROLE at construction and renouncement is not inferred. BURNER_ROLE burnFrom still needs the holder\'s allowance.'},'VERIFIED_SOURCE_AND_STATE');
  }
 }
 if(profile==='GOVERNANCE_MINTER_SET'){
  fields.tradingTaxes=noTokenTax('_transfer moves the full amount after nonzero-address and balance checks; no fee code exists. Pool fees are separate.');
  if(!direct)return;
  const governance=addressWord(await word(address,'governance()'));
  if(governance){
   fields.mintCapability=fact('Governance-managed minters · uncapped','Reviewed mint(require minters[msg.sender]) + pinned governance()',{...p,governance,
    mintAuthority:mintAuthority({mechanism:'GOVERNANCE_MANAGED_MAPPING',entryPoint:'mint(address,uint256)',authority:governance,constraints:{capped:false}}),scope:'Any address in the minters mapping can mint without a supply cap; governance adds and removes minters. The current minter set is a mapping and is not enumerated; an executable mint is not claimed.'},'VERIFIED_SOURCE_AND_STATE');
   fields.ownerAdmin=fields.ownerAdmin||fact('Governance: '+governance,'Reviewed setGovernance/addMinter/removeMinter + pinned governance()',{...p,governance,scope:'governance can replace itself and manage minters; it has no pause, blacklist or fee function. Whether the address is a multisig or contract is not inferred.'},'VERIFIED_SOURCE_AND_STATE');
  }
 }
 if(profile==='OPERATOR_SCHEDULED_CAPPED_MINT'){
  fields.tradingTaxes=noTokenTax('Inherited OpenZeppelin 3.x ERC20 _transfer with an empty _beforeTokenTransfer moves the full amount; no fee code exists. Pool fees are separate.');
  if(!direct)return;
  const [operator,proxy,cap,total]=await Promise.all([word(address,'operator()'),word(address,'vecrvProxy()'),word(address,'maxSupply()'),word(address,'totalSupply()')]);
  const op=addressWord(operator),px=addressWord(proxy);
  if(op&&px&&cap&&total&&BigInt(cap)>0n&&BigInt(total)<=BigInt(cap)){const c=BigInt(cap),t=BigInt(total);
   fields.mintCapability=fact(t>=c?'Operator mint · max supply reached':'Operator scheduled mint · cap '+formatTokenUnits(c,18,3)+' · '+formatTokenUnits(c-t,18,0)+' remaining','Reviewed operator-only cliff mint + pinned operator/maxSupply/totalSupply',{...p,operator:op,vecrvProxy:px,maxSupplyRaw:c.toString(),totalSupplyRaw:t.toString(),
    mintAuthority:mintAuthority({mechanism:'OPERATOR_CLIFF_SCHEDULE',entryPoint:'mint(address,uint256)',authority:op,members:[op],usable:t>=c?'NO_POSITIVE_CAPACITY':'NOT_VERIFIED',constraints:{maxSupplyRaw:c.toString(),remainingRaw:(c-t).toString(),operatorRefreshAuthority:px,externalOperatorControl:'NOT_VERIFIED',requestedMintAmount:'NOT_VERIFIED'}}),
    scope:'Only operator can mint; each mint is reduced by the supply cliff schedule and clamped at maxSupply (decimals fixed at 18 in the source). Calls from any other address return without minting. updateOperator() lets anyone copy operator from vecrvProxy.operator().'},'VERIFIED_SOURCE_AND_STATE');
   fields.ownerAdmin=fields.ownerAdmin||fact('No token owner · operator '+op,'Reviewed complete source + pinned operator/vecrvProxy',{...p,operator:op,vecrvProxy:px,scope:'The token has no owner, pause, blacklist or fee function. Its only privileged role is the minting operator, which follows vecrvProxy.operator() (external staking contract governance, not reviewed here).'},'VERIFIED_SOURCE_AND_STATE');
  }
 }
 if(profile==='MINIME_CONTROLLED'){
  fields.tradingTaxes=transferOnly('doTransfer moves the full amount; there is no fee code. Transfers require transfersEnabled and, when the controller is a contract, its onTransfer approval, so they can revert or be vetoed. Pool fees are separate.');
  if(!direct)return;
  const controller=addressWord(await word(address,'controller()')),enabled=await word(address,'transfersEnabled()');
  if(enabled!==null&&BigInt(enabled)<=1n)details.observations.push({method:'transfersEnabled()',value:BigInt(enabled)===1n,block,...p,scope:'Reviewed MiniMe transfer gate at the pinned block.'});
  if(controller){
   fields.mintCapability=fact('Controller mint (generateTokens)','Reviewed onlyController generateTokens + pinned controller()',{...p,controller,
    mintAuthority:mintAuthority({mechanism:'CONTROLLER',entryPoint:'generateTokens(address,uint256)',authority:controller,members:[controller],constraints:{capped:false,externalControllerExecution:'NOT_VERIFIED'}}),scope:'The controller can create any amount (no cap) and destroy any holder\'s tokens (destroyTokens). Whether the controller contract currently permits issuance is governance logic outside this token and is not claimed.'},'VERIFIED_SOURCE_AND_STATE');
   details.observations.push({method:'Reviewed controller arbitrary-holder burn path',block,...p,status:'VERIFIED_SOURCE_AND_STATE',burnAuthority:{functionPresent:true,entryPoint:'destroyTokens(address,uint256)',mechanism:'CONTROLLER',authority:controller,holderAllowanceRequired:false,arbitraryHolderBalance:true,currentUsability:'NOT_VERIFIED'}});
   fields.ownerAdmin=fields.ownerAdmin||fact('Controller: '+controller,'Reviewed onlyController surface + pinned controller()',{...p,controller,scope:'The controller can mint, destroy any balance, move tokens without allowance (transferFrom), enable/disable transfers, veto transfers via onTransfer, claim stray tokens and replace itself (changeController).'},'VERIFIED_SOURCE_AND_STATE');
  }
 }
}
module.exports={priorOwner,PROFILES,SPX_SLOTS,TORCH_GETTERS,PAXOS_GETTERS,REVIEWED_GETTERS,REVIEWED_BUDGET,slotKey,apply};
