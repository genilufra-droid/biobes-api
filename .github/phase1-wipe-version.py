from pathlib import Path
p=Path('backend/server.js')
s=p.read_text(encoding='utf-8')
old="""app.get('/api/state/version', needDb, needAuth, async (req, res) => {
  try {
    const { rows } = await getPool().query(\"SELECT version,updated_at FROM app_state WHERE id='main'\");
    res.json({ ok: true, version: rows.length ? rows[0].version : 0, updatedAt: rows.length ? rows[0].updated_at : null });
  } catch (e) { console.error('[state:version]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});"""
new="""app.get('/api/state/version', needDb, needAuth, async (req, res) => {
  try {
    const p = getPool();
    const [{ rows }, wipe] = await Promise.all([
      p.query(\"SELECT version,updated_at FROM app_state WHERE id='main'\"),
      p.query(\"SELECT value FROM meta WHERE key='wiped_at'\").catch(() => ({ rows: [] })),
    ]);
    res.json({ ok: true, version: rows.length ? rows[0].version : 0, updatedAt: rows.length ? rows[0].updated_at : null, wipedAt: wipe.rows[0]?.value || null });
  } catch (e) { console.error('[state:version]', e.message); res.status(500).json({ ok: false, error: 'Gabim serveri' }); }
});"""
if old not in s: raise SystemExit('state/version target not found')
s=s.replace(old,new,1)
if 'wipedAt: wipe.rows[0]?.value || null' not in s: raise SystemExit('wipe epoch output missing')
p.write_text(s,encoding='utf-8')
print('wipe epoch added to state/version')
