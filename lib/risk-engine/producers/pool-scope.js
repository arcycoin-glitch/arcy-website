'use strict';
// Where the reviewed pool producer may run, without loading the producer itself. Kept separate so request-path code
// (capability matrix, Search) never bundles producer code: the Vercel build of api/search failed when pool.js became
// reachable from it (bisected on #234; the build log is not accessible from this session).
const v2=require('../../liquidity-exit-v2');
const ANCHOR_NETWORKS=Object.freeze(['ethereum']);
const supported=network=>ANCHOR_NETWORKS.includes(network)&&v2.protocols(network).length>0;
module.exports={ANCHOR_NETWORKS,supported};
