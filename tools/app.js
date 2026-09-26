'use strict';
/* ============================================================
   TCG Binder

   DATA SOURCES
   1) TCGdex (main) — free, no key, with a Spanish, English and
      Japanese catalog and Cardmarket prices updated daily.
   2) pokemontcg.io (fallback) — only queried when TCGdex has no
      price for a card, which happens in about 90 English sets.
      This API shuts down on 1 March 2027; when that happens, the
      app says so and those cards keep their last known price.
   ============================================================ */

const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

/* ---------- interface language (the strings live in strings.js) ----------
   Stored separately from the collection: it's a preference of this
   browser, not of your cards, so it isn't included in backups and
   survives deleting the collection. The first time, the browser's
   language decides; if it isn't one of ours, English. */
const LANG_KEY = 'ptcg_lang';
let LANG = (() => {
  try { const l = localStorage.getItem(LANG_KEY); if (STRINGS[l]) return l; } catch (e) {}
  const pref = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''])
    .map(l => String(l).slice(0, 2).toLowerCase())
    .filter(l => STRINGS[l])[0];
  return pref || 'en';
})();
function t(k) {
  let v = STRINGS[LANG][k];
  if (v === undefined) v = STRINGS.es[k];
  if (v === undefined) return k;
  return typeof v === 'function' ? v.apply(null, Array.prototype.slice.call(arguments, 1)) : v;
}

const TCG = 'https://api.tcgdex.net/v2';
const PKM = 'https://api.pokemontcg.io/v2';
const PKM_EOL = '2027-03-01';
const KEY = 'ptcg_col_v3';

/* The keys are fixed; the labels come from STRINGS in the current language. */
const CATS  = ['es', 'en', 'ja'];
const LANG_OF_CAT = { es: 'ES', en: 'EN', ja: 'JP' };
const CONDS = { M:'Mint (M)', NM:'Near Mint (NM)', EX:'Excellent (EX)', GD:'Good (GD)', LP:'Light Played (LP)', PL:'Played (PL)', PO:'Poor (PO)' };
const VARS  = ['normal', 'holo', 'reverse', '1st', 'promo'];
const LANGS = ['ES','EN','FR','DE','IT','PT','JP','KR','ZH','Other'];
const MODES = ['trend', 'avg', 'avg30', 'avg7', 'low'];
const catName  = c => t('cats')[c] || c;
const varName  = v => t('vars')[v] || v;
const modeName = m => t('modes')[m] || '';
/* 'Other' is how it's stored on the cards; only what's shown changes. */
const langName = l => l === 'Other' ? t('lang.other') : l;

const DEF = {
  v: 3, items: [], wish: [], hist: [],
  cfg: { cat:'es', priceMode:'trend', useCond:1, apiKey:'',
         cond:{ M:1.05, NM:1, EX:0.9, GD:0.75, LP:0.6, PL:0.45, PO:0.3 } }
};
/* Empty collection. The catalog starts in the interface language: someone
   using the app in English is almost certainly after English cards. */
function blankState() {
  const s = JSON.parse(JSON.stringify(DEF));
  s.cfg.cat = LANG === 'en' ? 'en' : 'es';
  return s;
}

/* ---------- utilities ---------- */
const eur = n => new Intl.NumberFormat(t('locale'), { style:'currency', currency:'EUR' }).format(Number(n) || 0);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uid = () => 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const todayISO = () => new Date().toISOString().slice(0, 10);
const plu = (n, one, many) => n + ' ' + (n === 1 ? one : many);
function timeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return '—';
  const min = Math.round(ms / 60000);
  if (min < 1) return t('ago.now');
  if (min < 60) return t('ago.min', min);
  const h = Math.round(min / 60);
  if (h < 24) return t('ago.h', h);
  return t('ago.d', Math.round(h / 24));
}
const fmtDate = d => {
  if (!d) return '—';
  const s = String(d).replace(/\//g, '-').slice(0, 10).split('-');
  return s.length === 3 ? t('date', s[0], s[1], s[2]) : String(d);
};
const imgUrl = (base, q) => {
  if (!base) return '';
  if (base.slice(0, 5) === 'data:') return base;               // your own photo, embedded
  if (/_SM\.png$/i.test(base)) return q === 'high' ? base.replace(/_SM\.png$/i, '_LG.png') : base;
  if (/\.(png|webp|jpe?g)$/i.test(base)) return base;          // already a full url
  return base + (q === 'high' ? '/high.png' : '/low.webp');    // TCGdex serves each quality separately
};
/* Cardmarket identifies each card as "set code + number" (sv11B 161,
   PAR 066, MEW 111), and searching that way lands straight on its page
   instead of on a list. For Japanese cards the code is the one the catalog
   uses; for Western cards it's the official abbreviation, kept in
   CM_CODES. Without a code or a number we search by the Western name
   (グラードン -> Groudon). */
const cmSearchUrl = c => {
  const url = txt => 'https://www.cardmarket.com/' + t('cm.lang') + '/Pokemon/Products/Search?searchString=' + encodeURIComponent(txt);
  if (typeof c === 'string') return url(c);
  if (!c) return url('');
  if (c.setId && c.number && !c.manual) {
    const code = (typeof CM_CODES !== 'undefined' && CM_CODES[c.setId]) || c.setId;
    return url(code + ' ' + c.number);
  }
  return url(c.alt || c.name || '');
};

let toastT;
function toast(msg, kind) {
  const h = $('#toastHost');
  h.innerHTML = '<div class="toast ' + (kind || '') + '">' + esc(msg) + '</div>';
  clearTimeout(toastT);
  toastT = setTimeout(() => { h.innerHTML = ''; }, kind === 'err' ? 6500 : 3400);
}
function progress(p) { $('#pgbar').style.width = (p <= 0 || p >= 100 ? 0 : p) + '%'; }

/* ---------- storage ---------- */
let storageOK = true;
try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); } catch (e) { storageOK = false; }

function migrate(s) {
  /* v2 stored raw pokemontcg.io prices in "cm". We move them to the
     neutral "pr" format so both sources can live side by side. */
  const MODEMAP = { trendPrice:'trend', averageSellPrice:'avg', avg30:'avg30', avg7:'avg7', lowPrice:'low', lowPriceExPlus:'low' };
  if (MODEMAP[s.cfg.priceMode]) s.cfg.priceMode = MODEMAP[s.cfg.priceMode];
  if (MODES.indexOf(s.cfg.priceMode) < 0) s.cfg.priceMode = 'trend';
  if (CATS.indexOf(s.cfg.cat) < 0) s.cfg.cat = 'es';
  const seen = {};
  s.items.concat(s.wish).forEach(it => {
    if (!it.pr && it.cm) it.pr = prFromPkm(it.cm, it.cmUp);
    delete it.cm; delete it.cmUp; delete it.cmUrl;
    if (!it.cat) it.cat = 'en';
    if (it.img && it.imgBig) delete it.imgBig;
    /* Without its own id a card can't be edited or deleted: it gets one
       here, since everything coming in passes through (load and import). */
    if (!it.uid || seen[it.uid]) it.uid = uid();
    seen[it.uid] = 1;
    /* Cards saved without an image get the one from the public archive. */
    if (!it.img && !it.manual) it.img = fallbackImage(it.cat, it.setId, it.number);
    /* And old Japanese cards get their Western name, which is needed to
       recognise them and to search for them on Cardmarket. */
    if (it.cat === 'ja' && !it.alt) it.alt = latinName(it.name);
    /* Earlier versions stored the "other language" option as 'Otro'. */
    if (it.lang === 'Otro') it.lang = 'Other';
  });
  return s;
}
function load() {
  if (!storageOK) return blankState();
  let raw = null;
  try { raw = localStorage.getItem(KEY) || localStorage.getItem('ptcg_col_v2'); } catch (e) {}
  if (!raw) return blankState();
  try {
    const o = JSON.parse(raw);
    const s = JSON.parse(JSON.stringify(DEF));
    s.items = Array.isArray(o.items) ? o.items : [];
    s.wish  = Array.isArray(o.wish)  ? o.wish  : [];
    s.hist  = Array.isArray(o.hist)  ? o.hist  : [];
    if (o.cfg) { Object.assign(s.cfg, o.cfg); Object.assign(s.cfg.cond, o.cfg.cond || {}); }
    return migrate(s);
  } catch (e) { return blankState(); }
}
function save() {
  if (!storageOK) return;
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { toast(t('err.full'), 'err'); }
}

/* ---------- prices: one neutral format for both sources ---------- */
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
const SRC_NAME = { tcgdex: 'TCGdex', pokemontcg: 'pokemontcg.io' };

function basePrice(pr, variant) {
  if (!pr) return 0;
  const m = S.cfg.priceMode;
  if (variant === 'reverse') { const rv = pr['r' + m]; if (rv > 0) return rv; }
  const order = [m, 'trend', 'avg', 'avg30', 'avg7', 'low'];
  for (let i = 0; i < order.length; i++) { const v = pr[order[i]]; if (v > 0) return v; }
  return 0;
}
/* A price set by hand overrides the automatic one. It's needed for cards
   no source prices (many Japanese ones) and for when you don't trust the
   reference. The condition adjustment isn't applied: you're entering what
   your copy is worth, not a catalog price to discount. */
const manualPrice = it => {
  if (it.mp === '' || it.mp == null) return null;
  const n = Number(it.mp);
  return isNaN(n) ? null : n;
};
const hasAutoPrice = it => !it.manual && basePrice(it.pr, it.variant) > 0;

function unitPrice(it) {
  const m = manualPrice(it);
  if (m != null && m > 0) return m;
  if (it.manual) return m || 0;
  let p = basePrice(it.pr, it.variant);
  if (S.cfg.useCond) { const k = S.cfg.cond[it.cond]; p *= (k == null ? 1 : k); }
  return p;
}
const lineTotal = it => unitPrice(it) * (it.qty || 1);
const sumValue  = list => list.reduce((a, b) => a + lineTotal(b), 0);
const sumCount  = list => list.reduce((a, b) => a + (b.qty || 1), 0);
const sumBuy    = list => list.reduce((a, b) => a + (Number(b.buy) || 0) * (b.qty || 1), 0);

