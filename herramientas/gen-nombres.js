/* Construye el diccionario de nombres de Pokémon para poder buscar cartas
   japonesas escribiendo el nombre en español o inglés.
   Fuente: datos abiertos de PokeAPI (un único CSV).
   Uso: node gen-nombres.js   ->   nombres-bundle.js                       */
const fs = require('fs');

const LANG = { JA: '1', ES: '7', EN: '9' };   // ja-hrkt (katakana), español, inglés

/* CSV sencillo: los nombres no llevan comas, pero por si acaso respetamos comillas */
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

const porEspecie = {};
for (const r of rows) {
  const [id, lang, name] = r;
  if (lang !== LANG.JA && lang !== LANG.ES && lang !== LANG.EN) continue;
  porEspecie[id] = porEspecie[id] || {};
  porEspecie[id][lang] = name;
}

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

const jaDesdeLatin = {};   // "groudon" -> "グラードン"
const latinDesdeJa = {};   // "グラードン" -> "Groudon"
let n = 0;
for (const id of Object.keys(porEspecie)) {
  const e = porEspecie[id];
  const ja = e[LANG.JA];
  if (!ja) continue;
  const es = e[LANG.ES], en = e[LANG.EN];
  [es, en].forEach(v => { const k = norm(v); if (k && !jaDesdeLatin[k]) jaDesdeLatin[k] = ja; });
  if (!latinDesdeJa[ja]) latinDesdeJa[ja] = es || en || '';
  n++;
}

const js = 'const JA_DESDE_LATIN = ' + JSON.stringify(jaDesdeLatin) + ';\n' +
           'const LATIN_DESDE_JA = ' + JSON.stringify(latinDesdeJa) + ';\n';
fs.writeFileSync('nombres-bundle.js', js);
console.log(n + ' Pokémon · ' + Object.keys(jaDesdeLatin).length + ' claves latinas · ' + Math.round(js.length / 1024) + ' KB');
console.log('prueba: groudon ->', jaDesdeLatin['groudon'], '| pikachu ->', jaDesdeLatin['pikachu'], '| mewtwo ->', jaDesdeLatin['mewtwo']);
