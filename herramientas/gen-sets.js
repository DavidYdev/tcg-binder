/* Genera el catálogo de expansiones incrustado en la app.
   Se ejecuta a mano cuando salgan expansiones nuevas:  node gen-sets.js  */
const fs = require('fs');
const LANGS = ['es', 'en', 'ja'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function j(url, tries = 5) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.status >= 500) { last = new Error('HTTP ' + r.status); await sleep(500 * (i + 1)); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { last = e; await sleep(400 * (i + 1)); }
  }
  throw last;
}

(async () => {
  const out = {};
  for (const lang of LANGS) {
    const list = await j('https://api.tcgdex.net/v2/' + lang + '/sets');
    const rows = [];
    const queue = [...list];
    let done = 0;
    await Promise.all(Array.from({ length: 8 }, async () => {
      while (queue.length) {
        const s = queue.shift();
        try {
          const d = await j('https://api.tcgdex.net/v2/' + lang + '/sets/' + s.id);
          rows.push([d.id, d.name, (d.serie && d.serie.name) || '—', (d.releaseDate || '').slice(0, 10), (d.cardCount && d.cardCount.official) || 0]);
        } catch (e) { rows.push([s.id, s.name, '—', '', (s.cardCount && s.cardCount.official) || 0]); }
        done++;
        if (done % 40 === 0) process.stdout.write('  ' + lang + ': ' + done + '/' + list.length + '\r');
      }
    }));
    rows.sort((a, b) => String(b[3]).localeCompare(String(a[3])));
    out[lang] = rows;
    console.log('  ' + lang + ': ' + rows.length + ' expansiones            ');
  }
  const js = 'const SETS_RAW = ' + JSON.stringify(out) + ';\n';
  fs.writeFileSync('sets-bundle.js', js);
  console.log('sets-bundle.js escrito: ' + Math.round(js.length / 1024) + ' KB');
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
