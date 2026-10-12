'use strict';
module.exports={
 parse(body,address){return require('./gecko-market').parseMarket(body,'arc',address.toLowerCase()).fields},
 async inspect(){return require('./market-pending').fields()}
};
