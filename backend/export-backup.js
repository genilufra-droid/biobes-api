#!/usr/bin/env node
// Shkarkon gjendjen aktuale nga PostgreSQL në një file JSON (format backup-i aplikacionit).
// Përdorimi: API_URL=https://... ADMIN_USER=admin ADMIN_PASS=... node export-backup.js [dalje.json]
const fs = require('fs');

(async () => {
  const API = (process.env.API_URL || '').replace(/\/$/, '');
  const user = process.env.ADMIN_USER || 'admin';
  const pass = process.env.ADMIN_PASS || '';
  const out = process.argv[2] || ('BioBes-server-backup-' + new Date().toISOString().slice(0, 10) + '.json');
  if (!API || !pass) {
    console.error('Përdorimi: API_URL=<url> ADMIN_USER=<user> ADMIN_PASS=<pass> node export-backup.js [dalje.json]');
    process.exit(2);
  }
  const call = async (path, opts = {}) => {
    const r = await fetch(API + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    return { status: r.status, ok: r.ok, data: await r.json().catch(() => ({})) };
  };
  const login = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: user, password: pass }) });
  if (!login.ok || !login.data.token) { console.error('FAIL: login dështoi (' + login.status + ')'); process.exit(1); }
  const cur = await call('/api/state', { headers: { Authorization: 'Bearer ' + login.data.token } });
  if (!cur.ok || !cur.data.state) { console.error('FAIL: serveri nuk ka state (version ' + cur.data.version + ')'); process.exit(1); }
  fs.writeFileSync(out, JSON.stringify(cur.data.state, null, 2));
  console.log('OK: version ' + cur.data.version + ' u ruajt në ' + out + ' (' + fs.statSync(out).size + ' bytes)');
})().catch((e) => { console.error('FAIL: ' + e.message); process.exit(1); });
