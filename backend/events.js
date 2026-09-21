// BioBes API — Ngjarje në kohë reale (SSE).
// Hubi mban lidhjet e hapura me pajisjet dhe njofton menjëherë çdo ndryshim
// gjendjeje, kompanish ose të drejtash. Kështu faqja nuk pret 5 sekonda
// dhe as nuk ka nevojë për rifreskim manual — serveri është e vërteta.
//
// Rregullat e shpërndarjes:
//  - superuser (admin) merr ngjarjet e të gjitha kompanive;
//  - përdoruesit e tjerë marrin vetëm ngjarjet e kompanive ku janë anëtarë;
//  - ngjarjet globale (kompanitë, të drejtat) shkojnë te të gjithë.

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

// Kujt i shkon: param `company` kufizon te anëtarët e asaj kompanie (ose superuser).
function broadcast(event, payload, opts = {}) {
  const company = opts.company ? String(opts.company) : '';
  let n = 0;
  for (const c of [...clients]) {
    if (company && !c.superuser && !(c.companies || []).includes(company)) continue;
    if (send(c, event, payload)) n++;
  }
  return n;
}

const stateChanged = (company, version, actor, extra = {}) =>
  broadcast('state-changed', { company, version, actor, at: new Date().toISOString(), ...extra }, { company });

const companiesChanged = (payload = {}) =>
  broadcast('companies-changed', { at: new Date().toISOString(), ...payload });

const rightsChanged = (payload = {}) =>
  broadcast('rights-changed', { at: new Date().toISOString(), ...payload });

const wiped = (company, wipedAt, actor) =>
  broadcast('state-changed', { company, wiped: true, wipedAt, actor, at: new Date().toISOString() }, { company });

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

module.exports = { add, remove, size, list, send, broadcast, stateChanged, companiesChanged, rightsChanged, wiped, startHeartbeat };
