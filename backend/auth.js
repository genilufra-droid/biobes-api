// BioBes API — password-e scrypt, sesione në DB.
// Kujdes: scrypt është i shtrenjtë me qëllim (~70 ms). Versionet e sinkronizuara
// (crypto.scryptSync) bllokonin event loop-un e Node-it për çdo hyrje: me 20
// përdh. njëkohësisht serveri mbetej pa përgjigje për mbi një sekondë.
// Të dyja funksionet janë asinkrone (scrypt-i ekzekutohet në thread pool).
const crypto = require('crypto');
const { promisify } = require('util');
const { getPool } = require('./db');

const scryptAsync = promisify(crypto.scrypt);

const SESSION_TTL_H = +(process.env.SESSION_TTL_HOURS || 24);

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scryptAsync(String(password), salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split('$');
    if (parts[0] !== 'scrypt') return false;
    const [, N, r, p, saltHex, hashHex] = parts;
    const hash = await scryptAsync(String(password), Buffer.from(saltHex, 'hex'), 64, { N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem });
    const expected = Buffer.from(hashHex, 'hex');
    if (expected.length !== hash.length) return false;
    return crypto.timingSafeEqual(hash, expected);
  } catch { return false; }
}

async function ensureAdmin() {
  const p = getPool();
  if (!p) return;
  const { rows } = await p.query('SELECT COUNT(*)::int AS c FROM users');
  if (rows[0].c > 0) return;
  const pass = process.env.ADMIN_PASSWORD;
  if (!pass) { console.log('[auth] Nuk ka përdorues dhe ADMIN_PASSWORD mungon — vendoseni si env var në Render.'); return; }
  if (pass.length < 8) { console.log('[auth] ADMIN_PASSWORD shumë i shkurtër (min 8 karaktere) — admini NUK u krijua.'); return; }
  const username = process.env.ADMIN_USERNAME || 'admin';
  await p.query(
    `INSERT INTO users(id,username,name,role,password_hash,is_superadmin)
     VALUES('USR-ADMIN',$1,'Administrator','ROLE-ADMIN',$2,TRUE)`,
    [username, await hashPassword(pass)]
  );
  // Në skemën Odoo të qasjes: admini fillestar futet edhe në grupin Administrator.
  try {
    await p.query(
      `INSERT INTO user_groups(user_id,group_id) VALUES('USR-ADMIN','GRP-SET-ADMIN') ON CONFLICT DO NOTHING`);
  } catch (e) { console.error('[auth] grup admin:', e.message); }
  console.log(`[auth] U krijua admini fillestar "${username}".`);
}

// Formon objektin e përdoruesit që i kthehet klientit (me is_superuser sipas rolit).
function toClientUser(u) {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role,
    email: u.email || '',
    rights: u.rights || null,
    active: !!u.active,
    is_superuser: u.role === 'ROLE-ADMIN' || !!u.is_superadmin,
    is_superadmin: !!u.is_superadmin,
  };
}

async function loginUser(username, password) {
  const p = getPool();
  const { rows } = await p.query('SELECT * FROM users WHERE username=$1 AND active=TRUE', [String(username || '').trim()]);
  const u = rows[0];
  if (!u || !(await verifyPassword(password, u.password_hash))) return null;
  const token = crypto.randomBytes(32).toString('hex');
  const th = crypto.createHash('sha256').update(token).digest('hex');
  await p.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+($3||\' hours\')::interval)',
    [th, u.id, String(SESSION_TTL_H)]);
  // Modulet që sheh përdoruesi (null = gjithçka për superuser), për frontend-in.
  let modules = null;
  try {
    const { stateModules } = require('./access');
    modules = await stateModules(u.id, p);
  } catch (e) { console.error('[auth] module scope:', e.message); }
  return { token, user: toClientUser(u), modules };
}

async function userFromToken(token) {
  if (!token) return null;
  const p = getPool();
  if (!p) return null;
  const th = crypto.createHash('sha256').update(String(token)).digest('hex');
  const find = () => p.query(
    `SELECT u.id,u.username,u.name,u.role,u.rights,u.email,u.is_superadmin,u.active
     FROM sessions s JOIN users u ON u.id=s.user_id
     WHERE s.token_hash=$1 AND s.expires_at>NOW() AND u.active=TRUE`, [th]);
  let { rows } = await find();
  // Një lexim bosh për një token me format të vlefshëm është dyshim: ose sesioni
  // s'është shkruar ende te nyja që lexojmë (replikë/failover), ose lidhja sapo
  // është ricikluar. Pa këtë riprovë të vetme, përdoruesi del jashtë kot —
  // ndaj e provojmë edhe një herë dhe e shënojmë në log nëse ndodh shpesh.
  if (!rows.length && th.length === 64) {
    ({ rows } = await find());
    if (rows.length) console.warn('[auth] sesioni u gjet vetëm në riprovë — kontrollo shëndetin e databazës');
  }
  return rows[0] || null;
}

// Grupet efektive të një përdoruesi (përfshirë implikimet) — për admin/përgjigje.
async function groupsForUser(userId, pool, companyId) {
  try {
    const { resolveGroups } = require('./access');
    const p = pool || getPool();
    const ids = await resolveGroups(userId, p, companyId);
    const { rows } = await p.query('SELECT id, name, full_name, module_id FROM access_groups WHERE id = ANY($1::text[]) ORDER BY full_name', [Array.from(ids)]);
    return rows;
  } catch (e) { console.error('[auth] groupsForUser:', e.message); return []; }
}

async function logoutToken(token) {
  const p = getPool();
  if (!p || !token) return;
  await p.query('DELETE FROM sessions WHERE token_hash=$1',
    [crypto.createHash('sha256').update(String(token)).digest('hex')]);
}

// Kufizuesi i kërkesave jeton në ratelimit.js (kujtesë ose databazë sipas
// MULTI_INSTANCE). Eksportohet këtu vetëm për përputhshmëri me kodin e vjetër.
const ratelimit = require('./ratelimit');
const rateLimit = ratelimit.rateLimit;
// (trupi i kufizuesit u zhvendos në ratelimit.js)

module.exports = { hashPassword, verifyPassword, ensureAdmin, loginUser, userFromToken, logoutToken, rateLimit, toClientUser, groupsForUser };
