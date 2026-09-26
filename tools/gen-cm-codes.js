/* Builds the "catalog set -> Cardmarket code" table.
   Cardmarket names Western sets with their official abbreviation (PAR,
   MEW, BRS...), which pokemontcg.io publishes as ptcgoCode. We match the
   two databases by id and by name to get each set's code.
   Usage: node gen-cm-codes.js   ->   cm-codes-bundle.js                    */
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
  const withCode = (pk.data || []).filter(s => s.ptcgoCode);
  console.log('sets with an official code: ' + withCode.length + ' of ' + (pk.data || []).length);

  const byId = {}, byName = {};
  withCode.forEach(s => {
    byId[s.id.toLowerCase()] = s.ptcgoCode;
    byName[norm(s.name) + '|' + String(s.releaseDate || '').slice(0, 4)] = s.ptcgoCode;
    if (!byName[norm(s.name)]) byName[norm(s.name)] = s.ptcgoCode;
  });

  /* The English names are the ones that match the other database. */
  const sets = await j('https://api.tcgdex.net/v2/en/sets');
  const out = {};
  let byIdN = 0, byNameN = 0, missing = [];
  for (const s of sets) {
    const id = s.id.toLowerCase();
    let code = byId[id] || byId[id.replace(/0(\d)/g, '$1')] || byId[id.replace(/\./g, 'pt')];
    if (code) { byIdN++; }
    else {
      const d = await j('https://api.tcgdex.net/v2/en/sets/' + s.id).catch(() => null);
      const year = d && d.releaseDate ? String(d.releaseDate).slice(0, 4) : '';
      code = byName[norm(s.name) + '|' + year] || byName[norm(s.name)];
      if (code) byNameN++;
    }
    if (code) out[s.id] = code; else missing.push(s.id + ' (' + s.name + ')');
  }

  fs.writeFileSync(path.join(__dirname, 'cm-codes-bundle.js'),
    'const CM_CODES = ' + JSON.stringify(out) + ';\n');
  console.log('matched by id: ' + byIdN + ' | by name: ' + byNameN + ' | no code: ' + missing.length);
  console.log('no code: ' + missing.slice(0, 12).join(', '));
  console.log('examples: ' + ['sv04', 'xy5', 'swsh3', 'base1', 'sv03.5'].map(k => k + '->' + (out[k] || '?')).join('  '));
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
