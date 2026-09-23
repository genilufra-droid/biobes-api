// BioBes API — raportimi i gabimeve jashtë serverit (Sentry ose webhook).
//
// Pa këtë, një gabim në prodhim zbulohet vetëm kur telefonon klienti. Zgjidhja
// është qëllimisht pa varësi të reja: dërgojmë një "envelope" në API-në HTTP të
// Sentry-t (nëse jepet SENTRY_DSN) dhe/ose një JSON në çfarëdo webhook
// (ERROR_WEBHOOK_URL — Slack, Discord, n8n, një mailbox…).
//
// Dështimi i raportimit nuk ndikon kurrë në kërkesë: gjithçka është në
// try/catch dhe pritet në sfond.
const crypto = require('crypto');

const SENTRY_TIMEOUT_MS = 4000;

function sentryFromDsn() {
  const dsn = String(process.env.SENTRY_DSN || '').trim();
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const key = u.username;
    const projectId = u.pathname.replace(/^\//, '');
    if (!key || !projectId) return null;
    const ingest = `${u.protocol}//${u.host}/api/${projectId}/envelope/?sentry_key=${key}&sentry_version=7`;
    return { ingest, dsn };
  } catch (e) { return null; }
}

function environment() {
  return String(process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV
    || (process.env.RENDER ? 'render' : 'development'));
}

function release() {
  return String(process.env.SENTRY_RELEASE || process.env.RENDER_GIT_COMMIT
    || process.env.GIT_COMMIT || '').slice(0, 40) || undefined;
}

// Kufizon madhësinë e fushave, që të mos dërgojmë megabajt në Sentry.
function trim(v, n = 1000) {
  if (v === undefined || v === null) return v;
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

let lastSentAt = 0;
let sentCount = 0;

/**
 * Dërgon një gabim jashtë procesit. Kurrë nuk hedht, kurrë nuk bllokon.
 * @param {string} msg  çfarë po bëhej
 * @param {Error|string} err
 * @param {object} extra  fusha shtesë (reqId, user, company, …)
 */
function capture(msg, err, extra = {}) {
  const message = String(msg || 'gabim').slice(0, 200);
  const error = err instanceof Error ? err : (typeof err === 'string' ? new Error(err) : null);
  const text = error ? (error.stack || error.message) : (err ? String(err) : '');
  const payload = {
    message,
    error: error ? error.message : (err ? String(err) : ''),
    stack: (text || '').split('\n').slice(0, 12).join('\n'),
    environment: environment(),
    release: release(),
    instance: process.env.INSTANCE_ID || process.pid,
    time: new Date().toISOString(),
    extra: Object.fromEntries(Object.entries(extra || {}).map(([k, v]) => [k, trim(v)])),
  };

  const s = sentryFromDsn();
  if (s) {
    const eventId = crypto.randomBytes(16).toString('hex');
    const envelope = [
      JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn: s.dsn }),
      JSON.stringify({ type: 'event' }),
      JSON.stringify({
        event_id: eventId,
        timestamp: payload.time,
        level: 'error',
        logger: 'biobes-api',
        environment: payload.environment,
        release: payload.release,
        server_name: process.env.RENDER_SERVICE_NAME || require('os').hostname(),
        message: message + (payload.error ? ': ' + payload.error : ''),
        exception: payload.stack ? [{ type: error ? error.name : 'Error', value: payload.error || message,
          stacktrace: { frames: payload.stack.split('\n').map((l) => ({ filename: l.trim() })).reverse() } }] : undefined,
        extra: payload.extra,
        tags: { instance: String(payload.instance) },
      }),
    ].join('\n');
    Promise.resolve()
      .then(() => fetch(s.ingest, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-sentry-envelope' },
        body: envelope,
        signal: AbortSignal.timeout(SENTRY_TIMEOUT_MS),
      }))
      .then(() => { sentCount++; lastSentAt = Date.now(); })
      .catch(() => { /* raportimi nuk mund të bllokojë shërbimin */ });
  }

  const hook = String(process.env.ERROR_WEBHOOK_URL || '').trim();
  if (hook) {
    const body = process.env.ERROR_WEBHOOK_FORMAT === 'slack'
      ? { text: ':rotating_light: *BioBes API* — ' + message + '\n```' + payload.stack.slice(0, 1500) + '```' }
      : { text: '[BioBes API] ' + message, ...payload };
    Promise.resolve()
      .then(() => fetch(hook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(SENTRY_TIMEOUT_MS),
      }))
      .then(() => { sentCount++; lastSentAt = Date.now(); })
      .catch(() => {});
  }
  return !!s || !!hook;
}

function isEnabled() { return !!sentryFromDsn() || !!String(process.env.ERROR_WEBHOOK_URL || '').trim(); }
function stats() { return { enabled: isEnabled(), sent: sentCount, lastSentAt: lastSentAt || null }; }

module.exports = { capture, isEnabled, stats };
