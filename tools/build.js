/* Replaces the app's <script> block with a fresh one: the embedded
   dictionaries first, then the strings and the code. Everything is read
   from files so there is no escaping involved.
   Usage: node tools/build.js */
const fs = require('fs');
const path = require('path');

/* The pieces live next to this script; the app, in the folder above. */
const here = f => path.join(__dirname, f);
const APP = path.join(__dirname, '..', 'index.html');

const html = fs.readFileSync(APP, 'utf8');
const sets = fs.readFileSync(here('sets-bundle.js'), 'utf8');
const names = fs.readFileSync(here('names-bundle.js'), 'utf8');
const romaji = fs.readFileSync(here('romaji.js'), 'utf8');
const cmCodes = fs.readFileSync(here('cm-codes-bundle.js'), 'utf8');
const strings = fs.readFileSync(here('strings.js'), 'utf8');
const script = fs.readFileSync(here('app.js'), 'utf8');

/* Strings first: both languages with the same keys (and label objects
   with the same sub-keys), and no key requested from the code or the HTML
   that doesn't exist. A missing string doesn't break the app, the key just
   shows up on screen; that's why the build stops here. */
const STRINGS = new Function(strings + '\nreturn STRINGS;')();
const errors = [];
const langs = Object.keys(STRINGS);
langs.forEach(a => langs.forEach(b => {
  if (a === b) return;
  Object.keys(STRINGS[a]).forEach(k => {
    if (!(k in STRINGS[b])) { errors.push('"' + k + '" is missing in ' + b); return; }
    const va = STRINGS[a][k], vb = STRINGS[b][k];
    if (va && typeof va === 'object' && !Array.isArray(va))
      Object.keys(va).forEach(s => { if (!vb || !(s in vb)) errors.push('"' + k + '.' + s + '" is missing in ' + b); });
  });
}));
const used = {};
(script.match(/\bt\('[^']+'\s*[,)]/g) || []).forEach(m => { used[m.slice(3, m.indexOf("'", 3))] = 'app.js'; });
(html.match(/data-i18n(?:-ph)?="[^"]+"/g) || []).forEach(m => { used[m.slice(m.indexOf('"') + 1, -1)] = 'the HTML'; });
Object.keys(used).forEach(k => { if (!(k in STRINGS.es)) errors.push('"' + k + '" is used in ' + used[k] + ' but is not in strings.js'); });
if (errors.length) { console.error('Incomplete strings:\n  ' + errors.join('\n  ')); process.exit(1); }

const OPEN = '<script>';
const CLOSE = '</' + 'script>';
const i0 = html.indexOf(OPEN);
const i1 = html.lastIndexOf(CLOSE);
if (i0 === -1 || i1 === -1 || i1 < i0) { console.error('Could not find the <script> block'); process.exit(1); }

const out = html.slice(0, i0) + OPEN + '\n' + sets + names + cmCodes + romaji + strings + script + CLOSE + html.slice(i1 + CLOSE.length);
fs.writeFileSync(APP, out);

console.log('before: ' + Math.round(html.length / 1024) + ' KB');
console.log('after:  ' + Math.round(out.length / 1024) + ' KB');
