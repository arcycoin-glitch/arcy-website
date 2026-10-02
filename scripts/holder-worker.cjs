const refresh=require('../lib/holder-refresh');
const addresses=process.argv.slice(2).map(a=>a.toLowerCase());
refresh.run({addresses:addresses.length?addresses:undefined,limit:5,budgetMs:20000}).then(r=>console.log(JSON.stringify(r,null,2))).catch(()=>{console.error('Holder worker unavailable. Check internal health and storage configuration.');process.exitCode=1;});
