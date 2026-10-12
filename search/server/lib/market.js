'use strict';
const pending=require('./market-pending');
function parse(){return pending.fields()}
async function inspect(){return pending.card()}
function failure(){return pending.card()}
module.exports={parse,inspect,failure};
