# TCG Binder

[Read in English](README.md)

Organizador de colecciones de cartas coleccionables. Hoy está hecho para **Pokémon TCG**: inventario, lista de deseos, explorador de expansiones, estadísticas y precios en euros de Cardmarket. Funciona igual con cartas en español, inglés y japonés.

La interfaz está en **español e inglés**: se elige en el selector de la cabecera y se recuerda. La primera vez usa el idioma de tu navegador.

## Cómo usarlo

**Ábrelo en [davidydev.github.io/tcg-binder](https://davidydev.github.io/tcg-binder/).** No necesita instalación ni cuenta, y funciona también en el móvil. También puedes instalarla como app, con su propio icono y acceso sin conexión: **Ajustes → Instalar la app** explica cómo.

También puedes descargar `index.html` y abrirlo con doble clic. La web y el archivo descargado guardan colecciones separadas: para pasar la tuya de uno a otro, expórtala e impórtala.

Tu colección se guarda en el navegador (`localStorage`), no en ningún servidor. Para no perderla, expórtala de vez en cuando desde **Ajustes → Exportar JSON**.

### Importar una lista de cartas

Si ya tienes la colección apuntada, escríbela en un archivo de texto con el formato de `cards.txt` (una carta por línea) y conviértela:

```
node import-list.js cards.txt
```

El JSON resultante se carga desde **Ajustes → Importar JSON**.

### Servidor local (opcional)

```
node server.js
```

Sirve la app en `http://localhost:8731`.

## Desarrollo

La app es un único HTML con el código y varios diccionarios incrustados. **No edites el bloque `<script>` del HTML a mano**:

1. Edita `tools/app.js`.
2. Ejecuta `node tools/build.js`, que vuelve a montar el `<script>` con el código y los diccionarios.

Los textos de la interfaz viven en `tools/strings.js`, en español y en inglés. En el código se piden con `t('clave')`, y en el HTML con `data-i18n="clave"` (o `data-i18n-ph` para los placeholder). `build.js` no monta la app si a un idioma le falta una clave o si se usa una que no existe.

Los diccionarios (catálogo de expansiones, nombres latino↔katakana, códigos de Cardmarket) se regeneran con los `gen-*.js` de `tools/`, ejecutados desde esa carpeta.

## De dónde salen los datos

- **[TCGdex](https://tcgdex.dev)** (licencia MIT): catálogo de cartas en es/en/ja y precios de Cardmarket.
- **[Pokémon TCG API](https://pokemontcg.io)**: respaldo para las expansiones a las que TCGdex no pone precio.
- **[PokéAPI](https://pokeapi.co)**: nombres de los Pokémon en japonés y alfabeto latino (`tools/names.csv`).

Los precios son los de Cardmarket, que se actualizan una vez al día.

**Este repositorio no contiene imágenes de cartas.** Tu navegador las pide directamente a TCGdex, Pokémon TCG API y Limitless TCG al mostrarlas.

## Aviso de marcas

Pokémon y los nombres de sus personajes son marcas de Nintendo, Creatures Inc. y GAME FREAK inc. Las ilustraciones de las cartas son © The Pokémon Company. Este es un proyecto de aficionado, gratuito y sin ánimo de lucro, y no está afiliado, patrocinado ni aprobado por ninguna de ellas.

## Licencia

El código es [MIT](LICENSE). La licencia cubre solo el código de este repositorio, no las marcas ni las imágenes de las cartas.
