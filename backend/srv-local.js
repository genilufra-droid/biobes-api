// Helper për start_process: ndez serverin me PGlite-in e vetin (pa DATABASE_URL).
const { spawn } = require('child_process');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');

const DB_PORT = 5432;
const API_PORT = +(process.env.PORT || 3000);

(async () => {
  const db = new PGlite();
  const srv = new PGLiteSocketServer({ db, port: DB_PORT, host: '0.0.0.0', maxConnections: 10 });
  await srv.start();
  console.log('[local] Postgres PGlite në 0.0.0.0:' + DB_PORT);
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(API_PORT),
      DATABASE_URL: 'postgres://biobes:biobes@127.0.0.1:' + DB_PORT + '/biobes',
      ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'admin12345',
      SESSION_TTL_HOURS: '24',
      PGSSLMODE: 'disable',
      CORS_ORIGIN: '*',
    },
    stdio: 'inherit',
  });
  child.on('exit', (c) => { try { srv.stop(); } catch (_) {} process.exit(c || 0); });
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
})().catch((e) => { console.error('[local] fail:', e); process.exit(1); });
