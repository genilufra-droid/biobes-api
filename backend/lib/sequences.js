'use strict';
/* lib/sequences.js — numra dokumentesh të sigurt për 20 përdorues konkurrent.
 *
 * Problemi real: dy pajisje krijojnë faturë në të njëjtin çast. Të dyja llogarisin
 * «numrin e radhës» nga lista VENDORE → i njëjti numër → dyfishim ose mbishkrim.
 * Zgjidhja: numri merret nga një rresht i vetëm i bllokuar me SELECT … FOR UPDATE
 * në doc_sequences (company_id, kind, period). Transaksioni i dytë PRET derisa i pari
 * të bëjë COMMIT, pastaj merr numrin pasardhës. Asnjë dyfishim, asnjë humbje.
 *
 * Kërkon: migrimet 011_doc_sequences.sql + lib/pgCompany.js (client brenda transaksionit).
 *
 *   const { withCompany } = require('./lib/pgCompany');
 *   const { nextNumber } = require('./lib/sequences');
 *   const number = await withCompany(ctx, (client) => nextNumber(client, ctx.companyId, 'sales_invoice'));
 *   // → 'FSH-2026-0007'
 */

const KINDS = {
  sales_invoice:    { prefix: 'FSH', period: 'year',  table: 'sales_invoices',    column: 'number' },
  purchase_invoice: { prefix: 'FBL', period: 'year',  table: 'purchase_invoices', column: 'number' },
  stock_in:         { prefix: 'FH',  period: 'year',  table: '', column: '' },
  stock_out:        { prefix: 'FD',  period: 'year',  table: '', column: '' },
  weighing:         { prefix: 'PS',  period: 'year',  table: 'weighings', column: '' },
  sample:           { prefix: 'MS',  period: 'year',  table: '', column: '' },
  order:            { prefix: 'POR', period: 'year',  table: '', column: '' },
  shipment:         { prefix: 'NG',  period: 'year',  table: '', column: '' },
  customer_return:  { prefix: 'RK',  period: 'year',  table: '', column: '' },
  supplier_return:  { prefix: 'RF',  period: 'year',  table: '', column: '' },
  payment:          { prefix: 'PG',  period: 'year',  table: 'payments', column: '' },
  customer_payment: { prefix: 'AR',  period: 'year',  table: 'customer_payments', column: '' },
};

function periodKey(mode, at) {
  const d = at instanceof Date ? at : new Date(at || Date.now());
  const y = d.getUTCFullYear();
  if (mode === 'none') return '';
  if (mode === 'month') return y + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
  return String(y);
}

function formatNumber(prefix, period, n, pad) {
  const seq = String(n).padStart(pad || 4, '0');
  return period ? prefix + '-' + period + '-' + seq : prefix + '-' + seq;
}

/* Numri i radhës (i bllokuar). Thirret BRENDA një transaksioni. */
async function nextNumber(client, companyId, kind, options) {
  const opt = options || {};
  const cfg = KINDS[kind];
  if (!cfg) throw Object.assign(new Error('Lloj dokumenti i panjohur: ' + kind), { status: 400 });
  if (!companyId) throw Object.assign(new Error('Mungon company_id për numërimin'), { status: 400 });

  const period = opt.period != null ? String(opt.period) : periodKey(opt.periodMode || cfg.period, opt.at);
  const prefix = String(opt.prefix || cfg.prefix);
  const pad = opt.pad || 4;

  await client.query(
    `INSERT INTO doc_sequences (company_id, kind, period, last_number, prefix)
     VALUES ($1, $2, $3, 0, $4)
     ON CONFLICT (company_id, kind, period) DO NOTHING`,
    [companyId, kind, period, prefix]
  );

  // Bllokimi i rreshtit: kjo është pika ku garë e 20 përdoruesve ndalet.
  const lock = await client.query(
    `SELECT last_number FROM doc_sequences
      WHERE company_id = $1 AND kind = $2 AND period = $3
      FOR UPDATE`,
    [companyId, kind, period]
  );
  if (!lock.rows.length) throw Object.assign(new Error('Sekuenca nuk u gjet'), { status: 500 });

  const next = Number(lock.rows[0].last_number) + 1;
  const number = opt.suffix ? formatNumber(prefix, period, next, pad) + '-' + opt.suffix : formatNumber(prefix, period, next, pad);

  await client.query(
    `UPDATE doc_sequences SET last_number = $1, prefix = $2, updated_at = NOW(), updated_by = $3
      WHERE company_id = $4 AND kind = $5 AND period = $6`,
    [next, prefix, String(opt.userId || ''), companyId, kind, period]
  );
  await markUsed(client, companyId, kind, number, opt);
  return number;
}

