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
const textos = fs.readFileSync(aqui('textos.js'), 'utf8');
const script = fs.readFileSync(aqui('newscript.js'), 'utf8');

/* Antes de montar nada, los textos: los dos idiomas con las mismas claves
   (y los objetos de etiquetas, con las mismas subclaves), y ninguna clave
   pedida desde el código o desde el HTML que no exista. Un texto que falta
   no rompe la app, sale la clave en pantalla; por eso se para aquí. */
const TEXTOS = new Function(textos + '\nreturn TEXTOS;')();
const errores = [];
const idiomas = Object.keys(TEXTOS);
idiomas.forEach(a => idiomas.forEach(b => {
  if (a === b) return;
  Object.keys(TEXTOS[a]).forEach(k => {
    if (!(k in TEXTOS[b])) { errores.push('falta "' + k + '" en ' + b); return; }
    const va = TEXTOS[a][k], vb = TEXTOS[b][k];
    if (va && typeof va === 'object' && !Array.isArray(va))
      Object.keys(va).forEach(s => { if (!vb || !(s in vb)) errores.push('falta "' + k + '.' + s + '" en ' + b); });
  });
}));
const pedidas = {};
(script.match(/\bt\('[^']+'\s*[,)]/g) || []).forEach(m => { pedidas[m.slice(3, m.indexOf("'", 3))] = 'newscript.js'; });
(html.match(/data-i18n(?:-ph)?="[^"]+"/g) || []).forEach(m => { pedidas[m.slice(m.indexOf('"') + 1, -1)] = 'el HTML'; });
Object.keys(pedidas).forEach(k => { if (!(k in TEXTOS.es)) errores.push('"' + k + '" se usa en ' + pedidas[k] + ' pero no está en textos.js'); });
if (errores.length) { console.error('Textos incompletos:\n  ' + errores.join('\n  ')); process.exit(1); }

const OPEN = '<script>';
const CLOSE = '</' + 'script>';
const i0 = html.indexOf(OPEN);
const i1 = html.lastIndexOf(CLOSE);
if (i0 === -1 || i1 === -1 || i1 < i0) { console.error('No encuentro el bloque <script>'); process.exit(1); }

const nuevo = html.slice(0, i0) + OPEN + '\n' + bundle + nombres + codigos + romaji + textos + script + CLOSE + html.slice(i1 + CLOSE.length);
fs.writeFileSync(F, nuevo);

console.log('antes: ' + Math.round(html.length / 1024) + ' KB');
console.log('ahora: ' + Math.round(nuevo.length / 1024) + ' KB');
