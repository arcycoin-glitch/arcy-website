'use strict';
// Robinhood Chain on-chain token identity remains registry verified; DEX values
// are distinct SOURCE_REPORTED market observations, not Robinhood quotes.
module.exports={
 parse(body,address){return require('./gecko-market').parseMarket(body,'robinhood',address.toLowerCase()).fields},
 async inspect(address){return require('./dex-market').inspect('robinhood',address)}
};
