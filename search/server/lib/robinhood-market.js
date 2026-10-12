'use strict';
module.exports={
 parse(body,address){return require('./gecko-market').parseMarket(body,'robinhood',address.toLowerCase()).fields},
 async inspect(){return require('./market-pending').fields()}
};
