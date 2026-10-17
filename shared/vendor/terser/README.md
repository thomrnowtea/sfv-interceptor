# Packaged Terser

Source: `terser@5.51.2`, pinned by the development lockfile. Public API: https://terser.org/docs/api-reference/ . License: BSD-2-Clause (`LICENSE`); bundled source-map dependency licenses are retained alongside it.

`node scripts/vendor-terser.mjs` bundles the public `minify` export into this local ES module. This is a maintenance command; loading the unpacked extension needs no installation or build. The dashboard loads it lazily for save/import/export. No background, navigation, polling or content-script module imports it. No remote scripts are loaded, and no permissions are added.

Rule code uses format-only minification: compression and mangling are disabled; names are retained. Function-body grammar permits bare returns. Strings, regular expressions and template contents retain their meaning, including required raw newlines. The exported JSON is always one physical line, with embedded newlines escaped by JSON serialization.
