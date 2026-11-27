'use strict';
// Transfer Restrictions evidence (Mechanics V5). Additive field `transferRestrictions`.
//
// A restriction finding is published ONLY for a reviewed complete source (profile keyed by the full Sourcify source digest,
// already matched to the pinned deployed runtime by mechanics-deep) or for an accepted pinned-OpenZeppelin template. A
// selector, ABI name or bytecode pattern alone never produces a finding, and an unreviewed source stays NOT VERIFIED.
// Review basis (transfer-path excerpts read from Sourcify in CI, scripts/probe-mechanics-sources.cjs):
// docs/MECHANICS_V5_20261115.md. "None in token code" covers only the token's own transfer path; pool, router, hook,
// bridge and launchpad contracts are separate and NOT audited here. Behind an upgradeable proxy the finding covers the
// current implementation only.
const {UPGRADEABLE}=require('./mechanics-upgrade-caveat');
const NONE='None in token code';
// Bounded restriction-state reads (benchmark budget kind "augRestriction"), issued only by these reviewed profiles.
const RESTRICTION_GETTERS=Object.freeze(['transferAllowed()','limited()','uniswapV2Pair()']);
const RESTRICTION_BUDGET=2;
const ZERO='0x'+'0'.repeat(40);
const SIMPLE=Object.freeze({
 OZ_ERC20_TEMPLATE:'Pinned unmodified OpenZeppelin ERC20 transfer path. The accepted template rejects any own override of transfer/transferFrom/_transfer/_update/_beforeTokenTransfer, any assembly or delegatecall, and any pausable, blocklist or allowlist extension, so only standard balance, allowance and zero-address checks can stop a transfer.',
 FIXED_SUPPLY_BURNABLE_LAUNCH:'Reviewed OpenZeppelin ERC20 + ERC20Burnable with no transfer override: no pause, blacklist, allowlist or transfer limit exists in the token.',
 INITIALIZED_REWARD_LAUNCH_TOKEN:'Reviewed _update calls the full-value OpenZeppelin path, then syncs reward shares through bounded calls whose failures are caught; no pause, blacklist or transfer limit exists in the token.',
 WARD_AUTH_TOKEN:'Reviewed transferFrom checks only balance and allowance; wards control minting, not transfers.',
 TIMED_CAPPED_MINTER:'Reviewed _transferTokens checks only nonzero sender/recipient and balance; delegation bookkeeping does not restrict transfers.',
 NATIVE_DEPOSIT_WRAPPER:'Reviewed transferFrom checks only balance and allowance; no privileged account exists.',
 FIXED_ERC677:'Reviewed transfer/transferFrom reject only the zero address and the token contract itself as recipient (input validation); no pause, blacklist or limit exists.',
 GOVERNED_MINTER_SET:'Reviewed inherited ERC20 transfer with an empty _beforeTokenTransfer hook; the governor controls minters, not transfers.',
 UPGRADEABLE_NO_DIRECT_MINT:'Reviewed current implementation _transfer checks only nonzero addresses and balance before moving delegation bookkeeping.',
 OWNER_CAPPED_MINT_VOTES:'Reviewed source: the transfer override only updates vote checkpoints; no pause, blacklist or fee control exists.',
 ROLE_MINTER_BURNER_VOTES:'Reviewed source: the _transfer override only rejects transfers to the token contract itself; no pause, blacklist or limit exists. (BURNER_ROLE can still burn any balance: see Owner & Admin.)',
 FIXED_SUPPLY_NO_ADMIN:'Reviewed self-contained ERC20: transfers check only addresses and balance; no pause, blacklist, limit or admin exists.',
 IMMUTABLE_POOL_BUY_TAX:'Reviewed source: no owner, role, pause, blacklist or transfer limit; the immutable buy tax is a deduction, shown under Trading Taxes.',
 UNISWAP_UERC20_FIXED_SUPPLY:'Reviewed Solady-based UERC20: transfer/transferFrom check only balance and allowance; _beforeTokenTransfer/_afterTokenTransfer are empty and no admin exists.',
 FIXED_SUPPLY_SELF_BURN:'Reviewed source: _transfer checks only nonzero addresses and balance; no owner, pause, blacklist or limit exists.',
 LEGACY_FIXED_SUPPLY_SELF_FREEZE:'Reviewed legacy source: transfers reject only the zero address, zero amounts and insufficient balance. freeze/unfreeze lock only the caller\'s own tokens; no account can restrict another holder.',
 FIXED_SUPPLY_OZ_BURNABLE:'Reviewed OpenZeppelin 5.x ERC20 + ERC20Burnable with no transfer override: no pause, blacklist, allowlist or transfer limit exists in the token.',
 CCIP_BURN_MINT_ROLE_TOKEN:'Reviewed source: the _transfer override only rejects the token contract itself as recipient; no pause, blacklist or limit exists. MINTER/BURNER roles affect supply, not transfers (burnFrom still needs an allowance).',
 GOVERNANCE_MINTER_SET:'Reviewed source: _transfer checks only nonzero addresses and balance; governance and minters control issuance, not transfers.',
 OPERATOR_SCHEDULED_CAPPED_MINT:'Reviewed OpenZeppelin 3.x ERC20 with an empty _beforeTokenTransfer hook: no pause, blacklist or transfer limit; the operator controls minting only.',
 ERC1155_WRAPPED_FIXED_SUPPLY:'Reviewed OpenZeppelin-style ERC20 with empty transfer hooks; the owner has no function besides ownership transfer/renouncement.',
 FIXED_SUPPLY_LEGACY_ALLOCATION:'Reviewed legacy ERC20 transfer/transferFrom check only balance and allowance; all supply is allocated in the constructor and no post-construction admin or transfer restriction exists.'
});
const CAPABILITIES=Object.freeze({
 ALLOWANCE_MINTER_TOKEN:['PAUSE','BLACKLIST'],
 CAPPED_FEE_LEGACY_TOKEN:['PAUSE','SENDER_BLACKLIST'],
 OWNED_ISSUANCE_PAUSABLE:['PAUSE'],
 REGISTRY_AUTH_TOKEN:['PAUSE','BLOCKED_ACCOUNTS'],
 COMPLIANCE_ROLE_TOKEN:['PAUSE','COMPLIANCE_LISTS'],
 PAXOS_SUPPLY_CONTROLLED:['PAUSE','FREEZE'],
 FIXED_SUPPLY_POOL_SETUP:['LAUNCH_LIMITS','MAX_WALLET'],
 MINIME_CONTROLLED:['TRADING_TOGGLE','CONTROLLER_VETO'],
 FIXED_LAUNCH_RESTRICTIONS:['LAUNCH_LIMITS','MAX_WALLET','BUY_LIMITS'],
 IMMUTABLE_LAUNCH_RESTRICTIONS:['LAUNCH_LIMITS','MAX_WALLET','BUY_LIMITS'],
 ROLE_TIMELOCK_TRANSFER:['TRANSFER_ROLE_GATE','INVESTOR_VESTING'],
 OWNER_RULES_BLACKLIST_FIXED_SUPPLY:['BLACKLIST','PAIR_SETUP_GATE','BUY_HOLDING_LIMITS']
});
// A state observation belongs to the reviewed execution path and the requested block. Never combine a previous
// implementation's getter with this implementation's source or label an old pause/launch answer as current state.
function observation(details,proof,block,method,valid){
 return (details?.observations||[]).find(x=>x.method===method&&valid(x)&&
  (!proof?.sourceDigest||x.sourceDigest===proof.sourceDigest)&&(!block||x.block===block));
}
function pausedState(details,proof,block){
 const o=observation(details,proof,block,'paused()',x=>typeof x.value==='boolean');
 return o?o.value:null;
}
const withPause=(label,paused)=>paused===null?label:label+(paused?' · PAUSED':' · not paused');
async function derive({profile,fields,details,proof,word,address,block,kind=null,direct=false}){
 if(!profile||fields.transferRestrictions)return null;
 // Any delegating path other than a fixed EIP-1167 clone can have its executed code replaced (implementation slot,
 // legacy slot or beacon), so an absence finding there is qualified as current-implementation only.
 const upgradeable=Boolean(kind)&&!direct&&!['EIP-1167 minimal proxy','Minimal proxy (Solady LibClone, 44-byte)'].includes(kind)||UPGRADEABLE.has(kind);
 const out=(value,method,scope,status='VERIFIED_SOURCE',extra={})=>({value,method,scope,status,extra:{...extra,
  stateScope:'TOKEN_TRANSFER_PATH',
  // Capability presence is a source finding. Only an explicit pinned state answer establishes a current setting;
  // pause=false never establishes empty blacklist/freeze/allowlist membership or that every transfer will succeed.
  ...(CAPABILITIES[profile]?{capabilities:CAPABILITIES[profile].map(capability=>({capability,presence:'VERIFIED_SOURCE',
   currentState:capability==='PAUSE'&&typeof extra.paused==='boolean'?(extra.paused?'ACTIVE':'INACTIVE'):
    capability==='TRADING_TOGGLE'&&typeof extra.transfersEnabled==='boolean'?(extra.transfersEnabled?'ENABLED':'DISABLED'):
    capability==='TRANSFER_ROLE_GATE'&&typeof extra.transferAllowed==='boolean'?(extra.transferAllowed?'OPEN':'RESTRICTED'):
    ['LAUNCH_LIMITS','MAX_WALLET','BUY_LIMITS'].includes(capability)&&typeof extra.active==='boolean'?(extra.active?'ACTIVE':'EXPIRED'):
    capability==='PAIR_SETUP_GATE'&&typeof extra.pairSet==='boolean'?(extra.pairSet?'OPEN':'OWNER_ONLY'):
    capability==='BUY_HOLDING_LIMITS'&&extra.pairSet===true&&typeof extra.limited==='boolean'?(extra.limited?'ENABLED':'DISABLED'):'NOT_VERIFIED'}))}:{}),
  ...(upgradeable?{upgradeCaveat:'Upgradeable proxy ('+kind+'): this finding covers the current implementation only; the upgrade authority can replace it.'}:{})}});
 if(Object.hasOwn(SIMPLE,profile)){
  // Absence claims need a direct runtime or a bound, resolved proxy (mechanics-deep only applies profiles to resolved
  // execution); a mutable implementation is never presented as a final absence.
  if(!direct&&!kind)return null;
  if(profile==='NATIVE_DEPOSIT_WRAPPER'&&!direct)return null;
  return out(upgradeable?'None in current code · upgradeable':NONE,'Reviewed complete transfer path',SIMPLE[profile]);
 }
 const paused=pausedState(details,proof,block),status=paused===null?'VERIFIED_SOURCE':'VERIFIED_SOURCE_AND_STATE';
 if(profile==='ALLOWANCE_MINTER_TOKEN')return out(withPause('Pause + blacklist',paused),'Reviewed whenNotPaused/notBlacklisted transfer modifiers'+(paused===null?'':' + pinned paused()'),
  'transfer/transferFrom revert while paused and when the sender, spender or recipient is blacklisted. The pauser and blacklister (set by the owner) control these lists.',status,{paused});
 if(profile==='CAPPED_FEE_LEGACY_TOKEN'){
  // Only while the reviewed contract is active (not forwarding to an upgraded contract), which the tax profile proved.
  if(!fields.tradingTaxes?.evidence?.some(e=>e?.deprecated===false))return null;
  return out(withPause('Pause + sender blacklist',paused),'Reviewed whenNotPaused + isBlackListed checks'+(paused===null?'':' + pinned paused()'),
   'transfer/transferFrom revert while paused or when the sender (from) is blacklisted. The owner pauses and maintains the blacklist and can destroy blacklisted funds.',status,{paused});
 }
 if(profile==='OWNED_ISSUANCE_PAUSABLE')return out(withPause('Owner pause',paused),'Reviewed PausableToken transfer path'+(paused===null?'':' + pinned paused()'),
  'transfer/transferFrom revert while the owner has paused the token. No blacklist or transfer limit exists.',status,{paused});
 if(profile==='REGISTRY_AUTH_TOKEN')return out(withPause('Pause + blocked accounts',paused),'Reviewed onlyNotPaused/onlyNotBlocked transfer modifiers'+(paused===null?'':' + pinned paused()'),
  'transfer/transferFrom revert while paused and when the sender, spender or recipient is blocked. Pause and block roles are held in the external access registry.',status,{paused});
 if(profile==='COMPLIANCE_ROLE_TOKEN')return out(withPause('Pause + compliance lists',paused),'Reviewed inherited compliance/pause checks'+(paused===null?'':' + pinned paused()'),
  'KYC/allowlist/blocklist and pause checks can revert transfers; role holders manage them. Current list membership is not enumerated.',status,{paused});
 if(profile==='PAXOS_SUPPLY_CONTROLLED')return out(withPause('Pause + freeze',paused),'Reviewed whenNotPaused + frozen checks'+(paused===null?'':' + pinned paused()'),
  'transfer/transferFrom/approve revert while paused or when sender, recipient or spender is frozen. The owner pauses; the asset-protection role freezes addresses and can wipe a frozen balance.',status,{paused});
 if(profile==='FIXED_SUPPLY_POOL_SETUP')return out('Anti-snipe max wallet (time-limited)','Reviewed _update anti-snipe check',
  'Until the immutable antiSnipeDeadline, a non-exempt recipient whose resulting balance exceeds the immutable maxWallet reverts. Whether the window is still open was not evaluated here.');
 if(profile==='MINIME_CONTROLLED'){
  const o=observation(details,proof,block,'transfersEnabled()',x=>typeof x.value==='boolean');
  return out(o?(o.value?'Controller-gated transfers · enabled':'Transfers DISABLED by controller'):'Controller-gated transfers','Reviewed MiniMe transfersEnabled + controller onTransfer hook'+(o?' + pinned transfersEnabled()':''),
   'The controller can disable all transfers (enableTransfers) and, when it is a contract, veto each transfer through onTransfer; the controller can also move tokens without allowance and destroy balances (see Owner & Admin).',o?'VERIFIED_SOURCE_AND_STATE':'VERIFIED_SOURCE',o?{transfersEnabled:o.value}:{});
 }
 if(profile==='FIXED_LAUNCH_RESTRICTIONS'||profile==='IMMUTABLE_LAUNCH_RESTRICTIONS'){
  const end=observation(details,proof,block,'restrictionEndBlock()',x=>/^\d+$/.test(x.raw||''));
  if(!end||!/^0x[0-9a-f]+$/i.test(block||''))return null;
  const active=BigInt(block)<=BigInt(end.raw);
  return out(active?'Launch buy limits until block '+end.raw:'None active · launch limits expired','Reviewed _update launch restriction + pinned restrictionEndBlock()',
   active?'Until the pinned end block, buys from the launch pool are blocked in the launch block and capped by max-wallet and cumulative-buy limits. Other transfers are unrestricted.':
    'The reviewed launch restriction applies only while block.number <= restrictionEndBlock; that block has passed, so transfers follow the unmodified ERC20 path.',
   'VERIFIED_SOURCE_AND_STATE',{restrictionEndBlock:end.raw,active});
 }
 if(profile==='ROLE_TIMELOCK_TRANSFER'&&typeof word==='function'){
  const raw=await word(address,'transferAllowed()');if(!raw||BigInt(raw)>1n)return null;
  const allowed=BigInt(raw)===1n;
  return out(allowed?'Investor vesting locks · transfers enabled':'Transfers gated (TRANSFER_ROLE) · vesting locks','Reviewed whenTransferAllowed + vesting checks + pinned transferAllowed()',
   allowed?'transferAllowed is true, so the TRANSFER_ROLE gate is open for everyone. Accounts with an investor allocation can move only their vested (freed) balance.':
    'transferAllowed is false: only TRANSFER_ROLE holders can transfer. Investor allocations are additionally limited to their vested balance.','VERIFIED_SOURCE_AND_STATE',{transferAllowed:allowed});
 }
 if(profile==='OWNER_RULES_BLACKLIST_FIXED_SUPPLY'&&direct&&typeof word==='function'){
  // owner() was already read at this block by the generic verified-source pass; this re-read is served from its cache.
  const [ownerRaw,limitedRaw,pairRaw]=await Promise.all([word(address,'owner()'),word(address,'limited()'),word(address,'uniswapV2Pair()')]);
  const owner=ownerRaw&&/^0x0{24}[0-9a-f]{40}$/i.test(ownerRaw)?'0x'+ownerRaw.slice(26).toLowerCase():null;
  if(!limitedRaw||!pairRaw||BigInt(limitedRaw)>1n||!/^0x0{24}[0-9a-f]{40}$/i.test(pairRaw))return null;
  const limited=BigInt(limitedRaw)===1n,pairSet=BigInt(pairRaw)!==0n,frozen=owner===ZERO;
  const parts=[frozen?'Blacklist (frozen)':owner?'Owner blacklist':'Blacklist'];
  if(!pairSet)parts.push('owner-only transfers');else if(limited)parts.push('buy holding limits');
  return out(parts.join(' · '),'Reviewed _beforeTokenTransfer + pinned limited()/uniswapV2Pair()'+(owner?'/owner()':''),
   'Blacklisted senders/recipients revert. '+(pairSet?(limited?'Buys from the pair must keep the buyer within the min/max holding amounts.':'The holding-limit rule is off (limited = false).'):'Before the pair is set only the owner can send or receive.')+
   (frozen?' The owner is the zero address, so the blacklist and rule can no longer change; existing blacklist entries stay blocked.':''),'VERIFIED_SOURCE_AND_STATE',{limited,pairSet,ownerRenounced:frozen});
 }
 return null;
}
module.exports={derive,SIMPLE,RESTRICTION_GETTERS,RESTRICTION_BUDGET,NONE};
