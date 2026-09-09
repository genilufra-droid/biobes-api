// BioBes — dërgimi i emailit për rivendosjen e fjalëkalimit (F49).
// Konfigurohet VETËM me variabla mjedisi në Render (kurrë hardcoded):
// SMTP_HOST, SMTP_PORT (parazgjedhje 587), SMTP_SECURE ('true' për 465),
// SMTP_USER, SMTP_PASS, SMTP_FROM (p.sh. 'BioBes ERP <noreply@firma.juaj>').
let cached = null;

function smtpConfig() {
  const host = (process.env.SMTP_HOST || '').trim();
  if (!host) return null;
  const port = parseInt(process.env.SMTP_PORT || '587', 10) || 587;
  return {
    host,
    port,
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465,
    user: (process.env.SMTP_USER || '').trim(),
    pass: process.env.SMTP_PASS || '',
    from: (process.env.SMTP_FROM || '').trim() || (process.env.SMTP_USER || '').trim(),
  };
}

function isSmtpConfigured() {
  const c = smtpConfig();
  return !!(c && c.user && c.pass && c.from);
}

function getTransport() {
  if (cached) return cached;
  const c = smtpConfig();
  if (!c) throw new Error('SMTP_HOST mungon');
  const nodemailer = require('nodemailer');
  cached = nodemailer.createTransport({
    host: c.host, port: c.port, secure: c.secure,
    auth: { user: c.user, pass: c.pass },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    logger: true, debug: true,
  });
  return cached;
}

function resendConfig() {
  const key = (process.env.RESEND_API_KEY || '').trim();
  if (!key) return null;
  return {
    key,
    from: (process.env.SMTP_FROM || process.env.RESEND_FROM || '').trim() || 'BioBes ERP <onboarding@resend.dev>',
  };
}

function parseFrom(raw, fallbackName) {
  const s = String(raw || '').trim();
  const m = s.match(/^(.*)<([^<>@\s]+@[^<>\s]+)>\s*$/);
  if (m) return { name: (m[1] || '').trim().replace(/^["']|["']$/g, '') || fallbackName, email: m[2].trim() };
  if (/^[^@\s]+@[^@\s]+$/.test(s)) return { name: fallbackName, email: s };
  return null;
}

function brevoConfig() {
  const key = (process.env.BREVO_API_KEY || '').trim();
  if (!key) return null;
  const from = parseFrom(process.env.BREVO_FROM || process.env.SMTP_FROM, 'BioBes ERP');
  if (!from) return null;
  return { key, from };
}

function isMailConfigured() {
  return !!resendConfig() || !!brevoConfig() || isSmtpConfigured();
}

function resetMailText(username, code) {
  return 'Përshëndetje ' + username + ',\n\nKodi yt 6-shifror për të vendosur fjalëkalim të ri në BioBes ERP është:\n\n    ' + code + '\n\nKodi skadon pas 15 minutash. Nëse nuk e kërkove ti, shpërfille këtë email.\n\n— BioBes ERP';
}

async function sendViaResend(cfg, to, username, code) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: cfg.from,
      to: [to],
      subject: 'BioBes ERP — kodi i rivendosjes së fjalëkalimit',
      text: resetMailText(username, code),
    }),
    signal: AbortSignal.timeout(15000),
  });
  let j = {};
  try { j = await r.json(); } catch (e) { j = {}; }
  if (!r.ok) throw new Error('Resend ' + r.status + ': ' + ((j && j.message) || r.statusText || 'gabim'));
  return j;
}

async function sendViaBrevo(cfg, to, username, code) {
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': cfg.key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: cfg.from,
      to: [{ email: to, name: username }],
      subject: 'BioBes ERP — kodi i rivendosjes së fjalëkalimit',
      textContent: resetMailText(username, code),
    }),
    signal: AbortSignal.timeout(15000),
  });
  let j = {};
  try { j = await r.json(); } catch (e) { j = {}; }
  if (!r.ok) throw new Error('Brevo ' + r.status + ': ' + ((j && j.message) || r.statusText || 'gabim'));
  return j;
}

async function sendResetCode(to, username, code) {
  const rc = resendConfig();
  if (rc) {
    console.log('[mailer] dërgohet via Resend te ' + to);
    await sendViaResend(rc, to, username, code);
    return;
  }
  const bc = brevoConfig();
  if (bc) {
    console.log('[mailer] dërgohet via Brevo-API te ' + to);
    await sendViaBrevo(bc, to, username, code);
    return;
  }
  const c = smtpConfig();
  console.log('[mailer] dërgohet via SMTP (' + c.host + ') te ' + to);
  await getTransport().sendMail({
    from: c.from,
    to,
    subject: 'BioBes ERP — kodi i rivendosjes së fjalëkalimit',
    text: resetMailText(username, code),
  });
}

module.exports = { smtpConfig, isSmtpConfigured, resendConfig, brevoConfig, isMailConfigured, sendResetCode };