/* ---------- network ---------- */
async function getJSON(url, tries, headers) {
  tries = tries || 3;
  let last = null;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: headers || {} });
      if (r.status === 404) return null;
      if (r.status === 429) { last = new Error(t('err.429')); await sleep(1500 * (i + 1)); continue; }
      if (r.status >= 500) { last = new Error(t('err.busy', r.status)); await sleep(600 * (i + 1)); continue; }
      if (!r.ok) throw new Error(t('err.http', r.status));
      return await r.json();
    } catch (e) { last = e; await sleep(500 * (i + 1)); }
  }
  throw last || new Error(t('err.offline'));
}
const tcg = (path, tries) => getJSON(TCG + path, tries || 3);
const pkm = (path) => getJSON(PKM + path, 5, S.cfg.apiKey ? { 'X-Api-Key': S.cfg.apiKey } : {});

/* Runs tasks with limited parallelism: the API copes well with 6 at a time. */
async function pool(list, worker, workers, onProgress) {
  const q = list.slice();
  const total = list.length;
  let done = 0;
  await Promise.all(Array.from({ length: Math.min(workers || 6, Math.max(1, total)) }, async () => {
    while (q.length) {
      await worker(q.shift());
      done++;
      if (onProgress) onProgress(done, total);
    }
  }));
}

/* ---------- set catalog (embedded, see SETS_RAW) ---------- */
const setsOf = cat => (SETS_RAW[cat] || []).map(a => ({ id:a[0], name:a[1], serie:a[2], date:a[3], total:a[4] }));
let SETIDX = {};
function buildSetIndex() {
  SETIDX = {};
  Object.keys(SETS_RAW).forEach(cat => {
    SETIDX[cat] = {};
    setsOf(cat).forEach(s => { SETIDX[cat][s.id] = s; });
  });
}
const setInfo = (cat, id) => (SETIDX[cat] && SETIDX[cat][id]) || null;
const hasKana = s => /[぀-ヿ]/.test(String(s || ''));
/* Japanese names get their transliteration appended: they're nearly
   always English words written in katakana, so this makes them recognisable. */
function setLabel(s) {
  const year = s.date ? ' (' + String(s.date).slice(0, 4) + ')' : '';
  if (hasKana(s.name)) {
    const r = romaji(s.name);
    if (r) return s.name + ' · ' + r + year;
  }
  return s.name + year;
}
function seriesLabel(seriesName) {
  if (!hasKana(seriesName)) return seriesName;
  const r = romaji(seriesName);
  return r ? seriesName + ' · ' + r : seriesName;
}

function fillSetSelects() {
  const cat = S.cfg.cat;
  const grouped = {};
  setsOf(cat).forEach(s => { (grouped[s.serie] = grouped[s.serie] || []).push(s); });
  const opts = Object.keys(grouped).map(g =>
    '<optgroup label="' + esc(seriesLabel(g)) + '">' +
    grouped[g].map(s => '<option value="' + esc(s.id) + '">' + esc(setLabel(s)) + '</option>').join('') +
    '</optgroup>').join('');
  [['#qSet', '<option value="">' + t('search.anySet') + '</option>'],
   ['#sSet', '<option value="">' + t('sets.pick') + '</option>']].forEach(p => {
    const el = $(p[0]); if (!el) return;
    const prev = el.value;
    el.innerHTML = p[1] + opts;
    if (prev) el.value = prev;
  });
}
function fillCatSelects() {
  const opts = CATS.map(k =>
    '<option value="' + k + '"' + (k === S.cfg.cat ? ' selected' : '') + '>' + esc(catName(k)) + '</option>').join('');
  ['#qCat', '#sCat'].forEach(sel => { const el = $(sel); if (el) el.innerHTML = opts; });
}
const emptyBox = (icon, html) => '<div class="empty"><div class="big">' + icon + '</div>' + html + '</div>';
function setCat(cat) {
  if (CATS.indexOf(cat) < 0) return;
  S.cfg.cat = cat; save();
  fillCatSelects(); fillSetSelects();
  setCards = [];
  $('#setOut').innerHTML = emptyBox('🗂️', t('sets.start'));
  $('#setProgress').innerHTML = '';
}

/* ---------- card normalisation ---------- */
/* ---------- Japanese <-> Western names (see JA_FROM_LATIN) ----------
   So you can type "Groudon" and it searches for グラードン, and so the
   recognisable name can be shown under Japanese cards. */
const normLatin = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const hasLatin = s => /[a-zA-Z]/.test(String(s || ''));

function toJapanese(input) {
  const ja = JA_FROM_LATIN[normLatin(input)];
  return ja || '';
}
/* The Pokémon's name can come with extras before and after it:
   メガスターミーex = メガ (Mega) + スターミー (Starmie) + ex. We look for the
   longest dictionary entry inside the name and transliterate the rest. */
