#!/usr/bin/env node
// Prova testimi kundër API-t LIVE (Render + Aiven): simulon dy pajisje, konfliktin
// e shkrimeve paralele, guardrails-at e serverit dhe wipe-in.
// Përdorimi: API_URL=https://... ADMIN_USER=admin ADMIN_PASS=... node test-live.js
// KUJDES: testi bën WIPE në fund — ekzekutoje vetëm në mjedis testimi!

const API = (process.env.API_URL || '').replace(/\/$/, '');
const USER = process.env.ADMIN_USER || 'admin';
const PASS = process.env.ADMIN_PASS || '';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' — ' + extra : '')); };

(async () => {
  if (!API || !PASS) { console.error('Mungon API_URL ose ADMIN_PASS.'); process.exit(2); }
  const call = async (path, opts = {}) => {
    const r = await fetch(API + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    return { status: r.status, ok: r.ok, data: await r.json().catch(() => ({})) };
  };
  const login = async (u, p) => call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) });

  const h = await call('/api/health');
  ok('health-db', h.ok && h.data.db === true, JSON.stringify(h.data));
  const bad = await login(USER, 'gabim-sigurisht');
  ok('login-401', bad.status === 401);
  const a = await login(USER, PASS);
  ok('login-ok', a.ok && !!a.data.token);
  if (!a.ok) process.exit(1);
  const HA = { Authorization: 'Bearer ' + a.data.token };

  const v0 = (await call('/api/state', { headers: HA })).data.version || 0;
  const marker = 'E2E-' + Date.now().toString(36).toUpperCase();
  const payload = { products: [], suppliers: [{ id: marker, code: marker, name: 'Test cross-device', balance: 0 }],
    customers: [], warehouses: [], lots: [], weighings: [], purchaseInvoices: [], salesInvoices: [],
    orders: [], payments: [], customerPayments: [], users: [] };
  const put = await call('/api/state', { method: 'PUT', headers: HA, body: JSON.stringify({ state: payload, baseVersion: v0 }) });
  ok('put-version', put.ok && put.data.version === v0 + 1, 'v' + put.data.version);

  // Pajisja B: login i ri → sheh të dhënat e pajisjes A.
  const b = await login(USER, PASS);
  const seen = await call('/api/state', { headers: { Authorization: 'Bearer ' + b.data.token } });
  ok('cross-device', seen.ok && (seen.data.state.suppliers || []).some((x) => x.id === marker));

  // Shkrim paralel i vjetëruar → 409, nuk mbishkruan.
  const stale = await call('/api/state', { method: 'PUT', headers: HA, body: JSON.stringify({ state: payload, baseVersion: v0 }) });
  ok('stale-409', stale.status === 409);

  // Guardrails: formë e pavlefshme → 400; stok negativ → 400.
  const badShape = await call('/api/state', { method: 'PUT', headers: HA, body: JSON.stringify({ state: { x: 1 } }) });
  ok('guard-shape-400', badShape.status === 400);
  const negLot = JSON.parse(JSON.stringify(payload));
  negLot.lots = [{ id: 'L-NEG', product: 'P1', net: -50 }];
  const neg = await call('/api/state', { method: 'PUT', headers: HA, body: JSON.stringify({ state: negLot }) });
  ok('guard-neglot-400', neg.status === 400, neg.data.error || '');

  // Wipe me password gabim → 401 + të dhënat mbijetojnë.
  const wBad = await call('/api/admin/wipe', { method: 'POST', body: JSON.stringify({ password: 'gabim' }) });
  const still = await call('/api/state', { headers: HA });
  ok('wipe-401-survives', wBad.status === 401 && (still.data.state.suppliers || []).some((x) => x.id === marker));
  const wOk = await call('/api/admin/wipe', { method: 'POST', body: JSON.stringify({ password: PASS }) });
  const empty = await call('/api/state', { headers: HA });
  ok('wipe-ok-empties', wOk.ok && empty.data.state === null && empty.data.version === 0);
  const relog = await login(USER, PASS);
  ok('admin-survives-wipe', relog.ok);
  const audit = await call('/api/audit?limit=50', { headers: { Authorization: 'Bearer ' + relog.data.token } });
  ok('audit-trail', audit.ok && (audit.data.rows || []).some((r) => r.action === 'WIPE'));

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  console.log('Shënim: qëndrueshmëria pas rinisjes testohet manualisht — rinisni servisin në Render, pastaj GET /api/state duhet të kthejë të njëjtin version.');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL: ' + e.message); process.exit(1); });
