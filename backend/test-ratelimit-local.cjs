// Prova e kufizuesit të kërkesave (F2.6 — higjienë para push).
// Kontrollon që 20 përdorues nga e njëjta IP (zyrë/firmë) NUK bllokojnë njëri-tjetrin,
// ndërsa tentativat e përsëritura për TË NJËJTIN përdorues bllokohen.
const { spawn } = require('child_process');
const http = require('http');
const PORT = 8899;
let pass = 0, fail = 0;
const ok = (n, c, extra = '') => { if (c) { pass++; console.log('PASS ' + n + (extra ? ' — ' + extra : '')); } else { fail++; console.log('FAIL ' + n + ' — ' + extra); } };

function req(path, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body || {});
    const r = http.request({ host: '127.0.0.1', port: PORT, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ code: res.statusCode })); });
    r.on('error', () => resolve({ code: 0 }));
    r.write(data); r.end();
  });
}

(async () => {
  const child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT), DATABASE_URL: '', CORS_ORIGIN: '*' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let up = false;
  for (let i = 0; i < 40 && !up; i++) { await new Promise((r) => setTimeout(r, 250)); up = await new Promise((res) => { const rq = http.get({ host: '127.0.0.1', port: PORT, path: '/api/health' }, (rs) => { rs.resume(); res(rs.statusCode === 200); }); rq.on('error', () => res(false)); }); }
  ok('1. serveri lokal i ngritur (pa DB)', up);
  if (!up) { child.kill('SIGKILL'); process.exit(1); }

  // A) 20 përdorues të ndryshëm, e njëjta IP → askush nuk bllokohet
  const codes = [];
  for (let i = 1; i <= 20; i++) codes.push((await req('/api/auth/login', { username: 'ndryshues' + i, password: 'x'.repeat(10) })).code);
  ok('2. 20 përdorues të ndryshëm nga e njëjta IP: asnjë 429', !codes.includes(429), 'kodet: ' + [...new Set(codes)].join('/'));

  // B) i njëjti përdorues: 10 tentativa kalojnë, e 11-ta bllokohet
  const seq = [];
  for (let i = 1; i <= 12; i++) seq.push((await req('/api/auth/login', { username: 'i_njejti', password: 'x'.repeat(10) })).code);
  const first429 = seq.indexOf(429);
  ok('3. i njëjti përdorues: 10 tentativa të lejuara', first429 === 10, 'kodi i 11-tës: ' + seq[10]);
  ok('4. e 11-ta dhe e 12-ta bllokohen (429)', seq[10] === 429 && seq[11] === 429, seq.join(','));

  // C) një përdorues tjetër pas bllokimit → prapë i lirë (izolim per përdorues)
  const other = (await req('/api/auth/login', { username: 'i_treti', password: 'x'.repeat(10) })).code;
  ok('5. përdorues tjetër nuk preket nga bllokimi', other !== 429, 'kodi: ' + other);

  // D) ripërdorimi: emails të ndryshëm → pa 429
  const ecodes = [];
  for (let i = 1; i <= 8; i++) ecodes.push((await req('/api/auth/forgot', { email: 'u' + i + '@shembull.al' })).code);
  ok('6. 8 rivendosje nga e njëjta IP: asnjë 429', !ecodes.includes(429), 'kodet: ' + [...new Set(ecodes)].join('/'));

  child.kill('SIGKILL');
  console.log('\n=== REZULTATI: ' + pass + ' PASS / ' + fail + ' FAIL ===');
  process.exit(fail ? 1 : 0);
})();
