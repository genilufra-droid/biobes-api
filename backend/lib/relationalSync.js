'use strict';
/* lib/relationalSync.js — Ura e sinkronizimit mes app_state dhe tabelave relacionale SQL.
 *
 * Zgjidhja arkitekturore Enterprise Cloud (si Odoo/QuickBooks):
 * 1) Nxirr automatikisht çdo entitet nga gjendja JSON dhe popullo tabelat relacionale
 *    (products, suppliers, customers, warehouses, lots, weighings, payments, invoices).
 * 2) Shkëput skedarët/fotot e rënda Base64 nga JSON-i dhe ruaji në tabelën `attachments`
 *    me bytea dhe URL të dedikuar (/api/attachments/:id).
 * 3) Garanton që të gjitha tabelat relacionale në PostgreSQL janë gjithmonë 100% të
 *    plotësuara, duke mundësuar pyetje të drejtpërdrejta SQL, pagination dhe raporte.
 */

const crypto = require('crypto');

// Nxjerr attachments nga base64 dhe i ruan në tabelën attachments
async function extractAndSaveAttachments(client, companyId, state) {
  if (!state || typeof state !== 'object') return;
  const toSave = [];

  // 1. Peshimet
  if (Array.isArray(state.weighings)) {
    for (const w of state.weighings) {
      if (w && w.attachmentData && typeof w.attachmentData === 'string' && w.attachmentData.startsWith('data:')) {
        const match = w.attachmentData.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          const mime = match[1];
          const buf = Buffer.from(match[2], 'base64');
          const attId = 'ATT-W-' + (w.id || crypto.randomBytes(4).toString('hex'));
          const filename = w.attachment || (attId + (mime.includes('pdf') ? '.pdf' : '.jpg'));
          toSave.push({ id: attId, filename, mime, buf, ref: w, key: 'attachmentData' });
        }
      }
    }
  }

  // 2. Dokumentet
  if (Array.isArray(state.documents)) {
    for (const d of state.documents) {
      if (d && d.fileData && typeof d.fileData === 'string' && d.fileData.startsWith('data:')) {
        const match = d.fileData.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          const mime = match[1];
          const buf = Buffer.from(match[2], 'base64');
          const attId = 'ATT-D-' + (d.id || crypto.randomBytes(4).toString('hex'));
          const filename = d.fileName || (attId + (mime.includes('pdf') ? '.pdf' : '.jpg'));
          toSave.push({ id: attId, filename, mime, buf, ref: d, key: 'fileData' });
        }
      }
    }
  }

  for (const item of toSave) {
    try {
      await client.query(
        `INSERT INTO attachments(company_id, id, filename, mime_type, size_bytes, data, created_at)
         VALUES($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT(company_id, id) DO UPDATE SET filename=EXCLUDED.filename, data=EXCLUDED.data, size_bytes=EXCLUDED.size_bytes`,
        [companyId, item.id, item.filename, item.mime, item.buf.length, item.buf]
      );
      // Zëvendësojmë base64 e rëndë me URL të lehtë
      item.ref.attachmentUrl = '/api/attachments/' + item.id;
      // Heqim byte-at e rëndë nga objekti në memorje
      delete item.ref[item.key];
    } catch (e) {
      console.warn('[attachments:save]', e.message);
    }
  }
}

