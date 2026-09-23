// BioBes API — Ngjarje në kohë reale (SSE).
// Hubi mban lidhjet e hapura me pajisjet dhe njofton menjëherë çdo ndryshim
// gjendjeje, kompanish ose të drejtash. Kështu faqja nuk pret 5 sekonda
// dhe as nuk ka nevojë për rifreskim manual — serveri është e vërteta.
//
// Rregullat e shpërndarjes:
//  - superuser (admin) merr ngjarjet e të gjitha kompanive;
//  - përdoruesit e tjerë marrin vetëm ngjarjet e kompanive ku janë anëtarë;
//  - ngjarjet globale (kompanitë, të drejtat) shkojnë te të gjithë.

const bus = require('./bus');
const { log } = require('./log');
const clients = new Set();
let seq = 0;

function add(client) { clients.add(client); return client; }
function remove(client) { clients.delete(client); }
function size() { return clients.size; }
function list() { return [...clients]; }

function send(client, event, payload) {
  try {
    client.res.write('event: ' + event + '\n');
    client.res.write('data: ' + JSON.stringify(payload || {}) + '\n');
    client.res.write('id: ' + (++seq) + '\n\n');
    return true;
  } catch (e) {
    remove(client);
    return false;
  }
}

// Shpërndarje brenda kësaj instance (pa e ripublikuar në autobus).
function broadcastLocal(event, payload, opts = {}) {
  const company = opts.company ? String(opts.company) : '';
  let n = 0;
  for (const c of [...clients]) {
    if (company && !c.superuser && !(c.companies || []).includes(company)) continue;
    if (send(c, event, payload)) n++;
  }
  return n;
}

// Pika e vetme hyrëse: shpërndaje te pajisjet e kësaj instance DHE njofto
// instancat e tjera (LISTEN/NOTIFY në Postgres) që të bëjnë të njëjtën gjë.
// Pa këtë, me autoscale një ndryshim i bërë në instancën A nuk arrinte kurrë
// te pajisjet që rrinë lidhur në instancën B.
function broadcast(event, payload, opts = {}) {
  if (bus.isEnabled()) { bus.publish(event, payload, opts).catch(() => {}); }
  return broadcastLocal(event, payload, opts);
}

// Ngjarje të ardhura nga një instancë tjetër: shpërndahen vetëm lokalisht,
// përndryshe do të krijohej një cikël i pafund mes instancave.
bus.onMessage(({ event, payload, opts }) => {
  if (!event) { log.warn('bus: njoftim pa emër ngjarjeje'); return; }
  const n = broadcastLocal(event, payload, opts || {});
  log.info('bus: ngjarje nga instancë tjetër u shpërndarë lokalisht', { event, clients: clients.size, delivered: n });
});

const stateChanged = (company, version, actor, extra = {}) =>
  broadcast('state-changed', { company, version, actor, at: new Date().toISOString(), ...extra }, { company });

const companiesChanged = (payload = {}) =>
  broadcast('companies-changed', { at: new Date().toISOString(), ...payload });

const rightsChanged = (payload = {}) =>
  broadcast('rights-changed', { at: new Date().toISOString(), ...payload });

const wiped = (company, wipedAt, actor) =>
  broadcast('state-changed', { company, wiped: true, wipedAt, actor, at: new Date().toISOString() }, { company });

// Mbyll çdo lidhje SSE të hapur (përdoret nga mbyllja e butë e serverit,
// që klientët të mos presin timeout-in e Render-it gjatë një deploy-i).
function closeAll() {
  let n = 0;
  for (const c of [...clients]) {
    try { c.res.write('event: goodbye\ndata: {}\n\n'); c.res.end(); n++; } catch (e) {}
    clients.delete(c);
  }
  return n;
}

// Pastrim i periodik i lidhjeve të thyera (pajisje që humbin rrjetin pa u shkëputur).
function startHeartbeat(intervalMs = 25000) {
  const t = setInterval(() => {
    for (const c of [...clients]) {
      try { c.res.write(': ping ' + Date.now() + '\n\n'); } catch (e) { remove(c); }
    }
  }, intervalMs);
  if (t.unref) t.unref();
  return t;
}

module.exports = { add, remove, size, list, send, closeAll, broadcast, stateChanged, companiesChanged, rightsChanged, wiped, startHeartbeat };
