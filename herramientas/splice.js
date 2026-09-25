/* Sustituye el bloque <script> de la app por el nuevo, con el catálogo
   de expansiones incrustado delante. Lee todo de ficheros para que no
   haya escapes de por medio. */
const fs = require('fs');
const path = require('path');

/* Las piezas viven junto a este script; la app, en la carpeta de arriba. */
const aqui = f => path.join(__dirname, f);
const F = path.join(__dirname, '..', 'organizador-pokemon-tcg.html');

const html = fs.readFileSync(F, 'utf8');
const bundle = fs.readFileSync(aqui('sets-bundle.js'), 'utf8');
const nombres = fs.readFileSync(aqui('nombres-bundle.js'), 'utf8');
const romaji = fs.readFileSync(aqui('romaji.js'), 'utf8');
const codigos = fs.readFileSync(aqui('codigos-bundle.js'), 'utf8');
const script = fs.readFileSync(aqui('newscript.js'), 'utf8');

const OPEN = '<script>';
const CLOSE = '</' + 'script>';
const i0 = html.indexOf(OPEN);
const i1 = html.lastIndexOf(CLOSE);
if (i0 === -1 || i1 === -1 || i1 < i0) { console.error('No encuentro el bloque <script>'); process.exit(1); }

const nuevo = html.slice(0, i0) + OPEN + '\n' + bundle + nombres + codigos + romaji + script + CLOSE + html.slice(i1 + CLOSE.length);
fs.writeFileSync(F, nuevo);

console.log('antes: ' + Math.round(html.length / 1024) + ' KB');
console.log('ahora: ' + Math.round(nuevo.length / 1024) + ' KB');
