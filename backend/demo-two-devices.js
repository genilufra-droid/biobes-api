#!/usr/bin/env node
// Demonstrim i automatizuar: dy pajisje (PC + telefon) në të njëjtën databazë.
// A shkruan -> B e sheh; shkrime paralele -> 409 pa mbishkrim; B zgjidhe konfliktin.
// E SIGURT: punon mbi gjendjen ekzistuese (read-modify-write) dhe pastron gjurmët në fund.
// Përdorimi: API_URL=https://... ADMIN_USER=admin ADMIN_PASS=... npm run demo:devices

const API = (process.env.API_URL || '').replace(/\/$/, '');
const USER = process.env.ADMIN_USER || 'admin';
const PASS = process.env.ADMIN_PASS || '';
const TAG = 'E2E-DEMO';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' — ' + extra : '')); };
const EMPTY = () => ({ products: [], suppliers: [], customers: [], warehouses: [], lots: [],
  weighings: [], purchaseInvoices: [], salesInvoices: [], orders: [], payments: [],
  customerPayments: [], users: [] });

(async () => {
  if (!API || !PASS) { console.error('Mungon API_URL ose ADMIN_PASS.'); process.exit(2); }
  const call = async (path, opts = {}) => {
    const r = await fetch(API + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    return { status: r.status, ok: r.ok, data: await r.json().catch(() => ({})) };
  };
  const login = async (u, p) => call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) });

  // Hapi 1: dy pajisje, dy sesione.
  const devA = await login(USER, PASS);
  const devB = await login(USER, PASS);
  ok('dy-sesione', devA.ok && devB.ok && devA.data.token !== devB.data.token);
  if (!devA.ok || !devB.ok) process.exit(1);
  const HA = { Authorization: 'Bearer ' + devA.data.token };
  const HB = { Authorization: 'Bearer ' + devB.data.token };

  // Hapi 2: PC (A) regjistron furnizues; telefoni (B) e sheh.
  const s0 = await call('/api/state', { headers: HA });
  const v0 = s0.data.version || 0;
  const stA = s0.data.state ? JSON.parse(JSON.stringify(s0.data.state)) : EMPTY();
  stA.suppliers = Array.isArray(stA.suppliers) ? stA.suppliers : [];
  const markS = TAG + '-S';
  stA.suppliers = stA.suppliers.filter((x) => x.id !== markS);
  stA.suppliers.push({ id: markS, code: markS, name: 'Furnitor demo (PC)', balance: 0 });
  const putA = await call('/api/state', { method: 'PUT', headers: HA, body: JSON.stringify({ state: stA, baseVersion: v0 }) });
  ok('A-shkruan', putA.ok && putA.data.version === v0 + 1, 'v' + putA.data.version);
  const seenB = await call('/api/state', { headers: HB });
  ok('B-e-sheh', seenB.ok && (seenB.data.state.suppliers || []).some((x) => x.id === markS), 'pa humbje ndër-pajisje');

  // Hapi 3: garë paralele — A shkruan sërish, B provon me version të vjetër -> 409.
  const stA2 = JSON.parse(JSON.stringify(seenB.data.state));
  const markP = TAG + '-P';
  stA2.products = (stA2.products || []).filter((x) => x.id !== markP);
  stA2.products.push({ id: markP, code: markP, name: 'Produkt demo (PC)' });
  const putA2 = await call('/api/state', { method: 'PUT', headers: HA, body: JSON.stringify({ state: stA2, baseVersion: seenB.data.version }) });
  ok('A-shkruan-serish', putA2.ok, 'v' + putA2.data.version);
  const staleB = JSON.parse(JSON.stringify(seenB.data.state)); // B ka ende versionin e vjetër
  staleB.customers = (staleB.customers || []).filter((x) => x.id !== TAG + '-C');
  staleB.customers.push({ id: TAG + '-C', name: 'Klient demo (telefon)' });
  const raceB = await call('/api/state', { method: 'PUT', headers: HB, body: JSON.stringify({ state: staleB, baseVersion: seenB.data.version }) });
  ok('B-409-pa-mbishkrim', raceB.status === 409, 'shkrimi i vjeter u refuzua');
  const intact = await call('/api/state', { headers: HA });
  ok('te-dhenat-e-A-mbijetojne', (intact.data.state.products || []).some((x) => x.id === markP));

  // Hapi 4: B zgjidhe konfliktin si aplikacioni (GET i ri + ri-aplikim + PUT).
  const fresh = await call('/api/state', { headers: HB });
  const stB = fresh.data.state;
  stB.customers = (stB.customers || []).filter((x) => x.id !== TAG + '-C');
  stB.customers.push({ id: TAG + '-C', name: 'Klient demo (telefon)' });
  const putB = await call('/api/state', { method: 'PUT', headers: HB, body: JSON.stringify({ state: stB, baseVersion: fresh.data.version }) });
  ok('B-zgjidh-konfliktin', putB.ok, 'v' + putB.data.version);
  const final = await call('/api/state', { headers: HA });
  const fs = final.data.state;
  ok('te-gjitha-gjurmet-prane', (fs.suppliers || []).some((x) => x.id === markS)
    && (fs.products || []).some((x) => x.id === markP) && (fs.customers || []).some((x) => x.id === TAG + '-C'));

  // Hapi 5: pastrim (heq vetëm gjurmët demo, lë gjithçka tjetër).
  const clean = JSON.parse(JSON.stringify(fs));
  ['suppliers', 'products', 'customers'].forEach((k) => { clean[k] = (clean[k] || []).filter((x) => !(x.id || '').startsWith(TAG)); });
  const putC = await call('/api/state', { method: 'PUT', headers: HA, body: JSON.stringify({ state: clean, baseVersion: final.data.version }) });
  const after = await call('/api/state', { headers: HA });
  const left = ['suppliers', 'products', 'customers'].reduce((a, k) => a + (after.data.state[k] || []).filter((x) => (x.id || '').startsWith(TAG)).length, 0);
  ok('pastrim', putC.ok && left === 0, 'v' + (putC.data.version || '?'));

  console.log(`\n${pass} PASS, ${fail} FAIL — ${fail ? 'DEMO DËSHTOI' : 'dy pajisjet punojnë pa humbje apo mbishkrim'}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL: ' + e.message); process.exit(1); });
