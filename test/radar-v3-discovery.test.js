'use strict';
const {test,beforeEach}=require('node:test'),assert=require('node:assert/strict');
const radar=require('../lib/radar-v2'),D=require('../lib/radar-v2/discovery'),sources=require('../lib/radar-v2/sources'),http=require('../lib/radar-v2/http'),pons=require('../lib/radar-v2/pons');
const addr=i=>'0x'+i.toString(16).padStart(40,'0');
const T0=Date.UTC(2026,9,30,12,0,0),DAY=86400000,ENV={MARKET_RADAR_PUBLIC_DISPLAY_APPROVED:'true',MARKET_RADAR_JSON_DELIVERY_APPROVED:'true',COINGECKO_DEMO_API_KEY:'k',VERCEL:'1'};
beforeEach(()=>{http._resetCooldowns();radar._cache.clear();});
const resp=b=>({ok:true,status:200,headers:new Headers(),text:async()=>JSON.stringify(b)});
function router(routes){const calls=[];const f=async(u,o={})=>{calls.push({u,o});for(const [re,fn] of routes)if(re.test(u))return fn(u,o);throw new Error('unrouted '+u);};f.calls=calls;return f;}
// Build a provider page from explicit token specs: {a,s,n,price,vol,liq,ageDays,chg,buys,sells,coin}
function page(net,specs){
 const id=sources.NETWORKS[net].gecko,included=[],data=[];
 specs.forEach((x,i)=>{
  const a=x.a,pool=addr(70000+i);
  included.push({id:id+'_'+a,type:'token',attributes:{address:a,name:x.n||x.s,symbol:x.s,image_url:'https://coin-images.coingecko.com/coins/images/'+(i+1)+'/large/x.png',coingecko_coin_id:x.coin||null}});
  data.push({id:id+'_'+pool,type:'pool',attributes:{address:pool,pool_created_at:new Date(T0-(x.age??5)*DAY).toISOString(),base_token_price_usd:String(x.price??0.5),reserve_in_usd:String(x.liq??500000),fdv_usd:'1000000',market_cap_usd:null,
   volume_usd:{h24:String(x.vol??300000)},price_change_percentage:{h24:String(x.chg??12)},transactions:{h24:{buys:x.buys??400,sells:x.sells??350}}},
   relationships:{base_token:{data:{id:id+'_'+a,type:'token'}},quote_token:{data:{id:id+'_'+addr(900),type:'token'}},dex:{data:{id:'dex-'+id,type:'dex'}}}});
 });
 included.push({id:id+'_'+addr(900),type:'token',attributes:{address:addr(900),name:'Quote',symbol:'QQQ'}},{id:'dex-'+id,type:'dex',attributes:{name:'Dex'}});
 return {data,included};
}
function multi(net,specs){
 const id=sources.NETWORKS[net].gecko;
 return {data:specs.map(x=>({id:id+'_'+x.a,type:'token',attributes:{address:x.a,name:x.n||x.s,symbol:x.s,coingecko_coin_id:x.coin||null,price_usd:String(x.price??0.5),fdv_usd:'1000000',market_cap_usd:null,total_reserve_in_usd:String(x.tliq??x.liq??500000),normalized_total_supply:'1',volume_usd:{h24:String(x.tvol??x.vol??300000)}}}))};
}
const run=(net,specs,{rpc,env=ENV}={})=>{
 const f=router([[/tokens\/multi/,()=>resp(multi(net,specs))],[/coingecko\.com/,()=>resp(page(net,specs))],...(rpc?[[/rpc\.example/,rpc]]:[])]);
 return radar.load(net,{env,fetcher:f,now:()=>T0,disableCache:true,rpcUrl:'https://rpc.example/'}).then(o=>(o.f=f,o));
};

