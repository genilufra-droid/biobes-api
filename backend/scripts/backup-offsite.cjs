#!/usr/bin/env node
// BioBes API — kopje jashtë vendit (off-site), e planifikueshme.
//
// Pse: deri tani kopjet rrinin në të njëjtën databazë (tabela `backups`). Nëse
// Aiven-i bie ose dikush fshin të dhënat, humbet edhe kopja. Ky skript merr
// eksportin e plotë nga API-ja, e kompreson dhe e ngarkon në një kovë
// S3-përputhshme (AWS S3, Cloudflare R2, Backblaze B2, MinIO), pastaj hedh
// kopjet e vjetra sipas BACKUP_KEEP_OFFSITE.
//
// Asnjë varësi e re: nënshkrimi AWS SigV4 bëhet me crypto-n e Node-it.
//
// Përdorimi:
//   API_URL=https://api.biobes.al ADMIN_USER=admin ADMIN_PASS=…
//   S3_ENDPOINT=s3.eu-central-1.amazonaws.com S3_BUCKET=biobes-backup
//   S3_ACCESS_KEY=… S3_SECRET_KEY=… node scripts/backup-offsite.cjs
//
// Pa kredencialet S3, skripti e shkruan kopjen në ./backups (i dobishëm në
// vendas dhe në një disk të montuar në Render).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const API = String(process.env.API_URL || '').replace(/\/+$/, '');
const USER = process.env.ADMIN_USER || 'admin';
const PASS = process.env.ADMIN_PASS || '';
const PREFIX = String(process.env.S3_PREFIX || 'biobes').replace(/^\/+|\/+$/g, '');
const KEEP = Math.max(1, Number(process.env.BACKUP_KEEP_OFFSITE || 30));
const LOCAL_DIR = process.env.BACKUP_LOCAL_DIR || path.join(__dirname, '..', '..', 'backups');
const S3 = {
  endpoint: String(process.env.S3_ENDPOINT || '').replace(/^https?:\/\//, '').replace(/\/+$/, ''),
  bucket: process.env.S3_BUCKET || '',
  region: process.env.S3_REGION || 'auto',
  accessKey: process.env.S3_ACCESS_KEY || '',
  secretKey: process.env.S3_SECRET_KEY || '',
};
const HAS_S3 = !!(S3.endpoint && S3.bucket && S3.accessKey && S3.secretKey);

const stamp = (d = new Date()) => d.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
const log = (m) => console.log('[' + new Date().toISOString() + '] ' + m);
const fail = (m) => { console.error('[backup] DËSHTOI: ' + m); process.exit(1); };

// --------------------------- nënshkrimi AWS SigV4 ---------------------------
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest();

function signedHeaders(method, keyPath, query, body, headers) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const all = { ...headers, host: S3.endpoint, 'x-amz-content-sha256': sha256(body), 'x-amz-date': amzDate };
  const sorted = Object.keys(all).sort();
  const canonHeaders = sorted.map((k) => k + ':' + String(all[k]).trim() + '\n').join('');
  const signed = sorted.join(';');
  const canonUri = '/' + S3.bucket + keyPath;
  const canonQuery = Object.keys(query || {}).sort()
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(query[k])).join('&');
  const canonReq = [method, canonUri, canonQuery, canonHeaders, signed, all['x-amz-content-sha256']].join('\n');
  const scope = dateStamp + '/' + S3.region + '/s3/aws4_request';
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonReq)].join('\n');
  const k = hmac(hmac(hmac(hmac('AWS4' + S3.secretKey, dateStamp), S3.region), 's3'), 'aws4_request');
  const sig = crypto.createHmac('sha256', k).update(toSign).digest('hex');
  return {
    ...headers,
    host: S3.endpoint,
    'x-amz-content-sha256': all['x-amz-content-sha256'],
    'x-amz-date': amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${S3.accessKey}/${scope}, SignedHeaders=${signed}, Signature=${sig}`,
  };
}

async function s3(method, keyPath, query = {}, body = null, extraHeaders = {}) {
  const buf = body === null ? Buffer.alloc(0) : (Buffer.isBuffer(body) ? body : Buffer.from(String(body)));
  const headers = signedHeaders(method, keyPath, query, buf, extraHeaders);
  const url = 'https://' + S3.endpoint + '/' + S3.bucket + keyPath
    + (Object.keys(query).length ? '?' + new URLSearchParams(query).toString() : '');
  const r = await fetch(url, { method, headers, body: method === 'GET' || method === 'DELETE' ? undefined : buf });
  const text = await r.text().catch(() => '');
  if (!r.ok) throw new Error(method + ' ' + keyPath + ' → ' + r.status + ' ' + text.slice(0, 200));
  return text;
}

async function s3Upload(name, body) {
  await s3('PUT', '/' + name, {}, body, { 'Content-Type': 'application/gzip' });
  return name;
}

async function s3Prune() {
  // Listimi v2 i objekteve me parashtesë; më pas fshijmë më të vjetrit.
  const xml = await s3('GET', '/', { 'list-type': '2', prefix: PREFIX + '/' });
  const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
  const times = [...xml.matchAll(/<LastModified>([^<]+)<\/LastModified>/g)].map((m) => m[1]);
  const items = keys.map((k, i) => ({ key: k, at: times[i] || '' })).sort((a, b) => (a.at < b.at ? 1 : -1));
  const stale = items.slice(KEEP);
  for (const it of stale) {
    await s3('DELETE', '/' + it.key, {}).catch((e) => log('heqja dështoi: ' + e.message));
  }
  return { total: items.length, removed: stale.length };
}

(async () => {
  if (!API || !PASS) fail('API_URL dhe ADMIN_PASS duhen (shih komentet në krye).');
  log('marrja e eksportit nga ' + API);
  const call = async (p, o = {}) => {
    const r = await fetch(API + p, { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) } });
    return { status: r.status, ok: r.ok, data: await r.json().catch(() => ({})) };
  };
  const login = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: USER, password: PASS }) });
  if (!login.ok || !login.data.token) fail('hyrja dështoi (' + login.status + ')');
  const H = { Authorization: 'Bearer ' + login.data.token };
  const exp = await call('/api/admin/export', { headers: H });
  if (!exp.ok || !exp.data.export) fail('eksporti dështoi (' + exp.status + ' — ' + JSON.stringify(exp.data).slice(0, 120) + ')');

  const raw = Buffer.from(JSON.stringify(exp.data.export));
  const gz = zlib.gzipSync(raw, { level: 9 });
  const rows = Object.entries(exp.data.export.data)
    .map(([k, v]) => k + '=' + (Array.isArray(v) ? v.length : '?')).join(' ');
  log('eksport: ' + raw.length + ' B → ' + gz.length + ' B i kompresuar (' + rows + ')');

  const name = `${PREFIX}/biobes-${stamp()}.json.gz`;
  if (HAS_S3) {
    await s3Upload(name, gz);
    log('u ngarkua te s3://' + S3.bucket + '/' + name);
    const pruned = await s3Prune();
    log('kovë: ' + pruned.total + ' kopje, u hoqën ' + pruned.removed + ' (ruhen ' + KEEP + ')');
  } else {
    fs.mkdirSync(LOCAL_DIR, { recursive: true });
    const file = path.join(LOCAL_DIR, path.basename(name));
    fs.writeFileSync(file, gz);
    log('S3 nuk është konfiguruar — u ruajt në disk: ' + file);
    const files = fs.readdirSync(LOCAL_DIR).filter((f) => f.startsWith('biobes-') && f.endsWith('.json.gz')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - KEEP))) {
      fs.unlinkSync(path.join(LOCAL_DIR, f));
      log('  u hoq kopja e vjetër ' + f);
    }
  }
  log('KOPJA JASHTË VENDIT — GATI');
})().catch((e) => fail(e.message));
