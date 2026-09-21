// Modul i ndarë për SSE (për të shmangur ciklin e require-ve me company.js).
// Mbajtur në këtë file që të importohet nga server.js dhe nga company.js.
let sseClients = new Map();
let sseEventId = 0;

function registerClient(tokenHash, ctx) {
  sseClients.set(tokenHash, ctx);
}
function removeClient(tokenHash) {
  const c = sseClients.get(tokenHash);
  if (c) { try { c.res.end(); } catch (e) {} sseClients.delete(tokenHash); }
}
function broadcastSSE(event, data) {
  sseEventId++;
  const payload = 'event: ' + event + '\nid: ' + sseEventId + '\ndata: ' + JSON.stringify(data) + '\n\n';
  for (const [, c] of sseClients) {
    try { c.res.write(payload); } catch (e) {}
  }
}
// Dërgon event vetëm tek klientët që janë aktualisht në atë kompani.
function broadcastCompanyEvent(companyId, event, data) {
  sseEventId++;
  const payload = 'event: ' + event + '\nid: ' + sseEventId + '\ndata: ' + JSON.stringify({ ...data, companyId }) + '\n\n';
  for (const [, c] of sseClients) {
    if (!c) continue;
    if (c.companies && !c.companies.includes(companyId)) continue;
    try { c.res.write(payload); } catch (e) {}
  }
}

module.exports = { registerClient, removeClient, broadcastSSE, broadcastCompanyEvent };
