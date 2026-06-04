import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import path from 'path';
import { spawn } from 'child_process';
import fs from 'fs';
import yaml from 'js-yaml';

import { store, StoreSchema } from './store';
import {
  startDeviceAuth,
  logout as authLogout,
  checkAuth,
  getOctokit,
  getToken,
  DeviceCodeInfo,
} from './githubAuth';

// Squirrel.Windows installer events (only triggers on Windows install/update/uninstall)
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  if (require('electron-squirrel-startup')) { app.quit(); process.exit(0); }
} catch { /* not on Windows or not running under Squirrel */ }

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

// ─── Modpack root detection ───────────────────────────────────────────────────

const LAUNCHER_SUBPATHS = [
  path.join('Modrinth', 'profiles'),
  path.join('ModrinthApp', 'profiles'),
  path.join('PrismLauncher', 'instances'),
  path.join('MultiMC', 'instances'),
  path.join('curseforge', 'minecraft', 'Instances'),
];

// Lower-cased for case-insensitive matching on Windows
const SKIP_DIRS_LOWER = new Set([
  'windows', 'program files', 'program files (x86)', 'programdata',
  '$recycle.bin', 'system volume information', 'intel', 'drivers',
  'perflogs', 'msocache', 'recovery', 'boot', 'temp', 'tmp', 'cache',
]);

function shouldSkipDir(name: string): boolean {
  return name.startsWith('.') || name.startsWith('$') || SKIP_DIRS_LOWER.has(name.toLowerCase());
}

// ── Validation ──────────────────────────────────────────────────────────────

/** Sync check used for saved-root validation and fast scan. Requires mods/, config.yaml, core.py. */
function isValidModpackRoot(dir: string): boolean {
  try {
    const modsPath = path.join(dir, 'mods');
    return (
      fs.existsSync(modsPath) && fs.statSync(modsPath).isDirectory() &&
      fs.existsSync(path.join(dir, 'config.yaml')) &&
      fs.existsSync(path.join(dir, 'core.py'))
    );
  } catch { return false; }
}

/**
 * Async check for deep scan. Requires mods/ directory.
 * config.yaml and core.py are optional — warns but still accepts the root.
 */
async function isValidModpackRootAsync(dir: string): Promise<boolean> {
  const modsOk = await fs.promises.stat(path.join(dir, 'mods'))
    .then(s => s.isDirectory()).catch(() => false);
  if (!modsOk) return false;

  const [configOk, coreOk] = await Promise.all([
    fs.promises.access(path.join(dir, 'config.yaml')).then(() => true).catch(() => false),
    fs.promises.access(path.join(dir, 'core.py')).then(() => true).catch(() => false),
  ]);
  if (!configOk) console.warn(`[scan] ${dir}: missing config.yaml (accepted)`);
  if (!coreOk)   console.warn(`[scan] ${dir}: missing core.py (accepted)`);
  return true;
}

// ── Fast %APPDATA% scan ─────────────────────────────────────────────────────

function detectModpackRoot(): string | null {
  const appData = process.env.APPDATA;
  if (!appData) return null;

  const searchRoots = [
    path.join(appData, 'ModrinthApp', 'profiles'),
    path.join(appData, 'PrismLauncher', 'instances'),
    path.join(appData, 'MultiMC', 'instances'),
    path.join(appData, 'curseforge', 'minecraft', 'Instances'),
  ];

  for (const searchRoot of searchRoots) {
    if (!fs.existsSync(searchRoot)) continue;
    let entries: string[];
    try { entries = fs.readdirSync(searchRoot); } catch { continue; }
    for (const entry of entries) {
      const candidate = path.join(searchRoot, entry);
      try {
        if (fs.statSync(candidate).isDirectory() && isValidModpackRoot(candidate)) return candidate;
      } catch { continue; }
    }
  }
  return null;
}

// ── Drive enumeration ───────────────────────────────────────────────────────

/**
 * Enumerates A–Z using fs.promises.access with a 200ms per-drive timeout.
 * All 26 probes run in parallel so total wait is ≤ 200ms regardless of drive count.
 */
async function getAllDriveRoots(): Promise<string[]> {
  if (process.platform !== 'win32') return ['/'];

  const probes = Array.from({ length: 26 }, (_, i) => {
    const drive = `${String.fromCharCode(65 + i)}:\\`;
    return Promise.race<string | null>([
      fs.promises.access(drive, fs.constants.F_OK).then(() => drive).catch(() => null),
      new Promise<null>(r => setTimeout(() => r(null), 200)),
    ]);
  });

  const results = await Promise.all(probes);
  return results.filter((d): d is string => d !== null);
}

