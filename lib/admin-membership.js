const c = require('./core'), source = require('./verified-source');

// A positive role witness is sufficient for detection, never for enumerating all authorities.
async function inspect(address, verified, block) {
  const required = [
    ['DEFAULT_ADMIN_ROLE()', [], 'bytes32'],
    ['getRoleMemberCount(bytes32)', ['bytes32'], 'uint256'],
    ['getRoleMember(bytes32,uint256)', ['bytes32', 'uint256'], 'address'],
    ['hasRole(bytes32,address)', ['bytes32', 'address'], 'bool']
  ];
  const selectors = [];
  if (verified.dataState !== 'DATA_FOUND') return null;
  for (const [signature, inputs, output] of required) {
    const fn = verified.abi?.find(f => f.type === 'function' && f.name === signature.split('(')[0] &&
      JSON.stringify(f.inputs?.map(i => i.type)) === JSON.stringify(inputs) &&
      f.outputs?.length === 1 && f.outputs[0].type === output && ['view', 'pure'].includes(f.stateMutability));
    const selector = source.selector(verified, signature);
    if (!fn || !selector) return null;
    selectors.push(selector);
  }
  try {
    const role = await c.call(address, selectors[0], block);
    if (c.uint(role) !== 0n) return c.unknown('Default admin role getter is nonstandard.', 'NONSTANDARD_ADMIN_ROLE');
    const count = c.uint(await c.call(address, selectors[1] + role.slice(2), block));
    if (count === 0n) return c.unknown('Default admin role has no members at this block; other authorities remain possible.', 'NO_DEFAULT_ADMIN_MEMBERS');
    const member = c.addressWord(await c.call(address, selectors[2] + role.slice(2) + '0'.repeat(64), block));
    if (c.BURNS.includes(member)) return c.unknown('Role enumeration returned a burn address.', 'INVALID_ADMIN_MEMBER');
    const membership = c.uint(await c.call(address, selectors[3] + role.slice(2) + member.slice(2).padStart(64, '0'), block));
    if (membership !== 1n) return c.unknown('Role enumeration and membership disagree.', 'ADMIN_MEMBERSHIP_MISMATCH');
    return {...c.fact(member, [{source: (verified.runtimeMatch==='EXPLORER_ATTESTATION'?'Explorer-attested ABI':'Bytecode-matched verified ABI')+' + Arc RPC', address, block,
      sourceDigest: verified.sourceDigest, role, memberIndex: 0, reportedMemberCount: count.toString(),
      methods: required.map(x => x[0])}], 'GETTER_REPORTED'), confidence: 'MEDIUM',
      scope: 'One contract-reported DEFAULT_ADMIN_ROLE member, cross-checked at a fixed block. Other members and token-specific permissions are not established.'};
  } catch (error) {
    return {...c.unknown('Admin role getter request failed.', 'ADMIN_MEMBERSHIP_REQUEST_FAILED', c.failure(error).dataState), failure: c.failure(error)};
  }
}
module.exports = {inspect};
