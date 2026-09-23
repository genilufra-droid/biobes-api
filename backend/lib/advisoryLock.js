'use strict';
/* lib/advisoryLock.js — dryer i vetëm për punë që nuk duhet të ecin dy herë njëkohësisht.
 *
 * Rasti real: backup-i ditor automatik niset nga 20 pajisje (ose nga dy instance të
 * Render-it) në të njëjtën minutë → dy backup-e të njëjta, ose më keq, dy写入 të
 * njëkohshme që mbishkruajnë njëra-tjetrën. Me pg_advisory_xact_lock vetëm njëri
 * transaksion e merr dryerin; tjetri pret (ose dështon menjëherë me try-lock).
 *
 *   const { withAdvisoryLock, tryAdvisoryLock } = require('./lib/advisoryLock');
 *   await withCompany(ctx, (client) => withAdvisoryLock(client, 'backup:' + ctx.companyId, async () => {
 *     ... krijo backup-in ...
 *   }));
 */
const crypto = require('node:crypto');

/* Çelësi tekst → dy numra 32-bit (pg_advisory_lock merr bigint ose dy int). */
function keyParts(key) {
  const h = crypto.createHash('sha256').update(String(key)).digest();
  return [h.readInt32BE(0), h.readInt32BE(4)];
}

/* Bllokim që jeton sa transaksioni (lirohet automatikisht në COMMIT/ROLLBACK). */
async function withAdvisoryLock(client, key, fn) {
  const [a, b] = keyParts(key);
  await client.query('SELECT pg_advisory_xact_lock($1, $2)', [a, b]);
  return await fn();
}

/* Provë pa pritje: kthen true nëse dryeri u mor (përsëri brenda transaksionit). */
async function tryAdvisoryLock(client, key) {
  const [a, b] = keyParts(key);
  const r = await client.query('SELECT pg_try_advisory_xact_lock($1, $2) AS ok', [a, b]);
  return !!(r.rows[0] && r.rows[0].ok);
}

/* Bllokim në nivel lidhjeje (jashtë transaksionit) — përdoret rrallë, p.sh. për
 * pastrime të gjata. Çlirohet në fund me unlock; nëse lidhja mbyllet, lirohet vetë. */
async function withSessionLock(pool, key, fn) {
  const client = await pool.connect();
  const [a, b] = keyParts(key);
  try {
    await client.query('SELECT pg_advisory_lock($1, $2)', [a, b]);
    return await fn(client);
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1, $2)', [a, b]); } catch (_) {}
    client.release();
  }
}

/* Ndihmës për rrugët API: nëse dryeri është i zënë → 409 me mesazh shqip (jo pritje e gjatë). */
async function runExclusive(client, key, fn, busyMessage) {
  const got = await tryAdvisoryLock(client, key);
  if (!got) {
    throw Object.assign(new Error(busyMessage || 'Një operacion i njëjtë është duke u kryer — provo pas pak'), { status: 409, busy: true });
  }
  return await fn();
}

module.exports = { withAdvisoryLock, tryAdvisoryLock, withSessionLock, runExclusive, keyParts };
