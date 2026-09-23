'use strict';
/* routes/manual.js — GET /api/manual: manuali i moduleve, i shërbyer nga SERVERI.
 *
 * Pse: manuali nuk duhet të jetë i ngulitur në index.html (3 MB) dhe as i ruajtur në
 * browser — serveri e jep sipas gjuhës, versionit dhe të drejtave të përdoruesit, dhe
 * përmbajtja mund të përditësohet pa rindeosur frontend-in.
 *
 * Kontrata (frontend-i pret):
 *   GET /api/manual?company=C1            header: X-Company-Id: C1
 *   → { ok:true, version, lang:'sq', modules:[ { id, title, steps:[], shortcuts:[], notes:[] } ], updatedAt }
 * Përgjigja është e njëjtë për çdo kompani (manuali nuk përmban të dhëna biznesi),
 * por kërkesa mbart company_id që të jetë në të njëjtën rrugë si gjithçka tjetër.
 */
const MANUAL_VERSION = 3;

const MODULES = [
  {
    id: 'weighings', title: 'Peshimet', icon: '⚖️',
    purpose: 'Regjistrimi i çdo peshimi (hyrje/dalje) me lot, magazinë dhe raft.',
    steps: [
      'Zgjidh magazinën dhe raftin; shto produktin dhe lotin (kodi krijohet vetë: B1<furnitor>-<produkt>-<vv>).',
      'Shkruaj të papërpunuara: bruto, tara — neto llogaritet vetë.',
      'Konfirmo peshimin: pas konfirmimit stoku dhe kartela e lotit përditësohen menjëherë.',
      'Për dalje: kontrollo sasinë e disponueshme të lotit (sasia negative nuk lejohet).',
    ],
    shortcuts: ['Enter = ruaj dhe shto rresht të ri', 'F2 = korrigjo sasinë', 'Esc = mbyll modalen'],
    notes: ['Peshimet e konfirmuara nuk fshihen — korrigjimi bëhet me kundërlëvizje (anulim me arsye).', 'Çdo peshim i përket kompanisë aktive; numri PS-<vit>-<radhë> merret nga serveri.'],
    roles: { create: ['ROLE-ADMIN', 'ROLE-USER'], confirm: ['ROLE-ADMIN'] },
  },
  {
    id: 'lots', title: 'Lotet dhe gjurmueshmëria', icon: '🏷️',
    purpose: 'Ndiq çdo lot nga pranimit te furnitori deri te klienti (trace dossier).',
    steps: [
      'Hap Lotet → zgjidh lotin → shih hyrjet/daljet, magazinën, raftin, sasinë neto.',
      'Përdor "Grafiku i gjurmës" për lidhjen furnitor → lot → proces → klient.',
      'Printo etiketën e lotit (QR me thellësi: ?lot=<kod>).',
    ],
    shortcuts: ['QR/deep-link: #/lot/<kod>'],
    notes: ['Sasia e lotit nuk mund të bjerë nën zero; sistemi bllokon daljen dhe tregon arsyen.'],
  },
  {
    id: 'stockDocs', title: 'Fletë hyrje / dalje (Magazina)', icon: '📄',
    purpose: 'Dokumentet e magazinës me rreshta produkt/lot/sasi/kosto, draft dhe konfirmim.',
    steps: [
      'Magazina → "+ Fletë hyrje" ose "+ Fletë dalje".',
      'Shto rreshtat: produkt, lot, furnitor/klient, kg, thasë, kosto — SHUMA llogaritet live.',
      '"Ruaj draft" (pa prekur stokun) ose "Ruaj & konfirmo" (lëvizja regjistrohet).',
      'Anulimi bëhet me arsye: krijohet kundërlëvizje dhe loti rikthehet.',
    ],
    shortcuts: ['Ctrl+S = ruaj draft', 'Ctrl+Enter = ruaj & konfirmo'],
    notes: ['Numrat FH-<vit>-<radhë> dhe FD-<vit>-<radhë> jepen nga serveri me FOR UPDATE — dy pajisje nuk marrin kurrë të njëjtin numër.', 'Printimi A4 portret: 18 rreshta, të pashkruarit vizohen me "—".'],
  },
  {
    id: 'sales', title: 'Shitjet dhe faturat', icon: '🧾',
    purpose: 'Fatura shitjeje, pagesa nga klientët, kthime.',
    steps: [
      'Zgjidh klientin (kërkim live me kod/emër/NIPT), shto produktet dhe sasitë.',
      'Ruaj si draft ose konfirmo; regjistro arkëtimin (AR) me metodë pagese.',
      'Kthimi i klientit: zgjidh faturën, sasinë dhe arsyen — stoku rikthehet në lot.',
    ],
    notes: ['Numri FSH-<vit>-<radhë> është unik për kompani (indeks UNIQUE në DB).', 'Nëse dy përdorues zgjedhin të njëjtin numër, serveri kthen 409 conflict:"number" dhe aplikacioni rinumeron vetë.'],
  },
  {
    id: 'purchases', title: 'Blerjet dhe furnitorët', icon: '🚚',
    purpose: 'Fatura blerjeje, pagesa furnitorësh, kthime te furnitori, gjendje fillestare.',
    steps: [
      'Krijo furnitor me kod, NIPT dhe gjendje fillestare (monedhë/kurs opsional).',
      'Regjistro faturën e blerjes (FBL) dhe pagesat (PG).',
      'Kthimi te furnitori: zgjidh faturën dhe sasinë — zbritet stoku i lotit.',
    ],
    notes: ['Importi Excel me kolonat shqip pranohet; gabimet ndalojnë gjithë importin (jo pjesërisht).'],
  },
  {
    id: 'accounting', title: 'Kontabiliteti dhe raportet Alpha', icon: '📒',
    purpose: 'Ditari (VK), gjendjet fillestare, bilanci i hapjes, raporte Alpha.',
    steps: [
      'Kontabiliteti → Gjendjet fillestare: vendos datën e hapjes (go-live) një herë.',
      'J-GEN krijon rreshtat automatikë (311/401/685/618/101…) sipas dokumenteve.',
      'Posto ditarin; raporti Alpha lexon të dhënat pa i ndryshuar.',
    ],
    notes: ['Bilanci i hapjes është idempotent: "Rigjenero" nuk dyfishon rreshtat.', 'Përdoruesi pa modulin "Paraja dhe kontabiliteti" nuk e sheh këtë zonë.'],
  },
  {
    id: 'cloud', title: 'Cloud, sinkronizim dhe kompanitë', icon: '☁️',
    purpose: 'Si funksionon sistemi 100% cloud me shumë kompani dhe shumë përdorues.',
    steps: [
      'Hyr me llogarinë tënde: të dhënat tërhiqen nga serveri (jo nga browseri).',
      'Në krye shfaqet ndërruesi i kompanisë kur ke ≥2 kompani aktive — çdo kërkesë mbart company_id.',
      'Treguesi poshtë-majtas: "☁ I sinkronizuar <ora> · v<version> · <kompania>".',
      'Ndryshimet e kolegëve shfaqen vetë brenda ~1–2 s (SSE), pa rifreskim faqe.',
    ],
    notes: [
      'Serveri është burimi i së vërtetës: me pastrim browseri, me telefon tjetër ose PC tjetër, gjithçka rikthehet nga serveri.',
      'Ruajtja dërgohet me version (CAS) ose per dokument (patch). Në konflikt, puna bashkohet automatikisht — asgjë nuk humbet.',
      'Izolimi C1 ≠ C2 garantohet edhe në databazë (Row Level Security): edhe një kërkesë e gabuar nuk kthen të dhëna të kompanisë tjetër.',
      'Backup-i ditor bëhet në server; rikthimi nga Konfigurime → Backup-et në server (ADMIN).',
    ],
  },
  {
    id: 'export', title: 'Eksporti Excel (në server)', icon: '📊',
    purpose: 'Eksport .xlsx i prodhuar nga serveri, me faqe nga 20 rreshta dhe formate të sakta.',
    steps: [
      'Regjistri → Eksport Excel → zgjidh modulin (p.sh. kthimet e klientëve).',
      'Skedari shkarkohet direkt; nuk ruhet asgjë në browser.',
    ],
    notes: ['URL: GET /api/export/xlsx?module=<mod>&page=<n>&pageSize=20 me header X-Company-Id.', 'Datat janë datë të vërtetë Excel (numFmt 14), shumat me 2 shifra (164), kg me 3 shifra (165).'],
  },
];

