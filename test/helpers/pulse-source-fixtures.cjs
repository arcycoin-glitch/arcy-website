'use strict';
// Valid dated, explicitly historical research fixtures for every configured
// research-article source. Empty HTML would be a parse failure, not a quiet week.
const pulse=require('../../lib/pulse-edition');
const ARC_BLOG=pulse.SOURCES.find(s=>s.type==='arc-blog');
const RESEARCH=pulse.SOURCES.filter(s=>s.type==='research-article');
function completeSources(handler){return async(url,options)=>{
 const index=RESEARCH.findIndex(s=>s.url===String(url));
 if(index>=0)return {ok:true,status:200,text:async()=>'<script type="application/ld+json">'+JSON.stringify({'@type':'Article',headline:'Historical Arc research fixture '+index,datePublished:'2026-09-01T00:00:00Z'})+'</script>'};
 return handler(String(url),options);
};}
module.exports={ARC_BLOG,RESEARCH,completeSources};
