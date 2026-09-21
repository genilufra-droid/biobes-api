#!/usr/bin/env node
// Eksporton një kompani të vetme nga serveri cloud në një file JSON (backup logjik).
// Përdorimi: API_URL=... ADMIN_USER=admin ADMIN_PASS=... COMPANY_ID=CO-xxx
//            node export-company-backup.js [out.json]
const fs = require('fs');

(async () => {
  const API = (process.env.API_URL || '').replace(/\/$/, '');
  const user = process.env.ADMIN_USER || 'admin';
  const pass = process.env.ADMIN_PASS || '';
  const co = process.env.COMPANY_ID || '';
  const out = process.argv[2] || ('biobes-' + (co || 'all') + '-' + new Date().toISOString().slice(0,10) + '.json');
  if (!API || !pass) {
    console.error('Përdorimi: API_URL=<url> ADMIN_USER=<u> ADMIN_PASS=<p> COMPANY_ID=<id> node export-company-backup.js [out.json]');
    process.exit(2);
  }
  const call = async (path, opts = {}) => {
    const r = await fetch(API + path, { ...opts, headers: { 'Content-Type':'application/json', ...(opts.headers||{}) } });
    return { status: r.status, ok: r.ok, data: await r.json().catch(() => ({})) };
  };
  const login = await call('/api/auth/login', { method:'POST', body:JSON.stringify({username:user,password:pass}) });
  if (!login.ok || !login.data.token) { console.error('FAIL: login ('+login.status+')'); process.exit(1); }
  const H = { Authorization: 'Bearer ' + login.data.token, ...(co ? { 'X-Company-Id': co } : {}) };

  const dump = { exportedAt: new Date().toISOString(), companyId: co || null, entities: {} };
  const endpoints = ['products','suppliers','customers','warehouses','lots','weighings',
                     'payments','customer-payments','sales-invoices','purchase-invoices'];
  for (const ep of endpoints) {
    const r = await call('/api/' + ep + '?limit=10000', { headers: H });
    if (!r.ok) { console.error('FAIL /' + ep + ' (' + r.status + ' ' + (r.data.error||'') + ')'); continue; }
    dump.entities[ep] = r.data.rows || [];
    console.log(' - ' + ep + ': ' + (r.data.rows||[]).length);
  }
  fs.writeFileSync(out, JSON.stringify(dump, null, 2));
  console.log('OK → ' + out + ' (' + fs.statSync(out).size + ' bytes)');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
