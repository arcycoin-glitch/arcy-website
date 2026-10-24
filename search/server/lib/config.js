'use strict';
const NETWORKS=Object.freeze({ethereum:Object.freeze({chainId:1,name:'Ethereum Mainnet',rpcEnvironmentKey:'ETH_RPC_URL',dexChain:'ethereum',enabled:true}),arc:Object.freeze({chainId:5042,name:'Arc',enabled:false})});
module.exports={NETWORKS,DEFAULT_NETWORK:'ethereum',READ_ONLY:true};