// ── identity ───────────────────────────────────────────────────────────────────
test('identity: base, wrapped and stable assets are excluded by contract / CoinGecko id / peg evidence, not by ticker alone',()=>{
 const eth='ethereum',ref={eth:2250,btc:78000};
 const c=(row,net=eth,r=ref)=>D.classify({network:net,coinId:null,change24hPct:0.1,...row},net,r);
 assert.equal(c({address:'0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',symbol:'WETH',name:'Wrapped Ether',priceUsd:2250}).reason,'WRAPPED_BASE_ASSET','registry address');
 assert.equal(c({address:'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',symbol:'USDC',name:'USD Coin',priceUsd:1}).reason,'STABLECOIN');
 assert.equal(c({address:addr(5),symbol:'XYZ',name:'Something',priceUsd:1,coinId:'usd-coin'}).reason,'STABLECOIN','CoinGecko id');
 assert.equal(c({address:addr(6),symbol:'cirBTC',name:'Circle Wrapped Bitcoin',priceUsd:77000},'arc').reason,'WRAPPED_BASE_ASSET','price consistent with the chain BTC reference');
 assert.equal(c({address:addr(7),symbol:'USDB',name:'Blockchain USD',priceUsd:0.905,change24hPct:0.3},'arc').reason,'STABLECOIN','pegged stable-asset name');
 assert.equal(c({address:D.CANONICAL.robinhood.keys().next().value,symbol:'WETH',name:'WETH',priceUsd:2250},'robinhood').reason,'WRAPPED_BASE_ASSET');
 assert.equal(c({address:'0x0000000000000000000000000000000000000000',symbol:'ETH',name:'Ether',priceUsd:2250}).reason,'NATIVE_PLACEHOLDER');
});
test('identity: a project using the WETH ticker is NOT proven to be WETH — it is an impersonation suspect, not a pass',()=>{
 const r=D.classify({address:addr(8),symbol:'WETH',name:'WETH',priceUsd:0.0004,change24hPct:40},'arc',{eth:2250,btc:null});
 assert.equal(r.reason,'IMPERSONATION_SUSPECT');assert.match(r.detail,/ticker alone is not identity/);
 assert.equal(D.classify({address:addr(9),symbol:'USDT',name:'Tether',priceUsd:0.002,change24hPct:5},'arc',{eth:null,btc:null}).reason,'IMPERSONATION_SUSPECT','major stable ticker that does not hold a peg');
 assert.equal(D.classify({address:addr(10),symbol:'XUSD',name:'Xusd Meme',priceUsd:0.002,change24hPct:30},'arc',{eth:null,btc:null}),null,'a meme with "usd" in its name that trades nowhere near a peg is an ordinary token');
 assert.equal(D.classify({address:addr(11),symbol:'ARGUS',name:'Argus',priceUsd:0.005},'arc',{eth:null,btc:null}),null);
});
test('reference prices come from the registry asset or a >=3 agreeing median; one outlier cannot define them',()=>{
 const mk=(s,p,a=addr(Math.random()*1e9|0))=>({address:a,symbol:s,name:s,priceUsd:p});
 assert.equal(D.referencePrices('arc',[mk('WETH',2250),mk('WETH',0.0004)]).eth,null,'two disagreeing ETH tickers: no reference');
 assert.ok(Math.abs(D.referencePrices('arc',[mk('WETH',2250),mk('WETH',2260),mk('ETH',2240),mk('WETH',0.0004)]).eth-2250)<20);
 assert.equal(D.referencePrices('robinhood',[{address:'0x0bd7d308f8e1639fab988df18a8011f41eacad73',symbol:'WETH',name:'WETH',priceUsd:2248}]).eth,2248,'official Robinhood WETH alone is a reference');
});

