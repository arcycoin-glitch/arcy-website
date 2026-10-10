'use strict';

// Network identity must be explicit and part of every durable storage/cache key.
// This module is intentionally not connected to production request routing until
// all five research cards and the holder worker are chain-aware.
const NETWORKS = Object.freeze({
  arc: Object.freeze({
    id: 'arc', chainId: 5042, label: 'Arc', dexScreener: 'arc',
    geckoTerminal: 'arc', coinGeckoPlatform: 'arc',
    envRpc: 'ARC_RPC_URL', defaultRpc: 'https://rpc.mainnet.arc.io',
    explorer: 'https://explorer.arc.io'
  }),
  ethereum: Object.freeze({
    id: 'ethereum', chainId: 1, label: 'Ethereum', dexScreener: 'ethereum',
    geckoTerminal: 'eth', coinGeckoPlatform: 'ethereum',
    envRpc: 'ETH_RPC_URL', defaultRpc: null,
    explorer: 'https://etherscan.io'
  })
});

function network(input) {
  if (input === undefined || input === null || input === '') return NETWORKS.arc;
  const key = String(input).toLowerCase().trim();
  if (key === 'arc' || key === '5042') return NETWORKS.arc;
  if (key === 'ethereum' || key === 'eth' || key === '1') return NETWORKS.ethereum;
  throw Object.assign(new Error('Unsupported chain'), { code: 'UNSUPPORTED_CHAIN' });
}

function identity(chain, address) {
  const n = network(chain);
  if (typeof address !== 'string' || !/^0x[0-9a-f]{40}$/i.test(address)) {
    throw Object.assign(new Error('Exact ERC-20 address required'), { code: 'INVALID_TOKEN_ADDRESS' });
  }
  const normalized = address.toLowerCase();
  return { network: n, address: normalized, key: `${n.chainId}:${normalized}` };
}

function rpcUrl(chain, env = process.env) {
  const n = network(chain), value = env[n.envRpc] || n.defaultRpc;
  if (!value) throw Object.assign(new Error('RPC is not configured for the selected chain'), { code: 'CHAIN_RPC_NOT_CONFIGURED' });
  let url;
  try { url = new URL(value); } catch { throw Object.assign(new Error('Invalid RPC endpoint'), { code: 'CHAIN_RPC_INVALID' }); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
    throw Object.assign(new Error('Invalid RPC endpoint'), { code: 'CHAIN_RPC_INVALID' });
  }
  return value;
}

module.exports = { NETWORKS, network, identity, rpcUrl };
