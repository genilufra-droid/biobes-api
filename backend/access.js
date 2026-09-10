// BioBes API — qasja sipas modelit Odoo (ir.model.access + ir.rule + res.groups).
// I gjithë kontrolli i moduleve kalon këtu: një përdorues sheh/shkruan vetëm
// modelet që i janë dhënë përmes grupeve të tij (përfshirë grupet e nënkuptuara).
const { getPool } = require('./db');

// Hartë: model → (modul → fushat e gjendjes që i takojnë modulit).
// Është e njëjta ndarje që përdor `validateState` (KNOWN) e frontend-i.
const MODEL_MODULES = {
  app_state: {
    'MOD-INV': ['products', 'warehouses', 'lots', 'weighings'],
    'MOD-SAL': ['customers', 'salesInvoices', 'orders'],
    'MOD-PUR': ['suppliers', 'purchaseInvoices'],
    'MOD-FIN': ['payments', 'customerPayments'],
    'MOD-SET': ['users'],
  },
};

// Roli ROLE-ADMIN është "superuser" (si uid=1 në Odoo): bypass i plotë.
function isSuperuser(user) {
  return !!user && (user.role === 'ROLE-ADMIN' || user.is_superuser === true);
}

// Zgjidh grupet e përdoruesit duke përfshirë implikimet (implied_group_ids),
// rekurzivisht — si metoda `_expand_groups` e Odo-s.
async function resolveGroups(userId, pool) {
  const p = pool || getPool();
  const direct = await p.query('SELECT group_id FROM user_groups WHERE user_id=$1', [userId]);
  const result = new Set(direct.rows.map((r) => r.group_id));
  let frontier = Array.from(result);
  let guard = 0;
  while (frontier.length && guard++ < 32) {
    const { rows } = await p.query(
      'SELECT id, implied_group_ids FROM access_groups WHERE id = ANY($1::text[])', [frontier]);
    const next = [];
    for (const g of rows) {
      for (const id of (g.implied_group_ids || [])) {
        if (!result.has(id)) { result.add(id); next.push(id); }
      }
    }
    frontier = next;
  }
  return result;
}

// Të drejtat efektive mbi një model (si `ir.model.access::check`): OR-i i të
// gjitha grupeve të përdoruesit për modelin e kërkuar.
async function modelAccess(userId, model, pool) {
  if (!userId) return null;
  const p = pool || getPool();
  const groupIds = await resolveGroups(userId, p);
  const { rows } = await p.query(
    `SELECT bool_or(perm_read)  AS "read",
            bool_or(perm_write) AS "write",
            bool_or(perm_create) AS "create",
            bool_or(perm_unlink) AS "unlink"
     FROM access_rights WHERE model=$1 AND group_id = ANY($2::text[])`, [model, Array.from(groupIds)]);
  const r = rows[0];
  return { read: !!r.read, write: !!r.write, create: !!r.create, unlink: !!r.unlink };
}

// Si `check_access_rights` i Odo-s.
function checkAccess(access, action) {
  return !!access && access[action] === true;
}

// Rregullat e regjistrimeve (ir.rule): filtrat JSON `domain_force` për modelin,
// të kombinuara me OR (një rregull që lejon = lejohet). Grupi Administrator është
// gjithmonë i përjashtuar (rregulli `global` i Odo-s).
async function modelDomain(userId, model, pool) {
  const p = pool || getPool();
  const groupIds = await resolveGroups(userId, p);
  if (groupIds.has('GRP-SET-ADMIN')) return null; // pa kufizim
  const { rows } = await p.query(
    `SELECT domain, perm_read, perm_write, perm_create, perm_unlink
     FROM access_rules WHERE model=$1 AND group_id = ANY($2::text[])`, [model, Array.from(groupIds)]);
  if (!rows.length) return null; // pa rregulla → pa kufizim regjistrimi
  return rows.map((r) => ({
    domain: (r.domain && typeof r.domain === 'object') ? r.domain : {},
    read: !!r.perm_read, write: !!r.perm_write, create: !!r.perm_create, unlink: !!r.perm_unlink,
  }));
}

// Kontroll i thjeshtë i një regjistrimi kundrejt një domain-i JSON (subset i
// shprehjeve që përdor Odoo për domain_force: p.sh. {"warehouseId":"WH-1"} ose
// {"state":["in","draft","open"]}).
function recordMatchesDomain(record, domain) {
  const keys = Object.keys(domain || {});
  if (!keys.length) return true;
  return keys.every((k) => {
    const v = domain[k];
    if (Array.isArray(v)) {
      const op = v[0];
      const args = v.slice(1);
      if (op === 'in') return args.some((arg) => (Array.isArray(arg) ? arg.includes(record[k]) : arg === record[k]));
      if (op === '=') return record[k] === args[0];
      if (op === '!=') return record[k] !== args[0];
      return false;
    }
    return record[k] === v;
  });
}

// Modulet (aplikacionet) që sheh përdoruesi mbi modelin app_state: ato që kanë
// të paktën një grup të përdoruesit me lexim app_state.
async function stateModules(userId, pool) {
  const p = pool || getPool();
  const groupIds = await resolveGroups(userId, p);
  if (groupIds.has('GRP-SET-ADMIN')) return null; // Administrator → gjithë modulet

  const { rows } = await p.query(
    `SELECT DISTINCT g.module_id
     FROM access_rights ar JOIN access_groups g ON g.id = ar.group_id
     WHERE ar.model='app_state' AND ar.perm_read = TRUE AND ar.group_id = ANY($1::text[])`,
    [Array.from(groupIds)]);

  const moduleIds = Array.from(new Set(rows.map((r) => r.module_id)));
  const allowedFields = new Set();
  const fieldMap = (MODEL_MODULES.app_state || {});
  for (const mid of moduleIds) {
    const fields = fieldMap[mid];
    if (Array.isArray(fields)) fields.forEach((f) => allowedFields.add(f));
    else allowedFields.add(mid); // modul pa hartë fushash (i ardhshëm): lejohet me emër
  }
  return {
    full: false,
    allowedModules: moduleIds.sort(),
    allowedFields: Array.from(allowedFields).sort(),
  };
}

// Zbaton filtrin e moduleve mbi një objekt gjendjeje: ruan vetëm fushat e lejuara.
function applyStateModules(state, filter) {
  if (!filter || filter.full || !state || typeof state !== 'object' || Array.isArray(state)) return state;
  const out = {};
  for (const k of Object.keys(state)) {
    if (filter.allowedFields.includes(k)) out[k] = state[k];
  }
  return out;
}

// Paketa që i jepet serverit për një user të autentikuar (cached në req).
async function loadAccessContext(user, pool) {
  if (!user || !user.id) return { user, superuser: false, modules: null, allowedModules: [] };
  const p = pool || getPool();
  if (isSuperuser(user)) {
    return { user, superuser: true, modules: null, allowedModules: [] };
  }
  const modules = await stateModules(user.id, p);
  return { user, superuser: false, modules, allowedModules: modules ? modules.allowedModules : [] };
}

module.exports = {
  isSuperuser,
  resolveGroups,
  modelAccess,
  checkAccess,
  modelDomain,
  recordMatchesDomain,
  stateModules,
  applyStateModules,
  loadAccessContext,
  MODEL_MODULES,
};