// ── gates, score ───────────────────────────────────────────────────────────────
test('network profiles: the same activity passes on Arc and fails on Ethereum; nothing is shared blindly',()=>{
 const r={priceUsd:1,volume24hUsd:60000,liquidityUsd:150000,buys24h:200,sells24h:180};
 assert.deepEqual(D.gates(r,D.PROFILES.arc),[]);
 assert.deepEqual(D.gates(r,D.PROFILES.ethereum),['VOLUME_BELOW_NETWORK_FLOOR','LIQUIDITY_BELOW_NETWORK_FLOOR']);
});
test('hard gates: unverifiable price/volume/liquidity, inconsistent volume vs liquidity and almost no trades are ineligible',()=>{
 const p=D.PROFILES.arc,ok={priceUsd:1,volume24hUsd:90000,liquidityUsd:90000,buys24h:50,sells24h:50};
 assert.deepEqual(D.gates({...ok,priceUsd:null},p),['PRICE_NOT_VERIFIED']);
 assert.deepEqual(D.gates({...ok,volume24hUsd:null},p),['VOLUME_NOT_VERIFIED']);
 assert.deepEqual(D.gates({...ok,liquidityUsd:null},p),['LIQUIDITY_NOT_VERIFIED']);
 assert.ok(D.gates({...ok,volume24hUsd:1e8},p).includes('VOLUME_LIQUIDITY_INCONSISTENT'));
 assert.ok(D.gates({...ok,buys24h:1,sells24h:1},p).includes('TOO_FEW_TRADES'));
 assert.ok(D.gates({...ok,priceUsd:1e-30},p).includes('PRICE_IMPLAUSIBLE'));
});
test('score: missing inputs remove their component (weights re-normalise, loss is reported); nothing is invented',()=>{
 const base={volume24hUsd:400000,liquidityUsd:500000,change24hPct:20,buys24h:300,sells24h:280,poolCreatedAt:new Date(T0-3*DAY).toISOString(),scopeVolume:'TOKEN',poolVolume24hUsd:200000,crossShare:1};
 const full=D.score(base,'arc',T0);
 assert.equal(full.missing.length,0);assert.equal(full.weightCoverage,1);
 const part=D.score({...base,poolCreatedAt:null,change24hPct:null,buys24h:null,sells24h:null,crossShare:null},'arc',T0);
 assert.deepEqual(part.missing.map(m=>m.id).sort(),['activity','balance','consistency','momentum']);
 assert.equal(part.components.find(c=>c.id==='freshness').value,0,'unknown age earns no newness credit but keeps its weight');
 assert.ok(part.weightCoverage<1&&part.score>=0&&part.score<=100);
 assert.equal(D.score(base,'arc',T0).version,D.SCORE_VERSION);
 const sum=full.components.reduce((a,c)=>a+c.points,0);assert.ok(Math.abs(sum-full.score)<0.2,'component points explain the score');
});
test('score: a new token with real trades can beat an old giant; a new token with no volume cannot enter at all',()=>{
 const mk=(o)=>({volume24hUsd:300000,liquidityUsd:400000,change24hPct:8,buys24h:300,sells24h:260,poolCreatedAt:new Date(T0-o.age*DAY).toISOString(),scopeVolume:'TOKEN',poolVolume24hUsd:150000,crossShare:1,...o});
 const fresh=D.score(mk({age:2}),'arc',T0).score,old=D.score(mk({age:700,volume24hUsd:900000,liquidityUsd:900000}),'arc',T0).score;
 assert.ok(fresh>old-5,'freshness is a real but bounded signal: '+fresh+' vs '+old);
 assert.ok(D.gates({priceUsd:1,volume24hUsd:50,liquidityUsd:1e6,buys24h:9,sells24h:9},D.PROFILES.arc).includes('VOLUME_BELOW_NETWORK_FLOOR'),'new alone does not qualify');
});
test('score: wash-trading style signals reduce the score and are flagged as evidence, never as an accusation',()=>{
 const base={volume24hUsd:2e6,liquidityUsd:500000,change24hPct:5,buys24h:400,sells24h:400,poolCreatedAt:new Date(T0-DAY).toISOString(),scopeVolume:'POOL',crossShare:null};
 const calm=D.score(base,'arc',T0),churn=D.score({...base,volume24hUsd:80e6},'arc',T0),big=D.score({...base,buys24h:5,sells24h:20,volume24hUsd:3e6},'arc',T0);
 assert.ok(churn.flags.includes('HIGH_TURNOVER')&&churn.penalties.some(p=>p.id==='HIGH_TURNOVER'));
 assert.ok(big.flags.includes('LARGE_TRADES_FEW_TXNS'));
 assert.ok(churn.score<calm.score);
 assert.ok(D.score({...base,change24hPct:900},'arc',T0).flags.includes('EXTREME_PUMP_24H'));
});
test('dedupe keeps the contract with stronger identity evidence; diversify stops old giants and tokenized equities from filling the list',()=>{
 const a={address:addr(1),symbol:'PONS',coinId:null,discovery:{score:90}},b={address:addr(2),symbol:'PONS',coinId:null,_pons:{factory:'f'},discovery:{score:70}};
 const d=D.dedupe([a,b]);assert.deepEqual(d.kept.map(x=>x.address),[addr(2)]);assert.equal(d.dropped[0].reason,'DUPLICATE_SYMBOL_UNVERIFIED');
 const mk=(i,age,kind='TOKEN')=>({address:addr(i),symbol:'S'+i,kind,poolCreatedAt:new Date(T0-age*DAY).toISOString()});
 const rows=[mk(1,500),mk(2,500),mk(3,500),mk(4,500),mk(5,500),mk(6,500),mk(7,10,'TOKENIZED_EQUITY'),mk(8,10,'TOKENIZED_EQUITY'),mk(9,10,'TOKENIZED_EQUITY'),mk(10,3),mk(11,3),mk(12,3),mk(13,3),mk(14,3),mk(15,3),mk(16,3)];
 const v=D.diversify(rows,10,T0);
 assert.equal(v.out.filter(r=>D.ageDays(r,T0)>D.LEGACY_DAYS).length,D.CAPS.legacy);assert.equal(v.out.filter(r=>r.kind==='TOKENIZED_EQUITY').length,D.CAPS.tokenizedEquity);
 assert.ok(v.dropped.some(x=>x.reason==='DIVERSITY_CAP_ESTABLISHED')&&v.dropped.some(x=>x.reason==='DIVERSITY_CAP_TOKENIZED_EQUITY'));
 // soft cap: when there are not enough other candidates, held-back ones fill the empty places (the list is never shrunk by a cap)
 const few=D.diversify(rows.slice(0,8),10,T0);assert.equal(few.out.length,8);assert.equal(few.dropped.length,0);assert.ok(few.out.some(r=>r.diversityBackfill));
});

