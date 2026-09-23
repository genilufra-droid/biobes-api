// BioBes API — kufizues kërkesash me dy motorë.
//
// - në kujtesë (parazgjedhje, një instancë): mjafton dhe s'paguan asgjë;
// - në databazë (MULTI_INSTANCE=1): kufiri vlen për të GJITHA instancat, jo
//   veç për atë që e godet klienti. Pa këtë, me 3 instanca një sulmues merr
//   në të vërtetë 3× kufirin (dhe një përdorues i zakonshëm mund të bllokohet
//   nga instanca e gabuar).
//
// Tabela rate_buckets krijohet nga migrimi 010.
const { getPool } = require('./db');
const { log } = require('./log');

const multi = String(process.env.MULTI_INSTANCE || '').toLowerCase() === '1'
  || String(process.env.MULTI_INSTANCE || '').toLowerCase() === 'true';

// Koha e skadimit të një kërkese nëse databaza s'përgjigjet: preferojmë ta
// lëmë kërkesën të kalojë sesa të bllokojmë gjithë API-n.
function dbLimit(max, windowMs, keyFn) {
  return async (req, res, next) => {
    let who;
    try { who = keyFn ? keyFn(req) : (req.ip || '?'); } catch (e) { who = req.ip || '?'; }
    const key = who + ':' + (req.route && req.route.path ? req.route.path : req.path);
    const p = getPool();
    if (!p) return next();
    try {
      const { rows } = await p.query(
        `INSERT INTO rate_buckets(key, count, reset_at)
              VALUES ($1, 1, NOW() + ($2 || ' milliseconds')::interval)
         ON CONFLICT (key) DO UPDATE SET
              count    = CASE WHEN rate_buckets.reset_at < NOW() THEN 1 ELSE rate_buckets.count + 1 END,
              reset_at = CASE WHEN rate_buckets.reset_at < NOW() THEN NOW() + ($2 || ' milliseconds')::interval
                              ELSE rate_buckets.reset_at END
           RETURNING count, reset_at`,
        [String(key).slice(0, 200), String(windowMs)]
      );
      const { count, reset_at: resetAt } = rows[0];
      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - count)));
      if (count > max) {
        const retry = Math.max(1, Math.ceil((new Date(resetAt).getTime() - Date.now()) / 1000));
        res.setHeader('Retry-After', String(retry));
        return res.status(429).json({ ok: false, error: 'Shumë kërkesa — provoni përsëri pas ' + retry + ' s' });
      }
    } catch (e) {
      log.warn('ratelimit: databaza nuk u arrit, kalohet pa kufizim', { err: e.message });
    }
    return next();
  };
}

// Motor në kujtesë (një instancë). Tabela pastrohet çdo 5 minuta.
const buckets = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
}, 5 * 60 * 1000).unref();

function memLimit(max, windowMs, keyFn) {
  return (req, res, next) => {
    let who;
    try { who = keyFn ? keyFn(req) : (req.ip || '?'); } catch (e) { who = req.ip || '?'; }
    const key = who + ':' + (req.route && req.route.path ? req.route.path : req.path);
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.reset < now) { b = { count: 0, reset: now + windowMs }; buckets.set(key, b); }
    b.count++;
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - b.count)));
    if (b.count > max) {
      const retry = Math.max(1, Math.ceil((b.reset - now) / 1000));
      res.setHeader('Retry-After', String(retry));
      return res.status(429).json({ ok: false, error: 'Shumë kërkesa — provoni përsëri pas ' + retry + ' s' });
    }
    return next();
  };
}

// Zgjedhja e motorit bëhet në kohë nisjeje (MULTI_INSTANCE).
const rateLimit = (max, windowMs, keyFn) => (multi ? dbLimit(max, windowMs, keyFn) : memLimit(max, windowMs, keyFn));

// Pastrimi i rreshtave të skaduar (thirret periodikisht nga server.js).
async function cleanup() {
  if (!multi) return 0;
  try {
    const { rowCount } = await getPool().query('DELETE FROM rate_buckets WHERE reset_at < NOW() - INTERVAL \'1 hour\'');
    return rowCount;
  } catch (e) { return 0; }
}

module.exports = { rateLimit, cleanup, isDbBacked: () => multi };
