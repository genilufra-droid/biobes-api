// BioBes API — kontrolli i stokut + forma e state-it NË SERVER.
// Çdo PUT /api/state kalon këtu: refuzohet me 400 nëse gjen probleme.
// Opsioni `onlyFields` kufizon validimin vetëm në fushat që përdoruesi ka
// të drejtë t'i shkruajë (qasja sipas moduleve, si Odoo).
//
// LISTA E PLOTË E FUSHAVE TË GJENDJES (një burim i vetëm i së vërtetës).
// Çdo fushë këtu duhet të jetë array në state. Nëse një fushë mungon nga
// kjo listë, ajo konsiderohet "e panjohur" dhe pranohet pa validim
// (për fushat e reja nga frontend-i që ende s'janë përditësuar).
const CORE_ARRAYS = [
  // Organizimi
  'companies', 'users', 'warehouses', 'racks', 'machines',
  // Inventari
  'products', 'lots', 'weighings', 'processes', 'packagings',
  'stockMovements', 'inventories', 'inventoryTransfers',
  'customerReturns', 'supplierReturns', 'alphaMasters',
  // Palët
  'suppliers', 'customers',
  // Dokumentet
  'purchaseInvoices', 'salesInvoices', 'orders', 'samples',
  'shipments', 'exportDossiers', 'documents', 'documentSets',
  // Financa
  'payments', 'customerPayments', 'bankTransactions', 'bankAccounts',
  'accounting', 'cashRegisters',
  // Të ndryshme
  'events', 'notes', 'tasks', 'notifications',
];
// Fushat kritike që S'DO TË MUNGTËN kurrë nga një PUT nga një superuser
// (mungesa e tyre tregon se klienti po dërgon një state të cunguar nga cache
//  e vjetër dhe do të fshinte të dhëna — e refuzojmë në vend që të prishim).
const CRITICAL_FIELDS = ['companies', 'products', 'customers', 'suppliers', 'warehouses'];
// Fushat e panjohura pranohen (lehtësojmë përditësimet e frontendit),
// por duhet të ekzistojë të paktën një fushë e njohur që state-i të mos jetë bosh.
const KNOWN = CORE_ARRAYS;

function validateState(x, opts) {
  const onlyFields = (opts && Array.isArray(opts.onlyFields)) ? new Set(opts.onlyFields) : null;
  const requireAllKnown = !!(opts && opts.requireAllKnown);
  const errors = [];
  if (!x || typeof x !== 'object' || Array.isArray(x)) return { ok: false, errors: ['State-i nuk është objekt'] };
  const presentKnown = KNOWN.filter((k) => x[k] !== undefined && (!onlyFields || onlyFields.has(k)));
  if (presentKnown.length < 1 && Object.keys(x).length < 3) {
    errors.push('State-i nuk përmban fusha të njohura');
  }
  const scope = onlyFields || new Set(KNOWN);
  KNOWN.forEach((k) => {
    if (scope.has(k) && x[k] !== undefined && !Array.isArray(x[k])) errors.push(k + ' duhet të jetë array');
  });
  // Validim i ID-ve të fushave të biznesit.
  const idFields = ['companies', 'products', 'suppliers', 'customers', 'warehouses', 'lots', 'weighings', 'payments',
    'customerPayments', 'salesInvoices', 'purchaseInvoices', 'orders', 'stockMovements', 'documents'];
  idFields.forEach((k) => {
    if (!scope.has(k) || !Array.isArray(x[k])) return;
    const ids = new Set();
    x[k].forEach((r, i) => {
      if (!r || typeof r !== 'object') { errors.push(k + '[' + i + '] nuk është objekt'); return; }
      const id = r.id || r.code;
      if (!id) errors.push(k + '[' + i + '] nuk ka ID');
      else if (ids.has(id)) errors.push(k + ': ID duplikate ' + id);
      else ids.add(id);
    });
  });
  // Kontrolli i stokut: neto negative dhe shuma jo-pozitive nuk pranohen.
  if (scope.has('lots')) (Array.isArray(x.lots) ? x.lots : []).forEach((r) => {
    if (r && typeof r.net === 'number' && r.net < 0) errors.push('Loti ' + (r.id||'?') + ': neto negative (' + r.net + ')');
  });
  if (scope.has('weighings')) (Array.isArray(x.weighings) ? x.weighings : []).forEach((r) => {
    if (r && typeof r.net === 'number' && r.net < 0) errors.push('Peshimi ' + (r.id||'?') + ': neto negative (' + r.net + ')');
  });
  if (scope.has('payments')) (Array.isArray(x.payments) ? x.payments : []).forEach((r) => {
    if (r && typeof r.amount === 'number' && !(r.amount > 0)) errors.push('Pagesa ' + (r.id||'?') + ': shuma duhet > 0');
  });
  // Kontrolli i fushave kritike (kur kërkohet nga serveri për shkrim superuser).
  if (requireAllKnown) {
    CRITICAL_FIELDS.forEach((k) => {
      if (!Array.isArray(x[k])) errors.push('Fusha kritike `' + k + '` mungon — klienti po dërgon state të cunguar. Bëj pull nga serveri përpara ruajtjes.');
    });
  }
  return { ok: errors.length === 0, errors: errors.slice(0, 50) };
}

module.exports = { validateState, KNOWN, CORE_ARRAYS, CRITICAL_FIELDS };
