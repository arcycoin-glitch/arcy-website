'use strict';
// Pulse V2 on-chain watch scope.
//
// SCOPE, NOT ENDORSEMENT: every token address below is an exact contract already carried by this repository's reviewed
// cohorts (test/fixtures/search-v4-contracts.json, search-v5-contracts.json and search/server/lib/prefix-catalog.js);
// test/pulse-onchain-watchlist.test.js fails if an address is added here without that provenance. Symbols are labels
// for the exact address only and never an issuer-identity claim. Pulse reports events for THESE contracts; an empty
// result is a statement about this scope and block window, never about the whole network.
const NETWORKS=Object.freeze({
 arc:Object.freeze({
  chainId:5042,label:'Arc',explorer:'https://explorer.arc.io',
  // Arc public RPC evidence (lib/holder-log-range.js): 1000/2000/5000-block spans accepted, 10000 rejected, ~1000-log cap.
  // Live probe 2026-11-10: a 5-call JSON-RPC batch was answered -32005 "rate limit exceeded" by BOTH public endpoints,
  // so Arc is read one paced call at a time and its pool query is not split per token position.
  span:2000,maxSpan:2000,maxWindows:3,truncationAt:1000,confirmationDepth:20,maxCalls:36,batch:false,paceMs:280,factoryTokenFilter:false,
  tokens:[
   ['ARCY','0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b'],['ARGUS','0xece5ca8bf9220718e5727754026757512212cb3c'],
   ['USDT-Arc','0x3b0d0f9825850d3ab1491253b86c4cc26ff1250a'],['UBI','0x547dd73ce97c886f51e2d530e9b9ed2fd5844b56'],
   ['TOLLY','0xbc43ce8dec648ea298c4275559b81d6261c90b67'],['cirBTC','0x171a4217b86a807a64eb94757db6849fb4bdbaa0'],
   // System-level USDC: administrative events are watched; its Transfer log stream is NOT used as a supply ledger.
   ['USDC','0x3600000000000000000000000000000000000000',{supply:false,base:true}],
   ['LINK','0x76a443768a5e3b8d1aed0105fc250877841deb40'],['POLL','0xf76b1d00bd3d63a37246b5f512074e864010e33d']
  ],
  // Official Uniswap v4 PoolManager on Arc (same deployment lib/lp-positions.js already reads).
  factories:[{address:'0x8366a39cc670b4001a1121b8f6a443a643e40951',architecture:'v4',label:'Uniswap v4 PoolManager',reference:'https://developers.uniswap.org/docs/protocols/v4/deployments'}]
 }),
 ethereum:Object.freeze({
  chainId:1,label:'Ethereum',explorer:'https://etherscan.io',
  // Live probe 2026-11-10 (PublicNode): HTTP 403 "A maximum of 10 addresses is allowed" for a 13-address filter,
  // so address lists are split into filters of at most 10 and read sequentially.
  span:1500,maxSpan:1500,maxWindows:3,truncationAt:10000,confirmationDepth:64,maxCalls:64,batch:false,paceMs:0,factoryTokenFilter:true,maxAddresses:10,
  tokens:[
   ['USDT','0xdac17f958d2ee523a2206206994597c13d831ec7',{base:true}],['USDC','0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',{base:true}],
   ['DAI','0x6b175474e89094c44da98b954eedeac495271d0f',{base:true}],['WETH','0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',{base:true,supply:false}],
   ['WBTC','0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',{base:true}],['UNI','0x1f9840a85d5af5bf1d1762f925bdaddc4201f984'],
   ['LINK','0x514910771af9ca656af840dff83e8264ecf986ca'],['AAVE','0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9'],
   ['GRT','0xc944e90c64b2c07662a292be6244bdf05cda44a7'],['ONDO','0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3'],
   ['USDY','0x96f6ef951840721adbf46ac996b59e0235cb985c'],['OUSG','0x1b19c19393e2d034d8ff31ff34c81252fcbbee92'],
   ['USDON','0xace8e719899f6e91831b18ae746c9a965c2119f1']
  ],
  // Canonical Uniswap mainnet deployments (protocol documentation). The live probe asserts each has runtime code.
  factories:[
   {address:'0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f',architecture:'v2',label:'Uniswap V2 Factory',reference:'https://docs.uniswap.org/contracts/v2/reference/smart-contracts/factory'},
   {address:'0x1f98431c8ad98523631ae4a59f267346ea31f984',architecture:'v3',label:'Uniswap V3 Factory',reference:'https://docs.uniswap.org/contracts/v3/reference/deployments/ethereum-deployments'},
   {address:'0x000000000004444c5dc75cb358380d2e3de08a90',architecture:'v4',label:'Uniswap v4 PoolManager',reference:'https://developers.uniswap.org/docs/protocols/v4/deployments'}
  ]
 }),
 robinhood:Object.freeze({
  chainId:4663,label:'Robinhood Chain',explorer:'https://robinhoodchain.blockscout.com',
  // Live probe 2026-11-10: batches accepted; 12,000 blocks span only ~0.3 h (sub-second blocks), so a sparse window
  // doubles the next span (up to maxSpan) to widen time coverage at the same call cost.
  span:2000,maxSpan:32000,maxWindows:6,truncationAt:10000,confirmationDepth:60,maxCalls:48,batch:true,paceMs:0,factoryTokenFilter:true,
  tokens:[
   ['AAPL','0xaf3d76f1834a1d425780943c99ea8a608f8a93f9'],['TSLA','0x322f0929c4625ed5bad873c95208d54e1c003b2d'],
   ['CRM','0xd95b44124e475743a7589e68f3d74008a5536d44'],['ON','0xbbd09f72b025360fee5c928053dca6248d35be54'],
   ['APLD','0xb8dbf92f9741c9ac1c32115e78581f23509916fd'],['AEHR','0x5f604fba1162193a4388a5dfa56f556f3e133cc2'],
   ['LINK','0x492641f648a4986844848e0befe66d14817bce34'],['PONS','0x39dbed3a2bd333467115de45665cc57f813c4571']
  ],
  // No pool factory is listed: no Robinhood Chain DEX deployment address has been verified from a primary source yet.
  factories:[]
 })
});
function network(chain){
 if(!Object.hasOwn(NETWORKS,chain))throw Object.assign(Error('INVALID_PULSE_CHAIN'),{code:'INVALID_PULSE_CHAIN'});
 const cfg=NETWORKS[chain];
 const tokens=cfg.tokens.map(([symbol,address,flags={}])=>({symbol,address,supply:flags.supply!==false,base:flags.base===true}));
 return {...cfg,chain,tokens,bySymbol:new Map(tokens.map(t=>[t.address,t]))};
}
module.exports={NETWORKS,network};