// ── end-to-end discovery on a network ───────────────────────────────────────────────
test('Ethereum: WETH/USDC/DAI and a spoofed WETH never occupy the list; new real-activity tokens do, with explainable scores',async()=>{
 const specs=[
  {a:'0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',s:'WETH',price:2250,vol:2.9e9,liq:8e8,age:1500},
  {a:'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',s:'USDC',n:'USD Coin',price:1,vol:2.6e9,liq:3.7e8,age:1500,chg:0.1},
  {a:'0x6b175474e89094c44da98b954eedeac495271d0f',s:'DAI',n:'Dai',price:1,vol:2e8,liq:1.6e8,age:1500,chg:0},
  {a:addr(41),s:'WETH',n:'Fake WETH',price:0.0003,vol:5e6,liq:9e6,age:3},
  {a:addr(42),s:'NEWA',n:'New A',price:0.8,vol:3e6,liq:2.5e6,age:4,chg:35,buys:2200,sells:1900},
  {a:addr(43),s:'NEWB',n:'New B',price:1.4,vol:1.5e6,liq:1.8e6,age:12,chg:9,buys:900,sells:850},
  {a:addr(44),s:'OLDX',n:'Old X',price:3,vol:6e7,liq:9e7,age:900,chg:-2,buys:5000,sells:4800},
  {a:addr(45),s:'WASH',n:'Wash',price:0.2,vol:9e8,liq:400000,age:2,chg:5,buys:900,sells:900},
  {a:addr(46),s:'TINY',n:'Tiny',price:0.2,vol:30000,liq:900000,age:1,buys:30,sells:25}
 ];
 const out=await run('ethereum',specs);
 const syms=out.tokens.map(t=>t.symbol);
 assert.ok(!syms.includes('WETH')&&!syms.includes('USDC')&&!syms.includes('DAI'),syms.join());
 assert.ok(syms.indexOf('NEWA')<=1&&syms.indexOf('NEWB')<=2,'fresh tokens with real trades are in the top 3 beside a genuinely huge established token: '+syms.join());
 assert.ok(syms.includes('OLDX'),'large established tokens still qualify, they just do not dominate');
 const by=Object.fromEntries(out.excluded.map(x=>[x.address,x]));
 assert.equal(by['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'].reason,'WRAPPED_BASE_ASSET');
 assert.equal(by['0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'].reason,'STABLECOIN');
 assert.equal(by[addr(41)].reason,'IMPERSONATION_SUSPECT');
 assert.ok(!syms.includes('WASH'),'volume 2,000x liquidity is inconsistent');assert.ok(!syms.includes('TINY'),'below the Ethereum volume floor');
 const t=out.tokens[0];
 assert.ok(t.discovery.score>0&&t.discovery.reason.length>10&&t.discovery.components.length>=5);assert.equal(t.discovery.volumeGrowth.status,'NOT_AVAILABLE');
 assert.equal(out.engine,'arcy-radar-v3');assert.equal(out.version,2,'UI contract unchanged');assert.deepEqual(out.tokens.map(x=>x.rank),out.tokens.map((_,i)=>i+1));
 assert.ok(out.tokens.every((x,i,a)=>i===0||a[i-1].discovery.score>=x.discovery.score),'ranked by Discovery Score');
 assert.equal(out.discovery.excludedCounts.WRAPPED_BASE_ASSET,1);
});
test('fewer than 10 qualifying tokens: the list is shorter, never padded',async()=>{
 const specs=[{a:addr(50),s:'ONE',vol:3e5,liq:4e5},{a:addr(51),s:'TWO',vol:2e5,liq:3e5},{a:addr(52),s:'DOWN',vol:100,liq:100}];
 const out=await run('arc',specs);
 assert.deepEqual(out.tokens.map(t=>t.symbol).sort(),['ONE','TWO']);
});
test('duplicate representations of one asset on a chain collapse to a single entry',async()=>{
 const specs=[{a:addr(60),s:'DUP',n:'Dup',vol:5e5,liq:6e5,coin:'dup-coin'},{a:addr(61),s:'DUP',n:'Dup',vol:9e5,liq:6e5},{a:addr(62),s:'REAL',vol:4e5,liq:6e5}];
 const out=await run('arc',specs);
 assert.equal(out.tokens.filter(t=>t.symbol==='DUP').length,1);assert.equal(out.tokens.find(t=>t.symbol==='DUP').address,addr(60),'the contract with CoinGecko identity evidence stays');
 assert.equal(out.excluded.find(x=>x.address===addr(61)).reason,'DUPLICATE_SYMBOL_UNVERIFIED');
});
function rpcFor(members){
 return async(u,o)=>{const body=JSON.parse(o.body);return resp(body.map(c=>{
  if(c.method==='eth_chainId')return {jsonrpc:'2.0',id:c.id,result:'0x'+(4663).toString(16)};
  if(c.method==='eth_blockNumber')return {jsonrpc:'2.0',id:c.id,result:'0x64'};
  const data=c.params[0].data,tok='0x'+data.slice(-40);
  if(data.startsWith(pons.SEL.getLaunchedToken)){
   if(c.params[0].to!==sources.PONS.factories[0]||!members.includes(tok))return {jsonrpc:'2.0',id:c.id,result:'0x'+'0'.repeat(832)};
   const w=x=>x.replace('0x','').padStart(64,'0');const words=[tok,addr(7),addr(8)].map(w);while(words.length<11)words.push('0'.repeat(64));words.push('0'.repeat(63)+'1','0'.repeat(64));
   return {jsonrpc:'2.0',id:c.id,result:'0x'+words.join('')};
  }
  return {jsonrpc:'2.0',id:c.id,result:'0x'+(5n*10n**18n).toString(16).padStart(64,'0')+(5n*10n**18n).toString(16).padStart(64,'0')+'0'.repeat(64)};
 }));};
}
test('Robinhood: a copy-cat of an official pons launch ticker is a look-alike; tokenized equities are capped; duplicate WETH is gone',async()=>{
 const OFFICIAL=addr(80),FAKE=addr(81);
 const specs=[
  {a:'0x0bd7d308f8e1639fab988df18a8011f41eacad73',s:'WETH',price:2248,vol:4e8,liq:6e7,age:30},
  {a:addr(82),s:'WETH',n:'WETH',price:2247,vol:1.5e8,liq:1.7e8,age:60},
  {a:OFFICIAL,s:'PONS',n:'Pons',price:0.24,vol:2e6,liq:5e6,age:80,chg:-4},
  {a:FAKE,s:'PONS',n:'Pons',price:0.26,vol:5e7,liq:9e6,age:1,chg:2},
  ...[1,2,3,4].map(i=>({a:addr(90+i),s:'EQ'+i,n:'Stock '+i+' • Robinhood Token',price:100+i,vol:9e6-i*1e5,liq:5e6,age:60,chg:-1})),
  {a:addr(95),s:'FRESH',n:'Fresh',price:0.01,vol:8e5,liq:6e5,age:2,chg:60,buys:1500,sells:1400},
  ...[1,2,3,4,5,6,7,8].map(i=>({a:addr(140+i),s:'FIL'+i,n:'Filler '+i,price:0.1,vol:3e5+i*1000,liq:5e5,age:20}))
 ];
 const out=await run('robinhood',specs,{rpc:rpcFor([OFFICIAL])});
 const syms=out.tokens.map(t=>t.symbol);
 assert.ok(!syms.includes('WETH'));assert.equal(syms.filter(s=>s==='PONS').length,1);assert.equal(out.tokens.find(t=>t.symbol==='PONS').address,OFFICIAL);
 assert.equal(out.excluded.find(x=>x.address===FAKE).reason,'UNVERIFIED_LOOKALIKE');
 assert.equal(out.excluded.find(x=>x.address===addr(82)).reason,'WRAPPED_BASE_ASSET','second WETH has a price consistent with the official WETH reference');
 assert.ok(out.tokens.filter(t=>t.discovery.kind==='TOKENIZED_EQUITY').length<=2);
 assert.ok(syms.includes('FRESH'));
});
test('Robinhood without a working RPC still ranks; the look-alike check just reports it could not run',async()=>{
 const out=await run('robinhood',[{a:addr(100),s:'AAA',vol:5e5,liq:6e5}],{rpc:async()=>({ok:false,status:500,headers:new Headers(),text:async()=>''})});
 assert.equal(out.tokens.length,1);assert.match(out.coverage.ponsLookalikeCheck,/PONS_MEMBERSHIP_UNAVAILABLE/);
});
test('Pons: only factory-confirmed launches are ranked — a PONS-ticker impostor with huge volume is not',async()=>{
 const OFFICIAL=addr(110),FAKE=addr(111);
 const specs=[{a:FAKE,s:'PONS',n:'Pons',vol:5e7,liq:9e6,age:1},{a:OFFICIAL,s:'PONS',n:'Pons',vol:2e5,liq:3e5,age:20},{a:addr(112),s:'NEWL',n:'New Launch',vol:6e4,liq:9e4,age:1,buys:300,sells:250},{a:addr(113),s:'NOTL',vol:4e6,liq:2e6}];
 const out=await run('pons',specs,{rpc:rpcFor([OFFICIAL,addr(112)])});
 assert.deepEqual(out.tokens.map(t=>t.address).sort(),[OFFICIAL,addr(112)].sort());
 assert.ok(out.tokens.every(t=>t.launch.status==='ONCHAIN_VERIFIED'&&t.graduation));
 assert.equal(out.tokens[0].address,addr(112),'the fresh launch with real trades ranks first');
 assert.equal(out.discovery.excludedCounts.NOT_FACTORY_LAUNCH,2);
});
test('Pons: zero confirmed candidates is reported honestly with the number checked',async()=>{
 const out=await run('pons',[{a:addr(120),s:'AAA'},{a:addr(121),s:'BBB'}],{rpc:rpcFor([])});
 assert.equal(out.tokens.length,0);assert.equal(out.coverage.ponsChecked,2);assert.equal(out.coverage.ponsConfirmed,0);
});
test('quota: a full uncached refresh of all four sections stays inside the Demo plan arithmetic (13 provider credits)',async()=>{
 const specs=[{a:addr(130),s:'AAA',vol:5e5,liq:6e5}];
 const mk=net=>router([[/tokens\/multi/,()=>resp(multi(net,specs))],[/coingecko\.com/,()=>resp(page(net,specs))],[/rpc\.example/,rpcFor([addr(130)])]]);
 let credits=0;const shared=router([[/tokens\/multi/,(u)=>{credits++;return resp(multi('arc',specs));}],[/coingecko\.com/,(u)=>{credits++;return resp(page(/networks\/eth\//.test(u)?'ethereum':/networks\/arc\//.test(u)?'arc':'robinhood',specs));}],[/rpc\.example/,rpcFor([addr(130)])]]);
 for(const n of ['arc','ethereum','robinhood','pons'])await radar.load(n,{env:ENV,fetcher:shared,now:()=>T0,rpcUrl:'https://rpc.example/'});
 assert.equal(credits,sources.demoBudget(3600e3).callsPerCycle);
 const before=credits;for(const n of ['arc','ethereum','robinhood','pons'])await radar.load(n,{env:ENV,fetcher:shared,now:()=>T0+30*60000,rpcUrl:'https://rpc.example/'});
 assert.equal(credits,before,'second pass inside the TTL costs nothing');
});
