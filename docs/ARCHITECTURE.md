# Architecture

ORB Modpack Exporter is an Electron + React + TypeScript desktop app that lets non-technical
Minecraft modpack contributors sync mods and configs through a shared GitHub repository, without
touching git or the command line themselves.

This document is the map. For exact IPC channel names/payloads see
[IPC_HANDLERS.md](./IPC_HANDLERS.md); for the on-disk file formats see
[STORAGE_MODEL.md](./STORAGE_MODEL.md); for the push/pull/export algorithms step-by-step see
[PUSH_PULL_FLOW.md](./PUSH_PULL_FLOW.md); for every React component see
[UI_COMPONENTS.md](./UI_COMPONENTS.md); for how the app is built and released see
[BUILD_SYSTEM.md](./BUILD_SYSTEM.md).

## The two GitHub repos

- **`OR-Beyond/modpack-exporter`** — this app's own source code. Releases (installers) are
  published here via GitHub Actions (see BUILD_SYSTEM.md).
- **`OR-Beyond/OR-Beyond-Versions`** — the actual modpack's data. Stores `modrinth.index.json`
  (the mod manifest) and an `overrides/` folder (configs, resource packs, shader packs, scripts).
  This is the repo the app's git operations (`git:push`, `git:pull`, etc.) clone/read/write. It is
  cloned once into `<userData>/versions-repo` and treated as a working copy the app manages
  entirely on its own — the user never sees or touches this clone directly.

The modpack itself is also published to Modrinth as **origin-realms-beyond**
(project id `O5wGsyGR`, the default for the `modrinthProjectId` setting).

## Process split

**Main process** (`src/main/`) owns everything with real system access: all git operations
(via `isomorphic-git`, no system Git binary required), the GitHub API (via Octokit, OAuth device
flow), the Modrinth API, the filesystem (modpack root, versions-repo clone, profile snapshots),
the `.mrpack` export/zip pipeline, `electron-store`-backed settings, and the `electron-updater`
auto-updater. It exposes all of this to the renderer exclusively through `ipcMain.handle`
channels registered in one place, `registerIpc()` in `src/main/index.ts` (a ~3900-line file — see
IPC_HANDLERS.md for the full channel list).

**Preload** (`src/preload/preload.ts`) is the only bridge between the two. It uses
`contextBridge.exposeInMainWorld('electron', api)` to expose a single typed `window.electron`
object with ~10 namespaces (`auth`, `settings`, `config`, `github`, `git`, `python`, `export`,
`modpack`, `versions`, `profile`, `modrinth`, `app`) wrapping roughly 45 `ipcRenderer.invoke`
calls plus 5 event channels (`on`/`off` pairs). The renderer has no direct Node or Electron API
access — everything goes through this object. `src/renderer/lib/types/index.ts` mirrors this
same surface as a `declare global { interface Window { electron: {...} } }` block, so it's the
authoritative typed contract the renderer programs against.