/* Numri që një pajisje e ka zgjedhur vetë: pranohet VETËM nëse është i lirë.
 * Nëse është i zënë → kthehet { conflict:true, number } që API-ja të japë 409
 * me { ok:false, conflict:'number', number, nextNumber } (kontrata e frontend-it). */
async function reserveNumber(client, companyId, kind, wanted, options) {
  const opt = options || {};
  const cfg = KINDS[kind] || {};
  const n = String(wanted || '').trim();
  if (!n) return { ok: false, reason: 'empty' };

  // 1) A ekziston në tabelën e dokumenteve?
  if (cfg.table && cfg.column) {
    const r = await client.query(
      `SELECT 1 FROM ${cfg.table} WHERE company_id = $1 AND ${cfg.column} = $2 LIMIT 1`,
      [companyId, n]
    );
    if (r.rowCount) return await conflict(client, companyId, kind, n, opt);
  }
  // 2) A është lëshuar më parë nga sekuenca?
  const used = await client.query(
    `SELECT 1 FROM doc_numbers_used WHERE company_id = $1 AND kind = $2 AND number = $3 LIMIT 1`,
    [companyId, kind, n]
  );
  if (used.rowCount) return await conflict(client, companyId, kind, n, opt);

  // 3) E zëmë: e regjistron si të lëshuar (pa prekur last_number nëse është më i vogël).
  await markUsed(client, companyId, kind, n, opt);
  await bumpSequenceTo(client, companyId, kind, n, opt);
  return { ok: true, number: n };
}

async function conflict(client, companyId, kind, number, opt) {
  const suggested = await peekNext(client, companyId, kind, opt);
  return { ok: false, conflict: true, number, nextNumber: suggested };
}

async function markUsed(client, companyId, kind, number, opt) {
  await client.query(
    `INSERT INTO doc_numbers_used (company_id, kind, number, table_name, doc_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (company_id, kind, number) DO NOTHING`,
    [companyId, kind, number, (KINDS[kind] || {}).table || '', String(opt.docId || '')]
  );
}

/* Nëse dokumenti u ruajt me numër më të madh se sekuenca, sekuenca ngrihet
 * që numri pasardhës të mos bjerë mbi një numër të ekzistues. */
async function bumpSequenceTo(client, companyId, kind, number, opt) {
  const cfg = KINDS[kind] || {};
  const period = opt.period != null ? String(opt.period) : periodKey(opt.periodMode || cfg.period, opt.at);
  const m = String(number).match(/(\d+)\s*$/);
  if (!m) return;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return;
  await client.query(
    `INSERT INTO doc_sequences (company_id, kind, period, last_number)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (company_id, kind, period)
     DO UPDATE SET last_number = GREATEST(doc_sequences.last_number, EXCLUDED.last_number), updated_at = NOW()`,
    [companyId, kind, period, n]
  );
}

/* Shiko numrin pasardhës PA e bllokuar (për UI / mesazhe). */
async function peekNext(client, companyId, kind, options) {
  const opt = options || {};
  const cfg = KINDS[kind] || {};
  const period = opt.period != null ? String(opt.period) : periodKey(opt.periodMode || cfg.period, opt.at);
  const r = await client.query(
    `SELECT last_number, prefix FROM doc_sequences WHERE company_id = $1 AND kind = $2 AND period = $3`,
    [companyId, kind, period]
  );
  const last = r.rows.length ? Number(r.rows[0].last_number) : 0;
  const prefix = (r.rows.length && r.rows[0].prefix) || cfg.prefix || '';
  return formatNumber(prefix, period, last + 1, opt.pad || 4);
}

module.exports = { KINDS, nextNumber, reserveNumber, peekNext, formatNumber, periodKey };
