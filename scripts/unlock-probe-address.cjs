'use strict';
// Read-only: fetch verified ABI (Blockscout v2) for ADDRS (net:addr,...) and call every zero-arg view getter.
const keccak = require('../lib/keccak');
const NET = { ethereum: { chainId: 1, rpc: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'], ex: 'https://eth.blockscout.com' }, robinhood: { chainId: 4663, rpc: ['https://rpc.mainnet.chain.robinhood.com'], ex: 'https://robinhoodchain.blockscout.com' }, arc: { chainId: 5042, rpc: ['https://rpc.mainnet.arc.io', 'https://rpc.quicknode.mainnet.arc.io'], ex: 'https://explorer.arc.io' } };
const get = async u => { try { const r = await fetch(u, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000) }); const t = await r.text(); let j = null; try { j = JSON.parse(t) } catch { } return { http: r.status, j }; } catch (e) { return { http: 0, err: e.name }; } };
async function rpc(net, method, params) { for (const u of NET[net].rpc) { try { const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(10000) }); const j = await r.json(); if (j.result !== undefined) return j.result; if (j.error) return null; } catch { } } return null; }
const typeStr = i => i.type === 'tuple' ? '(' + i.components.map(typeStr).join(',') + ')' : i.type;
(async () => {
  const out = [];
  for (const spec of (process.env.ADDRS || '').split(',').filter(Boolean)) {
    const [net, addr] = spec.split(':'); const row = { net, addr };
    const cid = await rpc(net, 'eth_chainId', []); row.chainOk = cid && Number(BigInt(cid)) === NET[net].chainId;
    const code = await rpc(net, 'eth_getCode', [addr, 'latest']); row.codeBytes = code ? (code.length - 2) / 2 : null;
    const sc = await get(`${NET[net].ex}/api/v2/smart-contracts/${addr}`); row.scHttp = sc.http; row.name = sc.j?.name || null; row.verified = !!sc.j?.abi;
    const abi = sc.j?.abi || [];
    row.fns = abi.filter(x => x.type === 'function').map(x => `${x.name}(${x.inputs.map(typeStr).join(',')})${x.stateMutability === 'view' || x.stateMutability === 'pure' ? ':v' : ''}`).slice(0, 60);
    row.impl = sc.j?.implementations?.[0]?.address_hash || sc.j?.implementation_address || null;
    row.values = {};
    for (const f of abi.filter(x => x.type === 'function' && ['view', 'pure'].includes(x.stateMutability) && x.inputs.length === 0 && x.outputs.length === 1)) {
      const data = keccak(`${f.name}()`).slice(0, 10); const r = await rpc(net, 'eth_call', [{ to: addr, data }, 'latest']);
      if (r && /^0x[0-9a-f]{64}$/i.test(r)) row.values[f.name] = f.outputs[0].type.startsWith('uint') ? BigInt(r).toString() : f.outputs[0].type === 'address' ? '0x' + r.slice(26) : r.slice(0, 20);
    }
    if (process.env.SOURCE && sc.j?.source_code) { const src = sc.j.source_code; const i = src.indexOf('function quartersPassed'); row.src = { len: src.length, files: (sc.j.additional_sources || []).length, quartersPassed: src.slice(Math.max(0, i - 200), i + 700), withdraw: src.slice(src.indexOf('function withdraw'), src.indexOf('function withdraw') + 900) }; }
    if (process.env.ALLOWANCE) { const [o, sp] = process.env.ALLOWANCE.split('>'); const data = keccak('allowance(address,address)').slice(0, 10) + o.slice(2).toLowerCase().padStart(64, '0') + sp.slice(2).toLowerCase().padStart(64, '0'); const r = await rpc(net, 'eth_call', [{ to: row.values.UNI, data }, 'latest']); row.allowance = r ? BigInt(r).toString() : null; const b = await rpc(net, 'eth_call', [{ to: row.values.UNI, data: keccak('balanceOf(address)').slice(0, 10) + o.slice(2).toLowerCase().padStart(64, '0') }, 'latest']); row.ownerBalance = b ? BigInt(b).toString() : null; const blk = await rpc(net, 'eth_getBlockByNumber', ['latest', false]); row.blockTs = blk ? parseInt(blk.timestamp, 16) : null; }
    out.push(row);
  }
  console.log(JSON.stringify(out));
  const e = s => s.replace(/%/g, '%25').replace(/\r?\n/g, '%0A');
  out.forEach(r => console.log('::notice title=probe-' + r.addr.slice(0, 10) + '::' + e(JSON.stringify(r)).slice(0, 6000)));
})();
