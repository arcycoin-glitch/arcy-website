'use strict';
/**
 * Pure on-chain vesting evidence logic (no network). Used by the discovery
 * probe and the Robinhood/Arc/Ethereum adapters.
 *
 * Rules:
 *  - A schedule is ONLY derived from a recognised vesting-contract interface
 *    whose getters are decoded from eth_call results; ordinary transfers,
 *    holder balances and emissions are never unlock evidence.
 *  - The vesting contract must be bound to the canonical token: either
 *    token() === canonical (timelock) or the contract holds / has released a
 *    positive amount of the canonical token (OZ VestingWallet is multi-token).
 *  - Scheduled (what the contract says will unlock) is separate from executed
 *    (a release transaction) and from claimed/transferred.
 */
const keccak = require('./keccak');
const SEL = sig => keccak(sig).slice(0, 10);
const word = hex => hex.replace(/^0x/, '').padStart(64, '0');
const addrWord = a => word(a.toLowerCase());
const uintWord = n => BigInt(n).toString(16).padStart(64, '0');
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

const GETTERS = Object.freeze({
  start: 'start()', duration: 'duration()', end: 'end()', cliff: 'cliff()',
  releaseTime: 'releaseTime()', unlockTime: 'unlockTime()', beneficiary: 'beneficiary()',
  owner: 'owner()', token: 'token()', releasable0: 'releasable()', released0: 'released()'
});
const callData = {
  getter: name => SEL(GETTERS[name]),
  releasableToken: token => SEL('releasable(address)') + addrWord(token),
  releasedToken: token => SEL('released(address)') + addrWord(token),
  vestedAmountToken: (token, ts) => SEL('vestedAmount(address,uint64)') + addrWord(token) + uintWord(ts),
  balanceOf: holder => SEL('balanceOf(address)') + addrWord(holder)
};

function decodeUint(hex) {
  if (typeof hex !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hex)) return null;
  return BigInt(hex);
}
function decodeAddress(hex) {
  if (typeof hex !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hex)) return null;
  if (!/^0{24}/.test(hex.slice(2, 26))) return null;
  return '0x' + hex.slice(26).toLowerCase();
}
const safeTs = v => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  // sane unix seconds: 2015 .. 2150
  return Number.isSafeInteger(n) && n > 1420070400 && n < 5680000000 ? n : null;
};
const iso = ts => new Date(ts * 1000).toISOString().replace('.000Z', 'Z');

/**
 * raw = { start, duration, end, cliff, releaseTime, unlockTime, beneficiary, token : hex|null,
 *         tokenBalance: hex|null, releasedToken: hex|null, vestedAtCliff: hex|null }
 * Returns { kind, ... } or { kind:'UNRECOGNISED' }.
 */
function classify(raw, canonicalToken) {
  const canon = String(canonicalToken || '').toLowerCase();
  if (!ADDRESS.test(canon)) return { kind: 'UNRECOGNISED', reason: 'INVALID_CANONICAL_TOKEN' };
  const start = safeTs(decodeUint(raw.start)), duration = decodeUint(raw.duration);
  const cliff = safeTs(decodeUint(raw.cliff)), end = safeTs(decodeUint(raw.end));
  const releaseTime = safeTs(decodeUint(raw.releaseTime) ?? decodeUint(raw.unlockTime));
  const tokenAddr = decodeAddress(raw.token);
  const balance = decodeUint(raw.tokenBalance), released = decodeUint(raw.releasedToken);
  const beneficiary = decodeAddress(raw.beneficiary) || decodeAddress(raw.owner);

  // Single-token timelock (OZ TokenTimelock-like): token() + releaseTime()
  if (tokenAddr && releaseTime) {
    if (tokenAddr !== canon) return { kind: 'UNRECOGNISED', reason: 'TIMELOCK_TOKEN_MISMATCH' };
    if (balance === null) return { kind: 'UNRECOGNISED', reason: 'BALANCE_UNREADABLE' };
    return { kind: 'TOKEN_TIMELOCK', releaseTime, balance, beneficiary };
  }
  // OZ VestingWallet (multi-token): start() + duration(); optional cliff()
  if (start !== null && duration !== null && duration > 0n && duration < 3155760000n) {
    const funded = (balance !== null && balance > 0n) || (released !== null && released > 0n);
    if (!funded) return { kind: 'UNRECOGNISED', reason: 'NOT_FUNDED_WITH_CANONICAL_TOKEN' };
    const total = (balance || 0n) + (released || 0n);
    return {
      kind: cliff !== null ? 'VESTING_WALLET_CLIFF' : 'VESTING_WALLET',
      start, durationSeconds: Number(duration), end: end ?? start + Number(duration), cliff,
      balance: balance || 0n, released: released || 0n, total, beneficiary
    };
  }
  return { kind: 'UNRECOGNISED', reason: 'NO_RECOGNISED_VESTING_INTERFACE' };
}

/**
 * Derive discrete / linear schedule facts for a classified contract.
 * Never fabricates: a linear in-progress vest yields a window, not a "next unlock".
 */
function schedule(cls, now = Date.now(), vestedAtCliff = null) {
  const nowS = Math.floor(now / 1000);
  if (cls.kind === 'TOKEN_TIMELOCK') {
    return cls.releaseTime > nowS
      ? { scheduleType: 'CLIFF', next: { date: iso(cls.releaseTime), amount: cls.balance.toString(), unit: 'raw', basis: 'timelock balance' } }
      : { scheduleType: 'CLIFF', next: null, state: 'RELEASE_TIME_PASSED' };
  }
  if (cls.kind === 'VESTING_WALLET' || cls.kind === 'VESTING_WALLET_CLIFF') {
    const window = { startsAt: iso(cls.start), endsAt: iso(cls.end), total: cls.total.toString(), remaining: cls.balance.toString(), released: cls.released.toString() };
    if (cls.kind === 'VESTING_WALLET_CLIFF' && cls.cliff > nowS) {
      const at = decodeUint(vestedAtCliff);
      return {
        scheduleType: 'CLIFF_THEN_LINEAR', window,
        next: at !== null && at > 0n ? { date: iso(cls.cliff), amount: at.toString(), unit: 'raw', basis: 'vestedAmount(token, cliff)' } : null
      };
    }
    if (cls.start > nowS) return { scheduleType: 'LINEAR', window, next: null, state: 'NOT_STARTED' };
    if (cls.end <= nowS) return { scheduleType: 'LINEAR', window, next: null, state: 'FULLY_VESTED' };
    return { scheduleType: 'LINEAR', window, next: null, state: 'IN_PROGRESS_CONTINUOUS' };
  }
  return { scheduleType: null, next: null, state: 'UNRECOGNISED' };
}

/** Percent of total supply with BigInt precision (2 decimals); null if unknowable. */
function percentOfSupply(amountRaw, totalSupplyRaw) {
  try {
    const a = BigInt(amountRaw), s = BigInt(totalSupplyRaw);
    if (s <= 0n || a < 0n) return null;
    const bp = (a * 10000n) / s;
    return Number(bp) / 100;
  } catch { return null; }
}

module.exports = { SEL, GETTERS, callData, decodeUint, decodeAddress, classify, schedule, percentOfSupply, safeTs, iso, ADDRESS };
