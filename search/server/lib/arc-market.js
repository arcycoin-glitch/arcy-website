'use strict';
module.exports={
 parse(body,address){return require('./gecko-market').parseMarket(body,'arc',address.toLowerCase()).fields},
 // Use the same approved, exact-contract DEX adapter as Ethereum and
 // Robinhood. This path does not fall back to GeckoTerminal.
 async inspect(address){return require('./dex-market').inspect('arc',address)}
};
