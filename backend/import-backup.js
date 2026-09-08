#!/usr/bin/env node
// Importon një backup JSON të aplikacionit (butoni Backup ⇩) në PostgreSQL përmes API-t.
// Përdorimi: API_URL=https://... ADMIN_USER=admin ADMIN_PASS=... node import-backup.js BioBes-backup-YYYY-MM-DD.json [--force]
// Pa --force: dështon nëse serveri ka version më të ri (mbrojtje nga mbishkrimi).
const fs = require('fs');

(async () => {
  const file = process.argv[2];
  const force = process.argv.includes('--force');
  const API = (process.env.API_URL || '').replace(/\/$/, '');
  const user = process.env.ADMIN_USER || 'admin';
  const pass = process.env.ADMIN_PASS || '';
  if (!file || !API || !pass) {
    console.error('Përdorimi: API_URL=<url> ADMIN_USER=<user> ADMIN_PASS=<pass> node import-backup.js <backup.json> [--force]');
    process.exit(2);
  }
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.error('FAIL: skedari nuk lexohet: ' + e.message); process.exit(1); }
  const state = (parsed && parsed.state) || parsed;
  if (!state || typeof state !== 'object' || Array.isArray(state)) { console.error('FAIL: skedari nuk përmban state të vlefshëm'); process.exit(1); }
  const keys = ['products', 'suppliers', 'customers', 'warehouses', 'lots', 'weighings', 'payments'].filter((k) => Array.isArray(state[k]));
  console.log('Backup: ' + keys.map((k) => k + '=' + state[k].length).join(', '));

  const call = async (path, opts = {}) => {
    const r = await fetch(API + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    return { status: r.status, ok: r.ok, data: await r.json().catch(() => ({})) };
  };
  const login = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: user, password: pass }) });
  if (!login.ok || !login.data.token) { console.error('FAIL: login dështoi (' + login.status + ' ' + (login.data.error || '') + ')'); process.exit(1); }
  const H = { Authorization: 'Bearer ' + login.data.token };
  const cur = await call('/api/state', { headers: H });
  console.log('Serveri: version ' + (cur.data.version ?? '?'));
  const put = await call('/api/state', { method: 'PUT', headers: H,
    body: JSON.stringify({ state, baseVersion: force ? null : cur.data.version }) });
  if (put.status === 409) { console.error('FAIL: serveri ka version më të ri (v' + put.data.version + '). Përdor --force për mbishkrim të qëllimshëm.'); process.exit(1); }
  if (!put.ok) { console.error('FAIL: importi u refuzua (' + put.status + ' ' + (put.data.error || '') + ')'); process.exit(1); }
  console.log('OK: u importua si version ' + put.data.version);
})().catch((e) => { console.error('FAIL: ' + e.message); process.exit(1); });
