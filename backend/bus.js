// BioBes API — autobus i ngjarjeve midis instancave.
//
// SSE-ja (events.js) mban lidhjet në kujtesën e procesit. Me një instancë kjo
// mjafton; me dy ose më shumë (autoscale, ose deploy me mbivendosje në Render)
// një ndryshim i bërë në instancën A nuk arrinte kurrë te pajisjet që rrinë
// lidhur në instancën B.
//
// Zgjidhja: Postgres LISTEN/NOTIFY — e njëjta databazë që kemi tashmë (Aiven),
// pa infrastrukturë të re (as Redis, as kosto shtesë). Çdo instancë dërgon me
// pg_notify dhe dëgjon në një lidhje të vetme të dedikuar.
//
// Aktivizohet me MULTI_INSTANCE=1 (parazgjedhje: jo, që një instancë e vetme
// të mos paguajë një lidhje shtesë dhe një round-trip për çdo ngjarje).
const os = require('os');
const crypto = require('crypto');
const { Client } = require('pg');
const { log } = require('./log');

// Identiteti i kësaj instance. Postgres-i ua dërgon NOTIFY-n edhe vetë
// dërguesit, ndaj pa këtë çdo ngjarje do të shpërndahej dy herë te pajisjet e
// instancës që e prodhoi.
const MY_ID = process.env.INSTANCE_ID
  || (os.hostname() + ':' + process.pid + ':' + crypto.randomBytes(3).toString('hex'));

const CHANNEL = 'biobes_events';
const enabled = String(process.env.MULTI_INSTANCE || '').toLowerCase() === '1'
  || String(process.env.MULTI_INSTANCE || '').toLowerCase() === 'true';

let client = null;
let stopping = false;
const handlers = new Set();

function isEnabled() { return enabled; }

// Parametri i tretë është derë prove: suite-ja lokale fut një klient të sajuar,
// sepse serveri i socket-it të PGlite-it nuk ua përcjell njoftimet NOTIFY
// klientëve të lidhur (në Postgres të vërtetë kjo është sjellje standarde).
async function start(connectionString, ssl, injectedClient) {
  if (!enabled || client) return false;
  client = injectedClient || new Client({ connectionString, ssl });
  client.on('error', (e) => log.error('bus: lidhja ra', { err: e.message }));
  client.on('notification', (msg) => {
    if (!msg || !msg.payload) return;
    try {
      const data = JSON.parse(msg.payload);
      // Postgres-i ua dërgon NOTIFY-n edhe vetë dërguesit: pa këtë filtër çdo
      // ngjarje do të shpërndahej dy herë te pajisjet e instancës që e prodhoi.
      if (data && data.from && data.from === MY_ID) return;
      for (const h of handlers) { try { h(data); } catch (e) { log.error('bus: handler', { err: e.message }); } }
    } catch (e) { log.warn('bus: payload i pavlefshëm', { err: e.message }); }
  });
  try {
    await client.connect();
    await client.query('LISTEN ' + CHANNEL);
    log.info('bus: dëgjon për ngjarje midis instancave', { channel: CHANNEL });
    return true;
  } catch (e) {
    log.error('bus: nuk u lidh — vazhdohet vetëm brenda instancës', { err: e.message });
    client = null;
    return false;
  }
}

function onMessage(fn) { handlers.add(fn); return () => handlers.delete(fn); }

// Dërgo te instancat e tjera. Mos e prisni: nëse autobusi s'punon, ngjarja
// shpërndahet brenda kësaj instance gjithsesi.
async function publish(event, payload, opts = {}) {
  if (!enabled || !client || stopping) return 0;
  try {
    const body = JSON.stringify({ event, payload, opts, from: MY_ID });
    await client.query('SELECT pg_notify($1, $2)', [CHANNEL, body]);
    return 1;
  } catch (e) {
    log.error('bus: dërgimi dështoi', { err: e.message });
    return 0;
  }
}

async function stop() {
  stopping = true;
  if (client) { try { await client.end(); } catch (e) {} }
  client = null;
}

module.exports = { start, stop, publish, onMessage, isEnabled, CHANNEL, myId: () => MY_ID };
