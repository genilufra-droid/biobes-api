// BioBes API — password-e scrypt, sesione në DB, rate limit.
const crypto = require('crypto');
const { getPool } = require('./db');

const SESSION_TTL_H = +(process.env.SESSION_TTL_HOURS || 24);

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split('$');
    if (parts[0] !== 'scrypt') return false;
    const [, N, r, p, saltHex, hashHex] = parts;
    const hash = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 64, { N: +N, r: +r, p: +p });
    return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
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
    `INSERT INTO users(id,username,name,role,password_hash) VALUES('USR-ADMIN',$1,'Administrator','ROLE-ADMIN',$2)`,
    [username, hashPassword(pass)]
  );
  console.log(`[auth] U krijua admini fillestar "${username}".`);
}

async function loginUser(username, password) {
  const p = getPool();
  const { rows } = await p.query('SELECT * FROM users WHERE username=$1 AND active=TRUE', [String(username || '').trim()]);
  const u = rows[0];
  if (!u || !verifyPassword(password, u.password_hash)) return null;
  const token = crypto.randomBytes(32).toString('hex');
  const th = crypto.createHash('sha256').update(token).digest('hex');
  await p.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+($3||\' hours\')::interval)',
    [th, u.id, String(SESSION_TTL_H)]);
  return { token, user: { id: u.id, username: u.username, name: u.name, role: u.role, rights: u.rights || null } };
}

async function userFromToken(token) {
  if (!token) return null;
  const p = getPool();
  if (!p) return null;
  const th = crypto.createHash('sha256').update(String(token)).digest('hex');
  const { rows } = await p.query(
    `SELECT u.id,u.username,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id
     WHERE s.token_hash=$1 AND s.expires_at>NOW() AND u.active=TRUE`, [th]);
  return rows[0] || null;
}

async function logoutToken(token) {
  const p = getPool();
  if (!p || !token) return;
  await p.query('DELETE FROM sessions WHERE token_hash=$1',
    [crypto.createHash('sha256').update(String(token)).digest('hex')]);
}

// Rate limit i thjeshtë në memorie (për instancë të vetme — mjafton për MVP).
const buckets = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = (req.ip || '?') + ':' + req.path;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.reset < now) { b = { count: 0, reset: now + windowMs }; buckets.set(key, b); }
    if (++b.count > max) return res.status(429).json({ ok: false, error: 'Shumë tentativa — provo pas pak minutash' });
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k); }, 5 * 60 * 1000).unref();

module.exports = { hashPassword, verifyPassword, ensureAdmin, loginUser, userFromToken, logoutToken, rateLimit };
