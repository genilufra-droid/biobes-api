'use strict';
/* tools/extract-kit.cjs — rikthen skedarët e kit-it nga dokumenti i vetëm Markdown
 * (KIT-BIOBES-API-P1-P2-P3.md), me përmbajtje BAJT-PËR-BAJT të njëjtë.
 *
 * Përdorimi (nga rrënja e repo-s biobes-api):
 *   node tools/extract-kit.cjs ../KIT-BIOBES-API-P1-P2-P3.md .
 *   node tools/extract-kit.cjs <md> <dirDalje>            # dirDalje parazgjedhje: '.'
 *   node tools/extract-kit.cjs <md> <dirDalje> --list      # vetëm liston, nuk shkruan
 *   node tools/extract-kit.cjs <md> <dirDalje> --verify    # krahason me skedarët ekzistues
 *
 * Format i pritur në Markdown (për çdo skedar):
 *   ### FILE: backend/lib/token.js
 *   <gardh me 4 ose më shumë backtick>[gjuha]
 *   <përmbajtja>
 *   <i njëjti gardh>
 * Gjatësia e gardhit lexohet dhe përshtatet vetë (backreference), prandaj skedarët
 * që përmbajnë vetë backtick-e nuk e prishin ekstraktimin.
 *
 * Nëse ky skedar nuk ekziston ende, mund ta krijosh nga seksioni «A-0» i dokumentit —
 * ose thjesht të shkruash skedarët me dorë: çdo seksion FILE ka shtegun e saktë.
 */
const fs = require('node:fs');
const path = require('node:path');

/* Midis kokës "### FILE:" dhe gardhit lejohen rreshta përshkrues (p.sh. _për çfarë
 * shërben_), por JO rreshta që fillojnë me backtick — që gardhi të gjendet saktë. */
const RE = /^### FILE: (.+?)\r?\n+(?:[^`\r\n]*\r?\n+)*?(`{4,})[A-Za-z0-9_+\-.]*\r?\n([\s\S]*?)^\2[ \t]*$/gm;

function parse(mdText) {
  const files = [];
  let m;
  RE.lastIndex = 0;
  while ((m = RE.exec(mdText)) !== null) {
    files.push({ path: m[1].trim(), content: m[3] });
  }
  return files;
}

function safeJoin(outDir, rel) {
  const dest = path.resolve(outDir, rel);
  const root = path.resolve(outDir);
  if (!dest.startsWith(root + path.sep) && dest !== root) {
    throw new Error('Shteg i pasigurt (jashtë dirDaljes): ' + rel);
  }
  return dest;
}

function main() {
  const args = process.argv.slice(2);
  const mode = args.find((a) => a.startsWith('--')) || '';
  const positional = args.filter((a) => !a.startsWith('--'));
  const mdPath = positional[0];
  const outDir = positional[1] || '.';

  if (!mdPath) {
    console.error('Përdorimi: node tools/extract-kit.cjs <KIT.md> [dirDalje] [--list|--verify]');
    process.exit(2);
  }
  if (!fs.existsSync(mdPath)) {
    console.error('Skedari Markdown nuk u gjet: ' + mdPath);
    process.exit(2);
  }

  const md = fs.readFileSync(mdPath, 'utf8');
  const files = parse(md);
  if (!files.length) {
    console.error('Nuk u gjet asnjë seksion "### FILE:" me gardh ```` — a është ky dokumenti i kit-it?');
    process.exit(1);
  }

  const dup = files.map((f) => f.path).filter((p, i, a) => a.indexOf(p) !== i);
  if (dup.length) console.warn('KUJDES: shtigje të përsëritura → ' + [...new Set(dup)].join(', '));

  if (mode === '--list') {
    console.log(files.length + ' skedarë në dokument:');
    for (const f of files) console.log('  ' + f.path.padEnd(46) + String(f.content.length).padStart(7) + ' B');
    return;
  }

  let written = 0, same = 0, diff = 0;
  for (const f of files) {
    const dest = safeJoin(outDir, f.path);
    if (mode === '--verify') {
      if (!fs.existsSync(dest)) { diff++; console.log('  MUNGON  ' + f.path); continue; }
      const cur = fs.readFileSync(dest, 'utf8');
      if (cur === f.content) { same++; }
      else { diff++; console.log('  NDRYSHON ' + f.path + ' (' + cur.length + ' B lokal vs ' + f.content.length + ' B në MD)'); }
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.content);
    written++;
    console.log('  ✓ ' + f.path + ' (' + f.content.length + ' B)');
  }

  if (mode === '--verify') {
    console.log('\nVerifikim: ' + same + ' identikë, ' + diff + ' ndryshojnë/mungojnë (nga ' + files.length + ')');
    process.exit(diff ? 1 : 0);
  }
  console.log('\n' + written + ' skedarë u krijuan nën ' + path.resolve(outDir));
}

main();