function latinName(ja) {
  if (!ja) return '';
  if (LATIN_FROM_JA[ja]) return LATIN_FROM_JA[ja];
  let best = null, pos = -1;
  for (const k in LATIN_FROM_JA) {
    if (k.length < 2) continue;
    const i = ja.indexOf(k);
    if (i >= 0 && (!best || k.length > best.length)) { best = k; pos = i; }
  }
  if (!best) return '';
  const part = s => (s ? (/[぀-ヿ]/.test(s) ? romaji(s) : s) : '');
  return [part(ja.slice(0, pos)), LATIN_FROM_JA[best], part(ja.slice(pos + best.length))]
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function pickCardmarket(d) {
  const vs = d.variants_detailed || [];
  for (let i = 0; i < vs.length; i++) if (vs[i].pricing && vs[i].pricing.cardmarket) return vs[i].pricing.cardmarket;
  return null;
}
/* TCGdex doesn't have a picture of every card, and has almost none of the
   Japanese ones. We fall back on two public archives that do serve them and
   name their files predictably. If the card isn't there, the slot shows its
   name, and you can always add your own photo. */
function fallbackImage(cat, setId, num) {
  if (!setId || !num) return '';
  const n = /^[0-9]+$/.test(String(num)) ? String(parseInt(num, 10)) : num;
  if (cat === 'ja') return 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc/' + setId + '/' + setId + '_' + n + '_R_JP_SM.png';
  return 'https://images.pokemontcg.io/' + setId + '/' + n + '.png';
}

function normCard(d, cat) {
  const setMeta = setInfo(cat, (d.set && d.set.id) || '');
  return {
    id: d.id, cat: cat,
    name: d.name || '',
    setId: (d.set && d.set.id) || '',
    setName: (d.set && d.set.name) || (setMeta && setMeta.name) || '',
    series: (d.serie && d.serie.name) || (setMeta && setMeta.serie) || '—',
    number: d.localId || '',
    rarity: d.rarity || '—',
    img: d.image || fallbackImage(cat, (d.set && d.set.id) || '', d.localId),
    alt: cat === 'ja' ? latinName(d.name) : '',
    pr: prFromTcgdex(pickCardmarket(d))
  };
}
/* Maps a TCGdex id to the pokemontcg.io one: xy5 + "084" -> xy5-84.
   Checked against 20 sets: they all match. */
const pkmIdOf = it => {
  const n = String(it.number || '');
  return it.setId + '-' + (/^[0-9]+$/.test(n) ? String(parseInt(n, 10)) : n);
};

/* ============================================================
   NAVIGATION
   ============================================================ */
$$('nav.tabs button').forEach(b => b.onclick = () => {
  $$('nav.tabs button').forEach(x => x.classList.toggle('on', x === b));
  $$('section.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + b.dataset.v));
  window.scrollTo(0, 0);
  if (b.dataset.v === 'stats') renderStats();
  if (b.dataset.v === 'wishlist') renderWish();
  if (b.dataset.v === 'settings') syncSettingsUI();   // refreshes the storage meter
});

/* ============================================================
   CARD
   ============================================================ */
function cardHTML(c, opts) {
  opts = opts || {};
  /* The slot with the name always sits underneath: if the image doesn't
     load we hide it and the name shows, instead of an empty rectangle. */
  const src = imgUrl(c.img, 'low');
  const img = '<div class="ph">' + esc(c.name) + '</div>' +
    (src ? '<img src="' + esc(src) + '" alt="' + esc(c.name) + '" loading="lazy" style="position:relative" onerror="this.style.display=\'none\'">' : '');
  let price = opts.priceText;
  if (price == null) {
    const p = basePrice(c.pr, c.variant);
    price = p ? eur(p) + ' <small>' + t('unit') + '</small>' : '<small style="color:var(--tx3)">' + t('no.price') + '</small>';
  }
  return '<div class="card' + (opts.owned ? ' own' : '') + '">' +
    '<div class="imgbox">' + img +
      (opts.qty ? '<span class="qbadge">×' + opts.qty + '</span>' : '') +
      (opts.variant ? '<span class="vbadge v-' + esc(opts.variant) + '">' + esc(varName(opts.variant)) + '</span>' : '') +
    '</div>' +
    '<div class="body">' +
      '<div class="nm">' + esc(c.name) + '</div>' +
      (c.alt ? '<div class="meta" style="color:var(--acc2);font-weight:700">' + esc(c.alt) + '</div>' : '') +
      '<div class="meta">' + esc(c.setName) + ' · ' + esc(c.number) + '</div>' +
      '<div class="meta">' + esc(c.rarity) + (opts.sub ? ' · ' + esc(opts.sub) : '') + '</div>' +
      '<div class="pr">' + price + '</div>' +
    '</div>' +
    (opts.actions ? '<div class="cardacts">' + opts.actions + '</div>' : '') +
  '</div>';
}
function tile(k, v, n, cls) {
  return '<div class="tile"><div class="k">' + esc(k) + '</div><div class="v ' + (cls || '') + '">' + v + '</div><div class="n">' + esc(n || '') + '</div></div>';
}

/* ============================================================
   MY COLLECTION
   ============================================================ */
let viewMode = 'grid';

function fillFilters() {
  const sets = {}, rars = {}, langs = {};
  S.items.forEach(i => { if (i.setName) sets[i.setId || i.setName] = i.setName; if (i.rarity) rars[i.rarity] = 1; if (i.lang) langs[i.lang] = 1; });
  const keep = (sel, val) => { sel.value = val; if (sel.value !== val) sel.value = ''; };
  const s1 = $('#fSet'), v1 = s1.value;
  s1.innerHTML = '<option value="">' + t('col.allSets') + '</option>' + Object.keys(sets).sort((a, b) => sets[a].localeCompare(sets[b])).map(k => '<option value="' + esc(k) + '">' + esc(sets[k]) + '</option>').join('');
  keep(s1, v1);
  const s2 = $('#fRar'), v2 = s2.value;
  s2.innerHTML = '<option value="">' + t('all.f') + '</option>' + Object.keys(rars).sort().map(k => '<option value="' + esc(k) + '">' + esc(k) + '</option>').join('');
  keep(s2, v2);
  const s3 = $('#fVar'), v3 = s3.value;
  s3.innerHTML = '<option value="">' + t('all.f') + '</option>' + VARS.map(k => '<option value="' + k + '">' + esc(varName(k)) + '</option>').join('');
  keep(s3, v3);
  const s4 = $('#fLang'), v4 = s4.value;
  s4.innerHTML = '<option value="">' + t('all.m') + '</option>' + Object.keys(langs).sort().map(k => '<option value="' + esc(k) + '">' + esc(langName(k)) + '</option>').join('');
  keep(s4, v4);
}

function filtered() {
  const txt = $('#fText').value.trim().toLowerCase();
  const set = $('#fSet').value, rar = $('#fRar').value, va = $('#fVar').value, lng = $('#fLang').value;
  const pre = $('#fPrice').value;
  const out = S.items.filter(i => {
    if (set && (i.setId || i.setName) !== set) return false;
    if (rar && i.rarity !== rar) return false;
    if (va && i.variant !== va) return false;
    if (lng && i.lang !== lng) return false;
    if (pre === 'none' && unitPrice(i) > 0) return false;
    if (pre === 'mine' && !(manualPrice(i) > 0)) return false;
    if (pre === 'auto' && !hasAutoPrice(i)) return false;
    if (txt) {
      const haystack = (i.name + ' ' + i.setName + ' ' + i.number + ' ' + (i.notes || '') + ' ' + i.rarity + ' ' + i.id).toLowerCase();
      if (haystack.indexOf(txt) === -1) return false;
    }
    return true;
  });
  const cmp = {
    'value-desc': (a, b) => lineTotal(b) - lineTotal(a),
    'value-asc':  (a, b) => lineTotal(a) - lineTotal(b),
    'unit-desc':  (a, b) => unitPrice(b) - unitPrice(a),
    'name-asc':   (a, b) => a.name.localeCompare(b.name),
    'set-asc':    (a, b) => (a.setName || '').localeCompare(b.setName || '') || (parseInt(a.number, 10) || 0) - (parseInt(b.number, 10) || 0),
    'added-desc': (a, b) => String(b.added || '').localeCompare(String(a.added || '')),
    'qty-desc':   (a, b) => (b.qty || 1) - (a.qty || 1)
  }[$('#fSort').value];
  return out.sort(cmp);
}

function renderCollection() {
  fillFilters();
  const list = filtered();
  const all = S.items;
  const buy = sumBuy(all), val = sumValue(all), diff = val - buy;
  const dates = all.map(i => (i.pr && i.pr.updated) || '').filter(Boolean).sort();

  $('#colTiles').innerHTML = [
    tile(t('col.t.cards'), String(sumCount(all)), t('col.t.distinct', all.length)),
    tile(t('col.t.value'), eur(val), t('col.t.ref', modeName(S.cfg.priceMode))),
    tile(t('tile.invested'), buy ? eur(buy) : '—', buy ? t('col.t.bought') : t('col.t.noBuy')),
    buy ? tile(t('tile.gain'), (diff >= 0 ? '+' : '') + eur(diff), ((diff / buy) * 100).toFixed(1) + '%', diff >= 0 ? 'pos' : 'neg')
        : tile(t('col.t.top'), all.length ? eur(Math.max.apply(null, all.map(unitPrice))) : '—', t('col.t.unit')),
    /* Two different dates that people mix up: the data's (when Cardmarket
       computed those prices) and your last check. */
    tile(t('col.t.cm'),
         dates.length ? fmtDate(dates[dates.length - 1]) : t('col.t.never'),
         (S.lastCheck ? t('col.t.checked', timeAgo(S.lastCheck)) : t('col.t.press')) +
         (dates.length > 1 && dates[0] !== dates[dates.length - 1] ? t('col.t.oldest', fmtDate(dates[0])) : ''))
  ].join('');

  $('#hCount').textContent = sumCount(all);
  $('#hValue').textContent = eur(val);

  const out = $('#colOut');
  if (!all.length) {
    out.innerHTML = emptyBox('📚', t('col.empty'));
    return;
  }
  if (!list.length) { out.innerHTML = emptyBox('🔎', t('col.noMatch')); return; }

  const head = '<div style="margin-bottom:12px;color:var(--tx2);font-size:13px">' +
    t('col.showing', '<b style="color:var(--tx)">' + list.length + '</b>', all.length) + ' · ' + t('n.cards', sumCount(list)) +
    ' · <b style="color:var(--acc)">' + eur(sumValue(list)) + '</b></div>';

  if (viewMode === 'grid') {
    out.innerHTML = head + '<div class="grid">' + list.map(i => cardHTML(i, {
      qty: i.qty, variant: i.variant,
      sub: i.cond + ' · ' + langName(i.lang) + (i.manual ? ' · ' + t('manual.short') : ''),
      priceText: (unitPrice(i) ? eur(unitPrice(i)) + ' <small>' + t('unit') + ' · ' + eur(lineTotal(i)) + ' ' + t('total') + '</small>' : '<small style="color:var(--tx3)">' + t('no.price') + '</small>'),
      /* The Cardmarket shortcut is on every card; highlighted on the ones with
         no price, which are the ones to sort out by hand. */
      actions: '<button class="btn sm" data-edit="' + i.uid + '">✎</button>' +
        '<a class="btn sm' + (unitPrice(i) ? '' : ' pri') + '" href="' + esc(cmSearchUrl(i)) + '" target="_blank" rel="noopener" title="' + esc(t('col.cmTitle')) + '" style="text-decoration:none">€ ↗</a>' +
        '<button class="btn sm danger" data-del="' + i.uid + '">🗑</button>'
    })).join('') + '</div>';
  } else {
    const th = t('th');
    out.innerHTML = head + '<div class="tblwrap"><table><thead><tr>' +
      '<th></th><th>' + th.card + '</th><th>' + th.set + '</th><th>' + th.num + '</th><th>' + th.rarity + '</th><th>' + th.variant + '</th><th>' + th.cond + '</th><th>' + th.lang + '</th>' +
      '<th class="num">' + th.qty + '</th><th class="num">' + th.unit + '</th><th class="num">' + th.total + '</th><th class="num">' + th.paid + '</th><th>' + th.src + '</th><th></th></tr></thead><tbody>' +
      list.map(i =>
        '<tr>' +
        '<td>' + (imgUrl(i.img, 'low') ? '<img class="tmini" src="' + esc(imgUrl(i.img, 'low')) + '" loading="lazy" alt="">' : '') + '</td>' +
        '<td><b>' + esc(i.name) + '</b>' + (i.notes ? '<div style="font-size:11px;color:var(--tx3)">' + esc(i.notes) + '</div>' : '') + '</td>' +
        '<td style="color:var(--tx2)">' + esc(i.setName) + '</td>' +
        '<td style="color:var(--tx2)">' + esc(i.number) + '</td>' +
        '<td style="color:var(--tx2)">' + esc(i.rarity) + '</td>' +
        '<td><span class="chip">' + esc(varName(i.variant)) + '</span></td>' +
        '<td><span class="chip">' + esc(i.cond) + '</span></td>' +
        '<td style="color:var(--tx2)">' + esc(langName(i.lang)) + '</td>' +
        '<td class="num"><b>' + (i.qty || 1) + '</b></td>' +
        '<td class="num">' + eur(unitPrice(i)) + '</td>' +
        '<td class="num"><b style="color:var(--acc)">' + eur(lineTotal(i)) + '</b></td>' +
        '<td class="num" style="color:var(--tx3)">' + (i.buy ? eur(i.buy) : '—') + '</td>' +
        '<td style="color:var(--tx3);font-size:11px">' + (i.manual ? t('manual.short') : (i.pr ? SRC_NAME[i.pr.src] || '' : '—')) + '</td>' +
        '<td style="white-space:nowrap"><button class="btn sm" data-edit="' + i.uid + '">✎</button> <button class="btn sm danger" data-del="' + i.uid + '">🗑</button></td>' +
        '</tr>').join('') +
      '</tbody></table></div>';
  }
}

['fText','fSet','fRar','fVar','fLang','fPrice','fSort'].forEach(id => {
  const el = $('#' + id);
  el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', renderCollection);
});
$('#btnClearF').onclick = () => { ['fText','fSet','fRar','fVar','fLang','fPrice'].forEach(id => $('#' + id).value = ''); $('#fSort').value = 'value-desc'; renderCollection(); };
const viewLabel = () => t(viewMode === 'grid' ? 'view.table' : 'view.grid');
$('#btnViewMode').onclick = () => {
  viewMode = viewMode === 'grid' ? 'table' : 'grid';
  $('#btnViewMode').innerHTML = viewLabel();
  renderCollection();
};

/* ---------- delegated clicks ---------- */
document.addEventListener('click', async e => {
  const ed = e.target.closest('[data-edit]');
  if (ed) {
    const it = S.items.find(x => x.uid === ed.dataset.edit);
    if (it) openModal(it); else toast(t('col.notFound'), 'err');
    return;
  }

  const dl = e.target.closest('[data-del]');
  if (dl) {
    const it = S.items.find(x => x.uid === dl.dataset.del);
    if (!it) { toast(t('col.notFoundRetry'), 'err'); return; }
    if (confirm(t('col.confirmDel', it.name, it.setName + ' ' + it.number))) {
      const before = S.items.length;
      S.items = S.items.filter(x => x !== it);
      save(); renderCollection();
      toast(S.items.length < before ? t('col.deleted') : t('col.delFail'), S.items.length < before ? '' : 'err');
    }
    return;
  }
  const wd = e.target.closest('[data-wdel]');
  if (wd) { S.wish = S.wish.filter(x => x.uid !== wd.dataset.wdel); save(); renderWish(); toast(t('wish.removed')); return; }

  const wm = e.target.closest('[data-wmove]');
  if (wm) {
    const w = S.wish.find(x => x.uid === wm.dataset.wmove);
    if (w) { S.wish = S.wish.filter(x => x.uid !== w.uid); save(); renderWish(); openModal(null, w); }
    return;
  }
  const ad = e.target.closest('[data-add]');
  if (ad) {
    const card = await loadCard(ad.dataset.add, ad.dataset.cat, ad);
    if (card) openModal(null, card);
    return;
  }
  const wi = e.target.closest('[data-wish]');
  if (wi) {
    const card = await loadCard(wi.dataset.wish, wi.dataset.cat, wi);
    if (card) addWish(card);
    return;
  }
});

/* Fetches the full card (with prices) right before adding it. */
async function loadCard(id, cat, btn) {
  const txt = btn ? btn.innerHTML : '';
  if (btn) { btn.innerHTML = '…'; btn.disabled = true; }
  try {
    const d = await tcg('/' + (cat || S.cfg.cat) + '/cards/' + encodeURIComponent(id));
    if (!d) throw new Error(t('card.notFound'));
    const c = normCard(d, cat || S.cfg.cat);
    if (!c.pr) { const fb = await fallbackOne(c); if (fb) c.pr = fb; }
    return c;
  } catch (err) {
    toast(t('card.loadFail', err.message), 'err');
    return null;
  } finally { if (btn) { btn.innerHTML = txt; btn.disabled = false; } }
}

/* Fallback: if TCGdex has no price, we ask pokemontcg.io. */
async function fallbackOne(c) {
  if (c.cat === 'ja') return null;                 // that database only has English cards
  try {
    const j = await pkm('/cards?q=' + encodeURIComponent('id:' + pkmIdOf(c)) + '&select=id,cardmarket');
    const d = j && j.data && j.data[0];
    if (d && d.cardmarket && d.cardmarket.prices) return prFromPkm(d.cardmarket.prices, d.cardmarket.updatedAt);
  } catch (e) {}
  return null;
}

/* ============================================================
   IMAGE FIELD (used by both forms: the catalog one and the manual one)
   Accepts your own photo, downsized before saving, or a direct link to
   an image.
   ============================================================ */
function imageFieldHTML(id, img) {
  const isPhoto = !!(img && img.slice(0, 5) === 'data:');
  return '<label class="f">' + t('img.label') + '</label>' +
    '<div class="row" style="gap:8px">' +
      '<button class="btn pri" id="' + id + 'Btn" type="button">' + t('img.useMine') + '</button>' +
      '<input class="inp grow" id="' + id + 'Url" placeholder="' + esc(t('img.url.ph')) + '" value="' + esc(isPhoto ? '' : (img || '')) + '">' +
      (isPhoto ? '<button class="btn danger" id="' + id + 'Del" type="button">' + t('img.remove') + '</button>' : '') +
      '<input type="file" id="' + id + 'File" accept="image/*" hidden>' +
    '</div>' +
    '<div style="font-size:11.5px;color:var(--tx3);margin-top:5px" id="' + id + 'Info">' +
      (isPhoto ? t('img.mine') : t('img.hint')) +
    '</div>';
}

function imageFieldWire(id, img, saveLabel) {
  let photo = (img && img.slice(0, 5) === 'data:') ? img : null;
  let removed = false;
  const info = () => $('#' + id + 'Info');

  /* The easiest mistake: pasting a page link (Drive, Dropbox...) thinking
     it's the image's. We warn instead of failing silently. */
  const checkUrl = () => {
    const v = $('#' + id + 'Url').value.trim();
    if (!v) { info().innerHTML = photo ? t('img.mine') : t('img.hint'); return; }
    const isPage = /drive\.google\.com|docs\.google\.com|dropbox\.com\/s\/|photos\.app\.goo\.gl|onedrive\.live\.com|imgur\.com\/(a|gallery)\//i.test(v);
    const looksLikeImage = /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(v);
    if (isPage) info().innerHTML = t('img.page');
    else if (!looksLikeImage) info().innerHTML = t('img.notImg');
    else info().innerHTML = t('img.looksImg');
  };
  $('#' + id + 'Url').addEventListener('input', checkUrl);

  $('#' + id + 'Btn').onclick = () => $('#' + id + 'File').click();
  const btnRemove = $('#' + id + 'Del');
  if (btnRemove) btnRemove.onclick = () => {
    photo = null; removed = true;
    $('#' + id + 'Url').value = '';
    info().textContent = t('img.removed');
    btnRemove.remove();
  };

  $('#' + id + 'File').onchange = ev => {
    const f = ev.target.files[0]; if (!f) return;
    const kb = Math.round(f.size / 1024);
    const ext = (f.name.split('.').pop() || '').toUpperCase();
    const fileInfo = '<br><span style="color:var(--tx3)">' + t('img.file', esc(f.name), esc(f.type || t('img.unknownType')), kb) + '</span>';
    info().textContent = t('img.processing');
    const fr = new FileReader();
    fr.onerror = () => { info().innerHTML = t('img.readFail') + fileInfo; };
    fr.onload = () => {
      const im = new Image();
      im.onload = () => {
        const W = 280, H = Math.max(1, Math.round(im.height * (W / im.width)));
        const cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        cv.getContext('2d').drawImage(im, 0, 0, W, H);
        photo = cv.toDataURL('image/jpeg', 0.72);
        removed = false;
        $('#' + id + 'Url').value = '';
        info().innerHTML = t('img.ready', Math.round(photo.length / 1024), esc(saveLabel));
      };
      im.onerror = () => {
        const heic = /heic|heif/i.test(f.type) || /^(HEIC|HEIF)$/.test(ext);
        const html = /html?$/i.test(ext) || /html/i.test(f.type);
        info().innerHTML = t('img.cantOpen') +
          (heic ? t('img.heic') : html ? t('img.html') : t('img.other')) + fileInfo;
      };
      im.src = fr.result;
    };
    fr.readAsDataURL(f);
    ev.target.value = '';
  };

  return {
    getValue: () => {
      if (photo) return photo;
      const u = $('#' + id + 'Url').value.trim();
      if (u) return u;
      return removed ? '' : '';
    }
  };
}

/* ============================================================
   ADD / EDIT DIALOG
   ============================================================ */
function openModal(existing, card) {
  /* The default language comes from the catalog you searched in: if you
     search in English, the card is English. */
  const base = existing || Object.assign({}, card, {
    qty: 1, variant: 'normal', cond: 'NM',
    lang: LANG_OF_CAT[(card && card.cat) || S.cfg.cat] || 'ES',
    buy: '', notes: ''
  });
  const isEdit = !!existing;
  const opt = (o, sel) => Object.keys(o).map(k => '<option value="' + esc(k) + '"' + (k === sel ? ' selected' : '') + '>' + esc(o[k]) + '</option>').join('');
  const optArr = (a, sel) => a.map(k => '<option value="' + esc(k) + '"' + (k === sel ? ' selected' : '') + '>' + esc(langName(k)) + '</option>').join('');
  const big = imgUrl(base.img, 'high');
  const saveLabel = isEdit ? t('m.saveChanges') : t('add');

  $('#modalHost').innerHTML =
  '<div class="ovl" id="ovl"><div class="modal">' +
    '<div class="mhead"><h3>' + (isEdit ? t('m.edit') : t('m.add')) + '</h3><button class="x" id="mX">×</button></div>' +
    '<div class="mbody">' +
      '<div style="display:flex;gap:16px;margin-bottom:18px;flex-wrap:wrap">' +
        (big ? '<img src="' + esc(big) + '" alt="" style="width:130px;border-radius:8px;flex:0 0 auto" onerror="this.style.display=\'none\'">' : '') +
        '<div style="flex:1;min-width:190px">' +
          '<div style="font-size:18px;font-weight:800">' + esc(base.name) + '</div>' +
          '<div style="color:var(--tx2);font-size:13px;margin-bottom:8px">' + esc(base.setName) + ' · ' + t('num.short') + ' ' + esc(base.number) + ' · ' + esc(base.rarity) + '</div>' +
          priceBoxHTML(base) +
        '</div>' +
      '</div>' +
      '<div class="fgrid">' +
        '<div><label class="f">' + t('f.qty') + '</label><input class="inp" id="mQty" type="number" min="1" step="1" value="' + (base.qty || 1) + '"></div>' +
        '<div><label class="f">' + t('f.variant') + '</label><select class="inp" id="mVar">' + opt(t('vars'), base.variant) + '</select></div>' +
        '<div><label class="f">' + t('f.cond') + '</label><select class="inp" id="mCond">' + opt(CONDS, base.cond) + '</select></div>' +
        '<div><label class="f">' + t('f.lang') + '</label><select class="inp" id="mLang">' + optArr(LANGS, base.lang) + '</select></div>' +
        '<div><label class="f">' + t('m.paid') + '</label><input class="inp" id="mBuy" type="number" min="0" step="0.01" placeholder="' + esc(t('optional')) + '" value="' + esc(base.buy == null ? '' : base.buy) + '"></div>' +
        '<div><label class="f">' + t('m.grade') + '</label><input class="inp" id="mGrade" placeholder="PSA 10, CGC 9.5..." value="' + esc(base.grade || '') + '"></div>' +
        '<div><label class="f">' + (base.manual ? t('m.estValue') : t('m.myPrice')) + '</label>' +
          '<input class="inp" id="mMp" type="number" min="0" step="0.01" placeholder="' + esc(base.manual ? t('m.youSet') : t('m.auto.ph')) + '" value="' + esc(base.mp == null ? '' : base.mp) + '"></div>' +
      '</div>' +
      '<div style="margin-top:12px"><label class="f">' + t('f.notes') + '</label><input class="inp" id="mNotes" placeholder="' + esc(t('m.notes.ph')) + '" value="' + esc(base.notes || '') + '"></div>' +
      '<div style="margin-top:12px">' + imageFieldHTML('mI', base.img) + '</div>' +
      '<div class="note" id="mPrev"></div>' +
    '</div>' +
    '<div class="mfoot">' +
      '<a class="btn" href="' + esc(cmSearchUrl(base)) + '" target="_blank" rel="noopener" style="margin-right:auto;text-decoration:none">' + t('m.cm') + '</a>' +
      '<button class="btn" id="mCancel">' + t('cancel') + '</button>' +
      '<button class="btn pri" id="mSave">' + saveLabel + '</button>' +
    '</div>' +
  '</div></div>';

  const upd = () => {
    const tmp = Object.assign({}, base, {
      variant: $('#mVar').value, cond: $('#mCond').value,
      qty: Math.max(1, parseInt($('#mQty').value, 10) || 1),
      mp: $('#mMp') ? $('#mMp').value : base.mp
    });
    const u = unitPrice(tmp);
    const pm = manualPrice(tmp);
    const ownPriceWins = pm != null && pm > 0;
    $('#mPrev').innerHTML = t('m.prev', eur(u), eur(u * tmp.qty)) +
      (base.manual || ownPriceWins
        ? ' <span style="color:var(--tx3)">' + t('m.prevMine') + '</span>'
        : (S.cfg.useCond ? ' <span style="color:var(--tx3)">' + t('m.prevCond', S.cfg.cond[tmp.cond] == null ? 1 : S.cfg.cond[tmp.cond]) + '</span>' : ''));
  };
  ['mVar','mCond','mQty','mMp'].forEach(id => { const el = $('#' + id); if (el) el.addEventListener('input', upd); });
  upd();

  const imageField = imageFieldWire('mI', base.img, saveLabel);

  const close = () => { $('#modalHost').innerHTML = ''; };
  $('#mX').onclick = close; $('#mCancel').onclick = close;
  $('#ovl').onclick = e => { if (e.target.id === 'ovl') close(); };

  $('#mSave').onclick = () => {
    const data = {
      qty: Math.max(1, parseInt($('#mQty').value, 10) || 1),
      variant: $('#mVar').value, cond: $('#mCond').value, lang: $('#mLang').value,
      buy: $('#mBuy').value === '' ? '' : Number($('#mBuy').value),
      grade: $('#mGrade').value.trim(), notes: $('#mNotes').value.trim()
    };
    /* Empty = no price of your own, the automatic one takes over again. */
    data.mp = $('#mMp').value === '' ? '' : Number($('#mMp').value);

    data.img = imageField.getValue();

    if (isEdit) { Object.assign(existing, data); toast(t('m.saved'), 'ok'); }
    else {
      const dup = S.items.find(x => x.id === base.id && x.variant === data.variant && x.cond === data.cond && x.lang === data.lang && (x.grade || '') === data.grade);
      if (dup) { dup.qty = (dup.qty || 1) + data.qty; toast(t('m.dup', dup.qty), 'ok'); }
      else {
        S.items.push(Object.assign({
          uid: uid(), id: base.id, cat: base.cat, name: base.name,
          setId: base.setId, setName: base.setName, series: base.series,
          number: base.number, rarity: base.rarity, img: base.img, pr: base.pr,
          added: new Date().toISOString()
        }, data));
        toast(t('m.added', base.name), 'ok');
      }
    }
    save(); close(); renderCollection();
    if (searchCards.length) renderSearchResults();   // refreshes the "you have N"
  };
}

function priceBoxHTML(c) {
  if (c.manual) return '<div style="background:#0e141c;border:1px solid var(--line);border-radius:8px;padding:9px 11px;font-size:12px;color:var(--tx2)">' + t('pb.manual') + '</div>';
  const p = c.pr;
  if (!p) return '<div style="background:#2a1f14;border:1px solid #5a4322;border-radius:8px;padding:9px 11px;font-size:12px;color:var(--tx2)">' + t('pb.none') + '</div>';
  const rows = [[modeName('trend'), p.trend], [modeName('avg'), p.avg], [modeName('low'), p.low], [modeName('avg30'), p.avg30]];
  if (p.rtrend > 0) rows.push([t('pb.reverse'), p.rtrend]);
  return '<div style="background:#0e141c;border:1px solid var(--line);border-radius:8px;padding:9px 11px">' +
    rows.map(r => '<div class="srow"><span style="color:var(--tx2);font-size:12px">' + r[0] + '</span><b class="num">' + (r[1] > 0 ? eur(r[1]) : '—') + '</b></div>').join('') +
    '<div style="font-size:11px;color:var(--tx3);margin-top:7px">' + t('pb.via', esc(SRC_NAME[p.src] || p.src), esc(fmtDate(p.updated))) + '</div></div>';
}

/* ============================================================
   MANUAL ENTRY
   ============================================================ */
function openManual() {
  const opt = (o, sel) => Object.keys(o).map(k => '<option value="' + esc(k) + '"' + (k === sel ? ' selected' : '') + '>' + esc(o[k]) + '</option>').join('');
  const optArr = (a, sel) => a.map(k => '<option value="' + esc(k) + '"' + (k === sel ? ' selected' : '') + '>' + esc(langName(k)) + '</option>').join('');

  $('#modalHost').innerHTML =
  '<div class="ovl" id="ovl"><div class="modal">' +
    '<div class="mhead"><h3>' + t('x.title') + '</h3><button class="x" id="mX">×</button></div>' +
    '<div class="mbody">' +
      '<div class="note">' + t('x.note') + '</div>' +
      '<div class="fgrid">' +
        '<div><label class="f">' + t('x.name') + '</label><input class="inp" id="xName" placeholder="Groudon"></div>' +
        '<div><label class="f">' + t('f.set') + '</label><input class="inp" id="xSet" placeholder="' + esc(t('x.set.ph')) + '"></div>' +
        '<div><label class="f">' + t('f.number') + '</label><input class="inp" id="xNum" placeholder="084/086"></div>' +
        '<div><label class="f">' + t('f.rarity') + '</label><input class="inp" id="xRar" placeholder="' + esc(t('x.rar.ph')) + '"></div>' +
        '<div><label class="f">' + t('f.qty') + '</label><input class="inp" id="xQty" type="number" min="1" step="1" value="1"></div>' +
        '<div><label class="f">' + t('f.variant') + '</label><select class="inp" id="xVar">' + opt(t('vars'), 'normal') + '</select></div>' +
        '<div><label class="f">' + t('f.cond') + '</label><select class="inp" id="xCond">' + opt(CONDS, 'NM') + '</select></div>' +
        '<div><label class="f">' + t('f.lang') + '</label><select class="inp" id="xLang">' + optArr(LANGS, LANG_OF_CAT[S.cfg.cat] || 'ES') + '</select></div>' +
        '<div><label class="f">' + t('m.estValue') + '</label><input class="inp" id="xMp" type="number" min="0" step="0.01" placeholder="' + esc(t('m.youSet')) + '"></div>' +
        '<div><label class="f">' + t('m.paid') + '</label><input class="inp" id="xBuy" type="number" min="0" step="0.01" placeholder="' + esc(t('optional')) + '"></div>' +
      '</div>' +
      '<div style="margin-top:12px">' + imageFieldHTML('xI', '') + '</div>' +
      '<div style="margin-top:12px"><label class="f">' + t('f.notes') + '</label><input class="inp" id="xNotes" placeholder="' + esc(t('x.notes.ph')) + '"></div>' +
    '</div>' +
    '<div class="mfoot"><button class="btn" id="mCancel">' + t('cancel') + '</button><button class="btn pri" id="mSave">' + t('add') + '</button></div>' +
  '</div></div>';

  const close = () => { $('#modalHost').innerHTML = ''; };
  $('#mX').onclick = close; $('#mCancel').onclick = close;
  $('#ovl').onclick = e => { if (e.target.id === 'ovl') close(); };
  const imageField = imageFieldWire('xI', '', t('add'));
  $('#xName').focus();

  $('#mSave').onclick = () => {
    const name = $('#xName').value.trim();
    if (!name) { toast(t('x.needName'), 'err'); $('#xName').focus(); return; }
    S.items.push({
      uid: uid(), id: 'manual-' + uid(), manual: true, cat: S.cfg.cat,
      name: name,
      setId: '', setName: $('#xSet').value.trim() || t('manual.set'), series: t('manual.set'),
      number: $('#xNum').value.trim(), rarity: $('#xRar').value.trim() || '—',
      img: imageField.getValue(), pr: null,
      qty: Math.max(1, parseInt($('#xQty').value, 10) || 1),
      variant: $('#xVar').value, cond: $('#xCond').value, lang: $('#xLang').value,
      mp: $('#xMp').value === '' ? 0 : Number($('#xMp').value),
      buy: $('#xBuy').value === '' ? '' : Number($('#xBuy').value),
      grade: '', notes: $('#xNotes').value.trim(),
      added: new Date().toISOString()
    });
    save(); close(); renderCollection();
    toast(t('x.added', name), 'ok');
  };
}
$('#btnManual').onclick = openManual;

/* ============================================================
   SEARCH AND ADD
   ============================================================ */
/* The number is printed as 084/086, but each database stores it its own
   way: TCGdex uses "084" in some sets and "84" in others. We try both. */
function numCandidates(raw) {
  let n = String(raw || '').trim();
  if (!n) return [];
  n = n.split('/')[0].replace(/[^A-Za-z0-9-]/g, '');
  if (!n) return [];
  const out = [n];
  if (/^[0-9]+$/.test(n)) {
    const stripped = String(parseInt(n, 10));
    if (out.indexOf(stripped) === -1) out.push(stripped);
    const padded = stripped.padStart(3, '0');
    if (out.indexOf(padded) === -1) out.push(padded);
  }
  return out;
}

/* TCGdex's "set=" filter matches substrings: asking for M6 also returns
   SM6, SM6a and SM6b. Here we narrow it down by the exact id prefix. */
function exactSet(list, setId) {
  if (!setId) return list;
  const p = String(setId).toLowerCase() + '-';
  return list.filter(c => String(c.id || '').toLowerCase().indexOf(p) === 0);
}

/* Results of the last search, so they can be re-sorted and filtered
   without going back to the network. */
let searchCards = [];
let searchMeta = { total: 0, cat: 'es', notice: '' };
const searchOpts = { sortBy: 'set-desc', rarityFilter: '', inCollection: '', min: '' };

/* How much the price has moved against last month's average. It's the
   closest thing to "what's trending": no public source says how many
   units are sold. */
function priceChange(c) {
  const p = c.pr;
  if (!p) return null;
  const base = p.avg30, current = p.trend || p.avg;
  if (!(base > 0) || !(current > 0)) return null;
  return ((current - base) / base) * 100;
}

function renderSearchResults() {
  const out = $('#searchOut');
  const cat = searchMeta.cat;

  const rarities = {};
  searchCards.forEach(c => { if (c.rarity && c.rarity !== '—') rarities[c.rarity] = 1; });

  const owned = {};
  S.items.forEach(i => { owned[i.id] = (owned[i.id] || 0) + (i.qty || 1); });

  const min = parseFloat(String(searchOpts.min).replace(',', '.'));
  let filteredCards = searchCards.filter(c => {
    if (searchOpts.rarityFilter && c.rarity !== searchOpts.rarityFilter) return false;
    if (searchOpts.inCollection === 'yes' && !owned[c.id]) return false;
    if (searchOpts.inCollection === 'no' && owned[c.id]) return false;
    if (min > 0 && !(basePrice(c.pr, 'normal') >= min)) return false;
    return true;
  });

  const releaseOf = c => { const s = setInfo(cat, c.setId); return (s && s.date) || ''; };
  const sortBy = {
    /* Cards without a price always go last, even when sorting from low to
       high: otherwise they would take all the top spots. */
    'price-desc': (a, b) => basePrice(b.pr, 'normal') - basePrice(a.pr, 'normal'),
    'price-asc':  (a, b) => (basePrice(a.pr, 'normal') || Infinity) - (basePrice(b.pr, 'normal') || Infinity),
    'rising':        (a, b) => (priceChange(b) == null ? -1e9 : priceChange(b)) - (priceChange(a) == null ? -1e9 : priceChange(a)),
    'falling':        (a, b) => (priceChange(a) == null ? 1e9 : priceChange(a)) - (priceChange(b) == null ? 1e9 : priceChange(b)),
    'set-desc':    (a, b) => releaseOf(b).localeCompare(releaseOf(a)) || (parseInt(a.number, 10) || 0) - (parseInt(b.number, 10) || 0),
    'set-asc':     (a, b) => releaseOf(a).localeCompare(releaseOf(b)) || (parseInt(a.number, 10) || 0) - (parseInt(b.number, 10) || 0),
    'name':      (a, b) => String(a.alt || a.name).localeCompare(String(b.alt || b.name)),
    'number':      (a, b) => (parseInt(a.number, 10) || 0) - (parseInt(b.number, 10) || 0)
  }[searchOpts.sortBy];
  filteredCards = filteredCards.slice().sort(sortBy);

  const opt = (v, label) => '<option value="' + v + '"' + (searchOpts.sortBy === v ? ' selected' : '') + '>' + label + '</option>';
  const toolbar =
    '<div class="row" style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--line)">' +
      '<div style="min-width:210px"><label class="f">' + t('f.sort') + '</label><select class="inp" id="rOrder">' +
        opt('set-desc', t('search.o.newest')) +
        opt('price-desc', t('search.o.priceDesc')) +
        opt('price-asc', t('search.o.priceAsc')) +
        opt('rising', t('search.o.up')) +
        opt('falling', t('search.o.down')) +
        opt('set-asc', t('search.o.oldest')) +
        opt('name', t('search.o.name')) +
        opt('number', t('search.o.number')) +
      '</select></div>' +
      '<div style="min-width:150px"><label class="f">' + t('f.rarity') + '</label><select class="inp" id="rRar">' +
        '<option value="">' + t('all.f') + '</option>' +
        Object.keys(rarities).sort().map(r => '<option value="' + esc(r) + '"' + (searchOpts.rarityFilter === r ? ' selected' : '') + '>' + esc(r) + '</option>').join('') +
      '</select></div>' +
      '<div style="min-width:150px"><label class="f">' + t('search.inCol') + '</label><select class="inp" id="rOwn">' +
        '<option value="">' + t('all.f') + '</option>' +
        '<option value="no"' + (searchOpts.inCollection === 'no' ? ' selected' : '') + '>' + t('search.missing') + '</option>' +
        '<option value="yes"' + (searchOpts.inCollection === 'yes' ? ' selected' : '') + '>' + t('search.owned') + '</option>' +
      '</select></div>' +
      '<div style="min-width:120px"><label class="f">' + t('search.min') + '</label>' +
        '<input class="inp" id="rMin" type="number" min="0" step="0.5" placeholder="' + esc(t('search.min.ph')) + '" value="' + esc(searchOpts.min) + '"></div>' +
      '<div><button class="btn" id="rClear">' + t('clear') + '</button></div>' +
    '</div>';

  const summary = '<div style="margin-bottom:12px;color:var(--tx2);font-size:13px">' +
    t('n.cards', filteredCards.length) +
    (filteredCards.length !== searchCards.length ? t('search.of', searchCards.length) : '') +
    (searchMeta.total > searchCards.length ? t('search.capped', searchMeta.total, searchCards.length) : '') +
    t('search.catalog', esc(catName(cat))) +
    (searchMeta.translated ? t('search.as', '<b style="color:var(--tx)">' + esc(searchMeta.translated) + '</b>') : '') +
    '</div>';

  const showChange = searchOpts.sortBy === 'rising' || searchOpts.sortBy === 'falling';

  out.innerHTML =
    (searchMeta.notice ? '<div class="note">' + searchMeta.notice + '</div>' : '') +
    toolbar + summary +
    (filteredCards.length
      ? '<div class="grid">' + filteredCards.map(c => {
          const inCollection = owned[c.id] || 0;
          const v = priceChange(c);
          const cardPrice = basePrice(c.pr, 'normal');
          let txt = cardPrice ? eur(cardPrice) + ' <small>' + t('unit') + '</small>' : '<small style="color:var(--tx3)">' + t('no.price') + '</small>';
          if (showChange && v != null) {
            txt += ' <small class="' + (v >= 0 ? 'pos' : 'neg') + '">' + (v >= 0 ? '▲' : '▼') + Math.abs(v).toFixed(0) + '%</small>';
          }
          return cardHTML(c, {
            owned: inCollection > 0,
            sub: inCollection ? t('search.have', inCollection) : '',
            priceText: txt,
            actions: '<button class="btn sm pri" data-add="' + esc(c.id) + '" data-cat="' + esc(cat) + '">' + t('add.btn') + '</button>' +
                     '<button class="btn sm" data-wish="' + esc(c.id) + '" data-cat="' + esc(cat) + '" title="' + esc(t('search.wishTitle')) + '">⭐</button>'
          });
        }).join('') + '</div>'
      : emptyBox('🔎', t('search.noMatch')));

  $('#rOrder').onchange = e => { searchOpts.sortBy = e.target.value; renderSearchResults(); };
  $('#rRar').onchange   = e => { searchOpts.rarityFilter = e.target.value; renderSearchResults(); };
  $('#rOwn').onchange   = e => { searchOpts.inCollection = e.target.value; renderSearchResults(); };
  $('#rMin').oninput    = e => { searchOpts.min = e.target.value; renderSearchResults(); };
  $('#rClear').onclick  = () => { searchOpts.sortBy = 'set-desc'; searchOpts.rarityFilter = ''; searchOpts.inCollection = ''; searchOpts.min = ''; renderSearchResults(); };
}

let lastSearch = null;
async function doSearch() {
  const name = $('#qName').value.trim();
  const setId = $('#qSet').value;
  const numRaw = $('#qNum').value.trim();
  const cat = S.cfg.cat;
  if (!name && !setId && !numRaw) { toast(t('search.needSome'), 'err'); return; }

  const out = $('#searchOut');
  out.innerHTML = emptyBox('⏳', t('search.busy'));
  progress(30);
  lastSearch = { name: name, setId: setId, numRaw: numRaw, cat: cat };

  /* In the Japanese catalog names are in Japanese. If you type in the
     Latin alphabet, we translate: "Groudon" -> グラードン. */
  let nameQ = name, translated = '';
  if (cat === 'ja' && name && hasLatin(name)) {
    const ja = toJapanese(name);
    if (ja) { nameQ = ja; translated = ja; }
  }

  const build = num => {
    const q = [];
    if (nameQ) q.push('name=like:' + encodeURIComponent(nameQ));
    if (setId) q.push('set=' + encodeURIComponent(setId));
    if (num) q.push('localId=' + encodeURIComponent(num));
    return '/' + cat + '/cards?' + q.join('&');
  };

  try {
    let list = [];
    let notice = '';
    const nums = numCandidates(numRaw);
    if (nums.length) {
      for (let i = 0; i < nums.length && !list.length; i++) list = exactSet((await tcg(build(nums[i]))) || [], setId);
      if (!list.length && (name || setId)) {
        list = exactSet((await tcg(build(''))) || [], setId);
        if (list.length) notice = t('search.numMiss', esc(nums[0]));
      }
    } else {
      list = exactSet((await tcg(build(''))) || [], setId);
    }

    if (!list.length) {
      searchCards = [];
      out.innerHTML = emptyBox('🤷', t('search.none', esc(catName(cat))) + '<br>' +
        '<span style="font-size:12px">' +
        (cat === 'ja' && name && hasLatin(name) && !translated ? t('search.noDict', esc(name)) : t('search.tryLess')) +
        '</span>');
      progress(100); setTimeout(() => progress(0), 400);
      return;
    }

    /* Sorting by price needs each card's full data, so we fetch up to 150.
       Beyond that we say so, rather than lie with an order computed on a
       small slice of the results. */
    const MAX_RESULTS = 150;
    const total = list.length;
    const slice = list.slice(0, MAX_RESULTS);
    const cards = [];
    progress(45);
    out.innerHTML = emptyBox('⏳', t('search.pricing', slice.length));
    await pool(slice, async c => {
      try {
        const d = await tcg('/' + cat + '/cards/' + encodeURIComponent(c.id), 2);
        if (d) cards.push(normCard(d, cat));
      } catch (e) {}
    }, 6, (done, tot) => progress(45 + (done / tot) * 50));

    progress(100);
    searchCards = cards;
    searchMeta = { total: total, cat: cat, notice: notice, translated: translated };
    renderSearchResults();
  } catch (e) {
    progress(100);
    out.innerHTML = emptyBox('⚠️', esc(e.message) +
      '<br><button class="btn" style="margin-top:12px" id="btnRetry">' + t('retry') + '</button>');
    const rt = $('#btnRetry'); if (rt) rt.onclick = doSearch;
  }
  setTimeout(() => progress(0), 500);
}
$('#btnSearch').onclick = doSearch;
$('#qName').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
$('#qNum').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
$('#qCat').onchange = e => { setCat(e.target.value); if (lastSearch) doSearch(); };

/* ============================================================
   WISHLIST
   ============================================================ */
function addWish(c) {
  if (S.wish.some(w => w.id === c.id)) { toast(t('wish.dup')); return; }
  S.wish.push(Object.assign({ uid: uid(), qty:1, variant:'normal', cond:'NM', lang:'ES', added:new Date().toISOString() }, c));
  save(); toast(t('wish.added', c.name), 'ok'); renderWish();
}
function renderWish() {
  $('#wishTiles').innerHTML = [
    tile(t('wish.t.count'), String(S.wish.length), t('wish.t.pending', S.wish.length)),
    tile(t('wish.t.cost'), eur(sumValue(S.wish)), t('wish.t.today'))
  ].join('');
  const out = $('#wishOut');
  if (!S.wish.length) {
    out.innerHTML = emptyBox('⭐', t('wish.empty') + '<br><span style="font-size:12px">' + t('wish.empty2') + '</span>');
    return;
  }
  out.innerHTML = '<div class="grid">' + S.wish.map(w => cardHTML(w, {
    actions: '<button class="btn sm pri" data-wmove="' + w.uid + '">' + t('wish.got') + '</button><button class="btn sm danger" data-wdel="' + w.uid + '">🗑</button>'
  })).join('') + '</div>';
}

/* ============================================================
   BROWSE SETS
   ============================================================ */
let setCards = [];
async function loadSet() {
  const id = $('#sSet').value;
  const cat = S.cfg.cat;
  if (!id) { toast(t('sets.needPick'), 'err'); return; }
  const out = $('#setOut');
  out.innerHTML = emptyBox('⏳', t('sets.loading'));
  setCards = [];
  progress(40);
  try {
    const s = await tcg('/' + cat + '/sets/' + encodeURIComponent(id));
    if (!s || !s.cards) throw new Error(t('sets.unavailable'));
    setCards = s.cards.map(c => ({
      id: c.id, cat: cat, name: c.name || '', number: c.localId || '',
      setId: id, setName: s.name || '', rarity: '', img: c.image || '', pr: null
    }));
    progress(100);
    renderSet();
  } catch (e) {
    progress(100);
    out.innerHTML = emptyBox('⚠️', esc(e.message));
  }
  setTimeout(() => progress(0), 400);
}
function renderSet() {
  const owned = {};
  S.items.forEach(i => { owned[i.id] = (owned[i.id] || 0) + (i.qty || 1); });
  const have = setCards.filter(c => owned[c.id]).length;
  const pct = setCards.length ? Math.round(have / setCards.length * 100) : 0;
  $('#setProgress').innerHTML =
    '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px">' +
    '<b>' + t('sets.progress', have, setCards.length) + '</b><b style="color:var(--acc)">' + pct + '%</b></div>' +
    '<div class="bar"><i style="width:' + pct + '%"></i></div>';

  const f = $('#sFilter').value;
  const list = setCards.filter(c => f === 'have' ? owned[c.id] : f === 'miss' ? !owned[c.id] : true);
  $('#setOut').innerHTML = list.length
    ? '<div style="margin-bottom:12px;color:var(--tx2);font-size:13px">' + t('sets.priceLater') + '</div>' +
      '<div class="grid">' + list.map(c => cardHTML(c, {
        owned: !!owned[c.id], qty: owned[c.id] || 0,
        sub: owned[c.id] ? t('sets.inCol') : '',
        priceText: '<small style="color:var(--tx3)">' + t('sets.onAdd') + '</small>',
        actions: '<button class="btn sm ' + (owned[c.id] ? '' : 'pri') + '" data-add="' + esc(c.id) + '" data-cat="' + esc(c.cat) + '">' + t('add.btn') + '</button>' +
                 (owned[c.id] ? '' : '<button class="btn sm" data-wish="' + esc(c.id) + '" data-cat="' + esc(c.cat) + '" title="' + esc(t('search.wishTitle')) + '">⭐</button>')
      })).join('') + '</div>'
    : emptyBox('✅', t('sets.nothing'));
}
$('#btnLoadSet').onclick = loadSet;
$('#sFilter').onchange = () => { if (setCards.length) renderSet(); };
$('#sCat').onchange = e => setCat(e.target.value);

/* ============================================================
   UPDATE PRICES
   Phase 1: TCGdex, one request per card with limited parallelism.
   Phase 2: cards still without a price, in batches to pokemontcg.io.
   ============================================================ */
async function updatePrices() {
  const targets = S.items.concat(S.wish).filter(i => !i.manual);
  if (!targets.length) {
    toast(S.items.length ? t('upd.onlyManual') : t('upd.noCards'));
    return;
  }
  const btn = $('#btnUpdate');
  btn.disabled = true;

  const byId = {};
  targets.forEach(i => { (byId[i.cat + '|' + i.id] = byId[i.cat + '|' + i.id] || []).push(i); });
  const groupKeys = Object.keys(byId);

  let okTcg = 0, noPrice = [], failures = 0;

  btn.textContent = t('upd.progress', 0);
  await pool(groupKeys, async best => {
    const group = byId[best];
    const ref = group[0];
    try {
      const d = await tcg('/' + (ref.cat || 'en') + '/cards/' + encodeURIComponent(ref.id), 3);
      if (!d) { failures++; return; }
      const pr = prFromTcgdex(pickCardmarket(d));
      group.forEach(it => {
        if (!it.img && d.image) it.img = d.image;
        if (!it.rarity || it.rarity === '—') it.rarity = d.rarity || it.rarity;
        if (d.set && d.set.name) it.setName = d.set.name;
      });
      if (pr) { group.forEach(it => { it.pr = pr; }); okTcg++; }
      else noPrice.push(ref);
    } catch (e) { failures++; }
  }, 6, (done, tot) => {
    const p = (done / tot) * 70;
    btn.textContent = t('upd.progress', Math.round(p));
    progress(p);
  });

  /* Phase 2: fallback in batches of 15 (pokemontcg.io accepts id:a OR id:b) */
  let okPkm = 0;
  const candidates = noPrice.filter(i => i.cat !== 'ja');
  if (candidates.length) {
    const batches = [];
    for (let i = 0; i < candidates.length; i += 15) batches.push(candidates.slice(i, i + 15));
    for (let n = 0; n < batches.length; n++) {
      btn.textContent = t('upd.fallback', Math.round(70 + (n / batches.length) * 30));
      progress(70 + (n / batches.length) * 30);
      const byPkmId = {};
      batches[n].forEach(i => { byPkmId[pkmIdOf(i)] = i; });
      const q = Object.keys(byPkmId).map(id => 'id:' + id).join(' OR ');
      try {
        const j = await pkm('/cards?q=' + encodeURIComponent(q) + '&pageSize=15&select=id,cardmarket');
        (j && j.data || []).forEach(d => {
          const ref = byPkmId[d.id];
          if (!ref || !d.cardmarket || !d.cardmarket.prices) return;
          const pr = prFromPkm(d.cardmarket.prices, d.cardmarket.updatedAt);
          byId[ref.cat + '|' + ref.id].forEach(it => { it.pr = pr; });
          okPkm++;
        });
      } catch (e) {}
      if (n < batches.length - 1) await sleep(200);
    }
  }

  const total = sumValue(S.items);
  const stamp = todayISO();
  S.lastCheck = new Date().toISOString();
  S.hist = S.hist.filter(h => h.d !== stamp);
  S.hist.push({ d: stamp, v: Math.round(total * 100) / 100, n: sumCount(S.items) });
  S.hist.sort((a, b) => a.d.localeCompare(b.d));
  if (S.hist.length > 400) S.hist = S.hist.slice(-400);

  save();
  progress(100); setTimeout(() => progress(0), 500);
  btn.disabled = false; btn.innerHTML = t('upd.btn');
  renderCollection(); renderWish(); renderStats();
  if (setCards.length) renderSet();

  /* Cardmarket recomputes once a day: if the source still gives
     yesterday's date we have to say so, or the update looks broken. */
  const datesAfter = S.items.concat(S.wish).map(i => (i.pr && i.pr.updated) || '').filter(Boolean).sort();
  const newest = datesAfter.length ? datesAfter[datesAfter.length - 1] : '';
  const today = todayISO();

  const unpriced = noPrice.length - okPkm;
  let msg = t('upd.checked', okTcg + okPkm);
  if (okPkm) msg += t('upd.viaFb', okPkm);
  msg += ' · ' + eur(total);
  if (newest) msg += newest >= today ? t('upd.today') : t('upd.notYet', fmtDate(newest));
  if (unpriced > 0) msg += ' · ' + t('upd.noPrice', unpriced);
  if (failures) msg += ' · ' + t('upd.netErr', failures);
  toast(msg, failures ? 'err' : 'ok');
}
$('#btnUpdate').onclick = updatePrices;

/* ============================================================
   STATISTICS
   ============================================================ */
function renderStats() {
  const all = S.items;
  const val = sumValue(all), buy = sumBuy(all), diff = val - buy;
  const avg = all.length ? val / sumCount(all) : 0;
  const sets = {}, rars = {}, sources = {};
  all.forEach(i => {
    sets[i.setName || '—'] = (sets[i.setName || '—'] || 0) + lineTotal(i);
    rars[i.rarity || '—'] = (rars[i.rarity || '—'] || 0) + (i.qty || 1);
    const f = i.manual ? t('st.src.manual') : (i.pr ? (SRC_NAME[i.pr.src] || i.pr.src) : t('st.src.none'));
    sources[f] = (sources[f] || 0) + (i.qty || 1);
  });

  $('#stTiles').innerHTML = [
    tile(t('st.t.total'), eur(val), t('st.t.ref', modeName(S.cfg.priceMode))),
    tile(t('st.t.cards'), String(sumCount(all)), t('n.entries', all.length) + ' · ' + t('n.sets', Object.keys(sets).length)),
    tile(t('st.t.avg'), eur(avg), ''),
    tile(t('tile.invested'), buy ? eur(buy) : '—', buy ? t('st.t.boughtOn') : t('st.t.noBuy')),
    buy ? tile(t('tile.gain'), (diff >= 0 ? '+' : '') + eur(diff), ((diff / buy) * 100).toFixed(1) + '%', diff >= 0 ? 'pos' : 'neg') : ''
  ].join('');

  const h = S.hist;
  if (h.length < 2) {
    $('#stHist').innerHTML = '<div class="empty" style="padding:26px">' + t('st.needTwo') + '</div>';
  } else {
    const W = 760, H = 180, pad = 34;
    const vs = h.map(x => x.v), mx = Math.max.apply(null, vs), mn = Math.min.apply(null, vs);
    const span = (mx - mn) || 1;
    const px = i => pad + (i / (h.length - 1)) * (W - pad - 10);
    const py = v => H - 26 - ((v - mn) / span) * (H - 50);
    const pts = h.map((x, i) => px(i) + ',' + py(x.v)).join(' ');
    const first = h[0].v, lastv = h[h.length - 1].v, chg = lastv - first;
    $('#stHist').innerHTML =
      '<div style="margin-bottom:10px"><b style="font-size:20px">' + eur(lastv) + '</b> ' +
      '<span class="' + (chg >= 0 ? 'pos' : 'neg') + '" style="font-weight:700">' + (chg >= 0 ? '+' : '') + eur(chg) +
      ' (' + (first ? ((chg / first) * 100).toFixed(1) : '0') + '%)</span> <span style="color:var(--tx3);font-size:12px">' + t('st.since', fmtDate(h[0].d)) + '</span></div>' +
      '<div style="overflow-x:auto"><svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;min-width:420px;height:auto">' +
      '<polyline points="' + pts + '" fill="none" stroke="#ffcb05" stroke-width="2.5" stroke-linejoin="round"/>' +
      h.map((x, i) => '<circle cx="' + px(i) + '" cy="' + py(x.v) + '" r="3" fill="#ffcb05"><title>' + fmtDate(x.d) + ': ' + eur(x.v) + '</title></circle>').join('') +
      '<text x="4" y="14" fill="#6b7889" font-size="11">' + eur(mx) + '</text>' +
      '<text x="4" y="' + (H - 6) + '" fill="#6b7889" font-size="11">' + eur(mn) + '</text>' +
      '</svg></div>';
  }

  const top = all.slice().sort((a, b) => unitPrice(b) - unitPrice(a)).slice(0, 15);
  const th = t('th');
  $('#stTop').innerHTML = top.length
    ? '<div class="tblwrap"><table style="min-width:640px"><thead><tr><th>#</th><th></th><th>' + th.card + '</th><th>' + th.set + '</th><th>' + th.variant + '</th>' +
      '<th class="num">' + th.qty + '</th><th class="num">' + th.unit + '</th><th class="num">' + th.total + '</th></tr></thead><tbody>' +
      top.map((i, n) => '<tr><td style="color:var(--tx3)">' + (n + 1) + '</td>' +
        '<td>' + (imgUrl(i.img, 'low') ? '<img class="tmini" src="' + esc(imgUrl(i.img, 'low')) + '" loading="lazy" alt="">' : '') + '</td>' +
        '<td><b>' + esc(i.name) + '</b></td><td style="color:var(--tx2)">' + esc(i.setName) + '</td>' +
        '<td><span class="chip">' + esc(varName(i.variant)) + '</span></td>' +
        '<td class="num">' + (i.qty || 1) + '</td><td class="num">' + eur(unitPrice(i)) + '</td>' +
        '<td class="num"><b style="color:var(--acc)">' + eur(lineTotal(i)) + '</b></td></tr>').join('') +
      '</tbody></table></div>'
    : '<div class="empty" style="padding:26px">' + t('st.noCards') + '</div>';

  $('#stSets').innerHTML = barsHTML(sets, v => eur(v));
  $('#stRar').innerHTML = barsHTML(rars, v => t('n.cards', v));
  $('#stSrc').innerHTML = barsHTML(sources, v => t('n.cards', v));
}
function barsHTML(obj, fmt) {
  const ks = Object.keys(obj).sort((a, b) => obj[b] - obj[a]).slice(0, 18);
  if (!ks.length) return '<div class="empty" style="padding:26px">' + t('st.noData') + '</div>';
  const mx = obj[ks[0]] || 1;
  return ks.map(k =>
    '<div style="margin-bottom:9px"><div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:3px">' +
    '<span>' + esc(k) + '</span><b>' + fmt(obj[k]) + '</b></div>' +
    '<div class="bar"><i style="width:' + Math.max(2, (obj[k] / mx) * 100) + '%"></i></div></div>').join('');
}

/* ============================================================
   SETTINGS
   ============================================================ */
function download(name, text, type) {
  const b = new Blob([text], { type: type || 'application/json;charset=utf-8' });
  const u = URL.createObjectURL(b);
  const a = document.createElement('a');
  a.href = u; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(u); a.remove(); }, 1000);
}
$('#btnExportJson').onclick = () => {
  download(t('file.base') + '-' + todayISO() + '.json', JSON.stringify(S, null, 2));
  toast(t('exp.json'), 'ok');
};
/* Spanish Excel expects semicolons and decimal commas; English Excel,
   commas and decimal points. If they don't match, each whole row ends up
   in a single cell. */
