'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const id=require('../lib/verification/source-identity');
const catalog=require('../lib/verification/metric-catalog');
const freshness=require('../lib/verification/freshness');
const consensus=require('../lib/verification/consensus');
const {SLUG}=id;

test('RPC operators come from the registry; Arc endpoints are attributed per the official Arc endpoint list',()=>{
 assert.deepEqual(id.rpcOperator('https://rpc.mainnet.arc.io').operator,'circle');
 assert.deepEqual(id.rpcOperator('https://rpc.quicknode.mainnet.arc.io/').operator,'quicknode');
 assert.equal(id.rpcOperator('https://ethereum-rpc.publicnode.com').operator,'allnodes');
 assert.equal(id.rpcOperator('https://eth.drpc.org').operator,'drpc');
 assert.equal(id.rpcOperator('https://robinhood.drpc.org').operator,'drpc');
 assert.equal(id.rpcOperator('https://rpc.mainnet.chain.robinhood.com').operator,'robinhood-chain');
 assert.equal(id.rpcOperator('https://eth-mainnet.g.alchemy.com/v2/KEY').operator,'alchemy');
 for(const u of ['https://rpc.mainnet.arc.io','https://eth.drpc.org'])assert.equal(id.rpcOperator(u).basis,'REGISTRY');
});

test('same-operator endpoints never count as independent; unknown hosts never upgrade evidence',()=>{
 const circle=id.rpcOperator('https://rpc.mainnet.arc.io'),quick=id.rpcOperator('https://rpc.quicknode.mainnet.arc.io');
 assert.deepEqual(id.independent(circle,quick),{independent:true,reasonCode:null});
 // Two dRPC hostnames are one operator.
 assert.deepEqual(id.independent(id.rpcOperator('https://eth.drpc.org'),id.rpcOperator('https://lb.drpc.org/ogrpc?network=ethereum')),{independent:false,reasonCode:'SAME_OPERATOR'});
 // An unlisted host under arc.io belongs to the official operator, not to a new "independent" one.
 const other=id.rpcOperator('https://rpc.other.mainnet.arc.io');
 assert.equal(other.operator,'circle');assert.equal(other.basis,'OFFICIAL_DOMAIN_FALLBACK');
 assert.equal(id.independent(circle,other).reasonCode,'SAME_OPERATOR');
 // A custom endpoint with an unknown operator is not proof of independence.
 const custom=id.rpcOperator('https://node.example.net');
 assert.equal(custom.basis,'DOMAIN_FALLBACK');assert.equal(id.independent(circle,custom).reasonCode,'OPERATOR_UNVERIFIED');
 assert.equal(id.rpcOperator('not a url').basis,'INVALID_URL');
});

test('field source labels map to a source class and operator; CoinGecko and GeckoTerminal are one operator',()=>{
 assert.deepEqual(id.fieldSource('GeckoTerminal','arc').operator,'coingecko');
 assert.deepEqual(id.fieldSource('CoinGecko Onchain','arc').operator,'coingecko');
 assert.equal(id.fieldSource('DEX Screener','arc').operator,'dexscreener');
 assert.equal(id.fieldSource('Blockscout candidate addresses + Ethereum RPC','ethereum').operator,'blockscout');
 assert.equal(id.fieldSource('Arc signed COMPLETE holder publication','arc').class,'WORKER');
 const rpc=id.fieldSource('Robinhood RPC','robinhood');
 assert.equal(rpc.class,'ONCHAIN_RPC');assert.equal(rpc.operator,'unattributed-report-rpc');
 const odd=id.fieldSource('Some New Feed!','ethereum');
 assert.equal(odd.basis,'UNRECOGNIZED_LABEL');assert.match(odd.id,SLUG);
 for(const label of ['','Arc RPC / Sourcify','Chainlink Data Feed via Ethereum RPC',null])assert.match(id.fieldSource(label,'arc').id,SLUG);
});

test('the metric catalog covers every displayed Search field exactly once with a real policy and preset',()=>{
 assert.deepEqual(catalog.coverage(),{missing:[],extra:[],duplicateMetricIds:0});
 for(const e of catalog.entries()){
  assert.match(e.metricId,SLUG);assert.ok(Object.hasOwn(freshness.POLICIES,e.policy),e.metricId);
  assert.deepEqual(e.networks,['arc','ethereum','robinhood']);
  assert.ok(['ONCHAIN','ONCHAIN_DERIVED','INDEXER','MARKET','MARKET_DERIVED','SOURCE_ANALYSIS'].includes(e.kind));
  assert.ok(['INDEPENDENT_RPC_SAME_BLOCK','MARKET_CROSSCHECK','NONE'].includes(e.verification));
  if(e.preset)assert.ok(consensus.PRESETS[e.preset],e.preset);
  if(e.verification==='INDEPENDENT_RPC_SAME_BLOCK')assert.ok(e.read&&['ONCHAIN','ONCHAIN_DERIVED'].includes(e.kind),e.metricId);
  assert.ok(e.limitations.length>20&&e.independent.length>4);
 }
 // FDV / valuation is never an on-chain verification target.
 const valuation=catalog.lookup('activity','valuation');
 assert.equal(valuation.kind,'MARKET_DERIVED');assert.equal(valuation.verification,'NONE');
});
