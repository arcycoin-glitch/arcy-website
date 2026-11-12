'use strict';
// Inventory of every user-facing Search metric (search/server/schema.js) and how far each can be verified.
// The card and field keys are the existing public identities; metricId is the verification identity used by the
// MetricEvidence contract and the durable ledger. Nothing here changes a displayed value.
//
// kind
//   ONCHAIN          read directly from chain state at the analysis block
//   ONCHAIN_DERIVED  arithmetic over ONCHAIN inputs only
//   INDEXER          enumerated/ranked by an explorer or worker (RPC may re-read balances, not completeness)
//   MARKET           provider-reported market data
//   MARKET_DERIVED   arithmetic that includes at least one MARKET input (never on-chain verified)
//   SOURCE_ANALYSIS  derived from verified source code / bytecode review and role reads
// verification
//   INDEPENDENT_RPC_SAME_BLOCK   re-read at the same block number and hash by a second registered operator
//   MARKET_CROSSCHECK            compared with a second market operator only when the existing, licence-gated
//                                cross-check is enabled (SEARCH_MARKET_CROSSCHECK_APPROVED); tolerance agreement
//                                is never published as exact agreement
//   NONE                         no independent confirmation path exists today; best state is SINGLE_SOURCE
const schema=require('../../search/server/schema');
const ALL=Object.freeze(['arc','ethereum','robinhood']);
const RPC_SOURCES=Object.freeze({arc:'Arc RPC',ethereum:'Ethereum RPC',robinhood:'Robinhood RPC'});
const INDEPENDENT_RPC='Second registered RPC operator at the same block number and hash (Ethereum: dRPC vs PublicNode/Allnodes; Arc: QuickNode vs Circle; Robinhood: dRPC vs the official endpoint).';
const ENTRIES=Object.freeze([
 {card:'supply',field:'totalSupply',metricId:'supply.total_supply',kind:'ONCHAIN',policy:'onchain-state',unit:'token-base-units',
  read:'totalSupply',verification:'INDEPENDENT_RPC_SAME_BLOCK',current:RPC_SOURCES,independent:INDEPENDENT_RPC,
  limitations:'ERC-20 totalSupply() only. Rebasing or bridged supply is reported as the contract reports it.'},
 {card:'supply',field:'burnAddressBalance',metricId:'supply.burn_address_balance',kind:'ONCHAIN',policy:'onchain-state',unit:'token-base-units',
  read:'burnBalance',verification:'INDEPENDENT_RPC_SAME_BLOCK',current:RPC_SOURCES,independent:INDEPENDENT_RPC,
  limitations:'Current balance of 0x0 + 0x…dEaD only; not lifetime burned and not other burn sinks.'},
 {card:'supply',field:'nonBurnSupply',metricId:'supply.non_burn_supply',kind:'ONCHAIN_DERIVED',policy:'onchain-state',unit:'token-base-units',
  read:'nonBurnSupply',verification:'INDEPENDENT_RPC_SAME_BLOCK',current:RPC_SOURCES,independent:INDEPENDENT_RPC,
  limitations:'totalSupply minus burn-address custody. It is NOT circulating supply: locked, treasury and vesting balances are included.'},
 {card:'supply',field:'burnAddressPct',metricId:'supply.burn_address_pct',kind:'ONCHAIN_DERIVED',policy:'onchain-state',unit:'percent',
  read:'burnPct',verification:'INDEPENDENT_RPC_SAME_BLOCK',current:RPC_SOURCES,independent:INDEPENDENT_RPC,
  limitations:'Share of supply held at the two standard burn addresses at the analysis block (18 decimal places).'},
 {card:'holders',field:'holderCount',metricId:'holders.holder_count',kind:'INDEXER',policy:'holder-snapshot',unit:'count',
  verification:'NONE',current:{arc:'Signed worker holder publication (A/X Explorer enumeration reconciled to Arc RPC)',ethereum:'Blockscout / GoPlus',robinhood:'Robinhood Blockscout'},
  independent:'None today. An enumeration is only as complete as the indexer; a second indexer would be required.',
  limitations:'Holder completeness depends on the enumerating indexer. Arc snapshots that reconcile exactly to totalSupply are complete for that block, but still single-operator.'},
 {card:'holders',field:'largestWalletPct',metricId:'holders.largest_wallet_pct',kind:'INDEXER',policy:'holder-snapshot',unit:'percent',
  verification:'NONE',current:{arc:'Signed worker holder publication',ethereum:'Blockscout candidates re-read by Ethereum RPC / GoPlus',robinhood:'Robinhood Blockscout + RPC'},
  independent:'Balances can be re-read by RPC; the RANK (that no larger wallet exists) depends on the indexer.',
  limitations:'Pool, exchange and contract wallets are classified only where attribution evidence exists.'},
 {card:'holders',field:'top10Pct',metricId:'holders.top10_pct',kind:'INDEXER',policy:'holder-snapshot',unit:'percent',
  verification:'NONE',current:{arc:'Signed worker holder publication',ethereum:'Blockscout / GoPlus',robinhood:'Robinhood Blockscout + RPC'},
  independent:'As largestWalletPct.',limitations:'Concentration of the ten largest indexed holders.'},
 {card:'holders',field:'top20Pct',metricId:'holders.top20_pct',kind:'INDEXER',policy:'holder-snapshot',unit:'percent',
  verification:'NONE',current:{arc:'Signed worker holder publication',ethereum:'Blockscout',robinhood:'Robinhood Blockscout + RPC'},
  independent:'As largestWalletPct.',limitations:'Concentration of the twenty largest indexed holders.'},
 {card:'liquidity',field:'liquidityUsd',metricId:'liquidity.liquidity_usd',kind:'MARKET',policy:'market-liquidity',unit:'usd',preset:'MARKET_LIQUIDITY_USD',
  verification:'MARKET_CROSSCHECK',current:{arc:'DEX Screener (GeckoTerminal fallback)',ethereum:'DEX Screener / GeckoTerminal',robinhood:'DEX Screener (GeckoTerminal fallback)'},
  independent:'GeckoTerminal (CoinGecko) when the licence-gated cross-check is enabled and both providers return the same pool set.',
  limitations:'Sum of returned pools; not a chain-wide pool census and not executable exit liquidity.'},
 {card:'liquidity',field:'volume24h',metricId:'liquidity.volume_24h',kind:'MARKET',policy:'market-volume',unit:'usd',preset:'MARKET_VOLUME_24H_USD',
  verification:'MARKET_CROSSCHECK',current:{arc:'DEX Screener',ethereum:'DEX Screener / GeckoTerminal',robinhood:'DEX Screener'},
  independent:'GeckoTerminal when enabled; providers differ in window edges, so agreement is tolerance-based only.',
  limitations:'Pools younger than 24 hours report a partial window.'},
 {card:'liquidity',field:'dexPairCount',metricId:'liquidity.dex_pair_count',kind:'MARKET',policy:'market-liquidity',unit:'text-sha256',
  verification:'NONE',current:{arc:'DEX Screener',ethereum:'DEX Screener',robinhood:'DEX Screener'},
  independent:'None: providers index different pool sets by design.',limitations:'Count of pools the provider returned, not of all pools.'},
 {card:'liquidity',field:'liquidityTurnover24h',metricId:'liquidity.turnover_24h',kind:'MARKET_DERIVED',policy:'market-derived',unit:'ratio',
  verification:'NONE',current:{arc:'Derived: same-provider volume / liquidity',ethereum:'Derived',robinhood:'Derived'},
  independent:'Inherits its market inputs; never stronger than SINGLE_SOURCE.',limitations:'A turnover ratio is not exit-safety evidence.'},
 {card:'activity',field:'priceUsd',metricId:'activity.price_usd',kind:'MARKET',policy:'market-price',unit:'usd',preset:'MARKET_PRICE_USD',
  verification:'MARKET_CROSSCHECK',current:{arc:'DEX Screener',ethereum:'DEX Screener / GeckoTerminal / Chainlink where reviewed',robinhood:'DEX Screener'},
  independent:'GeckoTerminal when enabled (tolerance 3 %); exact agreement is not expected between market providers.',
  limitations:'Pool-derived spot price of the returned pools.'},
 {card:'activity',field:'valuation',metricId:'activity.valuation',kind:'MARKET_DERIVED',policy:'market-derived',unit:'usd',
  verification:'NONE',current:{arc:'Derived: Arc RPC totalSupply × market price',ethereum:'Provider-reported or derived',robinhood:'Derived'},
  independent:'Never on-chain verified: the price component is market data even when supply is on-chain.',
  limitations:'FDV uses total supply; market cap requires circulating supply, which is usually not verified.'},
 {card:'activity',field:'change24h',metricId:'activity.change_24h',kind:'MARKET',policy:'market-change',unit:'percent',preset:'MARKET_CHANGE_24H_PCT',
  verification:'NONE',current:{arc:'DEX Screener',ethereum:'DEX Screener / GeckoTerminal',robinhood:'DEX Screener'},
  independent:'Not compared: the existing cross-check covers liquidity, volume and price only.',limitations:'Provider window definition.'},
 {card:'activity',field:'volume24h',metricId:'activity.volume_24h',kind:'MARKET',policy:'market-volume',unit:'usd',preset:'MARKET_VOLUME_24H_USD',
  verification:'MARKET_CROSSCHECK',current:{arc:'DEX Screener',ethereum:'DEX Screener / GeckoTerminal',robinhood:'DEX Screener'},
  independent:'As liquidity.volume24h.',limitations:'Same value as the Liquidity card field; verified separately per card.'},
 {card:'mechanics',field:'tradingTaxes',metricId:'mechanics.trading_taxes',kind:'SOURCE_ANALYSIS',policy:'contract-mechanics',unit:'text-sha256',
  verification:'NONE',current:{arc:'Reviewed source/hook profiles + Arc RPC',ethereum:'Sourcify/Etherscan source + GoPlus',robinhood:'Reviewed source + Robinhood RPC'},
  independent:'None: a second source-analysis engine would be required.',limitations:'Transfer-path fees only unless buy/sell paths are separately proven.'},
 {card:'mechanics',field:'mintCapability',metricId:'mechanics.mint_capability',kind:'SOURCE_ANALYSIS',policy:'contract-mechanics',unit:'text-sha256',
  verification:'NONE',current:{arc:'Source/bytecode review + role reads',ethereum:'Source review / GoPlus',robinhood:'Source review + role reads'},
  independent:'None.',limitations:'Absence of a mint selector is not proof that minting is impossible.'},
 {card:'mechanics',field:'ownerAdmin',metricId:'mechanics.owner_admin',kind:'ONCHAIN',policy:'contract-mechanics',unit:'address',
  read:'owner',verification:'INDEPENDENT_RPC_SAME_BLOCK',current:RPC_SOURCES,independent:INDEPENDENT_RPC+' Only when the displayed value is an owner() getter result.',
  limitations:'owner() is one getter; it does not enumerate roles, timelocks or multisig signers.'},
 {card:'mechanics',field:'contractArchitecture',metricId:'mechanics.contract_architecture',kind:'ONCHAIN',policy:'contract-mechanics',unit:'address',
  read:'implementation',verification:'INDEPENDENT_RPC_SAME_BLOCK',current:RPC_SOURCES,independent:INDEPENDENT_RPC+' Only when the displayed value is an EIP-1967 implementation slot.',
  limitations:'An empty implementation slot does not prove non-upgradeability.'}
]);
const fail=code=>Object.assign(Error(code),{code});
function entries(){return ENTRIES.map(e=>({...e,networks:ALL}));}
function lookup(card,field){return ENTRIES.find(e=>e.card===card&&e.field===field)||null;}
// The catalog must cover every displayed schema field exactly once; tests enforce this.
function coverage(){
 const expected=schema.flatMap(c=>c.fields.map(([field])=>c.id+'.'+field)),have=ENTRIES.map(e=>e.card+'.'+e.field);
 return {missing:expected.filter(k=>!have.includes(k)),extra:have.filter(k=>!expected.includes(k)),duplicateMetricIds:have.length-new Set(ENTRIES.map(e=>e.metricId)).size};
}
module.exports={ENTRIES,entries,lookup,coverage,fail};