$('#btnExportCsv').onclick = () => {
  const sep = t('csv.sep');
  const dec = n => n.toFixed(2).replace('.', t('csv.dec'));
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const rows = S.items.map(i => [i.id, i.name, i.setName, i.number, i.rarity, varName(i.variant), i.cond, langName(i.lang), i.grade || '',
    i.qty || 1, dec(unitPrice(i)), dec(lineTotal(i)),
    i.buy === '' || i.buy == null ? '' : dec(Number(i.buy)),
    i.manual ? t('manual.short') : (i.pr ? SRC_NAME[i.pr.src] || '' : ''), i.pr ? fmtDate(i.pr.updated) : '', i.notes || ''].map(q).join(sep));
  download(t('file.base') + '-' + todayISO() + '.csv', '﻿' + t('csv.head').join(sep) + '\n' + rows.join('\n'), 'text/csv;charset=utf-8');
  toast(t('exp.csv'), 'ok');
};
$('#btnImport').onclick = () => $('#fileImport').click();
$('#fileImport').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const o = JSON.parse(r.result);
      if (!o || !Array.isArray(o.items)) throw new Error(t('imp.bad'));
      const incoming = { items: o.items, wish: o.wish || [], hist: [], cfg: DEF.cfg };
      migrate(incoming);
      const mode = S.items.length
        ? (confirm(t('imp.confirm', S.items.length)) ? 'merge' : 'replace')
        : 'replace';
      if (mode === 'replace') { S.items = incoming.items; S.wish = incoming.wish; S.hist = o.hist || []; }
      else {
        incoming.items.forEach(newItem => {
          const d = S.items.find(x => x.id === newItem.id && x.variant === newItem.variant && x.cond === newItem.cond && x.lang === newItem.lang);
          if (d) d.qty = (d.qty || 1) + (newItem.qty || 1);
          else S.items.push(Object.assign({}, newItem, { uid: uid() }));
        });
        incoming.wish.forEach(w => { if (!S.wish.some(x => x.id === w.id)) S.wish.push(Object.assign({}, w, { uid: uid() })); });
      }
      save(); syncSettingsUI(); renderCollection(); renderWish(); renderStats();
      toast(t('imp.done', incoming.items.length), 'ok');
    } catch (err) { toast(t('imp.fail', err.message), 'err'); }
    e.target.value = '';
  };
  r.readAsText(f);
};
$('#btnWipe').onclick = () => {
  if (!confirm(t('wipe.c1'))) return;
  if (!confirm(t('wipe.c2'))) return;
  S = blankState(); save(); syncSettingsUI(); fillCatSelects(); fillSetSelects(); renderCollection(); renderWish(); renderStats();
  toast(t('wipe.done'));
};
$('#setPriceMode').onchange = () => { S.cfg.priceMode = $('#setPriceMode').value; save(); renderCollection(); renderStats(); renderWish(); toast(t('set.modeToast', modeName(S.cfg.priceMode))); };
$('#setUseCond').onchange = () => { S.cfg.useCond = Number($('#setUseCond').value); save(); renderCollection(); renderStats(); };
$('#btnSaveKey').onclick = () => { S.cfg.apiKey = $('#setApiKey').value.trim(); save(); toast(S.cfg.apiKey ? t('key.saved') : t('key.removed'), 'ok'); };

