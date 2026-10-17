'use strict';
// Complete reviewed source fingerprints, never token addresses or ABI names.
// Provenance and execution-path review: docs/SEARCH_V4_DATA_AUDIT.md.
const crypto=require('node:crypto');
const {addressWord}=require('./admin-getters');
const PROFILES=Object.freeze({
 'aded855dee0c85115ce3de3ecac91908f810c12a2ddb6f085d7c5c10236c945f':'NATIVE_DEPOSIT_WRAPPER',
 'e29b890fd05e93bb661d6934d58afa365ff03b7d07bc1b1adeebf8259e1bc6dc':'FIXED_ERC677',
 'b0b6a93611c68a80ddccef0b5c61cf0e55976850b98a7ff47889b4725192f3e8':'OWNED_ISSUANCE_PAUSABLE',
 'f5ebad1074503ec0d9a61355ece383700862fc4c0d3904ad48aa97e35caea230':'GOVERNED_MINTER_SET',
 'fd9c8c9af9cdb9bce124a3d0d76edc18df19470c3c8d588c09172a97e708339d':'ROLE_TIMELOCK_TRANSFER',
 '97822136761cec8e740d8fab0b431651bfef3220891a71dee37056ecccf46175':'FIXED_LAUNCH_RESTRICTIONS',
 '1716a2d2068f5816644c6717836c817a11dda64ca3f99b6223efad2764f1824b':'COMPLIANCE_ROLE_TOKEN',
 '697ac51ddd373bb754030b8f10021c0e17ef54912b3ebf9c5d1845d8d698bc43':'COMPLIANCE_ROLE_TOKEN',
 'd39017d4a57fc82f293ddf7d7b780064636a94ba6f66d4bca5be6fb5d17762f5':'COMPLIANCE_ROLE_TOKEN',
 '8b0d6fcd1ea483267b044f497bbf6389e565c88a4b9cbe4390b471590497626f':'UPGRADEABLE_NO_DIRECT_MINT'
});
const PROXY_SOURCES=Object.freeze({
 '4622819b48b8b59aa16f771794980f7d976ad2e5c7b8131cef249f35bce94f3d':'REVIEWED_TRANSPARENT_EIP1967',
 '3a0d3e5ecc348aa435a000583716200d1a7a6d9e98bc98930083da33c4f931c7':'REVIEWED_ADMIN_EIP1967'
});
const BEACON_TEMPLATE=Object.freeze({bytes:283,start:29,length:32,
 maskedSha256:'d7c35a51be0ed39d622709106b8ffaa1ad9a6b91be8136fa0b36f4e9da749a45',
 reviewedSourceDigest:'922425867904c46fb129080ebcd685ba70e0afb5aaa9fdc47b5f9327cee41196'});
