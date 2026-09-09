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
  });
  return cached;
}

async function sendResetCode(to, username, code) {
  const c = smtpConfig();
  await getTransport().sendMail({
    from: c.from,
    to,
    subject: 'BioBes ERP — kodi i rivendosjes së fjalëkalimit',
    text: 'Përshëndetje ' + username + ',\n\nKodi yt 6-shifror për të vendosur fjalëkalim të ri në BioBes ERP është:\n\n    ' + code + '\n\nKodi skadon pas 15 minutash. Nëse nuk e kërkove ti, shpërfille këtë email.\n\n— BioBes ERP',
  });
}

module.exports = { smtpConfig, isSmtpConfigured, sendResetCode };
