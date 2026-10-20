const crypto=require('node:crypto'),client=require('../lib/pulse-client'),edition=require('../lib/pulse-edition'),fallback=require('../lib/pulse-display-fallback');
function authorized(req){const secret=process.env.CRON_SECRET,provided=Buffer.from(req.headers?.authorization||''),expected=Buffer.from(secret?'Bearer '+secret:'');return !!secret&&provided.length===expected.length&&crypto.timingSafeEqual(provided,expected);}
function cronRequest(req){return req.headers?.['x-vercel-cron']==='1'||/vercel-cron/i.test(req.headers?.['user-agent']||'');}
function threeSections(raw,{status='updated',cycle=null}={}){
 // The signed weekly publisher still owns its existing stored edition.
 // Current homepage only: three informative, non-repeating editorial slots.
 const items=Array.isArray(raw)?raw:[];
 const defaults=fallback.ITEMS;
 const valid=item=>{
  if(status==='quiet_week'||item?.verifiedCurrentWeek===false)return false;
  if(!item||typeof item.title!=='string'||!item.title.trim()||
   typeof item.summary!=='string'||!item.summary.trim()||
   typeof item.url!=='string'||!/^https:\/\//i.test(item.url))return false;
  const time=Date.parse(item.publishedAt||'');
  if(!Number.isFinite(time))return false;
  const from=Date.parse(cycle?.start||''),to=Date.parse(cycle?.end||'');
  return Number.isFinite(from)&&Number.isFinite(to)&&time>=from&&time<to;
 };
 const source=items.filter(valid),used=new Set();
 const choose=(kinds,slot)=>{
  const item=source.find(x=>kinds.includes(x.kind)&&!used.has(x.url));
  if(!item)return {...defaults[slot],publishedAt:null,verifiedCurrentWeek:false,contentType:'SOURCE_GUIDE'};
  used.add(item.url);
  return {...item,kind:defaults[slot].kind,verifiedCurrentWeek:true,contentType:'VERIFIED_DEVELOPMENT'};
 };
 return [choose(['week'],0),choose(['new','watch'],1),choose(['unlock','reality'],2)];
}
function response(value,audit,{archive=false}={}){
 const previousWeek=Array.isArray(value.recentCards)?value.recentCards.filter(item=>item?.contentType==='RECENT_VERIFIED'&&item?.verifiedCurrentWeek===false&&typeof item.url==='string'&&item.url.startsWith('https://')&&Number.isFinite(Date.parse(item.publishedAt))&&Date.parse(item.publishedAt)>=Date.parse(value.cycle?.start||'')-604800000&&Date.parse(item.publishedAt)<Date.parse(value.cycle?.start||'')):[];
 const recentDisplay=previousWeek.slice(0,3).map((item,index)=>({...item,owner:'PREVIOUS WEEK · '+item.owner,kind:['week','new','unlock'][index],verifiedCurrentWeek:false,contentType:'RECENT_VERIFIED'}));
 // The existing three-card layout is a product contract. A reviewed primary
 // Circle source supplies category #3 only for its actual publication week.
 const review={
  owner:'PREVIOUS WEEK · OFFICIAL CIRCLE',kind:'unlock',
  title:'Institutional wrapped assets: custody, reserves and redemption',
  summary:'Published 13 Oct 2026 · Circle outlines seven due-diligence dimensions for wrapped assets, including cirBTC on Arc. Verify custody, reserve evidence and redemption rather than assuming BTC backing means zero risk.',
  url:'https://www.circle.com/blog/what-makes-a-wrapped-asset-institutional-grade',
  linkLabel:'READ DATED SOURCE ↗',publishedAt:'2026-10-13T00:00:00.000Z',
  verifiedCurrentWeek:false,contentType:'RECENT_VERIFIED'
 };
 const recentThree=[...recentDisplay];
 const weekStart=Date.parse(value.cycle?.start||'');
 if(!archive&&recentThree.length>0&&recentThree.length<3&&
   weekStart===Date.parse('2026-10-19T00:00:00.000Z')&&
   !recentThree.some(x=>x.url===review.url))recentThree.push(review);
 const display=archive?value.cards:recentThree.length&&value.status==='quiet_week'?
   [...recentThree,...fallback.ITEMS.slice(recentThree.length).map(x=>({...x,publishedAt:null,verifiedCurrentWeek:false,contentType:'SOURCE_GUIDE'}))].slice(0,3):
   threeSections(value.cards,{status:value.status,cycle:value.cycle});
 const neutralTake=fallback.fallback().take;
 const hasBitquery=display.some(c=>c.url?.includes('bitquery.io/investigations/arc-blockchain-first-month'));
 const hasGateway=display.some(c=>c.url?.includes('community.arc.io/public/videos/move-supported-non-usdc'));
 const editorial=hasBitquery?
  'Bitquery’nin 15 Ekim araştırmasında Arc’ın günlük aktif cüzdan sayısı ilk gündeki 406.006 seviyesinden dördüncü hafta ortalaması 24.678’e geriliyor. Bu rakamlar kişi sayısı değil, işlem gönderen adreslerdir. Aynı araştırmada cirBTC teminatlı USDC borçlanması yaklaşık 190 milyon dolara ulaşıyor. '+(hasGateway?'Arc House’un Fast Gateway Deposits güncellemesi ise çapraz zincir USDC fonlamasında kesinleşme süresini azaltmaya odaklanıyor. ':'')+'ARCY’nin izlemesi gereken şey yalnızca fon akışı değil; bağımsız kullanıcı aktivitesi, gerçek likidite ve borç alınan USDC’nin nereye gittiğidir. Bu tespitler kaynak raporlarına dayanır; ARCY tarafından bağımsız on-chain yeniden hesaplama yapıldığı anlamına gelmez.':
  display.some(c=>c.contentType==='RECENT_VERIFIED')?
   'Önceki haftanın resmî kaynakları Arc üzerindeki ödeme ve entegrasyon altyapısındaki ilerlemeyi gösteriyor. Ancak geliştirici duyuruları tek başına kalıcı kullanıcı talebi veya gerçek likidite artışının kanıtı değildir.':'';


 return {ok:true,number:value.number,status:value.status,generatedAt:value.generatedAt,
  isCurrentWeekResearch:display.some(card=>card.verifiedCurrentWeek===true),
  hasRecentVerifiedResearch:display.some(card=>card.contentType==='RECENT_VERIFIED'),
  contentNotice:display.some(card=>card.verifiedCurrentWeek===true)?
   'Current-week articles have dated source evidence; remaining cards may be source guides.':
   display.some(card=>card.contentType==='RECENT_VERIFIED')?'No current-week developments verified yet. These are dated reports from the previous week, not new announcements.':
   'No dated current-week research is verified. Source guides are not news or evidence of activity.',
  cycle:value.cycle,cards:display,
  take:archive?value.take:(value.status==='updated'&&display.some(c=>c.verifiedCurrentWeek===true)?value.take||neutralTake:editorial||neutralTake),
  sources:value.sources,
  audit:{...value.audit,lastSuccessful:audit?.lastSuccessful||{
   number:value.number,status:value.status,generatedAt:value.generatedAt,trigger:value.trigger
  },lastFailure:audit?.lastFailure||null,nextScheduledAt:edition.nextRun()}};
}
const transientWeeks=new Map();
async function currentTransient(now){
 const cycle=edition.cycle(now);
 let state=transientWeeks.get(cycle.start);
 if(!state){state={};transientWeeks.set(cycle.start,state);while(transientWeeks.size>2)transientWeeks.delete(transientWeeks.keys().next().value);}
 if(state.cache&&state.cache.expiresAt>now)return state.cache.value;
 if(!state.promise){
  state.promise=(async()=>{
   const controller=new AbortController();let timer;
   try{
    const value=await Promise.race([
     edition.generate({now,fetcher:(url,options={})=>fetch(url,{...options,signal:options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal}),trigger:'transient'}),
     new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Object.assign(Error('timeout'),{code:'PULSE_TRANSIENT_TIMEOUT'}));},8500);})
    ]);
    return value;
   }catch(error){return fallback.fallback(now,{reasonCode:error.code||'PULSE_SOURCE_CHECK_UNAVAILABLE'});}
   finally{clearTimeout(timer);}
  })().finally(()=>{state.promise=null;});
 }
 const value=await state.promise;
 state.cache={expiresAt:now+(value.status==='updated'?900000:180000),value};
 return value;
}
function preserveAudit(value,saved,audit){
 return {...value,audit:{...value.audit,lastSuccessful:audit?.lastSuccessful||value.audit?.lastSuccessful||(saved?{number:saved.number,status:saved.status,generatedAt:saved.generatedAt,trigger:saved.trigger}:null),lastFailure:audit?.lastFailure||value.audit?.lastFailure||null}};
}
async function handler(req,res){
 res.setHeader('Cache-Control','no-store');const scheduled=cronRequest(req),manual=req.method==='POST'||req.query?.action==='refresh',auditOnly=req.query?.action==='audit';
 if(req.method==='GET'&&req.query?.action==='edition'){const number=Number(req.query.number);if(!Number.isSafeInteger(number)||number<1||number>9999)return res.status(400).json({ok:false,error:'INVALID_EDITION'});const saved=await client.edition(number);return saved?res.status(200).json(response(saved,null,{archive:true})):res.status(404).json({ok:false,error:'EDITION_NOT_FOUND',number});}
 if(scheduled||manual||auditOnly){if(!authorized(req))return res.status(401).json({ok:false,error:'Unauthorized'});if(auditOnly){const audit=await client.audit();return res.status(audit?200:503).json(audit?{ok:true,...audit,nextScheduledAt:edition.nextRun()}:{ok:false,reasonCode:'PULSE_WORKER_UNAVAILABLE'});}const refreshed=await client.refresh(scheduled?'cron':'manual');if(!refreshed.ok||!refreshed.edition)return res.status(503).json({ok:false,reasonCode:refreshed.reasonCode||'PULSE_REFRESH_FAILED'});return res.status(200).json(response(refreshed.edition,await client.audit()));}
 const now=Date.now();
 const saved=await client.latest();
 // An older verified edition belongs to its original cycle; never relabel
 // archived developments as new news for the current Monday-to-Monday cycle.
 if(saved){
  const week=edition.cycle(now),start=Date.parse(saved.cycle?.start||'');
  // The authenticated publication validator rejects malformed editions in
  // production. Preserve the historical saved-read contract for older mocks
  // and legacy signed documents that did not publish cycle.start.
  if(!saved.cycle?.start||start===week.start)
   {if(saved.status==='quiet_week'){
    const checked=await currentTransient(now);
    if(checked.status==='updated'||checked.recentCards?.length)return res.status(200).json(response(checked,null));
   }
   return res.status(200).json(response(saved,await client.audit()));}
  const latest=await currentTransient(now);
  const audit=await client.audit();
  return res.status(200).json(preserveAudit(latest.status==='updated'||latest.recentCards?.length?response(latest,null):latest,saved,audit));
 }
 // Even with provider outages, visitors receive three useful source-led
 // sections and ARCY Take; no headlines are forged or recycled as current.
 const current=await currentTransient(now);
 return res.status(200).json(current.status==='updated'||current.recentCards?.length?response(current,null):current);
}
module.exports=handler;
module.exports.threeSections=threeSections;
