const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');

const base = () => process.env.ARC_UNLOCK_EDITION_DIR || path.join(process.env.ARC_HOLDER_PUBLISHED_DIR || path.join(__dirname, '../data/holder-snapshots'), 'unlock-editions');
const latestFile = () => path.join(base(), 'latest.json');
const auditFile = () => path.join(base(), 'audit.json');
const key = () => process.env.ARC_UNLOCK_SIGNING_KEY || process.env.ARC_HOLDER_SIGNING_KEY;
const publicKey = () => process.env.ARC_UNLOCK_PUBLIC_KEY || process.env.ARC_HOLDER_PUBLIC_KEY || (key() ? crypto.createPublicKey(key()) : null);

function valid(value) {
  return !!(value && value.schemaVersion === 1 && value.success === true && typeof value.generatedAt === 'string' && typeof value.refreshAt === 'string' && Array.isArray(value.events) && value.windows && ['today', 'next7', 'days8to30'].every(name => Array.isArray(value.windows[name])) && value.events.every(event => typeof event.name === 'string' && typeof event.symbol === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(event.date) && typeof event.sourceUrl === 'string'));
}
function envelope(edition) { const payload = JSON.stringify(edition), signing = key(); return signing ? { payload, signature: crypto.sign(null, Buffer.from(payload), signing).toString('base64') } : { payload }; }
function unpack(data) { try { if (!data?.payload) return null; const verify = publicKey(); if (data.signature && (!verify || !crypto.verify(null, Buffer.from(data.payload), verify, Buffer.from(data.signature, 'base64')))) return null; const edition = JSON.parse(data.payload); return valid(edition) ? edition : null; } catch { return null; } }
async function read(file) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; } }
async function write(file, data) { await fs.mkdir(base(), { recursive: true }); const temp = file + '.' + crypto.randomUUID() + '.tmp'; await fs.writeFile(temp, JSON.stringify(data)); await fs.rename(temp, file); }
async function latest() { return unpack(await read(latestFile())); }
async function audit() { return read(auditFile()); }
async function publish(edition) {
  if (!valid(edition)) throw Object.assign(Error('INVALID_UNLOCK_EDITION'), { code: 'INVALID_UNLOCK_EDITION' });
  const oldEnvelope = await read(latestFile()), signed = envelope(edition);
  try { await write(latestFile(), signed); const prior = await audit(); await write(auditFile(), { lastSuccessful: { generatedAt: edition.generatedAt, refreshAt: edition.refreshAt, trigger: edition.trigger, eventCount: edition.events.length, partial: edition.partial }, lastFailure: prior?.lastFailure || null }); return edition; }
  catch (error) { try { if (oldEnvelope) await write(latestFile(), oldEnvelope); else await fs.unlink(latestFile()); } catch {} throw error; }
}
async function failure(error, now = Date.now(), trigger = 'worker') { const prior = await audit(); await write(auditFile(), { lastSuccessful: prior?.lastSuccessful || null, lastFailure: { status: 'failed', at: new Date(now).toISOString(), trigger, code: error?.code || 'UNLOCK_REFRESH_FAILED' } }); }
async function due(now = Date.now()) { const current = await latest(); return !current || !Number.isFinite(Date.parse(current.refreshAt)) || Date.parse(current.refreshAt) <= now; }

module.exports = { base, latest, audit, publish, failure, due, unpack, valid };
