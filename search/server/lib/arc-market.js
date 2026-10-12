'use strict';
module.exports={
 parse(body,address){return require('./gecko-market').parseMarket(body,'arc',address.toLowerCase()).fields},
 inspect(address){return require('./gecko-market').inspect('arc',address.toLowerCase()).then(x=>x.fields)}
};
