'use strict';
/* lib/token.js — JWT (HS256) + fjalëkalime, PA shtuar varësi.
 *
 * package.json i biobes-api ka vetëm express/nodemailer/pg, prandaj këtu përdoret
 * `node:crypto`: JWT HS256 i nënshkruar/verifikuar me dorë dhe fjalëkalime me scrypt
 * (i rezistent ndaj GPU; formati i ruajtur është i vetë-përshkrueshëm). Nëse në të
 * ardhmen shtohen `jsonwebtoken`/`bcrypt`, ky modul mund të zëvendësohet pa ndryshuar
 * thirrësit (funksionet kanë të njëjtën formë).
 *
 * Dy lloje tokenësh (P1):
 *   - ACCESS  (15 min, stateless): { sub, username, role, companyId, isSuperadmin }
 *   - REFRESH (7 ditë, i ruajtur si hash në refresh_tokens): { sub, jti }
 */
const crypto = require('node:crypto');

const ACCESS_TTL = Number(process.env.JWT_TTL_SECONDS || 900);          // 15 min
const REFRESH_TTL = Number(process.env.JWT_REFRESH_TTL_SECONDS || 604800); // 7 ditë

function b64u(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64uDecode(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(s + '='.repeat((4 - (s.length % 4)) % 4), 'base64');
}
function secretFor(kind) {
  const s = kind === 'refresh'
    ? (process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET)
    : process.env.JWT_SECRET;
  if (!s || String(s).length < 16) {
    throw new Error('Mungon ose është shumë i shkurtër ' + (kind === 'refresh' ? 'JWT_REFRESH_SECRET' : 'JWT_SECRET') + ' (≥16 shenja)');
  }
  return String(s);
}

function sign(payload, kind, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = Object.assign({}, payload, { iat: now, exp: now + (ttlSeconds || ACCESS_TTL), typ: kind });
  const data = b64u(JSON.stringify(header)) + '.' + b64u(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', secretFor(kind)).update(data).digest();
  return data + '.' + b64u(sig);
}

/* Kthen payload-in ose hedh { name:'TokenExpiredError' | 'JsonWebTokenError' }. */
function verify(token, kind) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) { const e = new Error('Token i pavlefshëm'); e.name = 'JsonWebTokenError'; throw e; }
  const data = parts[0] + '.' + parts[1];
  const expected = crypto.createHmac('sha256', secretFor(kind)).update(data).digest();
  const got = b64uDecode(parts[2]);
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) {
    const e = new Error('Nënshkrimi nuk përputhet'); e.name = 'JsonWebTokenError'; throw e;
  }
  let payload;
  try { payload = JSON.parse(b64uDecode(parts[1]).toString('utf8')); }
  catch (e) { const err = new Error('Token i palexueshëm'); err.name = 'JsonWebTokenError'; throw err; }
  if (payload.typ && payload.typ !== kind) { const e = new Error('Lloj token-i i gabuar'); e.name = 'JsonWebTokenError'; throw e; }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now) {
    const e = new Error('Token-i ka skaduar'); e.name = 'TokenExpiredError'; throw e;
  }
  return payload;
}

const signAccessToken = (u, companyId) => sign({
  sub: String(u.id), username: u.username || '', role: u.role || 'ROLE-USER',
  companyId: companyId || '', isSuperadmin: !!u.is_superadmin,
}, 'access', ACCESS_TTL);

const signRefreshToken = (u, jti) => sign({ sub: String(u.id), jti: jti || crypto.randomUUID() }, 'refresh', REFRESH_TTL);

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/* ---------- Fjalëkalime: scrypt (pa varësi) ---------- */
const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1, KEYLEN = 64;

function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(plain), salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 });
  return 'scrypt$' + SCRYPT_N + '$' + SCRYPT_R + '$' + SCRYPT_P + '$' + salt.toString('base64') + '$' + dk.toString('base64');
}

function verifyPassword(plain, stored) {
  try {
    const s = String(stored || '');
    if (!s.startsWith('scrypt$')) return false;   // formate të vjetra (bcrypt) → kalo te bcrypt.compare
    const [, N, r, p, saltB64, hashB64] = s.split('$');
    const dk = crypto.scryptSync(String(plain), Buffer.from(saltB64, 'base64'), Buffer.from(hashB64, 'base64').length,
      { N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
    const want = Buffer.from(hashB64, 'base64');
    return dk.length === want.length && crypto.timingSafeEqual(dk, want);
  } catch (e) { return false; }
}

module.exports = {
  ACCESS_TTL, REFRESH_TTL,
  sign, verify, signAccessToken, signRefreshToken, hashToken,
  hashPassword, verifyPassword,
};
