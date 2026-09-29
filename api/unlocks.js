const API='https://api.tokenomist.ai/v5';

function ymd(d){ return d.toISOString().slice(0,10); }
function addDays(d,n){ const x=new Date(d); x.setUTCDate(x.getUTCDate()+n); return x; }
function compact(n){
  if(!Number.isFinite(n)) return null;
  const a=Math.abs(n);
  const units=[[1e12,'T'],[1e9,'B'],[1e6,'M'],[1e3,'K']];
  for(const [v,s] of units) if(a>=v) return (n/v).toFixed(a>=10*v?1:2).replace(/\.0+$|(?<=\.[0-9])0$/,'')+s;
  return n.toLocaleString('en-US',{maximumFractionDigits:2});
}
async function getJson(url,key){
  const r=await fetch(url,{headers:{'x-api-key':key,'accept':'application/json'}});
  if(!r.ok) throw new Error(`Tokenomist ${r.status}`);
  return r.json();
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','s-maxage=21600, stale-while-revalidate=900');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  const key=process.env.TOKENOMIST_API_KEY;
  if(!key) return res.status(503).json({ok:false,code:'PROVIDER_NOT_CONFIGURED',message:'Live unlock feed is temporarily unavailable.',updatedAt:null,events:[]});

  try{
    const now=new Date();
    const start=ymd(now), end=ymd(addDays(now,30));
    let page=1, all=[], totalPages=1;
    do{
      const u=`${API}/unlock/events/upcoming?start=${start}&end=${end}&page=${page}&pageSize=100`;
      const j=await getJson(u,key);
      if(j?.status===false) throw new Error('Provider returned status=false');
      all.push(...(Array.isArray(j?.data)?j.data:[]));
      totalPages=Math.min(Number(j?.metadata?.totalPages||1),10);
      page++;
    }while(page<=totalPages);

    const ids=[...new Set(all.map(x=>x.tokenId).filter(Boolean))];
    let meta=[];
    for(let i=0;i<ids.length;i+=100){
      const j=await getJson(`${API}/token/list?tokenId=${encodeURIComponent(ids.slice(i,i+100).join(','))}`,key);
      meta.push(...(Array.isArray(j?.data)?j.data:[]));
    }
    const byId=new Map(meta.map(x=>[x.id,x]));

    const events=all.map(x=>{
      const e=x.upcomingEvent||{};
      const cliff=e.cliffUnlocks||{};
      const m=byId.get(x.tokenId)||{};
      const amount=Number(cliff.cliffAmount);
      const max=Number(m.maxSupply);
      const pct=Number.isFinite(amount)&&Number.isFinite(max)&&max>0 ? amount/max*100 : null;
      return {
        id:x.tokenId,
        name:x.tokenName||m.name||x.tokenId,
        symbol:x.tokenSymbol||m.symbol||'',
        unlockDate:e.unlockDate||null,
        amount:Number.isFinite(amount)?amount:null,
        amountText:Number.isFinite(amount)?`${compact(amount)} ${x.tokenSymbol||m.symbol||''}`.trim():null,
        supplyPct:Number.isFinite(pct)?pct:null,
        supplyPctText:Number.isFinite(pct)?`${pct.toFixed(pct<0.1?3:2).replace(/0+$/,'').replace(/\.$/,'')}%`:'—',
        sourceUrl:m.websiteUrl||`https://tokenomist.ai/${encodeURIComponent(x.tokenId||'')}`,
        dataSource:x.dataSource||null,
        latestUpdateDate:e.latestUpdateDate||m.lastUpdatedDate||null
      };
    }).filter(x=>x.unlockDate && x.amount!==null)
      .sort((a,b)=>new Date(a.unlockDate)-new Date(b.unlockDate));

    return res.status(200).json({ok:true,provider:'Tokenomist',updatedAt:new Date().toISOString(),window:{start,end},events});
  }catch(err){
    return res.status(502).json({ok:false,code:'PROVIDER_ERROR',message:'Live unlock feed is temporarily unavailable.',updatedAt:null,events:[]});
  }
}
