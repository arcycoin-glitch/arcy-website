const c=require('../lib/core'),f=require('../lib/fields');module.exports=c.route(a=>f.cached('activity:'+a,60000,()=>require('../lib/market-activity').read(a)));
