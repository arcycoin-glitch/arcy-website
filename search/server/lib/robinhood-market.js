'use strict';
module.exports={
 parse(body,address){return require('./gecko-market').parseMarket(body,'robinhood',address.toLowerCase()).fields},
 inspect(address){return require('./gecko-market').inspect('robinhood',address.toLowerCase()).then(x=>x.fields)}
};
