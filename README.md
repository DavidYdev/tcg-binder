# TCG Binder

[Leer en español](README.es.md)

A collection organizer for trading cards. It's currently built for the **Pokémon TCG**: inventory, wishlist, set browser, statistics and Cardmarket prices in euros. It works with Spanish, English and Japanese cards.

The interface is in **English and Spanish**: pick one from the selector in the header and it's remembered. The first time, it follows your browser's language.

## How to use it

Download `index.html` and open it with a double click. No installation, no account.

Your collection is stored in your browser (`localStorage`), not on any server. To avoid losing it, export it now and then from **Settings → Export JSON**.

### Importing a card list

If you already have your collection written down, put it in a text file following the format of `cards.txt` (one card per line) and convert it:

```
node import-list.js cards.txt
```

Load the resulting JSON from **Settings → Import JSON**.

### Local server (optional)

```
node server.js
```

Serves the app at `http://localhost:8731`.

## Development

The app is a single HTML file with the code and several dictionaries embedded in it. **Don't edit the `<script>` block of the HTML by hand**:

1. Edit `tools/app.js`.
2. Run `node tools/build.js`, which rebuilds the `<script>` from the code and the dictionaries.

Interface text lives in `tools/strings.js`, in Spanish and English. The code asks for it with `t('key')`, and the HTML with `data-i18n="key"` (or `data-i18n-ph` for placeholders). `build.js` refuses to build the app if a language is missing a key, or if a key is used that doesn't exist.

The dictionaries (set catalog, Latin↔katakana Pokémon names, Cardmarket codes) are regenerated with the `gen-*.js` scripts in `tools/`, run from that folder.

## Where the data comes from

- **[TCGdex](https://tcgdex.dev)** (MIT license): card catalog in Spanish, English and Japanese, and Cardmarket prices.
- **[Pokémon TCG API](https://pokemontcg.io)**: fallback for the sets TCGdex has no prices for.
- **[PokéAPI](https://pokeapi.co)**: Pokémon names in Japanese and Latin script (`tools/names.csv`).

Prices are Cardmarket's, updated once a day.

**This repository contains no card images.** Your browser requests them directly from TCGdex, Pokémon TCG API and Limitless TCG when it shows them.

## Trademark notice

Pokémon and its character names are trademarks of Nintendo, Creatures Inc. and GAME FREAK inc. Card artwork is © The Pokémon Company. This is a free, non-profit fan project, and it is not affiliated with, sponsored or endorsed by any of them.

## License

The code is [MIT](LICENSE). The license covers only the code in this repository, not the trademarks or the card images.
