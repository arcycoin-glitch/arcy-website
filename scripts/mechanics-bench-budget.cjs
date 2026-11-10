'use strict';

// JSON-RPC block tags are quantity hex strings, not 32-byte ABI words. Require
// an explicit height so budgeted role reads cannot silently use `latest`.
function isPinnedBlockTag(value){
 return typeof value==='string'&&/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(value);
}

module.exports={isPinnedBlockTag};
