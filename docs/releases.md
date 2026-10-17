# Releases

Users download the named extension ZIP from [GitHub Releases](https://github.com/thomrnowtea/sfv-interceptor/releases). They extract it and use Chrome's **Load unpacked** action. The archive contains `manifest.json` at its root, without an extra enclosing directory. See [Chrome's installation instructions](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

## Package locally

Use Node 22 or later:

```sh
npm ci
npm test
npm run check
npm run package
npx playwright install chromium
npm run test:release
```

The current version produces `dist/sfv-interceptor-v1.3.1.zip` and `dist/sfv-interceptor-v1.3.1.zip.sha256`. The version comes from `manifest.json` and must match `package.json`. `dist/` is ignored by Git. Packaging does not compile, minify, or rewrite the extension's code or manifest.

`npm run package -- --tag v1.3.1` additionally checks the expected release tag. Versions use Chrome-compatible numeric `X.Y.Z` values; tags use `vX.Y.Z`. For a future release, update the manifest and run `npm version <version> --no-git-tag-version` to update the package and lockfile before packaging. Update [the release notes](release-body.md) with a short changelog and the new download/compare links.

## Archive contents

[scripts/release-files.json](../scripts/release-files.json) is the explicit allowlist. Files are never selected by recursively archiving the repository or trusting `.gitignore`. Unknown files stay out even when placed inside a runtime directory.

| Included | Purpose |
| --- | --- |
| `manifest.json`, `background.js`, `content.js`, `page-hook.js` | Extension registration, worker, interception, notifications |
| Required `sw/` modules | Storage, subscriptions, matching, navigation, execution |
| Required `dashboard/` and `popup/` files | Editor, imports, sources, settings, activation |
| `sandbox/` | Isolated execution bridge |
| Required `shared/` modules and CSS | Schema, imports, themes, icons, dialogs |
| Six `icons/*.png` files | Normal and applied-state toolbar icons |
| Manrope WOFF2 and its license | Bundled interface font |
| CodeMirror, Prettier, Terser and their license notices | Local code editing, formatting, compact export |

Excluded: `AGENTS.md`, personal agent configuration, `.github/`, `.git/`, README and developer documentation, tests, scripts, Node packages and lockfiles, `node_modules/`, screenshots, browser profiles, QA reports, source maps, private/test rule JSON and user settings. Vendor maintenance READMEs and the unused dashboard converter compatibility module are also omitted. License notices are kept even though they are not executable assets.

The packager validates local JS imports (including literal dynamic imports), HTML/CSS resources, manifest resources, regular files, source-tree boundaries, duplicate paths and version/tag agreement. New runtime files must be added to the allowlist; missing dependencies fail packaging. ZIP paths are sorted and their metadata is fixed, so identical file bytes with the same locked tools produce identical ZIP bytes despite different source timestamps. The checksum is written beside the ZIP.

The extracted-archive smoke check verifies checksum, exact allowlisted contents and source bytes before loading that directory into isolated Chromium. It exercises worker messaging, an empty profile, CodeMirror, lazy Prettier/Terser, Manrope, real dynamic API interception, activity, light/dark popup activation and Open dashboard. Its evidence is under `.artifacts/release/`. The repository is never loaded as the test extension. This smoke check supplements the fuller UI/behavior runners.

## Publish on GitHub

Commit and push the reviewed source changes, new runtime assets, packaging files and [.github/workflows/release.yml](../.github/workflows/release.yml). Tag that commit only after its versions agree and checks pass:

```sh
git tag -a v1.3.1 -m "SFV Interceptor 1.3.1"
git push origin v1.3.1
```

The tag push runs Node tests, syntax checks, packaging and the extracted-ZIP browser check. On success, the workflow attaches the versioned ZIP and checksum to a GitHub Release. [Tag filters](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#using-filters-to-target-specific-branches-or-tags-for-push-events) select releases; [GitHub CLI](https://cli.github.com/manual/gh_release_create) publishes the curated [changelog and update instructions](release-body.md). Actions are pinned to full commit SHAs. The built-in GitHub token needs `contents: write`; no personal token is required.

**Actions → Release → Run workflow** builds and uploads a downloadable preview artifact without publishing a release. Only a pushed version tag publishes. GitHub's automatic source archives remain separate from the named extension ZIP. Existing releases are not overwritten by this workflow; publish fixes under a new version/tag.

## Updating an installed ZIP release

Replace the extension files in the same extracted folder and click **Reload** on the existing extension in `chrome://extensions`. Reopen the dashboard/popup and reload host pages so content scripts update. Chrome stores rules and settings in the profile, outside the archive. Keeping the same installed extension and folder preserves those values. Updates from GitHub ZIPs are manual.

CodeMirror's consolidated license notices retain the upstream CodeMirror, Lezer and support-library attribution alongside the bundled editor. Prettier, Terser, source-map dependency and Manrope notices retain their existing locations.
