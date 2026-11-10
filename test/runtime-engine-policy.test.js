'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../package.json');

test('Vercel runtime stays on configured Node 24 while retaining Node 22 compatibility', () => {
  // Vercel selects the latest matching engines.node runtime, which overrides
  // the project setting. Keep the Node 26 runtime out until its DEP0169 warning
  // source is resolved.
  assert.equal(pkg.engines.node, '>=22 <25');
});
