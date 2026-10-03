module.exports=require('../lib/search-request').route(a=>require('../lib/fields').cached('control-card:'+a,0,()=>require('../lib/control').inspect(a)));