function syncSettingsUI() {
  $('#setPriceMode').innerHTML = MODES.map(k =>
    '<option value="' + k + '"' + (k === S.cfg.priceMode ? ' selected' : '') + '>' + esc(modeName(k)) + (k === 'trend' ? t('set.recommended') : '') + '</option>').join('');
  $('#setUseCond').value = String(S.cfg.useCond);
  $('#setApiKey').value = S.cfg.apiKey || '';
  $('#condGrid').innerHTML = Object.keys(CONDS).map(k =>
    '<div><label class="f">' + esc(CONDS[k]) + '</label>' +
    '<input class="inp" type="number" step="0.01" min="0" max="3" data-cond="' + k + '" value="' + (S.cfg.cond[k] == null ? 1 : S.cfg.cond[k]) + '"></div>').join('');
  $$('[data-cond]').forEach(el => el.onchange = () => {
    S.cfg.cond[el.dataset.cond] = Number(el.value) || 0;
    save(); renderCollection(); renderStats();
  });
  let meter = '';
  if (storageOK) {
    try {
      const bytes = (localStorage.getItem(KEY) || '').length * 2;      // UTF-16
      const mb = bytes / 1048576;
      const photos = S.items.filter(i => i.img && i.img.slice(0, 5) === 'data:').length;
      const pct = Math.min(100, Math.round((mb / 5) * 100));
      meter = '<div style="margin-top:9px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">' +
        '<span>' + t('set.used') + (photos ? ' · ' + t('set.photos', photos) : '') + '</span>' +
        '<b>' + t('set.mb', mb.toFixed(2)) + '</b></div><div class="bar"><i style="width:' + Math.max(1, pct) + '%"></i></div></div>';
    } catch (e) {}
  }
  $('#storeInfo').innerHTML = (storageOK ? t('set.store.ok') : t('set.store.no')) + meter;

  const daysLeft = Math.round((new Date(PKM_EOL) - new Date()) / 864e5);
  $('#srcInfo').innerHTML = t('set.src') + (daysLeft > 0 ? t('set.src.eol', daysLeft) : t('set.src.off'));
}