**Renderer** (`src/renderer/`) is a plain React 18 app (no Redux/Zustand — all state lives in
`App.tsx`'s `useState`/`useRef` hooks and is threaded down as props; see UI_COMPONENTS.md).
`App.tsx` owns auth state, dashboard data (commits, sync status, issues), and modal visibility,
and orchestrates the main user flows: sign in → first-run clone+pull → dashboard (activity feed +
sidebar) → push/pull/export via modals → settings.

## Data flow at a glance

```
┌─────────────────────────┐        IPC (ipcMain.handle /        ┌───────────────────────────┐
│   Renderer (React)      │        ipcRenderer.invoke, via      │   Main process             │
│   App.tsx + components  │◄──────  contextBridge preload  ────►│   src/main/index.ts        │
│   window.electron.*     │        window.electron.*            │   (registerIpc handlers)   │
└─────────────────────────┘                                     └─────────────┬──────────────┘
                                                                                │
                     ┌──────────────────────────────────────────────────────────────────────────┐
                     │                                                                            │
             ┌───────▼────────┐   ┌──────────────────┐   ┌──────────────────┐   ┌────────────────▼───┐
             │ isomorphic-git  │   │ Octokit           │   │ Modrinth API      │   │ electron-store /    │
             │ (git/           │   │ (GitHub OAuth      │   │ (fetch, mod       │   │ filesystem           │
             │ IsomorphicGit-  │   │ device flow +      │   │ hash lookup,      │   │ (settings, config    │
             │ Provider)       │   │ REST: commits,     │   │ icons, latest      │   │ .yaml, profile        │
             │                 │   │ issues)             │   │ release version)  │   │ snapshots)            │
             └───────┬─────────┘   └──────────────────┘   └──────────────────┘   └────────────────────┘
                     │
                     ▼
       <userData>/versions-repo   (local clone of OR-Beyond-Versions)
       modrinth.index.json + overrides/{config,resourcepacks,shaderpacks,essential,...}
                     │
        push/pull reconciles this against the user's real modpack profile:
                     ▼
       <modpackRoot>   (the user's actual Modrinth-profile folder — mods/, config/, etc.)
```

- **Push**: scan `<modpackRoot>/mods`, hash + resolve each jar against Modrinth, rebuild
  `modrinth.index.json`, sync override folders into the versions-repo clone, commit, push, then
  fire a Discord webhook. See PUSH_PULL_FLOW.md.
- **Pull**: sync the versions-repo clone from `origin/main`, then reconcile
  `<modpackRoot>/mods` and override folders against the manifest — downloading changed mods from
  the Modrinth CDN, copying changed override files, and preserving anything the user added locally
  but hasn't pushed yet ("smart merge"). See PUSH_PULL_FLOW.md.
- **Export**: build a `.mrpack` zip (Modrinth's modpack format) from the current manifest +
  overrides, optionally with an auto-generated changelog diffed against the last published
  release. See PUSH_PULL_FLOW.md.

## Storage model (hybrid)

- **Mod `.jar` files** are *not* stored in git. `modrinth.index.json` references each Modrinth-
  hosted mod by its CDN download URL + sha512 hash; jars are downloaded on demand during pull.
  Mods not found on Modrinth ("local"/unresolved mods) are the one exception — their actual jar
  bytes are committed into `overrides/mods/` in the versions repo, since there's no CDN URL to
  reference.
- **Override files** — everything under `OVERRIDE_FOLDERS` (`config`, `resourcepacks`,
  `shaderpacks`, `essential`, `fancymenu_data`, `data`, `keybind_presets`,
  `configureddefaults`) plus a couple of root-level `INCLUDE_FILES` (`checkbox_states.json`,
  `emi.json`) — are synced as real files through git in `overrides/`.
- **Personal files** (`options.txt`, `keybindings.txt`, `servers.dat`, and everything under
  `essential/` matched by `ESSENTIAL_EXCLUDE` — caches, natives, machine-specific binaries) are
  never synced.

Full field-by-field formats are in [STORAGE_MODEL.md](./STORAGE_MODEL.md).

## Key dependencies and why

| Dependency | Why |
|---|---|
| `electron` | Desktop app shell. |
| `react` / `react-dom` | Renderer UI. No state library — plain hooks in `App.tsx`. |
| `isomorphic-git` | Pure-JS git implementation — lets the app do clone/fetch/push/commit/diff without requiring a system Git install. All git access goes through the `GitProvider` interface (`src/main/git/GitProvider.ts`), currently implemented once by `IsomorphicGitProvider`. |
| `@octokit/rest` | GitHub REST API client — commits, issues, user profile, used after the custom OAuth device-flow login (`src/main/githubAuth.ts`). |
| `electron-store` | Typed, persisted key/value settings (`src/main/store.ts`) — token, modpack root, toggles, cached versions, etc. |
| `electron-updater` | Auto-update: checks GitHub Releases, downloads, installs on restart. Configured/used directly in `src/main/index.ts` (`checkForUpdate`/`installUpdate`/`configureAutoUpdater`) — **not** a hand-rolled updater despite older documentation claiming otherwise. |
| `adm-zip` | Builds/reads `.mrpack` zip files and reads jar files (`fabric.mod.json` extraction) and `.mrpack` downloads for changelog diffing. |
| `js-yaml` | Reads/writes the modpack's `config.yaml` (pack name, versions, include folders, Modrinth project IDs, etc.). |
| `lucide-react` | Icon set used throughout the renderer. |
| `react-hot-toast` | Toast notifications in the renderer. |
| `tailwindcss` | Renderer styling (dark theme, utility classes). |
| `vite` (+ `@vitejs/plugin-react`) | Builds all three bundles: main, preload, renderer. Three separate configs — no Electron Forge involved (see BUILD_SYSTEM.md). |
| `electron-builder` | Packages/publishes the installers (NSIS+MSI on Windows, AppImage/deb/rpm on Linux, dmg/zip/pkg on macOS) and their `electron-updater` metadata (`latest.yml` etc). |

## Notable architectural gaps (worth knowing before changing things)

These were found while reading the code and are easy to trip over:

- **`src/main/export/` is only partially wired up.** It's a clean, self-contained export
  pipeline (`orchestrator.ts` → `buildExport`, plus `modrinth.ts`, `changelog.ts`,
  `packaging.ts`, `cache.ts`), but only the `export:run` IPC channel actually calls into it. The
  two export-shaped channels the real UI flow uses — `export:generate-changelog` and
  `export:mrpack` — are separate, independently-written implementations living directly in
  `src/main/index.ts` that duplicate similar concepts (Modrinth CDN URL parsing, mod diffing,
  sha-based caching, override hashing, `.mrpack` zipping) against different data sources: they
  diff against the *live Modrinth-published release* + versions-repo git snapshots
  (`versions-repo/releases/v*.json`), not the `export/` module's local `<root>/manifests/*.json`
  snapshot files. If you're changing changelog or `.mrpack`-build behavior, you almost certainly
  want the `index.ts` implementations, not `export/changelog.ts` / `export/packaging.ts`. See
  PUSH_PULL_FLOW.md for both flows in detail.
- **`src/main/appdata.ts` is dead code.** It defines a clean set of userData path helpers
  (`getVersionsRepoDir`, `getSnapshotsDir`, etc.) but nothing imports it — `index.ts` reimplements
  `getVersionsRepoDir()` locally and inlines other paths (e.g. the mod-icon cache dir) directly.
- **`src/main/sync-mods/index.ts`** (`syncMods`, wired to the `python:sync-mods` IPC channel — a
  legacy name) is a *separate* mod-reconciliation pipeline driven by
  `<root>/manifests/modpack_manifest_*.json` files, distinct from the git-based
  `modrinth.index.json` push/pull flow. It has exactly one call site.
- **`profile.ts`'s `restoreSnapshot`** can detect drift (it hashes every file) but can't actually
  restore original bytes — it looks for a `fileContents` field that `takeSnapshot` never
  populates. Snapshots currently only ever record hashes, not content.
- **Two unrelated types share the name `PushResult`**: `src/main/git/GitProvider.ts` defines one
  (vestigial — `GitProvider.push()` actually returns `Promise<void>`) and
  `src/renderer/lib/types/index.ts` defines a completely different one (the shape of the
  `git:push` IPC response). Don't confuse them.
