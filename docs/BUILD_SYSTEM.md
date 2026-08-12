# Build System

**This project does not use Electron Forge.** Some older documentation (and the README's
architecture table) references Forge, `forge.config.ts`, and a `post-make-hook.js` zip-restructuring
script — none of these exist in the current repo. The actual build system is three plain Vite
configs + `electron-builder`, with releases published by a GitHub Actions workflow. This document
describes what's actually there.

## The three Vite builds

Three independent Vite configs, one per Electron process, each with its own `npm run build:*`
script:

- **`vite.main.config.ts`** — builds `src/main/index.ts` → `.vite/build/index.js` (CJS, library
  mode). Externalizes `electron`, `electron-updater`, and all Node builtins. Explicitly does
  **not** externalize `js-yaml`/`electron-store` — they're pure JS and must be bundled into the
  main asar, per a comment in the config: externalizing them previously caused a "Cannot find
  module" crash in packaged builds.
- **`vite.preload.config.ts`** — builds `src/preload/preload.ts` → `.vite/build/preload.js` (CJS,
  library mode, `emptyOutDir: false` so it doesn't wipe the main build's output). Externalizes
  `electron` + Node builtins.
- **`vite.renderer.config.ts`** — builds the React app rooted at `src/renderer/` →
  `.vite/renderer/main_window/` (an **absolute** path, deliberately, per an in-config comment: it
  must stay at `<projectRoot>/.vite/renderer/main_window` regardless of the `root: 'src/renderer'`
  override, because that's where `electron-builder` expects to package it from). Uses `base: './'`
  (relative asset URLs — required for `file://` loading in the packaged app) and the `@` alias
  resolving to `src/renderer`.

`package.json`'s `build` script just runs all three in sequence:
```
npm run build:main && npm run build:preload && npm run build:renderer
```

Entry point in `package.json`: `"main": ".vite/build/index.js"` — this is what Electron actually
loads when you run `electron .` or launch the packaged app.

## electron-builder (`electron-builder.config.cjs`)

Packages and publishes the built `.vite/**` output. Key settings:

- `appId: 'org.orbeyond.modpackexporter'`, `productName: 'ORB Modpack Exporter'`.
- `files: ['.vite/**/*', 'package.json']` — only the Vite output + package.json get packaged (no
  raw `src/`, no `node_modules` beyond what electron-builder auto-includes for native deps).
- `extraResources`: copies `config.yaml` and `build/icons/256x256.png` (as `icon.png`) into the
  packaged app's resources folder — this is what `getConfigPath()`/`getAppIconPath()` in
  `src/main/index.ts` read in production (`process.resourcesPath`) vs. dev (`DEV_APP_ROOT`).
- `publish`: a single GitHub provider target — `owner: 'OR-Beyond', repo: 'modpack-exporter'`,
  `releaseType: 'release'`. This is also what `electron-updater` reads at runtime to know where to
  check for updates.
- **Windows** (`win`): both `nsis` and `msi` targets, each for `x64` and `arm64`.
  `requestedExecutionLevel: 'asInvoked'`, non-silent installer (`oneClick: false`), desktop +
  start menu shortcuts, doesn't wipe AppData on uninstall.
- **macOS** (`mac`): `dmg` target (x64/arm64), hardened runtime, ad-hoc signing
  (`identity: null` — the config has a comment noting a real Apple Developer ID would be needed
  for production/non-quarantined installs).
- **Linux** (`linux`): `AppImage` target (x64/arm64), `Utility` category.
- `artifactName: '${productName}-${version}-${os}-${arch}.${ext}'` (with a couple of per-platform
  overrides — `dmg.artifactName` and `appImage.artifactName` use slightly different patterns).

## npm scripts (`package.json`)

| Script | Command | Purpose |
|---|---|---|
| `start` | `npm run build && electron .` | Build everything, launch the app directly (no Forge dev server — this is the actual "run it locally" command; the README's `npm run dev` does **not exist**, that's stale). |
| `build` | `build:main && build:preload && build:renderer` | Build all three bundles. |
| `lint` / `test` | `tsc --noEmit` | Typecheck only — there is no separate test suite. |
| `package` | `npm run build && electron-builder --dir` | Unpacked local build (`dist/win-unpacked/` etc.) — no installer, fast iteration. |
| `dist` | `npm run build && electron-builder` | Full local installer build for the current platform, no publish. |
| `release` | `npm run build && electron-builder --publish always` | Build **and publish** — requires `GH_TOKEN` in the environment. |

**`npm run release` is not the reliable way to cut a release from a normal contributor machine.**
On at least one real Windows environment, the MSI target's WiX toolset step
(`light.exe`) failed with `LGHT1105 — Validation could not run due to system policy`, which
appears to be a non-interactive/restricted-session limitation of that particular machine (MSI
validation needs interactive Windows Installer access) rather than a config bug — NSIS built fine
in earlier runs, MSI didn't. The reliable path is the tag-triggered GitHub Actions workflow below,
which builds on clean GitHub-hosted runners for all three OSes.

## GH_TOKEN

Both `npm run release` (electron-builder's own publish step) and the GitHub Actions workflow need
a `GH_TOKEN` with permission to create releases and upload assets on
`OR-Beyond/modpack-exporter`. Locally this must be set in the environment; in CI it's the
workflow-scoped `secrets.GITHUB_TOKEN` (see below — no PAT needed there).

## Auto-updater (`electron-updater`, entirely inside `src/main/index.ts`)

There is **no custom/hand-rolled updater** — despite older documentation describing one, the
implementation is straightforward `electron-updater`, configured directly in `src/main/index.ts`:

- `autoUpdater.autoDownload = false` — the app decides when to download (only after explicit user
  confirmation or the launch check), not automatically in the background.
- `autoUpdater.autoInstallOnAppQuit = true`.
- `configureAutoUpdater()` — one-time listener setup (`updaterConfigured` guard): logs
  `autoUpdater`'s `'error'` events; on `'update-downloaded'`, sets `updateDownloaded = true` and
  shows a native dialog offering to restart now (`autoUpdater.quitAndInstall(false, true)`) or
  later.
- **`checkForUpdate()`** — no-ops with `{ updateAvailable: false }` if the app isn't packaged
  (i.e. always a no-op in dev). Otherwise calls `autoUpdater.checkForUpdates()` and compares the
  returned version against `app.getVersion()`. Exposed via the `app:check-for-update` IPC channel.
- **`installUpdate(downloadUrl?)`** — if an update was already downloaded, installs immediately;
  otherwise triggers `autoUpdater.downloadUpdate()`. Exposed via `app:install-update`.
- **`runLaunchUpdateCheck()`** — called once from `app.on('ready', ...)` (fire-and-forget,
  `.catch`-wrapped so it can never crash startup): silently checks for an update, and if one's
  found, shows a confirm dialog and downloads it.

Update metadata (`latest.yml`, `latest-mac.yml`, `latest-linux.yml`) is produced automatically by
`electron-builder` alongside the installers and uploaded to the same GitHub Release —
`electron-updater` reads these at runtime using the `publish` config's `owner`/`repo`.

## Official releases: the GitHub Actions workflow (`.github/workflows/release.yml`)

This is the actual, reliable way releases get built and published. Triggers on any pushed tag
matching `v*`, or manually via `workflow_dispatch`.

**`build` job** — matrix over three OSes (`windows-latest`, `ubuntu-latest`, `macos-latest`),
`timeout-minutes: 30`, `fail-fast: false` (one platform failing doesn't cancel the others):
1. Checkout (`fetch-depth: 1`), setup Node 20 with npm cache, `npm ci`.
2. Linux only: `apt-get install rpm` (needed for the `.rpm` target).
3. `npm run build`.
4. `npx electron-builder --config electron-builder.config.cjs <matrix-specific targets>
   --publish never` — Windows builds `nsis msi portable`, Linux builds `AppImage deb rpm`, macOS
   builds `dmg zip pkg`. (Note: the matrix's target lists — `portable`, `deb`, `rpm`, `zip`,
   `pkg` — are broader than what `electron-builder.config.cjs` itself declares as default targets
   per-platform; the extra formats are produced because they're passed explicitly as CLI args to
   `electron-builder`, which layers on top of the config file's `win`/`mac`/`linux` target lists.)
   `--publish never` here — this job only builds, it doesn't publish.
5. Uploads every produced artifact (`.exe .msi .AppImage .deb .rpm .dmg .zip .pkg .yml .yaml
   .blockmap`) as a workflow artifact named `release-<runner.os>`, `if-no-files-found: error` (the
   build fails loudly if a platform produces nothing).

**`publish` job** — runs after `build` completes (`needs: build`), on `ubuntu-latest`:
1. Downloads and merges all three `release-*` artifact sets into one `release-artifacts/`
   directory.
2. Uses `softprops/action-gh-release@v2` to create/update the GitHub Release for the pushed tag:
   `draft: false`, `prerelease` is auto-computed as true only if the tag name contains a `-`
   (e.g. `v2.1.0-beta`), `fail_on_unmatched_files: true`, uploads everything in
   `release-artifacts/`.

Permissions: `contents: write` (needed to create the release and upload assets), using the
workflow's own `secrets.GITHUB_TOKEN` — no PAT needs to be configured for this path.
`concurrency: release-${{ github.ref }}` with `cancel-in-progress: true` means re-pushing the same
tag cancels any still-running build for it.

**Code signing**: the README describes an intended SignPath Foundation integration
(`SIGNPATH_API_TOKEN`, `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`,
`SIGNPATH_SIGNING_POLICY_SLUG`, `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG`) for signing Windows
release artifacts. **This is not present in the current `release.yml`** — there is no SignPath
step in the workflow as it stands. Treat the README's Code Signing section as aspirational/planned
rather than active until a signing step is actually added to the workflow.

## How to publish a new release

This is the proven, reliable sequence (used for v2.0.11 and v2.0.12):

1. Bump `"version"` in `package.json`.
2. Commit the change (and anything else going into the release) to `main`, push it.
3. Tag the commit and push the tag:
   ```
   git tag v2.0.12
   git push origin v2.0.12
   ```
4. The `Release` workflow picks up the tag push automatically, builds all three platforms, and
   publishes the GitHub Release with every installer + `electron-updater` metadata file attached.
5. Confirm via the Releases page or the GitHub API
   (`GET /repos/OR-Beyond/modpack-exporter/releases/tags/v2.0.12`) that the expected assets are
   present before telling anyone the release is out — the workflow can fail partway (e.g. one
   platform's build step fails) and `fail_on_unmatched_files: true` will surface that as a failed
   `publish` job rather than a silently incomplete release.

Do **not** rely on running `npm run release` locally as the primary release mechanism — it
requires a correctly configured `GH_TOKEN` locally, builds only for your current OS, and (as
noted above) the Windows MSI target has failed on at least one real machine due to a WiX/system
policy issue unrelated to the app's code.