/* ============================================================
   LANGUAGE
   Fixed text on the page carries data-i18n (or data-i18n-ph, for
   placeholders) with its key; what the code draws already goes through
   t(), so switching language means redrawing.
   ============================================================ */
function applyStrings() {
  document.documentElement.lang = LANG;
  document.title = t('app.title');
  $$('[data-i18n]').forEach(el => { el.innerHTML = t(el.dataset.i18n); });
  $$('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  $('#btnViewMode').innerHTML = viewLabel();
  const sel = $('#uiLang');
  sel.value = LANG;
  sel.title = t('ui.lang');
}
function setLang(l) {
  if (!STRINGS[l] || l === LANG) return;
  LANG = l;
  try { localStorage.setItem(LANG_KEY, l); } catch (e) {}
  applyStrings();
  syncSettingsUI(); fillCatSelects(); fillSetSelects();
  renderCollection(); renderWish(); renderStats();
  /* Results on screen are redrawn; one-off messages (no results, an
     error) go back to the initial message. */
  if (searchCards.length) renderSearchResults(); else $('#searchOut').innerHTML = emptyBox('🔍', t('search.start'));
  if (setCards.length) renderSet(); else $('#setOut').innerHTML = emptyBox('🗂️', t('sets.start'));
}
$('#uiLang').onchange = e => setLang(e.target.value);

/* ============================================================
   STARTUP
   ============================================================ */
let S = load();
buildSetIndex();
(function init() {
  applyStrings();
  $('#searchOut').innerHTML = emptyBox('🔍', t('search.start'));
  $('#setOut').innerHTML = emptyBox('🗂️', t('sets.start'));
  syncSettingsUI();
  fillCatSelects();
  fillSetSelects();
  renderCollection();
  renderWish();
  const stale = S.items.filter(i => !i.manual && i.pr && i.pr.updated && i.pr.updated !== todayISO());
  if (stale.length) toast(t('tip.update'));
})();