// ── Deep scan ───────────────────────────────────────────────────────────────

interface ScanCtx {
  signal: AbortSignal;
  deadline: number;
  remaining: number;   // shared mutable counter across all drives
  drive: string;       // current drive label for progress messages
}

/**
 * Checks all instance subfolders inside a launcher directory.
 * Decrements ctx.remaining for each profile folder checked.
 */
async function checkLauncherDir(dir: string, ctx: ScanCtx): Promise<string | null> {
  if (ctx.signal.aborted || Date.now() > ctx.deadline || ctx.remaining <= 0) return null;
  try {
    const entries = await fs.promises.readdir(dir);
    for (const entry of entries) {
      if (ctx.signal.aborted || Date.now() > ctx.deadline || ctx.remaining <= 0) return null;
      if (shouldSkipDir(entry)) continue;
      const candidate = path.join(dir, entry);
      ctx.remaining--;
      try {
        const stat = await fs.promises.stat(candidate);
        if (!stat.isDirectory()) continue;
        if (await isValidModpackRootAsync(candidate)) return candidate;
      } catch {}
    }
  } catch {}
  return null;
}

/**
 * Depth-first walk up to maxDepth levels from dir.
 * At each node checks all LAUNCHER_SUBPATHS before recursing into non-blacklisted subdirs.
 */
async function dfsWalk(dir: string, depth: number, maxDepth: number, ctx: ScanCtx): Promise<string | null> {
  if (ctx.signal.aborted || Date.now() > ctx.deadline || ctx.remaining <= 0) return null;

  // Check every launcher subpath rooted at this directory before going deeper
  for (const sub of LAUNCHER_SUBPATHS) {
    if (ctx.signal.aborted || Date.now() > ctx.deadline) return null;
    const found = await checkLauncherDir(path.join(dir, sub), ctx);
    if (found) return found;
  }

  if (depth >= maxDepth) return null;

  let entries: string[];
  try { entries = await fs.promises.readdir(dir); } catch { return null; }

  for (const entry of entries) {
    if (ctx.signal.aborted || Date.now() > ctx.deadline || ctx.remaining <= 0) return null;
    if (shouldSkipDir(entry)) continue;

    const candidate = path.join(dir, entry);
    ctx.remaining--;
    sendScanProgress(
      `Scanning ${ctx.drive} – checking ${500 - ctx.remaining} directories so far`,
    );

    try {
      const stat = await fs.promises.stat(candidate);
      if (!stat.isDirectory()) continue;
      const found = await dfsWalk(candidate, depth + 1, maxDepth, ctx);
      if (found) return found;
    } catch {}
  }
  return null;
}

// ── Concurrency guard & progress ────────────────────────────────────────────

let isDeepScanning = false;
let currentAbortController: AbortController | null = null;
let lastProgressSend = 0;

function sendScanProgress(msg: string) {
  const now = Date.now();
  if (now - lastProgressSend < 500) return; // throttle to ≤ 2 per second
  lastProgressSend = now;
  mainWindow?.webContents.send('modpack:scan-progress', { message: msg });
}

async function deepScanForModpackRoot(): Promise<{ path: string; driveRoot: string } | null> {
  if (isDeepScanning) return null;
  isDeepScanning = true;
  lastProgressSend = 0;
  currentAbortController = new AbortController();
  const { signal } = currentAbortController;

  try {
    const allDrives = await getAllDriveRoots();
    const cached = store.get('lastScanDriveRoot');
    const drives = cached ? [cached, ...allDrives.filter(d => d !== cached)] : allDrives;

    const ctx: ScanCtx = {
      signal,
      deadline: Date.now() + 5000,
      remaining: 500,
      drive: '',
    };

    for (const drive of drives) {
      if (signal.aborted || Date.now() > ctx.deadline || ctx.remaining <= 0) break;
      ctx.drive = drive;
      lastProgressSend = 0; // always emit one message per drive
      sendScanProgress(`Scanning ${drive}…`);
      const found = await dfsWalk(drive, 0, 4, ctx);
      if (found) return { path: found, driveRoot: drive };
    }

    // Nothing found — clear stale cache so next scan tries all drives
    store.set('lastScanDriveRoot', '');
    return null;
  } finally {
    isDeepScanning = false;
    currentAbortController = null;
  }
}

