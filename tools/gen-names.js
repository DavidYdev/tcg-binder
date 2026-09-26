/* Builds the Pokémon name dictionary, so Japanese cards can be searched
   by typing the name in Spanish or English.
   Source: PokeAPI open data (a single CSV).
   Usage: node gen-names.js   ->   names-bundle.js  (run from this folder)  */
const fs = require('fs');

const LANG = { JA: '1', ES: '7', EN: '9' };   // ja-hrkt (katakana), Spanish, English

/* Simple CSV: names contain no commas, but quotes are respected just in case */
function parseCSV(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

const rows = parseCSV(fs.readFileSync('names.csv', 'utf8'));
rows.shift();

const bySpecies = {};
for (const r of rows) {
  const [id, lang, name] = r;
  if (lang !== LANG.JA && lang !== LANG.ES && lang !== LANG.EN) continue;
  bySpecies[id] = bySpecies[id] || {};
  bySpecies[id][lang] = name;
}

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

const jaFromLatin = {};   // "groudon" -> "グラードン"
const latinFromJa = {};   // "グラードン" -> "Groudon"
let n = 0;
for (const id of Object.keys(bySpecies)) {
  const e = bySpecies[id];
  const ja = e[LANG.JA];
  if (!ja) continue;
  const es = e[LANG.ES], en = e[LANG.EN];
  [es, en].forEach(v => { const k = norm(v); if (k && !jaFromLatin[k]) jaFromLatin[k] = ja; });
  if (!latinFromJa[ja]) latinFromJa[ja] = es || en || '';
  n++;
}

const js = 'const JA_FROM_LATIN = ' + JSON.stringify(jaFromLatin) + ';\n' +
           'const LATIN_FROM_JA = ' + JSON.stringify(latinFromJa) + ';\n';
fs.writeFileSync('names-bundle.js', js);
console.log(n + ' Pokémon · ' + Object.keys(jaFromLatin).length + ' Latin keys · ' + Math.round(js.length / 1024) + ' KB');
console.log('test: groudon ->', jaFromLatin['groudon'], '| pikachu ->', jaFromLatin['pikachu'], '| mewtwo ->', jaFromLatin['mewtwo']);
