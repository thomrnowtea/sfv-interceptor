# Packaged Prettier

Source: npm package `prettier@3.9.10`, pinned in the development lockfile.
Upstream: https://github.com/prettier/prettier
Browser integration: https://prettier.io/docs/browser
License: MIT, retained as `LICENSE`.

Only the standalone ES module and Babel, ESTree, HTML, and PostCSS ES modules are copied here. Keep them at the same version when updating. The extension reads these checked-in assets directly; installing node_modules is unnecessary for loading it unpacked. No remote scripts or plugin downloads run in the extension.

To update, install the intended exact Prettier development version, copy `standalone.mjs`, `LICENSE`, and the four matching `plugins/*.mjs` files, then run `npm test`, `npm run check`, and `npm run test:formatter`. Preserve this provenance file and the upstream license.