// ── Modrinth profile enumeration ─────────────────────────────────────────────

interface ModrinthProfile {
  name: string;        // profile folder name
  path: string;        // full path to the profile (future modpackRoot)
  launcherPath: string; // full path to the Modrinth folder containing profiles/
}

/**
 * Scans all drives up to maxDepth levels deep looking for Modrinth/profiles/<name>/mods/.
 * Collects every valid profile found before the 10-second deadline.
 * Runs per-drive in parallel; DFS is sequential within each drive.
 */
async function findAllModrinthProfiles(maxDepth = 5): Promise<ModrinthProfile[]> {
  const deadline = Date.now() + 10_000;
  const allDrives = await getAllDriveRoots();
  const allResults: ModrinthProfile[] = [];

  async function scanDir(dir: string, depth: number): Promise<void> {
    if (Date.now() > deadline) return;
    let entries: string[];
    try { entries = await fs.promises.readdir(dir); } catch { return; }

    const subdirs: string[] = [];

    for (const entry of entries) {
      if (Date.now() > deadline) return;
      if (shouldSkipDir(entry)) continue;
      const entryPath = path.join(dir, entry);

      if (entry.toLowerCase() === 'modrinth') {
        const profilesDir = path.join(entryPath, 'profiles');
        try {
          const profileNames = await fs.promises.readdir(profilesDir);
          for (const profileName of profileNames) {
            if (Date.now() > deadline) break;
            const profilePath = path.join(profilesDir, profileName);
            try {
              const st = await fs.promises.stat(profilePath);
              if (!st.isDirectory()) continue;
              const hasMods = await fs.promises.stat(path.join(profilePath, 'mods'))
                .then(s => s.isDirectory()).catch(() => false);
              if (hasMods) allResults.push({ name: profileName, path: profilePath, launcherPath: entryPath });
            } catch {}
          }
        } catch {}
        continue; // don't recurse inside the Modrinth folder itself
      }

      if (depth < maxDepth) {
        try {
          const st = await fs.promises.stat(entryPath);
          if (st.isDirectory()) subdirs.push(entryPath);
        } catch {}
      }
    }

    for (const sub of subdirs) {
      if (Date.now() > deadline) return;
      await scanDir(sub, depth + 1);
    }
  }

  await Promise.all(allDrives.map(drive => scanDir(drive, 0)));
  return allResults;
}

// ── Startup scan ────────────────────────────────────────────────────────────

function runStartupScan() {
  const saved = store.get('modpackRoot');
  if (saved && isValidModpackRoot(saved)) return;

  const fast = detectModpackRoot();
  if (fast) { store.set('modpackRoot', fast); return; }

  // Non-blocking background deep scan
  deepScanForModpackRoot().then(found => {
    if (!found) return;
    store.set('modpackRoot', found.path);
    store.set('lastScanDriveRoot', found.driveRoot);
    mainWindow?.webContents.send('modpack:root-found', { path: found.path });
  }).catch(() => {});
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

const DEV_APP_ROOT = app.isPackaged
  ? process.resourcesPath
  : path.resolve(__dirname, '../..');

function getScriptPath(name: string) {
  return app.isPackaged ? path.join(process.resourcesPath, name) : path.join(DEV_APP_ROOT, name);
}

function getConfigPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'config.yaml')
    : path.join(DEV_APP_ROOT, 'config.yaml');
}

function getPython() {
  return process.platform === 'win32' ? 'python' : 'python3';
}

// ─── Process helpers ──────────────────────────────────────────────────────────

function runPython(scriptPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(getPython(), [scriptPath, ...args], { cwd: DEV_APP_ROOT });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d: Buffer) => (out += d.toString()));
    proc.stderr.on('data', (d: Buffer) => (err += d.toString()));
    proc.on('close', code => (code === 0 ? resolve(out) : reject(new Error(err || out))));
    proc.on('error', reject);
  });
}

function runGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d: Buffer) => (out += d.toString()));
    proc.stderr.on('data', (d: Buffer) => (err += d.toString()));
    proc.on('close', code => (code === 0 ? resolve({ stdout: out, stderr: err }) : reject(new Error(err || out))));
    proc.on('error', reject);
  });
}

