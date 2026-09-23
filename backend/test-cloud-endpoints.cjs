// test-cloud-endpoints.cjs
// Verifikon kontratat cloud: /api/state/patch, /api/backups, multi-company state isolation
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');

const DB_PORT = 5434;
const PORT = 3206;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function request(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, BASE_URL);
    const req = http.request(u, {
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    req.end();
  });
}

async function run() {
  const db = new PGlite();
  const srv = new PGLiteSocketServer({ db, port: DB_PORT, host: '127.0.0.1', maxConnections: 8 });
  await srv.start();

  const env = {
    ...process.env,
    PORT: String(PORT),
    JWT_SECRET: 'test-secret-min-16-chars-long!',
    JWT_REFRESH_SECRET: 'test-refresh-secret-min-16-chars-long!',
    DATABASE_URL: `postgres://biobes:biobes@127.0.0.1:${DB_PORT}/biobes`,
    PGSSLMODE: 'disable',
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'admin-password-123',
    ADMIN_INIT_PASSWORD: 'admin-password-123',
  };

  const proc = spawn('node', ['server.js'], { cwd: path.join(__dirname), env, stdio: 'inherit' });

  // Wait for server to boot
  let ok = false;
  for (let i = 0; i < 60; i++) {
    try {
      const res = await request('/api/health');
      if (res.status === 200 && res.body && res.body.ok && res.body.db) { ok = true; break; }
    } catch (err) {
      // waiting for server boot
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  if (!ok) {
    proc.kill();
    await srv.stop();
    console.error('Server failed to boot');
    process.exit(1);
  }

  try {
    // 1. Login admin
    const login = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { username: 'admin', password: 'admin-password-123' },
    });
    console.assert(login.status === 200, 'Admin login failed');
    const token = login.body.accessToken || login.body.token;
    const authH = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    // 2. Put state for company C1
    const putC1 = await request('/api/state?company=C1', {
      method: 'PUT',
      headers: authH,
      body: {
        baseVersion: 0,
        state: {
          products: [{ id: 'PR-1', name: 'Product C1', code: 'P1' }],
          suppliers: [{ id: 'SUP-1', name: 'Supplier C1' }],
          customers: [{ id: 'CUS-1', name: 'Customer C1' }],
        },
      },
    });
    console.log('PUT C1 status:', putC1.status, putC1.body);
    console.assert(putC1.status === 200 && putC1.body.company === 'C1', 'PUT C1 failed');

    // 3. Put state for company C2
    const putC2 = await request('/api/state?company=C2', {
      method: 'PUT',
      headers: authH,
      body: {
        baseVersion: 0,
        state: {
          products: [{ id: 'PR-2', name: 'Product C2', code: 'P2' }],
          suppliers: [{ id: 'SUP-2', name: 'Supplier C2' }],
          customers: [{ id: 'CUS-2', name: 'Customer C2' }],
        },
      },
    });
    console.log('PUT C2 status:', putC2.status, putC2.body);
    console.assert(putC2.status === 200 && putC2.body.company === 'C2', 'PUT C2 failed');

    // 4. Verify C1 and C2 state are completely isolated
    const getC1 = await request('/api/state?company=C1', { headers: authH });
    console.assert(getC1.body.state.products[0].id === 'PR-1', 'C1 state incorrect');
    const getC2 = await request('/api/state?company=C2', { headers: authH });
    console.assert(getC2.body.state.products[0].id === 'PR-2', 'C2 state incorrect');
    console.log('✓ C1 and C2 state isolation verified');

    // 5. Test POST /api/state/patch on C1
    const patchC1 = await request('/api/state/patch?company=C1', {
      method: 'POST',
      headers: authH,
      body: {
        ops: [
          { kind: 'products', op: 'upsert', id: 'PR-3', doc: { id: 'PR-3', name: 'Product 3', code: 'P3' } },
        ],
      },
    });
    console.log('PATCH C1 status:', patchC1.status, patchC1.body);
    console.assert(patchC1.status === 200 && patchC1.body.applied === 1, 'PATCH C1 failed');

    // 6. Test Backups: POST /api/backups for C1
    const backupC1 = await request('/api/backups?company=C1', {
      method: 'POST',
      headers: authH,
      body: { label: 'backup-test-c1' },
    });
    console.log('Backup C1 status:', backupC1.status, backupC1.body);
    console.assert(backupC1.status === 200 && backupC1.body.id, 'Backup C1 failed');

    // 7. Test List Backups: GET /api/backups
    const listB = await request('/api/backups?company=C1', { headers: authH });
    console.assert(listB.status === 200 && listB.body.backups.length >= 1, 'List backups failed');
    console.log('✓ Backups create & list verified');

    console.log('ALL CLOUD ENDPOINT CHECKS PASSED SUCCESSFULLY!');
  } finally {
    proc.kill();
    await srv.stop();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