function build(req) {
  const lang = String((req && (req.query && (req.query.lang || req.query.gjuha))) || 'sq');
  const modules = MODULES.map((m) => ({
    id: m.id, title: m.title, icon: m.icon || '', purpose: m.purpose || '',
    steps: (m.steps || []).slice(), shortcuts: (m.shortcuts || []).slice(), notes: (m.notes || []).slice(),
    roles: m.roles || null,
  }));
  return {
    ok: true,
    version: MANUAL_VERSION,
    lang,
    modules,
    moduleIds: modules.map((m) => m.id),
    company: (req && req.companyId) || '',
    updatedAt: process.env.MANUAL_UPDATED_AT || '2026-09-22T00:00:00.000Z',
  };
}

function register(app, options) {
  const opts = options || {};
  const guard = Array.isArray(opts.middleware) ? opts.middleware : [];
  app.get('/api/manual', ...guard, (req, res) => {
    try {
      res.set('Cache-Control', 'public, max-age=300');
      res.json(build(req));
    } catch (e) {
      res.status(500).json({ ok: false, error: 'Gabim gjatë leximit të manualit' });
    }
  });
  app.get('/api/manual/:moduleId', ...guard, (req, res) => {
    const all = build(req);
    const m = all.modules.filter((x) => x.id === String(req.params.moduleId))[0];
    if (!m) return res.status(404).json({ ok: false, error: 'Moduli nuk u gjet' });
    res.json({ ok: true, version: all.version, module: m });
  });
}

module.exports = { register, build, MODULES, MANUAL_VERSION };