// ─── Manifest diff ────────────────────────────────────────────────────────────

interface ManifestMod { filename: string; title?: string; version?: string }
interface ModChange { type: 'added' | 'removed' | 'updated'; name: string }

function diffManifests(
  old: { mods?: ManifestMod[] },
  next: { mods?: ManifestMod[] }
): ModChange[] {
  const changes: ModChange[] = [];
  const oldMap = new Map((old.mods || []).map(m => [m.filename, m]));
  const newMap = new Map((next.mods || []).map(m => [m.filename, m]));
  for (const [fn, mod] of newMap) {
    const label = mod.title || fn.replace('.jar', '');
    if (!oldMap.has(fn)) changes.push({ type: 'added', name: label });
    else if (oldMap.get(fn)!.version !== mod.version) changes.push({ type: 'updated', name: label });
  }
  for (const [fn, mod] of oldMap) {
    if (!newMap.has(fn)) changes.push({ type: 'removed', name: mod.title || fn.replace('.jar', '') });
  }
  return changes;
}

// ─── Window ───────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.js');
  console.log('[main] preload path:', preloadPath);
  console.log('[main] DEV_SERVER_URL:', MAIN_WINDOW_VITE_DEV_SERVER_URL);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 620,
    backgroundColor: '#1E1E1E',
    frame: false,
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' } : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    console.log('[main] ready-to-show fired');
    mainWindow!.show();
    mainWindow!.focus();
  });

  const fallback = setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      console.warn('[main] ready-to-show never fired – forcing show');
      mainWindow.show();
      mainWindow.focus();
    }
  }, 10_000);

  mainWindow.webContents.once('did-finish-load', () => clearTimeout(fallback));

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[main] did-fail-load', code, desc, url);
  });

  mainWindow.webContents.on('preload-error', (_e, p, err) => {
    console.error('[main] preload-error', p, err);
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  console.log('[main] window created, visible:', mainWindow.isVisible(), mainWindow.getBounds());
}

app.on('ready', () => { registerIpc(); createWindow(); runStartupScan(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ─── IPC ──────────────────────────────────────────────────────────────────────

function registerIpc() {
  // App controls
  ipcMain.handle('app:minimize', () => mainWindow?.minimize());
  ipcMain.handle('app:maximize', () => { mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize(); });
  ipcMain.handle('app:close', () => mainWindow?.close());
  ipcMain.handle('app:open-external', (_e, url: string) => shell.openExternal(url));
  ipcMain.handle('app:select-directory', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('app:platform', () => process.platform);

  // ── Device flow auth ──────────────────────────────────────────────────────
  ipcMain.handle('device-auth:start', async (event) => {
    try {
      const token = await startDeviceAuth((info: DeviceCodeInfo) => {
        // Push the user_code / verification_uri to the renderer so it can show the modal.
        if (!event.sender.isDestroyed()) {
          event.sender.send('device-auth:code', info);
        }
      });

      // Token obtained – fetch the user profile for the UI.
      const check = await checkAuth();
      return { success: true, token, user: check.user ?? null };
    } catch (e: any) {
      return { success: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle('device-auth:logout', () => {
    try {
      authLogout();
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle('device-auth:check', async () => {
    try {
      const result = await checkAuth();
      return { success: true, ...result };
    } catch (e: any) {
      return { success: false, authenticated: false, error: e?.message || String(e) };
    }
  });

  // Settings
  ipcMain.handle('settings:get', (_e, key: keyof StoreSchema) => store.get(key) || null);
  ipcMain.handle('settings:set', (_e, key: keyof StoreSchema, val: string) => store.set(key, val));
  ipcMain.handle('settings:get-all', () => store.store);

  // Config
  ipcMain.handle('config:read', () => {
    try {
      return { success: true, data: yaml.load(fs.readFileSync(getConfigPath(), 'utf-8')) };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('config:write', (_e, data: Record<string, unknown>) => {
    try {
      fs.writeFileSync(getConfigPath(), yaml.dump(data, { lineWidth: -1 }), 'utf-8');
      return { success: true };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('config:read-export-state', () => {
    try {
      const root = store.get('modpackRoot') || DEV_APP_ROOT;
      const p = path.join(root, '.last_export_state.json');
      if (!fs.existsSync(p)) return { success: true, data: null };
      return { success: true, data: JSON.parse(fs.readFileSync(p, 'utf-8')) };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  // GitHub
  ipcMain.handle('github:get-user', async () => {
    const oc = getOctokit();
    if (!oc) return { success: false, error: 'No token' };
    try { const { data } = await oc.users.getAuthenticated(); return { success: true, data }; }
    catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('github:get-commits', async (_e, { owner, repo, branch }: { owner: string; repo: string; branch: string }) => {
    const oc = getOctokit();
    if (!oc) return { success: false, error: 'No token' };
    try {
      const { data } = await oc.repos.listCommits({ owner, repo, sha: branch, per_page: 20 });
      return { success: true, data };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('github:get-commit-files', async (_e, { owner, repo, sha }: { owner: string; repo: string; sha: string }) => {
    const oc = getOctokit();
    if (!oc) return { success: false, error: 'No token' };
    try {
      const { data: commit } = await oc.repos.getCommit({ owner, repo, ref: sha });
      const files = commit.files || [];
      const allFiles = files.map(f => f.filename);
      const configChanged = files.some(f => f.filename === 'config.yaml');
      const manifestFiles = files.filter(f => f.filename.startsWith('manifests/') && !f.filename.includes('lite') && f.status === 'modified');

      let modChanges: ModChange[] = [];
      if (commit.parents.length > 0) {
        for (const mf of manifestFiles) {
          try {
            const parentSha = commit.parents[0].sha;
            const [{ data: oldFile }, { data: newFile }] = await Promise.all([
              oc.repos.getContent({ owner, repo, path: mf.filename, ref: parentSha }),
              oc.repos.getContent({ owner, repo, path: mf.filename, ref: sha }),
            ]);
            const decode = (f: typeof oldFile) => 'content' in f ? Buffer.from((f as any).content, 'base64').toString() : '{}';
            modChanges = diffManifests(JSON.parse(decode(oldFile)), JSON.parse(decode(newFile)));
          } catch {}
        }
      }

      return { success: true, data: { files: allFiles, modChanges, configChanged } };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('github:get-issues', async (_e, { owner, repo }: { owner: string; repo: string }) => {
    const oc = getOctokit();
    if (!oc) return { success: false, error: 'No token' };
    try {
      const { data } = await oc.issues.listForRepo({ owner, repo, state: 'open', per_page: 10 });
      // Exclude pull requests (GitHub returns them via the issues endpoint), strip down labels.
      const issues = data
        .filter(i => !i.pull_request)
        .map(i => ({
          number: i.number,
          title: i.title,
          html_url: i.html_url,
          created_at: i.created_at,
          user: i.user
            ? { login: i.user.login, avatar_url: i.user.avatar_url }
            : { login: 'unknown', avatar_url: 'https://github.com/ghost.png' },
          labels: (i.labels || [])
            .map(l => (typeof l === 'string' ? { name: l, color: '888888' } : { name: l.name || '', color: l.color || '888888' }))
            .filter(l => l.name),
        }));
      return { success: true, data: issues };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  // Modpack root detection
  ipcMain.handle('modpack:detect-root', () => {
    const detected = detectModpackRoot();
    return { success: true, path: detected };
  });

  ipcMain.handle('modpack:deep-scan', async () => {
    if (isDeepScanning) {
      return { success: false, path: null, driveRoot: null, error: 'Scan already in progress' };
    }
    try {
      const found = await deepScanForModpackRoot();
      if (found) {
        store.set('modpackRoot', found.path);
        store.set('lastScanDriveRoot', found.driveRoot);
      }
      return { success: true, path: found?.path ?? null, driveRoot: found?.driveRoot ?? null };
    } catch (e: any) {
      return { success: false, path: null, driveRoot: null, error: (e as Error).message };
    }
  });

  ipcMain.handle('modpack:abort-scan', () => {
    currentAbortController?.abort();
    return { success: true };
  });

  ipcMain.handle('modpack:list-profiles', async () => {
    try {
      const data = await findAllModrinthProfiles(5);
      return { success: true, data };
    } catch (e: any) {
      return { success: false, data: [], error: (e as Error).message };
    }
  });

  ipcMain.handle('modpack:set-root-from-profile', (_e, profilePath: string) => {
    store.set('modpackRoot', profilePath);
    store.set('lastScanDriveRoot', '');
    return { success: true };
  });

  ipcMain.handle('modpack:set-root', (_e, p: string) => {
    store.set('modpackRoot', p);
    return { success: true };
  });

  ipcMain.handle('modpack:get-root', () => {
    return { success: true, path: store.get('modpackRoot') || null };
  });

  // Modpack info – combines config.yaml + .last_export_state.json
  ipcMain.handle('modpack:info', () => {
    try {
      const root = store.get('modpackRoot') || DEV_APP_ROOT;
      let config: unknown = null;
      let exportState: unknown = null;
      try { config = yaml.load(fs.readFileSync(getConfigPath(), 'utf-8')); } catch {}
      const sp = path.join(root, '.last_export_state.json');
      if (fs.existsSync(sp)) {
        try { exportState = JSON.parse(fs.readFileSync(sp, 'utf-8')); } catch {}
      }
      return { success: true, data: { config, exportState } };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // Git operations
  ipcMain.handle('git:pull', async () => {
    const root = store.get('modpackRoot') || DEV_APP_ROOT;
    try {
      const { stdout } = await runGit(['pull'], root);
      try { await runPython(getScriptPath('sync_mods.py'), ['--root', root]); } catch {}
      store.set('lastPullTime', new Date().toISOString());
      return { success: true, output: stdout };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('git:push', async (_e, { message }: { message: string }) => {
    const root = store.get('modpackRoot') || DEV_APP_ROOT;
    try {
      await runGit(['add', 'config.yaml', 'manifests/', '.last_export_state.json'], root);
      await runGit(['commit', '-m', message], root);
      const { stdout } = await runGit(['push'], root);
      return { success: true, output: stdout };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('git:status', async () => {
    const root = store.get('modpackRoot') || DEV_APP_ROOT;
    try {
      const [branchRes, statusRes, abRes] = await Promise.all([
        runGit(['rev-parse', '--abbrev-ref', 'HEAD'], root),
        runGit(['status', '--porcelain'], root),
        runGit(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], root).catch(() => ({ stdout: '0\t0', stderr: '' })),
      ]);
      const [ahead, behind] = abRes.stdout.trim().split('\t').map(Number);
      const modified = statusRes.stdout.trim().split('\n').filter(Boolean);
      return {
        success: true,
        data: { branch: branchRes.stdout.trim(), ahead: ahead || 0, behind: behind || 0, modified, lastPull: store.get('lastPullTime') || null },
      };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('git:staged-files', async () => {
    const root = store.get('modpackRoot') || DEV_APP_ROOT;
    const targets = ['config.yaml', 'manifests', '.last_export_state.json'];
    const result: string[] = [];
    for (const t of targets) {
      const p = path.join(root, t);
      if (!fs.existsSync(p)) continue;
      if (fs.statSync(p).isDirectory()) {
        for (const f of fs.readdirSync(p)) result.push(`manifests/${f}`);
      } else {
        result.push(t);
      }
    }
    return { success: true, data: result };
  });

  // Export
  ipcMain.handle('export:run', async (_e, opts: {
    version: string; isLite: boolean; isRelease: boolean; packName: string; exportDir?: string;
  }) => {
    const root = store.get('modpackRoot') || DEV_APP_ROOT;
    const configPath = getConfigPath();
    const exportDir = opts.exportDir || store.get('exportDir') || path.join(root, 'Modpack Export');
    try {
      const out = await runPython(getScriptPath('export_runner.py'), [
        root, configPath, opts.packName, opts.version,
        String(opts.isLite), String(opts.isRelease), exportDir,
      ]);
      const result = JSON.parse(out.trim().split('\n').pop() || '{}');
      if (result.success) {
        store.set('lastExportTime', new Date().toISOString());
        fs.writeFileSync(
          path.join(root, '.last_export_state.json'),
          JSON.stringify({ version: opts.version, timestamp: new Date().toISOString() }, null, 2)
        );
      }
      return result;
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  // Sync mods
  ipcMain.handle('python:sync-mods', async () => {
    const root = store.get('modpackRoot') || DEV_APP_ROOT;
    try {
      const out = await runPython(getScriptPath('sync_mods.py'), ['--root', root]);
      const lines = out.trim().split('\n');
      const resultLine = lines.find(l => { try { return JSON.parse(l).type === 'result'; } catch { return false; } });
      return { success: true, data: resultLine ? JSON.parse(resultLine) : {} };
    } catch (e: any) { return { success: false, error: e.message }; }
  });
}

// Prevent the linter from flagging the imported-but-only-typed identifiers.
void getToken;
