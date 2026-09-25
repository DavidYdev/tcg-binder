/* Construye la tabla «expansión del catálogo -> código de Cardmarket».
   Cardmarket nombra las expansiones occidentales con la abreviatura oficial
   (PAR, MEW, BRS...), que pokemontcg.io publica como ptcgoCode. Cruzamos las
   dos bases por nombre y por id para tener el código de cada expansión.
   Uso: node gen-codigos.js   ->   codigos-bundle.js                        */
const fs = require('fs');
const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function j(url, tries = 6) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.status >= 500 || r.status === 429) { last = new Error('HTTP ' + r.status); await sleep(700 * (i + 1)); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { last = e; await sleep(600 * (i + 1)); }
  }
  throw last;
}

const norm = s => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]/g, '');

(async () => {
  const pk = await j('https://api.pokemontcg.io/v2/sets?pageSize=250');
  const conCodigo = (pk.data || []).filter(s => s.ptcgoCode);
  console.log('expansiones con código oficial: ' + conCodigo.length + ' de ' + (pk.data || []).length);

  const porId = {}, porNombre = {};
  conCodigo.forEach(s => {
    porId[s.id.toLowerCase()] = s.ptcgoCode;
    porNombre[norm(s.name) + '|' + String(s.releaseDate || '').slice(0, 4)] = s.ptcgoCode;
    if (!porNombre[norm(s.name)]) porNombre[norm(s.name)] = s.ptcgoCode;
  });

  /* Los nombres en inglés son los que coinciden con la otra base. */
  const sets = await j('https://api.tcgdex.net/v2/en/sets');
  const salida = {};
  let porIdN = 0, porNombreN = 0, sin = [];
  for (const s of sets) {
    const id = s.id.toLowerCase();
    let code = porId[id] || porId[id.replace(/0(\d)/g, '$1')] || porId[id.replace(/\./g, 'pt')];
    if (code) { porIdN++; }
    else {
      const d = await j('https://api.tcgdex.net/v2/en/sets/' + s.id).catch(() => null);
      const anio = d && d.releaseDate ? String(d.releaseDate).slice(0, 4) : '';
      code = porNombre[norm(s.name) + '|' + anio] || porNombre[norm(s.name)];
      if (code) porNombreN++;
    }
    if (code) salida[s.id] = code; else sin.push(s.id + ' (' + s.name + ')');
  }

  fs.writeFileSync(path.join(__dirname, 'codigos-bundle.js'),
    'const CM_CODIGO = ' + JSON.stringify(salida) + ';\n');
  console.log('emparejadas por id: ' + porIdN + ' | por nombre: ' + porNombreN + ' | sin código: ' + sin.length);
  console.log('sin código: ' + sin.slice(0, 12).join(', '));
  console.log('ejemplos: ' + ['sv04', 'xy5', 'swsh3', 'base1', 'sv03.5'].map(k => k + '->' + (salida[k] || '?')).join('  '));
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
