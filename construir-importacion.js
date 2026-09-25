/* ============================================================
   construir-importacion.js
   Convierte una lista de cartas en un archivo JSON que la app
   "Mi Colección Pokémon TCG" importa desde Ajustes → Importar JSON.

   Uso:   node construir-importacion.js cartas.txt

   Una carta por línea. Solo el id es obligatorio:

     catalogo:id | cantidad | variante | estado | idioma | compra | notas

   El catálogo es es / en / ja (por defecto es). Ejemplos:

     ja:M6-084 | 1 | holo | NM | JP | 12 | de un sobre
     es:xy5-84 | 2
     en:base1-4 | 1 | holo | LP | EN | 50 | carpeta azul

   variante: normal | holo | reverse | 1st | promo
   estado:   M | NM | EX | GD | LP | PL | PO   (por defecto NM)

   Precios: TCGdex primero; si una carta no tiene, se pregunta a
   pokemontcg.io, igual que hace la app.
   ============================================================ */

const fs = require('fs');

const TCG = 'https://api.tcgdex.net/v2';
const PKM = 'https://api.pokemontcg.io/v2';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const eur = n => new Intl.NumberFormat('es-ES', { style:'currency', currency:'EUR' }).format(n || 0);

async function getJSON(url, tries = 5) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.status === 404) return null;
      if (r.status >= 500 || r.status === 429) { last = new Error('HTTP ' + r.status); await sleep(600 * (i + 1)); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { last = e; await sleep(500 * (i + 1)); }
  }
  throw last;
}

function prFromTcgdex(cm) {
  if (!cm) return null;
  return {
    trend: cm.trend, avg: cm.avg, low: cm.low, avg1: cm.avg1, avg7: cm.avg7, avg30: cm.avg30,
    rtrend: cm['trend-holo'], ravg: cm['avg-holo'], rlow: cm['low-holo'],
    ravg1: cm['avg1-holo'], ravg7: cm['avg7-holo'], ravg30: cm['avg30-holo'],
    unit: cm.unit || 'EUR', updated: String(cm.updated || '').slice(0, 10), src: 'tcgdex'
  };
}
function prFromPkm(p, updated) {
  if (!p) return null;
  return {
    trend: p.trendPrice, avg: p.averageSellPrice, low: p.lowPrice, avg1: p.avg1, avg7: p.avg7, avg30: p.avg30,
    rtrend: p.reverseHoloTrend, ravg: p.reverseHoloSell, rlow: p.reverseHoloLow,
    ravg1: p.reverseHoloAvg1, ravg7: p.reverseHoloAvg7, ravg30: p.reverseHoloAvg30,
    unit: 'EUR', updated: String(updated || '').replace(/\//g, '-').slice(0, 10), src: 'pokemontcg'
  };
}
function pickCardmarket(d) {
  const vs = d.variants_detailed || [];
  for (const v of vs) if (v.pricing && v.pricing.cardmarket) return v.pricing.cardmarket;
  return null;
}

function parseLine(line) {
  const p = line.split('|').map(s => s.trim());
  let ref = p[0], cat = 'es';
  const m = ref.match(/^(es|en|ja|fr|it|de|pt):(.+)$/i);
  if (m) { cat = m[1].toLowerCase(); ref = m[2]; }
  return {
    cat, id: ref,
    qty: Math.max(1, parseInt(String(p[1] || '1').replace(/^x/i, ''), 10) || 1),
    variant: (p[2] || 'normal').toLowerCase(),
    cond: (p[3] || 'NM').toUpperCase(),
    lang: (p[4] || (cat === 'ja' ? 'JP' : 'ES')).toUpperCase(),
    buy: p[5] ? Number(String(p[5]).replace(',', '.')) : '',
    notes: p[6] || ''
  };
}

const pkmIdOf = (setId, num) => setId + '-' + (/^[0-9]+$/.test(String(num)) ? String(parseInt(num, 10)) : num);

(async function main() {
  const src = process.argv[2];
  if (!src) { console.error('Falta el archivo de entrada.\nUso: node construir-importacion.js cartas.txt'); process.exit(1); }

  const wanted = fs.readFileSync(src, 'utf8')
    .split(/\r?\n/).map(l => l.trim())
    .filter(l => l && l[0] !== '#')
    .map(parseLine);
  if (!wanted.length) { console.error('El archivo no tiene ninguna carta.'); process.exit(1); }

  const items = [];
  const noEncontradas = [];
  const sinPrecio = [];
  let total = 0, viaRespaldo = 0;

  for (const w of wanted) {
    process.stdout.write('consultando ' + w.cat + ':' + w.id + '...\r');
    let d = null;
    try { d = await getJSON(TCG + '/' + w.cat + '/cards/' + encodeURIComponent(w.id)); } catch (e) {}
    if (!d) { noEncontradas.push(w.cat + ':' + w.id); continue; }

    let pr = prFromTcgdex(pickCardmarket(d));
    if (!pr && w.cat !== 'ja') {
      try {
        const j = await getJSON(PKM + '/cards?q=' + encodeURIComponent('id:' + pkmIdOf(d.set.id, d.localId)) + '&select=id,cardmarket');
        const c = j && j.data && j.data[0];
        if (c && c.cardmarket && c.cardmarket.prices) { pr = prFromPkm(c.cardmarket.prices, c.cardmarket.updatedAt); viaRespaldo++; }
      } catch (e) {}
    }
    if (!pr) sinPrecio.push(d.name + ' (' + w.id + ')');

    let unit = 0;
    if (pr) {
      unit = (w.variant === 'reverse' && pr.rtrend > 0) ? pr.rtrend : (pr.trend || pr.avg || pr.avg30 || pr.low || 0);
    }
    total += unit * w.qty;

    items.push({
      id: d.id, cat: w.cat, name: d.name,
      setId: d.set.id, setName: d.set.name, series: (d.serie && d.serie.name) || '—',
      number: d.localId, rarity: d.rarity || '—',
      img: d.image || '', pr: pr,
      qty: w.qty, variant: w.variant, cond: w.cond, lang: w.lang,
      buy: w.buy, grade: '', notes: w.notes,
      added: new Date().toISOString()
    });

    console.log(
      String(w.qty).padStart(2) + '×  ' +
      (d.name + '                        ').slice(0, 24) +
      ((d.set.name || '') + ' ' + d.localId + '                        ').slice(0, 26) +
      (w.variant + '        ').slice(0, 9) + (w.cond + '   ').slice(0, 4) +
      (unit ? eur(unit).padStart(11) : '  sin precio') +
      (pr ? '  [' + (pr.src === 'tcgdex' ? 'TCGdex' : 'respaldo') + ']' : '')
    );
  }

  const out = 'importar-' + new Date().toISOString().slice(0, 10) + '.json';
  fs.writeFileSync(out, JSON.stringify({ v: 3, items, wish: [], hist: [] }, null, 2));

  console.log('\n' + '─'.repeat(74));
  console.log(items.length + ' entradas · ' + items.reduce((a, b) => a + b.qty, 0) + ' cartas · valor estimado ' + eur(total));
  if (viaRespaldo) console.log(viaRespaldo + ' con precio traído de la fuente de respaldo');
  if (sinPrecio.length) console.log('Sin precio en ninguna fuente: ' + sinPrecio.join(', '));
  if (noEncontradas.length) console.log('No encontradas: ' + noEncontradas.join(', '));
  console.log('Archivo generado: ' + out);
  console.log('Impórtalo en la app: Ajustes → Importar JSON → «Aceptar» para fusionar.');
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
