'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const sched = require('../search/server/lib/scheduled-unlock');
const core = require('../lib/unlock-core.cjs');
const reg = require('../search/server/data/onchain-vesting.json')[0];
const NOW = Date.parse('2026-11-27T12:00:00Z');
const addr = n => '0x' + String(n).padStart(40, '0');
const field = (over = {}, ev = {}) => ({ dataState: 'DATA_FOUND', status: 'ONCHAIN_VERIFIED', value: '2026-12-02T00:00:00Z',
  evidence: [{ chainId: 1, token: reg.token, vestingContract: reg.vestingContract, eventAmount: '5000000', percentOfTotalSupply: 0.5,
    recipient: addr(1), owner: addr(2), block: '0x10', ...ev }], ...over });
const ctx = { address: reg.token };
const inspectOf = result => async () => result;

test('supply card projection: valid UNI schedule is scheduled, not executed, with caveat', () => {
  const p = sched.project(field(), ctx, NOW);
  assert.equal(p.kind, 'SCHEDULED_UNLOCK'); assert.equal(p.executed, false); assert.equal(p.revocable, true);
  assert.equal(p.allocationCategory, reg.allocationCategory); assert.match(p.caveat, /not an executed transaction/);
});
test('supply card projection: wrong token, wrong vesting contract, past date, bad amount are all rejected', () => {
  assert.equal(sched.project(field(), { address: addr(9) }, NOW), null);
  assert.equal(sched.project(field({}, { vestingContract: addr(9) }), ctx, NOW), null);
  assert.equal(sched.project(field({ value: '2026-11-01T00:00:00Z' }), ctx, NOW), null);
  assert.equal(sched.project(field({}, { eventAmount: '0' }), ctx, NOW), null);
  assert.equal(sched.project(field({ status: 'UNVERIFIED' }), ctx, NOW), null);
  assert.equal(sched.project(null, ctx, NOW), null);
});
test('calendar: verified UNI release inside 30 days becomes a scheduled project-confirmed event', async () => {
  const r = await core.onchainEvents({ now: NOW, records: [reg], inspect: inspectOf(field()) });
  assert.equal(r.events.length, 1); const e = r.events[0];
  assert.equal(e.date, '2026-12-02'); assert.equal(e.symbol, 'UNI'); assert.equal(e.amount, '5,000,000 UNI');
  assert.equal(e.verification, 'project-confirmed'); assert.equal(e.onchainSchedule.scheduled, true); assert.equal(e.onchainSchedule.executed, false);
  assert.equal(e.allocation, reg.allocationCategory);
});
test('calendar: outside the 30-day window, unverified or failing evidence yields no event', async () => {
  for (const f of [field({ value: '2027-03-02T00:00:00Z' }), field({ value: '2026-11-20T00:00:00Z' }), field({ status: 'NOT_VERIFIED' }), { dataState: 'NOT_VERIFIED', reasonCode: 'RPC' }]) {
    assert.equal((await core.onchainEvents({ now: NOW, records: [reg], inspect: inspectOf(f) })).events.length, 0);
  }
  const boom = await core.onchainEvents({ now: NOW, records: [reg], inspect: async () => { throw new Error('rpc down'); } });
  assert.equal(boom.events.length, 0); assert.equal(boom.rejected[0].status, 'onchain-evidence-unavailable');
});
test('calendar: a third-party row for the same release is dropped, a different one is kept', async () => {
  const { events } = await core.onchainEvents({ now: NOW, records: [reg], inspect: inspectOf(field()) });
  const same = { name: 'Uniswap', symbol: 'UNI', date: '2026-12-02', amount: '5000000 UNI' };
  const other = { name: 'Uniswap', symbol: 'UNI', date: '2026-12-02', amount: '1 UNI' };
  const out = core.dropOnchainDuplicates([same, other], events);
  assert.deepEqual(out, [other]);
  assert.deepEqual(core.dropOnchainDuplicates([same], []), [same]);
});
