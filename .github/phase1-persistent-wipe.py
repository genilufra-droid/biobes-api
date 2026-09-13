from pathlib import Path
p=Path('backend/server.js')
s=p.read_text(encoding='utf-8')
old="    const clearWipeMark = async () => { try { await p.query(\"DELETE FROM meta WHERE key='wiped_at'\"); } catch (e) {} };\n"
if old not in s: raise SystemExit('clearWipeMark declaration not found')
s=s.replace(old,'',1)
count=s.count('          await clearWipeMark();')+s.count('    await clearWipeMark();')
s=s.replace('          await clearWipeMark();\n','',1)
s=s.replace('    await clearWipeMark();\n','',1)
if count<2: raise SystemExit('expected two clearWipeMark calls, got '+str(count))
if 'clearWipeMark' in s: raise SystemExit('clearWipeMark still present')
p.write_text(s,encoding='utf-8')
print('persistent wipe epoch patch applied')