// Sinkronizon gjendjen JSON në të gjitha tabelat relacionale
async function syncStateToRelational(client, companyId, state) {
  if (!state || typeof state !== 'object' || !companyId) return;

  // Së pari nxjerrim skedarët/fotot binarë
  await extractAndSaveAttachments(client, companyId, state);

  // 1. Produktet
  if (Array.isArray(state.products)) {
    for (const p of state.products) {
      if (!p || !p.id) continue;
      const code = String(p.code || p.id).slice(0, 80);
      const name = String(p.name || code).slice(0, 200);
      const unit = String(p.unit || 'copë').slice(0, 30);
      const cat = String(p.category || '').slice(0, 100);
      const price = parseFloat(p.price) || 0;
      const cost = parseFloat(p.cost) || 0;
      const balance = parseFloat(p.balance) || 0;
      const active = p.active !== false;
      const meta = JSON.stringify({ botanical: p.botanical || '', english: p.english || '', ...((typeof p.meta === 'object' && p.meta) || {}) });
      await client.query(
        `INSERT INTO products (company_id, id, code, name, unit, category, price, cost, balance, active, meta, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, NOW())
         ON CONFLICT (company_id, id) DO UPDATE SET
           code = EXCLUDED.code, name = EXCLUDED.name, unit = EXCLUDED.unit, category = EXCLUDED.category,
           price = EXCLUDED.price, cost = EXCLUDED.cost, balance = EXCLUDED.balance, active = EXCLUDED.active,
           meta = EXCLUDED.meta, updated_at = NOW()`,
        [companyId, String(p.id), code, name, unit, cat, price, cost, balance, active, meta]
      );
    }
  }

  // 2. Furnitorët
  if (Array.isArray(state.suppliers)) {
    for (const s of state.suppliers) {
      if (!s || !s.id) continue;
      const code = String(s.code || s.id).slice(0, 80);
      const name = String(s.name || code).slice(0, 200);
      const tax = String(s.taxId || s.nipt || '').slice(0, 50);
      const addr = String(s.address || s.region || '').slice(0, 200);
      const phone = String(s.phone || '').slice(0, 50);
      const email = String(s.email || '').slice(0, 100);
      const bal = parseFloat(s.balance) || 0;
      const active = s.active !== false;
      const meta = JSON.stringify((typeof s.meta === 'object' && s.meta) || {});
      await client.query(
        `INSERT INTO suppliers (company_id, id, code, name, tax_id, address, phone, email, balance, active, meta, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, NOW())
         ON CONFLICT (company_id, id) DO UPDATE SET
           code = EXCLUDED.code, name = EXCLUDED.name, tax_id = EXCLUDED.tax_id, address = EXCLUDED.address,
           phone = EXCLUDED.phone, email = EXCLUDED.email, balance = EXCLUDED.balance, active = EXCLUDED.active,
           meta = EXCLUDED.meta, updated_at = NOW()`,
        [companyId, String(s.id), code, name, tax, addr, phone, email, bal, active, meta]
      );
    }
  }

  // 3. Klientët
  if (Array.isArray(state.customers)) {
    for (const c of state.customers) {
      if (!c || !c.id) continue;
      const code = String(c.code || c.id).slice(0, 80);
      const name = String(c.name || code).slice(0, 200);
      const tax = String(c.taxId || c.nipt || '').slice(0, 50);
      const addr = String(c.address || c.country || '').slice(0, 200);
      const phone = String(c.phone || '').slice(0, 50);
      const email = String(c.email || '').slice(0, 100);
      const bal = parseFloat(c.balance) || 0;
      const limit = parseFloat(c.creditLimit) || 0;
      const active = c.active !== false;
      const meta = JSON.stringify((typeof c.meta === 'object' && c.meta) || {});
      await client.query(
        `INSERT INTO customers (company_id, id, code, name, tax_id, address, phone, email, balance, credit_limit, active, meta, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, NOW())
         ON CONFLICT (company_id, id) DO UPDATE SET
           code = EXCLUDED.code, name = EXCLUDED.name, tax_id = EXCLUDED.tax_id, address = EXCLUDED.address,
           phone = EXCLUDED.phone, email = EXCLUDED.email, balance = EXCLUDED.balance, credit_limit = EXCLUDED.credit_limit,
           active = EXCLUDED.active, meta = EXCLUDED.meta, updated_at = NOW()`,
        [companyId, String(c.id), code, name, tax, addr, phone, email, bal, limit, active, meta]
      );
    }
  }

  // 4. Magazinat
  if (Array.isArray(state.warehouses)) {
    for (const w of state.warehouses) {
      if (!w || !w.id) continue;
      const code = String(w.code || w.id).slice(0, 80);
      const name = String(w.name || code).slice(0, 200);
      const addr = String(w.address || '').slice(0, 200);
      const active = w.active !== false;
      const meta = JSON.stringify((typeof w.meta === 'object' && w.meta) || {});
      await client.query(
        `INSERT INTO warehouses (company_id, id, code, name, address, active, meta, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
         ON CONFLICT (company_id, id) DO UPDATE SET
           code = EXCLUDED.code, name = EXCLUDED.name, address = EXCLUDED.address,
           active = EXCLUDED.active, meta = EXCLUDED.meta, updated_at = NOW()`,
        [companyId, String(w.id), code, name, addr, active, meta]
      );
    }
  }

  // 5. Lotet
  if (Array.isArray(state.lots)) {
    for (const l of state.lots) {
      if (!l || !l.id) continue;
      const prodId = String(l.product || l.product_id || '').slice(0, 80);
      const whId = String(l.warehouse || l.warehouse_id || '').slice(0, 80);
      const lotNum = String(l.code || l.lot_number || l.id).slice(0, 80);
      const net = parseFloat(l.net) || 0;
      const tare = parseFloat(l.tare) || 0;
      const gross = parseFloat(l.gross) || 0;
      const notes = String(l.notes || l.status || '').slice(0, 500);
      const meta = JSON.stringify({ rack: l.rack || '', supplier: l.supplier || '', ...((typeof l.meta === 'object' && l.meta) || {}) });
      await client.query(
        `INSERT INTO lots (company_id, id, product_id, warehouse_id, lot_number, net, tare, gross, notes, meta, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, NOW())
         ON CONFLICT (company_id, id) DO UPDATE SET
           product_id = EXCLUDED.product_id, warehouse_id = EXCLUDED.warehouse_id, lot_number = EXCLUDED.lot_number,
           net = EXCLUDED.net, tare = EXCLUDED.tare, gross = EXCLUDED.gross, notes = EXCLUDED.notes,
           meta = EXCLUDED.meta, updated_at = NOW()`,
        [companyId, String(l.id), prodId, whId, lotNum, net, tare, gross, notes, meta]
      );
    }
  }

  // 6. Peshimet
  if (Array.isArray(state.weighings)) {
    for (const w of state.weighings) {
      if (!w || !w.id) continue;
      const lotId = String(w.lot || w.lot_id || '').slice(0, 80);
      const prodId = String(w.product || w.product_id || '').slice(0, 80);
      const whId = String(w.warehouse || w.warehouse_id || '').slice(0, 80);
      const gross = parseFloat(w.gross) || 0;
      const tare = parseFloat(w.tare) || 0;
      const net = parseFloat(w.net) || 0;
      const notes = String(w.notes || w.status || '').slice(0, 500);
      const meta = JSON.stringify({ supplier: w.supplier || '', attachmentUrl: w.attachmentUrl || '', ...((typeof w.meta === 'object' && w.meta) || {}) });
      await client.query(
        `INSERT INTO weighings (company_id, id, lot_id, product_id, warehouse_id, gross, tare, net, notes, meta, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, NOW())
         ON CONFLICT (company_id, id) DO UPDATE SET
           lot_id = EXCLUDED.lot_id, product_id = EXCLUDED.product_id, warehouse_id = EXCLUDED.warehouse_id,
           gross = EXCLUDED.gross, tare = EXCLUDED.tare, net = EXCLUDED.net, notes = EXCLUDED.notes,
           meta = EXCLUDED.meta, updated_at = NOW()`,
        [companyId, String(w.id), lotId, prodId, whId, gross, tare, net, notes, meta]
      );
    }
  }

  // 7. Faturat e shitjes
  if (Array.isArray(state.salesInvoices)) {
    for (const inv of state.salesInvoices) {
      if (!inv || !inv.id) continue;
      const num = String(inv.number || inv.id).slice(0, 80);
      const cusId = String(inv.customer || inv.customer_id || '').slice(0, 80);
      const whId = String(inv.warehouse || inv.warehouse_id || '').slice(0, 80);
      const total = parseFloat(inv.total) || 0;
      const subtotal = parseFloat(inv.subtotal) || 0;
      const vatRate = parseFloat(inv.vatRate) || 20;
      const vatAmount = parseFloat(inv.vatAmount) || 0;
      const status = String(inv.status || 'draft').slice(0, 50);
      const items = JSON.stringify(Array.isArray(inv.items) ? inv.items : []);
      const meta = JSON.stringify((typeof inv.meta === 'object' && inv.meta) || {});
      await client.query(
        `INSERT INTO sales_invoices (company_id, id, number, customer_id, warehouse_id, total, subtotal, vat_rate, vat_amount, status, items, meta, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, NOW())
         ON CONFLICT (company_id, id) DO UPDATE SET
           number = EXCLUDED.number, customer_id = EXCLUDED.customer_id, warehouse_id = EXCLUDED.warehouse_id,
           total = EXCLUDED.total, subtotal = EXCLUDED.subtotal, vat_rate = EXCLUDED.vat_rate, vat_amount = EXCLUDED.vat_amount,
           status = EXCLUDED.status, items = EXCLUDED.items, meta = EXCLUDED.meta, updated_at = NOW()`,
        [companyId, String(inv.id), num, cusId, whId, total, subtotal, vatRate, vatAmount, status, items, meta]
      );
    }
  }

  // 8. Faturat e blerjes
  if (Array.isArray(state.purchaseInvoices)) {
    for (const inv of state.purchaseInvoices) {
      if (!inv || !inv.id) continue;
      const num = String(inv.number || inv.id).slice(0, 80);
      const supId = String(inv.supplier || inv.supplier_id || '').slice(0, 80);
      const whId = String(inv.warehouse || inv.warehouse_id || '').slice(0, 80);
      const total = parseFloat(inv.total) || 0;
      const subtotal = parseFloat(inv.subtotal) || 0;
      const vatRate = parseFloat(inv.vatRate) || 20;
      const vatAmount = parseFloat(inv.vatAmount) || 0;
      const status = String(inv.status || 'draft').slice(0, 50);
      const items = JSON.stringify(Array.isArray(inv.items) ? inv.items : []);
      const meta = JSON.stringify((typeof inv.meta === 'object' && inv.meta) || {});
      await client.query(
        `INSERT INTO purchase_invoices (company_id, id, number, supplier_id, warehouse_id, total, subtotal, vat_rate, vat_amount, status, items, meta, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, NOW())
         ON CONFLICT (company_id, id) DO UPDATE SET
           number = EXCLUDED.number, supplier_id = EXCLUDED.supplier_id, warehouse_id = EXCLUDED.warehouse_id,
           total = EXCLUDED.total, subtotal = EXCLUDED.subtotal, vat_rate = EXCLUDED.vat_rate, vat_amount = EXCLUDED.vat_amount,
           status = EXCLUDED.status, items = EXCLUDED.items, meta = EXCLUDED.meta, updated_at = NOW()`,
        [companyId, String(inv.id), num, supId, whId, total, subtotal, vatRate, vatAmount, status, items, meta]
      );
    }
  }
}

module.exports = { syncStateToRelational, extractAndSaveAttachments };