const BEACON_SOURCES=Object.freeze({
 'b80e9ea9116556c182e12f8e786950a32985026edff7b62c73130ca3661eccdf':'ROLE_CONTROLLED_IMPLEMENTATION_REGISTRY'
});
function immutableBeacon(code){
 if(typeof code!=='string'||!/^0x[0-9a-f]+$/i.test(code)||code.length!==2+BEACON_TEMPLATE.bytes*2)return null;
 const bytes=Buffer.from(code.slice(2),'hex');
 const beacon=addressWord('0x'+bytes.subarray(29,61).toString('hex'));if(!beacon)return null;
 bytes.fill(0,29,61);
 if(crypto.createHash('sha256').update(bytes).digest('hex')!==BEACON_TEMPLATE.maskedSha256)return null;
 return {...BEACON_TEMPLATE,beacon,scope:'Exact reviewed immutable-beacon runtime template, including compiler metadata; only its compiler-declared32-byte immutable differs. Not a token address match.'};
}
async function apply({profile,fields,details,proof,fact,word,call,address,block,keccak,direct=false,admin=null}){
 if(!Object.values(PROFILES).includes(profile))return;
 const transfer=scope=>fact('Transfer 0% · DEX/hook fees NOT VERIFIED','Reviewed complete token transfer execution',
  {...proof,coverage:'TOKEN_TRANSFER_ONLY',scope},'VERIFIED_SOURCE');
 const source=value=>fact(value,'Reviewed complete source capability',{...proof,
  scope:'Source-defined capability only; active privileged accounts, successful execution and external DEX/hook fees are not inferred.'},'VERIFIED_SOURCE');
 if(profile==='NATIVE_DEPOSIT_WRAPPER'){
  fields.tradingTaxes=transfer('transferFrom moves the full amount without deduction. Deposit/withdraw wrap native currency; DEX fees are separate.');
  fields.mintCapability=source('Native-deposit issuance');
  if(direct)fields.ownerAdmin=fields.ownerAdmin||fact('NONE DETECTED ✓','Reviewed complete non-delegating source authority paths',{
   ...proof,scope:'No privileged owner/admin or role path in this exact runtime/source. Permissionless native deposits create balances; forced native transfers can affect totalSupply without crediting ERC20 balances.'},'VERIFIED_SOURCE');
 }
 if(profile==='FIXED_ERC677'){
  fields.tradingTaxes=transfer('transfer/transferFrom move full units; ERC677 recipient callbacks are separate external behavior and DEX/hook fees remain unknown.');
  if(direct)fields.mintCapability=fact('NONE DETECTED ✓','Reviewed constant totalSupply and constructor-only initial allocation',{
   ...proof,scope:'Complete non-delegating implementation has no post-construction issuance path; not inferred from a missing getter.'},'VERIFIED_SOURCE');
  if(direct)fields.ownerAdmin=fields.ownerAdmin||fact('NONE DETECTED ✓','Reviewed complete non-delegating authority paths',{
   ...proof,scope:'No privileged owner/admin or role path in this source. Recipient callbacks do not grant token administrator privileges.'},'VERIFIED_SOURCE');
 }
 if(profile==='OWNED_ISSUANCE_PAUSABLE'){
  fields.tradingTaxes=transfer('Full-value transfer paths; owner pause can revert transfers. Pause is a restriction, not a percentage tax.');
  const owner=addressWord(await call(address,'owner()')),finished=await word(address,'mintingFinished()');
  if(owner&&finished&&BigInt(finished)===0n)fields.mintCapability=fact('Owner-authorized mint','Reviewed inherited mint path + pinned owner/mintingFinished',{
   ...proof,owner,mintingFinished:false,scope:'Owner issuance capability; reviewed finishMinting override returns false and renounceOwnership reverts. No mint transaction was simulated.'},'VERIFIED_SOURCE_AND_STATE');
 }
 if(profile==='GOVERNED_MINTER_SET'){
  fields.tradingTaxes=transfer('Inherited full-value ERC20 transfer and allowance paths; burn is explicit and separate.');
  const governor=addressWord(await call(address,'governor()'));
  if(governor){
   fields.ownerAdmin=fields.ownerAdmin||fact('Governor: '+governor,'Reviewed onlyGovernor and pinned governor()',{
    ...proof,governor,scope:'Governor can add/remove minters and nominate a successor. Pending governor is not active authority.'},'VERIFIED_SOURCE_AND_STATE');
   fields.mintCapability=fact('Governor-managed minter set','Reviewed onlyMinter mint + pinned governor',{
    ...proof,governor,scope:'Governor can configure minters; current complete minter membership and executable mint are not claimed.'},'VERIFIED_SOURCE_AND_STATE');
  }
 }
 if(profile==='ROLE_TIMELOCK_TRANSFER'){
  fields.tradingTaxes=transfer('Full-value transfer/transferFrom, subject to transfer-role and investor vesting restrictions; restrictions can revert and are not deductions.');
  const role=await word(address,'MINTER_ROLE()'),admin=await word(address,'getRoleAdmin(bytes32)','0'.repeat(64));
  if(role?.toLowerCase()===keccak(Buffer.from('MINTER_ROLE')).toLowerCase()&&admin){
   fields.mintCapability=fact('Role-gated mint','Reviewed mint role enforcement + pinned role identifier',{
    ...proof,minterRole:role,scope:'Source allows MINTER_ROLE issuance within uint96 bounds; role holders may be revoked. Current membership/executable mint not claimed.'},'VERIFIED_SOURCE_AND_STATE');
   fields.ownerAdmin=fields.ownerAdmin||fact('AccessControl role authority','Reviewed grant/revoke/transfer/timelock authority + pinned role admin',{
    ...proof,defaultAdminRole:'0x'+'0'.repeat(64),adminRole:admin,scope:'Verified role-based authority model, not a complete member list or a no-owner/renouncement claim. Transfer and timelock roles are distinct.'},'VERIFIED_SOURCE_AND_STATE');
  }
 }
 if(profile==='FIXED_LAUNCH_RESTRICTIONS'){
  fields.tradingTaxes=transfer('All permitted transfers move full value. Launch buy limits/exemptions can revert; poolFee is a configured V3 fee, not an ERC20 tax or proof of current trading fees.');
  if(direct)fields.mintCapability=fact('NONE DETECTED ✓','Reviewed constructor-only mint and full inheritance',{
   ...proof,scope:'No external post-construction issuance path in this exact non-delegating implementation.'},'VERIFIED_SOURCE');
  const factory=addressWord(await call(address,'launchFactory()'));
  if(factory)fields.ownerAdmin=fields.ownerAdmin||fact('Launch factory controls','Reviewed restricted exemption setter + pinned launchFactory',{
   ...proof,launchFactory:factory,scope:'Factory controls initial-buy recipient exemption. Deployer metadata is not ownership; transfer limits and expiry remain distinct from taxes.'},'VERIFIED_SOURCE_AND_STATE');
  for(const signature of ['poolFee()','restrictionEndBlock()','maxWalletBps()','maxTxBps()']){
   const raw=await word(address,signature);if(raw)details.observations.push({method:signature,raw:BigInt(raw).toString(),block,...proof,scope:'Reviewed configured parameter; pool fees/restrictions are not token trading-tax percentages.'});
  }
 }
 if(profile==='COMPLIANCE_ROLE_TOKEN'){
  fields.tradingTaxes=transfer('Reviewed inherited full-value ERC20 transfers. Pause, KYC/allowlist/blocklist/compliance gates can revert but do not deduct tokens. Proxy upgrades and external DEX/hook fees are separate.');
  const role=await word(address,'MINTER_ROLE()');
  if(role?.toLowerCase()===keccak(Buffer.from('MINTER_ROLE')).toLowerCase())fields.mintCapability=fact('Role-gated mint','Reviewed inherited mint + pinned MINTER_ROLE',{
   ...proof,minterRole:role,scope:'MINTER_ROLE capability in the currently reviewed implementation; pause/compliance restrictions apply. Current complete role membership or executable issuance is not asserted; upgrade authority remains separate.'},'VERIFIED_SOURCE_AND_STATE');
 }
 if(profile==='UPGRADEABLE_NO_DIRECT_MINT'){
  fields.tradingTaxes=transfer('Current reviewed implementation transfers full token units and updates delegation bookkeeping separately; external DEX/hook fees and future upgrades are unknown.');
  if(!direct&&admin)fields.mintCapability=fact('No direct mint · upgradeable','Reviewed current implementation + pinned proxy admin',{
   ...proof,proxyAdmin:admin,scope:'No public/external issuance path in this implementation; initialize is revision-gated and empty. This is NOT permanent fixed-supply or renouncement evidence: proxy upgrades can introduce issuance.'},'VERIFIED_SOURCE_AND_STATE');
 }
}
module.exports={PROFILES,PROXY_SOURCES,BEACON_TEMPLATE,BEACON_SOURCES,immutableBeacon,apply};
