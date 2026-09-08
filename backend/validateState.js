// BioBes API — kontrolli i stokut + forma e state-it NË SERVER.
// Çdo PUT /api/state kalon këtu: refuzohet me 400 nëse gjen probleme.
const KNOWN = ['products', 'suppliers', 'customers', 'warehouses', 'lots', 'weighings',
  'purchaseInvoices', 'salesInvoices', 'orders', 'payments', 'customerPayments', 'users'];

function validateState(x) {
  const errors = [];
  if (!x || typeof x !== 'object' || Array.isArray(x)) return { ok: false, errors: ['State-i nuk është objekt'] };
  const known = KNOWN.filter((k) => x[k] !== undefined);
  if (known.length < 3) errors.push('State-i nuk përmban fusha të njohura (' + known.length + '/3)');
  KNOWN.forEach((k) => { if (x[k] !== undefined && !Array.isArray(x[k])) errors.push(k + ' duhet të jetë array'); });
  ['products', 'suppliers', 'customers', 'warehouses', 'lots', 'weighings', 'payments'].forEach((k) => {
    if (!Array.isArray(x[k])) return;
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
  (Array.isArray(x.lots) ? x.lots : []).forEach((r) => {
    if (r && typeof r.net === 'number' && r.net < 0) errors.push('Loti ' + r.id + ': neto negative (' + r.net + ')');
  });
  (Array.isArray(x.weighings) ? x.weighings : []).forEach((r) => {
    if (r && typeof r.net === 'number' && r.net < 0) errors.push('Peshimi ' + r.id + ': neto negative (' + r.net + ')');
  });
  (Array.isArray(x.payments) ? x.payments : []).forEach((r) => {
    if (r && typeof r.amount === 'number' && !(r.amount > 0)) errors.push('Pagesa ' + r.id + ': shuma duhet > 0');
  });
  return { ok: errors.length === 0, errors: errors.slice(0, 50) };
}

module.exports = { validateState };
