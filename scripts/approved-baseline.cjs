'use strict';
// Approved-baseline fingerprints for the preservation regression tests
// (test/search-v3-data.test.js). Replaces `git show 7c1faf7:<file>`, which only
// worked when a commit from an unmerged branch happened to be in the clone.
//
//   node scripts/approved-baseline.cjs            # print current fingerprints
//   node scripts/approved-baseline.cjs --write    # refresh test/fixtures/approved-baseline.json
//
// --write is a deliberate review action: run it ONLY in the same reviewed PR as
// an approved change to a protected file. The PR26 section (taken once from
// commit 7c1faf7) is never recomputed.
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const PROTECTED_FILES = Object.freeze(['index.html', 'premium.css', 'api/unlocks.js', 'api/pulse.js', 'scripts/holder-worker.cjs']);
const normalize = text => String(text).replace(/\r\n/g, '\n');
const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
const withoutScripts = html => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
function mechanicsSections(source) {
  const s = normalize(source);
  return {
    validateSource: s.slice(s.indexOf('function validateSource('), s.indexOf('async function sourceFor(')),
    enrich: s.slice(s.indexOf('async function enrich('))
  };
}
function compute(root = path.resolve(__dirname, '..')) {
  const read = p => normalize(fs.readFileSync(path.join(root, p), 'utf8'));
  const sections = mechanicsSections(read('search/server/lib/mechanics-deep.js'));
  return {
    files: Object.fromEntries(PROTECTED_FILES.map(p => [p, sha256(read(p))])),
    searchIndexWithoutScripts: sha256(withoutScripts(read('search/index.html'))),
    schema: sha256(read('search/server/schema.js')),
    mechanics: { validateSource: sha256(sections.validateSource), enrich: sha256(sections.enrich) }
  };
}
if (require.main === module) {
  const root = path.resolve(__dirname, '..'), file = path.join(root, 'test/fixtures/approved-baseline.json');
  const current = compute(root);
  if (process.argv.includes('--write')) {
    const prior = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...prior, current, refreshedAt: new Date().toISOString() }, null, 2) + '\n');
    console.log('updated', path.relative(root, file));
  } else console.log(JSON.stringify(current, null, 2));
}
module.exports = { PROTECTED_FILES, normalize, sha256, withoutScripts, mechanicsSections, compute };
