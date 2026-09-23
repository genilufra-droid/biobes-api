// BioBes API — logje të strukturuara (JSON).
//
// Në cloud, logjet janë e vetmja dritare që ke: Render-i i mbledh nga stdout.
// Formati është një objekt JSON për rresht, me fushat e njëjta në çdo hyrje,
// që të mund të filtrosh sipas `reqId`, `company`, `user` apo `level`.
// Asnjë varësi e re — vetëm JSON.stringify.
const crypto = require('crypto');
const monitor = require('./monitor');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = LEVELS[String(process.env.LOG_LEVEL || 'info').toLowerCase()] || LEVELS.info;

function emit(level, msg, fields = {}) {
  if (LEVELS[level] < minLevel) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  };
  const out = level === 'error' ? process.stderr : process.stdout;
  out.write(JSON.stringify(line) + '\n');
}

const log = {
  debug: (msg, f) => emit('debug', msg, f),
  info: (msg, f) => emit('info', msg, f),
  warn: (msg, f) => emit('warn', msg, f),
  error: (msg, f) => { emit('error', msg, f); monitor.capture(msg, (f && f.err) || msg, f); },
  // Përjashtimet: mesazhi + grumbulli, por pa fusha të ndjeshme — dhe njoftim
  // jashtë serverit (Sentry ose webhook) kur është konfiguruar.
  exception: (msg, err, f) => {
    emit('error', msg, { ...f, err: String((err && err.message) || err), stack: err && err.stack ? String(err.stack).split('\n').slice(0, 6).join(' | ') : undefined });
    monitor.capture(msg, err, f);
  },
};

// ID e kërkesës: lidh çdo log me një kërkesë të vetme klienti.
function requestId(req, res, next) {
  const incoming = req.headers['x-request-id'];
  req.id = (incoming && String(incoming).slice(0, 64)) || crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-Id', req.id);
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    emit('info', 'request', {
      reqId: req.id,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      ms: Math.round(ms * 10) / 10,
      user: (req.user && req.user.username) || undefined,
      company: req.company || undefined,
      ip: req.ip,
    });
  });
  next();
}

module.exports = { log, requestId, monitor };
