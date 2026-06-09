import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import path from 'path';
import { spawn } from 'child_process';
import fs from 'fs';
import crypto from 'crypto';
import AdmZip from 'adm-zip';
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

// ─── Versions repo helpers ────────────────────────────────────────────────────

const VERSIONS_REPO_URL = 'https://github.com/OR-Beyond/OR-Beyond-Versions.git';
const OVERRIDE_FOLDERS = ['config', 'resourcepacks', 'shaderpacks', 'scripts'] as const;

function getVersionsRepoDir(): string {
  return path.join(app.getPath('userData'), 'versions-repo');
}

// ── Hashing ──────────────────────────────────────────────────────────────────

function computeSha512(filePath: string): string {
  return crypto.createHash('sha512').update(fs.readFileSync(filePath)).digest('hex');
}

function computeSha256(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

// ── File system ───────────────────────────────────────────────────────────────

/** Returns all file paths (not directories) under dir, recursively. */
function walkDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkDir(full));
    else results.push(full);
  }
  return results;
}

// ── Modrinth hash cache (stored in versions repo, gitignored) ─────────────────

interface ModrinthLookupResult {
  found: boolean;
  slug?: string;
  title?: string;
  iconUrl?: string;
  downloadUrl?: string;
  fileSize?: number;
  filename: string;
}

function loadModrinthCache(versionsDir: string): Record<string, ModrinthLookupResult> {
  try {
    return JSON.parse(fs.readFileSync(path.join(versionsDir, '.modrinth_cache.json'), 'utf-8'));
  } catch {
    return {};
  }
}

function saveModrinthCache(versionsDir: string, cache: Record<string, ModrinthLookupResult>): void {
  try {
    fs.writeFileSync(
      path.join(versionsDir, '.modrinth_cache.json'),
      JSON.stringify(cache, null, 2),
      'utf-8',
    );
  } catch (e) {
    console.error('[modrinth-cache] save failed:', e);
  }
}

async function lookupModrinthHash(
  sha512: string,
  filename: string,
  cache: Record<string, ModrinthLookupResult>,
): Promise<ModrinthLookupResult> {
  if (sha512 in cache) return cache[sha512];

  const headers = { 'User-Agent': 'ORB-Modpack-Exporter/1.0' };
  try {
    const versionRes = await fetch(
      `https://api.modrinth.com/v2/version_file/${sha512}?algorithm=sha512`,
      { headers },
    );
    if (!versionRes.ok) {
      cache[sha512] = { found: false, filename };
      return cache[sha512];
    }
    const versionData: any = await versionRes.json();
    const projectId: string = versionData.project_id;
    const fileEntry =
      (versionData.files ?? []).find((f: any) => f.hashes?.sha512 === sha512) ??
      versionData.files?.[0];

    const projectRes = await fetch(`https://api.modrinth.com/v2/project/${projectId}`, { headers });
    let slug = projectId;
    let title = projectId;
    let iconUrl: string | undefined;
    if (projectRes.ok) {
      const proj: any = await projectRes.json();
      slug = proj.slug ?? projectId;
      title = proj.title ?? projectId;
      iconUrl = proj.icon_url ?? undefined;
    }

    cache[sha512] = {
      found: true,
      slug,
      title,
      iconUrl,
      downloadUrl: fileEntry?.url,
      fileSize: fileEntry?.size,
      filename,
    };
    return cache[sha512];
  } catch {
    cache[sha512] = { found: false, filename };
    return cache[sha512];
  }
}

// ── Pull state (SHA256 snapshot of overrides at last successful pull) ─────────

interface PullState {
  files: Record<string, string>; // overrideRelPath (forward slashes) → sha256 hex
}

function loadPullState(versionsDir: string): PullState {
  try {
    return JSON.parse(fs.readFileSync(path.join(versionsDir, '.last_pull_state.json'), 'utf-8'));
  } catch {
    return { files: {} };
  }
}

function savePullState(versionsDir: string, state: PullState): void {
  try {
    fs.writeFileSync(
      path.join(versionsDir, '.last_pull_state.json'),
      JSON.stringify(state, null, 2),
      'utf-8',
    );
  } catch (e) {
    console.error('[pull-state] save failed:', e);
  }
}

// ── Versions repo lifecycle ───────────────────────────────────────────────────

function ensureGitignore(versionsDir: string): void {
  const gitignorePath = path.join(versionsDir, '.gitignore');
  const required = ['.modrinth_cache.json', '.last_pull_state.json'];
  let content = '';
  try { content = fs.readFileSync(gitignorePath, 'utf-8'); } catch {}
  let changed = false;
  for (const entry of required) {
    if (!content.includes(entry)) {
      content += (content.length > 0 && !content.endsWith('\n') ? '\n' : '') + entry + '\n';
      changed = true;
    }
  }
  if (changed) fs.writeFileSync(gitignorePath, content, 'utf-8');
}

async function ensureVersionsRepo(versionsDir: string, token: string | null): Promise<void> {
  fs.mkdirSync(versionsDir, { recursive: true });

  const repoUrlWithAuth = token
    ? `https://x-access-token:${token}@github.com/OR-Beyond/OR-Beyond-Versions.git`
    : VERSIONS_REPO_URL;

  const gitDir = path.join(versionsDir, '.git');
  if (!fs.existsSync(gitDir)) {
    try {
      await runGit(['clone', repoUrlWithAuth, '.'], versionsDir);
    } catch {
      // Clone failed (empty remote, non-empty dest dir, etc.) — init locally.
      try { await runGit(['init'], versionsDir); } catch {}
      try { await runGit(['remote', 'add', 'origin', repoUrlWithAuth], versionsDir); } catch {}
      // If remote has any commits (e.g. just a README), pull them in.
      try {
        await runGit(['fetch', 'origin', 'main'], versionsDir);
        await runGit(['reset', '--hard', 'origin/main'], versionsDir);
      } catch {
        // Truly empty remote — just ensure we're on the main branch.
        try { await runGit(['checkout', '-b', 'main'], versionsDir); } catch {}
      }
    }
  } else {
    // Refresh auth token in remote URL, then pull.
    try { await runGit(['remote', 'set-url', 'origin', repoUrlWithAuth], versionsDir); } catch {}
    try {
      await runGit(['fetch', 'origin', 'main'], versionsDir);
      await runGit(['reset', '--hard', 'origin/main'], versionsDir);
    } catch (pullErr: any) {
      // No upstream yet (first push scenario) — not an error.
      if (
        !pullErr.message.includes("couldn't find remote ref") &&
        !pullErr.message.includes('no tracking information') &&
        !pullErr.message.includes('does not appear to be a git repository')
      ) {
        throw pullErr;
      }
    }
  }
}

async function ensureGitIdentity(versionsDir: string, githubUser: string): Promise<void> {
  try {
    const { stdout } = await runGit(['config', 'user.email'], versionsDir);
    if (stdout.trim()) return;
  } catch {}
  await runGit(['config', 'user.name', githubUser], versionsDir);
  await runGit(['config', 'user.email', `${githubUser}@users.noreply.github.com`], versionsDir);
}

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
  ipcMain.handle('app:show-in-folder', (_e, filePath: string) => {
    shell.showItemInFolder(filePath);
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
  ipcMain.handle('settings:test-webhook', async (_e, { url }: { url: string }) => {
    if (!url) return { success: false, error: 'No webhook URL provided' };
    const embed = {
      title: 'ORB Modpack Exporter',
      description: 'Discord webhook is working! Push notifications will appear here.',
      color: 0x238636,
      footer: { text: 'ORB Modpack Exporter' },
      timestamp: new Date().toISOString(),
    };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'ORB-Modpack-Exporter/1.0' },
        body: JSON.stringify({ embeds: [embed] }),
      });
      if (!res.ok) return { success: false, error: `Discord returned HTTP ${res.status}` };
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

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
      const allFiles = files.map(f => ({
        path: f.filename,
        status: f.status ?? 'modified',
        additions: f.additions ?? 0,
        deletions: f.deletions ?? 0,
      }));
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
    const root = store.get('modpackRoot');
    if (!root) return { success: false, error: 'No modpack root configured' };

    const versionsDir = getVersionsRepoDir();
    const modsDir = path.join(root, 'mods');
    const token = getToken();

    const sendProgress = (stage: string, msg: string, percent: number) => {
      mainWindow?.webContents.send('sync:progress', { stage, message: msg, percent });
    };

    try {
      // ── Snapshot state BEFORE pulling so we can compute what changed ─────────
      const manifestPath = path.join(versionsDir, 'modrinth.index.json');
      let oldManifestFiles: any[] = [];
      if (fs.existsSync(manifestPath)) {
        try { oldManifestFiles = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')).files || []; } catch {}
      }
      const oldLocalJars = new Set<string>(
        fs.existsSync(modsDir) ? fs.readdirSync(modsDir).filter((f: string) => f.endsWith('.jar')) : []
      );

      // 1. Clone or update the versions repo
      sendProgress('git', 'Syncing versions repository…', 5);
      await ensureVersionsRepo(versionsDir, token);

      // Load cache after ensuring repo is up-to-date
      const cache = loadModrinthCache(versionsDir);

      // CDN URL → { projectId, versionId, versionNumber }
      const parseCdnUrl = (url: string): { projectId: string; versionId: string; versionNumber: string } | null => {
        try {
          const parts = url.split('/');
          // https://cdn.modrinth.com/data/{projectId}/versions/{versionId}/{filename}
          if (parts.length < 8 || parts[3] !== 'data' || parts[5] !== 'versions') return null;
          const projectId = parts[4];
          const versionId = parts[6];
          const filename  = parts[7] ?? '';
          const m = filename.match(/(\d+\.\d+[\d.]*)/);
          return { projectId, versionId, versionNumber: m ? m[1] : versionId };
        } catch { return null; }
      };

      // Project-id key for a manifest entry (primary: CDN projectId, fallback: slug)
      const modKey = (entry: any): string => {
        const url: string = (entry.downloads as string[] | undefined)?.[0] ?? '';
        const parsed = parseCdnUrl(url);
        return parsed ? parsed.projectId : path.basename(entry.path as string, '.jar');
      };

      // Resolve icon and name from cache, with fallback sha
      const getIconUrl = (sha: string, fallbackSha?: string): string | null => {
        if (sha && cache[sha]?.iconUrl) return cache[sha].iconUrl!;
        if (fallbackSha && cache[fallbackSha]?.iconUrl) return cache[fallbackSha].iconUrl!;
        return null;
      };
      const getName = (sha: string, slug: string): string =>
        (sha && cache[sha]?.title) ? cache[sha].title! : slug;

      // 2. Read and validate the manifest — abort before touching any local files
      sendProgress('manifest', 'Reading manifest…', 15);
      if (!fs.existsSync(manifestPath)) {
        return { success: false, error: 'modrinth.index.json not found in versions repo. Has a push been made yet?' };
      }

      let manifest: any;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      } catch {
        return { success: false, error: 'Manifest is corrupted (invalid JSON). Aborting to protect local files.' };
      }
      if (!Array.isArray(manifest?.files)) {
        return { success: false, error: 'Manifest is missing "files" array. Aborting to protect local files.' };
      }

      // 3. Load last pull state for local-change detection on override files
      const pullState = loadPullState(versionsDir);
      const newPullStateFiles: Record<string, string> = {};

      // 4. Build manifest lookup and inventory local mods
      fs.mkdirSync(modsDir, { recursive: true });
      const localJars = new Set(fs.readdirSync(modsDir).filter(f => f.endsWith('.jar')));

      const manifestByBasename = new Map<string, any>();
      for (const entry of manifest.files) {
        manifestByBasename.set(path.basename(entry.path as string), entry);
      }

      let modsDownloaded = 0;
      let modsRemoved = 0;
      const modsSkipped: string[] = [];
      let filesUpdated = 0;
      const filesSkipped: string[] = [];
      const errors: string[] = [];
      const changedFiles: { path: string; status: 'added' | 'modified' | 'removed' }[] = [];

      // 5. Sync mods from manifest
      const totalMods = manifestByBasename.size;
      let modsDone = 0;

      for (const [basename, entry] of manifestByBasename.entries()) {
        modsDone++;
        const percent = 15 + Math.floor((modsDone / totalMods) * 40);

        if (entry.source === 'local') {
          const overrideJar = path.join(versionsDir, 'overrides', 'mods', basename);
          const localPath = path.join(modsDir, basename);
          const expectedSha512: string | undefined = entry.hashes?.sha512;

          sendProgress('mods', `Checking local mod: ${basename}`, percent);

          let needsCopy = !localJars.has(basename);
          if (!needsCopy && expectedSha512) {
            try { needsCopy = computeSha512(localPath) !== expectedSha512; } catch { needsCopy = true; }
          }

          if (needsCopy) {
            if (fs.existsSync(overrideJar)) {
              fs.copyFileSync(overrideJar, localPath);
              modsDownloaded++;
            } else {
              modsSkipped.push(basename);
              errors.push(`Local mod missing from overrides: ${basename}`);
            }
          }
          continue;
        }

        // Modrinth mod — download if missing or hash differs
        const localPath = path.join(modsDir, basename);
        const expectedSha512: string | undefined = entry.hashes?.sha512;

        let needsDownload = !localJars.has(basename);
        if (!needsDownload && expectedSha512) {
          try { needsDownload = computeSha512(localPath) !== expectedSha512; } catch { needsDownload = true; }
        }

        if (!needsDownload) {
          sendProgress('mods', `Up to date: ${basename}`, percent);
          continue;
        }

        const downloadUrl: string | undefined =
          Array.isArray(entry.downloads) ? entry.downloads[0] : undefined;
        if (!downloadUrl) {
          modsSkipped.push(basename);
          sendProgress('mods', `No download URL for: ${basename}`, percent);
          continue;
        }

        sendProgress('mods', `Downloading: ${basename}…`, percent);
        try {
          const resp = await fetch(downloadUrl, { headers: { 'User-Agent': 'ORB-Modpack-Exporter/1.0' } });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          fs.writeFileSync(localPath, Buffer.from(await resp.arrayBuffer()));
          modsDownloaded++;
        } catch (dlErr: any) {
          modsSkipped.push(basename);
          errors.push(`Download failed for ${basename}: ${dlErr.message}`);
          console.error(`[pull] download failed for ${basename}:`, dlErr.message);
        }
      }

      // 6. Remove local jars not in the manifest
      sendProgress('mods', 'Removing stale mods…', 57);
      for (const localJar of localJars) {
        if (!manifestByBasename.has(localJar)) {
          try { fs.unlinkSync(path.join(modsDir, localJar)); modsRemoved++; } catch {}
        }
      }

      // 7. Sync override files (config/, resourcepacks/, shaderpacks/, scripts/)
      //    Protected by pull state: skip files the user has locally modified.
      //    First-time path (no .last_pull_state.json): copy everything blindly and
      //    build the baseline — no change detection, no changedFiles reported.
      sendProgress('overrides', 'Syncing override files…', 62);
      const overridesDir = path.join(versionsDir, 'overrides');
      const pullStatePath = path.join(versionsDir, '.last_pull_state.json');
      const hasExistingState = fs.existsSync(pullStatePath);

      if (!hasExistingState) {
        // No baseline yet — copy every override file and establish the state.
        // Treat this as a fresh install: don't report any files as "changed".
        for (const folder of OVERRIDE_FOLDERS) {
          const srcDir = path.join(overridesDir, folder);
          if (!fs.existsSync(srcDir)) continue;

          for (const srcFilePath of walkDir(srcDir)) {
            const relToOverrides = path.relative(overridesDir, srcFilePath);
            const stateKey = relToOverrides.replace(/\\/g, '/');
            const localFilePath = path.join(root, relToOverrides);

            let remoteHash: string;
            try { remoteHash = computeSha256(srcFilePath); } catch { continue; }
            newPullStateFiles[stateKey] = remoteHash;

            fs.mkdirSync(path.dirname(localFilePath), { recursive: true });
            fs.copyFileSync(srcFilePath, localFilePath);
            filesUpdated++;
          }
        }
        // changedFiles stays empty — no point surfacing 1000+ "new" files on first pull.
      } else {
        // Baseline exists — compare and protect user-modified files.
        for (const folder of OVERRIDE_FOLDERS) {
          const srcDir = path.join(overridesDir, folder);
          if (!fs.existsSync(srcDir)) continue;

          for (const srcFilePath of walkDir(srcDir)) {
            const relToOverrides = path.relative(overridesDir, srcFilePath);
            const stateKey = relToOverrides.replace(/\\/g, '/');
            const localFilePath = path.join(root, relToOverrides);

            let remoteHash: string;
            try { remoteHash = computeSha256(srcFilePath); } catch { continue; }
            newPullStateFiles[stateKey] = remoteHash;

            if (!fs.existsSync(localFilePath)) {
              fs.mkdirSync(path.dirname(localFilePath), { recursive: true });
              fs.copyFileSync(srcFilePath, localFilePath);
              filesUpdated++;
              changedFiles.push({ path: stateKey, status: 'added' });
            } else {
              const lastHash = pullState.files[stateKey];
              let localHash: string;
              try { localHash = computeSha256(localFilePath); } catch {
                filesSkipped.push(stateKey);
                continue;
              }

              if (lastHash === undefined) {
                filesSkipped.push(stateKey);
                console.warn(`[pull] locally-added file skipped: ${stateKey}`);
              } else if (localHash === lastHash) {
                fs.copyFileSync(srcFilePath, localFilePath);
                filesUpdated++;
                changedFiles.push({ path: stateKey, status: 'modified' });
              } else {
                filesSkipped.push(stateKey);
                console.warn(`[pull] locally-modified file skipped: ${stateKey}`);
              }
            }
          }
        }
      }

      // 8. Persist updated pull state
      savePullState(versionsDir, { files: newPullStateFiles });
      store.set('lastPullTime', new Date().toISOString());
      sendProgress('done', 'Sync complete!', 100);

      // ── Build enriched mod change lists (zero extra API calls) ───────────────

      const newModMap = new Map<string, any>();
      const oldModMap = new Map<string, any>();
      for (const f of (manifest.files as any[])) {
        if ((f.path as string).startsWith('mods/')) newModMap.set(modKey(f), f);
      }
      for (const f of oldManifestFiles) {
        if ((f.path as string).startsWith('mods/')) oldModMap.set(modKey(f), f);
      }

      const addedMods: { slug: string; name: string; projectId: string | null; iconUrl: string | null; versionNumber: string | null; source: 'modrinth' | 'local' }[] = [];
      const updatedMods: { slug: string; name: string; projectId: string | null; iconUrl: string | null; oldVersionNumber: string | null; newVersionNumber: string | null }[] = [];
      const removedMods: { slug: string; name: string; projectId: string | null; iconUrl: string | null; versionNumber: string | null; source: 'modrinth' | 'local' }[] = [];

      for (const [key, newEntry] of newModMap) {
        const slug = path.basename(newEntry.path as string, '.jar');
        const newUrl: string = (newEntry.downloads as string[] | undefined)?.[0] ?? '';
        const newParsed = parseCdnUrl(newUrl);
        const newSha: string = newEntry.hashes?.sha512 ?? '';
        const oldEntry = oldModMap.get(key);

        if (!oldEntry) {
          addedMods.push({
            slug,
            name: getName(newSha, slug),
            projectId: newParsed?.projectId ?? null,
            iconUrl: getIconUrl(newSha),
            versionNumber: newParsed?.versionNumber ?? null,
            source: newParsed ? 'modrinth' : 'local',
          });
        } else {
          const oldUrl: string = (oldEntry.downloads as string[] | undefined)?.[0] ?? '';
          const oldParsed = parseCdnUrl(oldUrl);
          const oldSha: string = oldEntry.hashes?.sha512 ?? '';
          const versionChanged = newParsed?.versionId && oldParsed?.versionId && newParsed.versionId !== oldParsed.versionId;
          const localChanged   = !newParsed && !oldParsed && newSha && oldSha && newSha !== oldSha;
          if (versionChanged || localChanged) {
            updatedMods.push({
              slug,
              name: getName(newSha, slug) || getName(oldSha, slug),
              projectId: newParsed?.projectId ?? null,
              iconUrl: getIconUrl(newSha, oldSha),
              oldVersionNumber: oldParsed?.versionNumber ?? null,
              newVersionNumber: newParsed?.versionNumber ?? null,
            });
          }
        }
      }

      for (const [key, oldEntry] of oldModMap) {
        if (!newModMap.has(key)) {
          const slug = path.basename(oldEntry.path as string, '.jar');
          const oldUrl: string = (oldEntry.downloads as string[] | undefined)?.[0] ?? '';
          const oldParsed = parseCdnUrl(oldUrl);
          const oldSha: string = oldEntry.hashes?.sha512 ?? '';
          removedMods.push({
            slug,
            name: getName(oldSha, slug),
            projectId: oldParsed?.projectId ?? null,
            iconUrl: getIconUrl(oldSha),
            versionNumber: oldParsed?.versionNumber ?? null,
            source: oldParsed ? 'modrinth' : 'local',
          });
        }
      }

      return {
        success: true,
        pulled: true,
        modsDownloaded,
        modsRemoved,
        modsSkipped,
        filesUpdated,
        filesSkipped,
        errors,
        addedMods,
        updatedMods,
        removedMods,
        changedFiles,
      };
    } catch (e: any) {
      return { success: false, error: e?.message ?? String(e) };
    }
  });

  ipcMain.handle('git:push', async (_e, { message }: { message: string }) => {
    const root = store.get('modpackRoot');
    if (!root) return { success: false, error: 'No modpack root configured' };

    const modsDir = path.join(root, 'mods');
    if (!fs.existsSync(modsDir)) {
      return { success: false, error: `mods/ folder not found at: ${modsDir}` };
    }

    const versionsDir = getVersionsRepoDir();
    const token = getToken();

    const sendProgress = (stage: string, msg: string, percent: number) => {
      mainWindow?.webContents.send('sync:progress', { stage, message: msg, percent });
    };

    try {
      // 1. Init or sync the versions repo
      sendProgress('git', 'Syncing versions repository…', 2);
      await ensureVersionsRepo(versionsDir, token);

      // 2. Resolve GitHub user for git identity
      let githubUser = 'orbmodpack';
      try {
        const oc = getOctokit();
        if (oc) { const { data } = await oc.users.getAuthenticated(); githubUser = data.login; }
      } catch {}
      await ensureGitIdentity(versionsDir, githubUser);

      // 3. Scan mods/ for .jar files
      sendProgress('scan', 'Scanning mods…', 8);
      const jarFiles = fs.readdirSync(modsDir).filter(f => f.endsWith('.jar'));
      const localJarSet = new Set(jarFiles);

      // 4. Load Modrinth hash cache (in versions repo, gitignored)
      const cache = loadModrinthCache(versionsDir);

      // 5. Load existing manifest for version tracking
      const manifestPath = path.join(versionsDir, 'modrinth.index.json');
      let prevVersion = 0;
      let prevFiles: any[] = [];
      if (fs.existsSync(manifestPath)) {
        try {
          const prev = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          prevVersion = parseInt(prev.versionId, 10) || 0;
          prevFiles = prev.files || [];
        } catch {}
      }
      const newVersion = prevVersion + 1;
      const packName = path.basename(root);

      // 6. Process each jar: Modrinth lookup or local bundle into overrides/mods/
      const overrideModsDir = path.join(versionsDir, 'overrides', 'mods');
      fs.mkdirSync(overrideModsDir, { recursive: true });

      // Remove overrides/mods/ jars that no longer exist in the modpack
      for (const overrideMod of walkDir(overrideModsDir).map(p => path.basename(p))) {
        if (!localJarSet.has(overrideMod)) {
          try { fs.unlinkSync(path.join(overrideModsDir, overrideMod)); } catch {}
        }
      }

      const newFiles: any[] = [];
      const modsUnresolved: string[] = [];

      for (let i = 0; i < jarFiles.length; i++) {
        const jar = jarFiles[i];
        const percent = 10 + Math.floor(((i + 1) / jarFiles.length) * 45);
        sendProgress('modrinth', `Checking ${jar}…`, percent);

        const jarPath = path.join(modsDir, jar);
        let sha512: string;
        try {
          sha512 = computeSha512(jarPath);
        } catch (hashErr: any) {
          console.error(`[push] hash failed for ${jar}:`, hashErr.message);
          modsUnresolved.push(jar);
          continue;
        }

        const fileSize = fs.statSync(jarPath).size;
        const info = await lookupModrinthHash(sha512, jar, cache);

        if (info.found && info.downloadUrl) {
          // Modrinth mod — reference by download URL only
          newFiles.push({
            path: `mods/${info.slug}.jar`,
            hashes: { sha512 },
            downloads: [info.downloadUrl],
            fileSize: info.fileSize ?? fileSize,
          });
        } else {
          // Non-Modrinth — bundle the actual .jar into overrides/mods/
          const destJar = path.join(overrideModsDir, jar);
          fs.copyFileSync(jarPath, destJar);
          newFiles.push({
            path: `mods/${jar}`,
            hashes: { sha512 },
            downloads: [],
            fileSize,
            source: 'local',
          });
          modsUnresolved.push(jar);
        }
      }

      saveModrinthCache(versionsDir, cache);

      // 7. Compute diff stats vs previous manifest
      const prevPaths = new Set(prevFiles.map((f: any) => f.path));
      const newPaths = new Set(newFiles.map((f: any) => f.path));
      const modsAdded = newFiles.filter(f => !prevPaths.has(f.path)).length;
      const modsRemoved = prevFiles.filter((f: any) => !newPaths.has(f.path)).length;

      // 8. Write modrinth.index.json
      const manifest = {
        formatVersion: 1,
        game: 'minecraft',
        versionId: String(newVersion),
        name: packName,
        files: newFiles,
      };
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

      // 9. Sync override folders (config/, resourcepacks/, shaderpacks/, scripts/)
      sendProgress('overrides', 'Syncing override files…', 58);
      const overridesDir = path.join(versionsDir, 'overrides');
      let filesChanged = 0;

      for (const folder of OVERRIDE_FOLDERS) {
        const srcDir = path.join(root, folder);
        const destDir = path.join(overridesDir, folder);

        // Remove files from overrides/ that were deleted from the modpack
        if (fs.existsSync(destDir)) {
          for (const destFile of walkDir(destDir)) {
            const relPath = path.relative(destDir, destFile);
            if (!fs.existsSync(path.join(srcDir, relPath))) {
              fs.unlinkSync(destFile);
              filesChanged++;
            }
          }
        }

        // Copy all current files into overrides/
        if (fs.existsSync(srcDir)) {
          for (const srcFile of walkDir(srcDir)) {
            const relPath = path.relative(srcDir, srcFile);
            const destFile = path.join(destDir, relPath);
            fs.mkdirSync(path.dirname(destFile), { recursive: true });
            fs.copyFileSync(srcFile, destFile);
            filesChanged++;
          }
        }
      }

      // 10. Ensure .gitignore excludes local cache files, then stage everything
      ensureGitignore(versionsDir);

      sendProgress('git', 'Committing changes…', 80);
      await runGit(['add', '-A'], versionsDir);

      let hasChanges = false;
      try {
        const { stdout } = await runGit(['diff', '--cached', '--name-only'], versionsDir);
        hasChanges = stdout.trim().length > 0;
      } catch {}

      if (hasChanges) {
        await runGit(['commit', '-m', message || `Modpack push v${newVersion}`], versionsDir);
      }

      // 11. Push (handle first-push to empty remote)
      sendProgress('git', 'Pushing to GitHub…', 92);
      try {
        await runGit(['push', 'origin', 'main'], versionsDir);
      } catch (pushErr: any) {
        if (pushErr.message.includes('no upstream') || pushErr.message.includes('has no upstream')) {
          await runGit(['push', '-u', 'origin', 'main'], versionsDir);
        } else {
          throw pushErr;
        }
      }

      sendProgress('done', 'Push complete!', 100);

      // Fire-and-forget Discord notification
      void (async () => {
        const webhookUrl = store.get('discordWebhook');
        if (!webhookUrl) return;

        const fields: { name: string; value: string; inline: boolean }[] = [];

        const addedModNames = newFiles.filter(f => !prevPaths.has(f.path)).map(f => path.basename(f.path, '.jar'));
        const removedModNames = prevFiles.filter((f: any) => !newPaths.has(f.path)).map((f: any) => path.basename(f.path, '.jar'));

        if (addedModNames.length > 0) {
          const list = addedModNames.slice(0, 10).map((n: string) => `\`${n}\``).join(', ');
          fields.push({ name: '+ Mods Added', value: list + (addedModNames.length > 10 ? ` +${addedModNames.length - 10} more` : ''), inline: false });
        }
        if (removedModNames.length > 0) {
          const list = removedModNames.slice(0, 10).map((n: string) => `\`${n}\``).join(', ');
          fields.push({ name: '− Mods Removed', value: list + (removedModNames.length > 10 ? ` +${removedModNames.length - 10} more` : ''), inline: false });
        }

        try {
          const { stdout } = await runGit(['diff', '--name-only', 'HEAD~1', 'HEAD', '--', 'overrides/'], versionsDir).catch(() => ({ stdout: '' }));
          const fileList = stdout.trim().split('\n').filter(Boolean);
          if (fileList.length > 0) {
            const list = fileList.slice(0, 10).map((f: string) => `\`${f}\``).join('\n');
            fields.push({ name: 'Files Changed', value: list + (fileList.length > 10 ? `\n+${fileList.length - 10} more` : ''), inline: false });
          }
        } catch {}

        const embed = {
          title: `${packName} — v${newVersion}`,
          description: message || `Modpack push v${newVersion}`,
          color: 0x238636,
          fields,
          footer: { text: `Pushed by ${githubUser}` },
          timestamp: new Date().toISOString(),
        };

        try {
          await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'ORB-Modpack-Exporter/1.0' },
            body: JSON.stringify({ embeds: [embed] }),
          });
        } catch (e: any) {
          console.error('[discord] webhook send failed:', e.message);
        }
      })();

      return { success: true, version: newVersion, modsAdded, modsRemoved, modsUnresolved, filesChanged };
    } catch (e: any) {
      return { success: false, error: e?.message ?? String(e) };
    }
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

  // ── Export .mrpack (pure Node) ────────────────────────────────────────────

  ipcMain.handle('export:latest-modrinth-version', async (_e, { projectId }: { projectId: string }) => {
    if (!projectId) return { version_number: null, reason: 'No project ID provided' };
    try {
      const res = await fetch(
        `https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version`,
        { headers: { 'User-Agent': 'ORB-Modpack-Exporter/1.0' } }
      );
      if (!res.ok) return { version_number: null, reason: `Modrinth API returned ${res.status}` };
      const versions = await res.json() as any[];
      const listed = versions
        .filter((v: any) => v.status === 'listed')
        .sort((a: any, b: any) => new Date(b.date_published).getTime() - new Date(a.date_published).getTime());
      if (listed.length === 0) return { version_number: null, reason: 'No published releases found' };
      const latest = listed[0];
      return { version_number: latest.version_number as string, versionId: latest.id as string, publishedAt: latest.date_published as string };
    } catch (e: any) {
      return { version_number: null, reason: 'Could not fetch from Modrinth' };
    }
  });

  ipcMain.handle('export:manifest-version', () => {
    const versionsDir = getVersionsRepoDir();
    const manifestPath = path.join(versionsDir, 'modrinth.index.json');
    if (!fs.existsSync(manifestPath)) return { success: true, versionId: null };
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const versionId = parseInt(manifest.versionId, 10);
      return { success: true, versionId: isNaN(versionId) ? null : versionId };
    } catch (e: any) {
      return { success: false, versionId: null, error: e.message };
    }
  });

  ipcMain.handle('export:save-dialog', async (_e, { defaultPath }: { defaultPath: string }) => {
    const r = await dialog.showSaveDialog(mainWindow!, {
      title: 'Save Modpack As',
      defaultPath,
      filters: [{ name: 'Modrinth Modpack', extensions: ['mrpack'] }],
    });
    return r.canceled ? null : r.filePath ?? null;
  });

  ipcMain.handle('export:generate-changelog', async (_e, { version }: { version: string }) => {
    const versionsDir = getVersionsRepoDir();
    const root = store.get('modpackRoot');
    const token = getToken();
    const sendP = (stage: string, message: string, percent: number) =>
      mainWindow?.webContents.send('export:progress', { stage, message, percent });
    const today = new Date().toISOString().split('T')[0];

    // ── Step 1: Auto-push local mod changes before generating changelog ───────
    //
    // Runs the same scan/hash/resolve/commit/push pipeline as git:push so that
    // the versions repo is always up-to-date with whatever the maintainer has
    // in their local modpack folder.  If nothing changed, the "git diff --cached"
    // check short-circuits and we skip the push entirely.

    if (root && fs.existsSync(path.join(root, 'mods'))) {
      const modsDir = path.join(root, 'mods');
      sendP('autopush', 'Checking for local changes…', 2);
      try {
        await ensureVersionsRepo(versionsDir, token);

        let githubUser = 'orbmodpack';
        try {
          const oc = getOctokit();
          if (oc) { const { data } = await oc.users.getAuthenticated(); githubUser = data.login; }
        } catch {}
        await ensureGitIdentity(versionsDir, githubUser);

        const jarFiles = fs.readdirSync(modsDir).filter((f: string) => f.endsWith('.jar'));
        const localJarSet = new Set(jarFiles);
        const autoCache = loadModrinthCache(versionsDir);

        const manifestPath_auto = path.join(versionsDir, 'modrinth.index.json');
        let prevVersion = 0;
        if (fs.existsSync(manifestPath_auto)) {
          try { prevVersion = parseInt(JSON.parse(fs.readFileSync(manifestPath_auto, 'utf-8')).versionId, 10) || 0; } catch {}
        }
        const packName = path.basename(root);

        const overrideModsDir = path.join(versionsDir, 'overrides', 'mods');
        fs.mkdirSync(overrideModsDir, { recursive: true });
        for (const overrideMod of walkDir(overrideModsDir).map((p: string) => path.basename(p))) {
          if (!localJarSet.has(overrideMod)) {
            try { fs.unlinkSync(path.join(overrideModsDir, overrideMod)); } catch {}
          }
        }

        const newFiles: any[] = [];
        for (let i = 0; i < jarFiles.length; i++) {
          const jar = jarFiles[i];
          sendP('autopush', `Checking ${jar}…`, 3 + Math.floor(((i + 1) / jarFiles.length) * 9));
          const jarPath = path.join(modsDir, jar);
          let sha512: string;
          try { sha512 = computeSha512(jarPath); } catch { continue; }
          const fileSize = fs.statSync(jarPath).size;
          const info = await lookupModrinthHash(sha512, jar, autoCache);
          if (info.found && info.downloadUrl) {
            newFiles.push({ path: `mods/${info.slug}.jar`, hashes: { sha512 }, downloads: [info.downloadUrl], fileSize: info.fileSize ?? fileSize });
          } else {
            fs.copyFileSync(jarPath, path.join(overrideModsDir, jar));
            newFiles.push({ path: `mods/${jar}`, hashes: { sha512 }, downloads: [], fileSize, source: 'local' });
          }
        }
        saveModrinthCache(versionsDir, autoCache);

        fs.writeFileSync(
          manifestPath_auto,
          JSON.stringify({ formatVersion: 1, game: 'minecraft', versionId: String(prevVersion + 1), name: packName, files: newFiles }, null, 2),
          'utf-8'
        );

        sendP('autopush', 'Syncing override files…', 13);
        const overridesDir_auto = path.join(versionsDir, 'overrides');
        for (const folder of OVERRIDE_FOLDERS) {
          const srcDir = path.join(root, folder);
          const destDir = path.join(overridesDir_auto, folder);
          if (fs.existsSync(destDir)) {
            for (const destFile of walkDir(destDir)) {
              const rel = path.relative(destDir, destFile);
              if (!fs.existsSync(path.join(srcDir, rel))) fs.unlinkSync(destFile);
            }
          }
          if (fs.existsSync(srcDir)) {
            for (const srcFile of walkDir(srcDir)) {
              const rel = path.relative(srcDir, srcFile);
              const dest = path.join(destDir, rel);
              fs.mkdirSync(path.dirname(dest), { recursive: true });
              fs.copyFileSync(srcFile, dest);
            }
          }
        }
        ensureGitignore(versionsDir);
        await runGit(['add', '-A'], versionsDir);

        const { stdout: cachedOut } = await runGit(['diff', '--cached', '--name-only'], versionsDir).catch(() => ({ stdout: '' }));
        if (cachedOut.trim().length > 0) {
          sendP('autopush', 'Pushing uncommitted changes…', 17);
          await runGit(['commit', '-m', `Auto-push before export v${version}`], versionsDir);
          try {
            await runGit(['push', 'origin', 'main'], versionsDir);
          } catch (pushErr: any) {
            const msg = pushErr.message ?? '';
            if (msg.includes('no upstream') || msg.includes('has no upstream')) {
              await runGit(['push', '-u', 'origin', 'main'], versionsDir);
            } else if (msg.includes('fetch first') || msg.includes('rejected')) {
              await runGit(['fetch', 'origin', 'main'], versionsDir);
              await runGit(['reset', '--hard', 'origin/main'], versionsDir);
              await runGit(['push', 'origin', 'main'], versionsDir);
            } else {
              throw pushErr;
            }
          }
          sendP('autopush', 'Auto-push complete', 20);
        }
      } catch (e: any) {
        return { success: false, error: `Auto-push failed: ${e?.message ?? String(e)}` };
      }
    }

    // ── Step 2: Pull latest remote state ─────────────────────────────────────

    sendP('pulling', 'Pulling latest changes…', 22);
    try {
      await runGit(['fetch', 'origin', 'main'], versionsDir);
      await runGit(['reset', '--hard', 'origin/main'], versionsDir);
    } catch (e: any) {
      console.warn('[changelog] git pull skipped:', e.message);
    }

    sendP('diffing', 'Generating changelog…', 30);

    const manifestPath = path.join(versionsDir, 'modrinth.index.json');
    const releasesDir  = path.join(versionsDir, 'releases');
    const snapshotExists = fs.existsSync(path.join(releasesDir, `v${version}.json`));

    const mkInitial = (markdown: string) => ({
      success: true, type: 'initial' as const, snapshotExists, diff: null, markdown,
    });

    if (!fs.existsSync(manifestPath)) {
      return mkInitial(`## v${version} — ${today}\n\n🎉 Initial release — no previous version to compare.\n`);
    }

    let manifest: any;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')); }
    catch (e: any) { return { success: false, error: `Could not read manifest: ${e.message}` }; }

    const cache = loadModrinthCache(versionsDir);

    // ── Step 3: Fetch published manifest from Modrinth ────────────────────────
    //
    // Downloads the latest listed .mrpack from Modrinth, extracts its
    // modrinth.index.json, and uses that as the "previous" manifest for the diff.
    // Falls back to the most recent local snapshot if the API or download fails.

    const projectId = store.get('modrinthProjectId') || 'O5wGsyGR';
    let prevFiles: any[] = [];
    let publishedVersion = '';
    let usingFallback = false;
    let warning: string | undefined;
    let note: string | undefined;

    try {
      sendP('diffing', 'Fetching latest Modrinth release…', 35);
      const versionsRes = await fetch(
        `https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version`,
        { headers: { 'User-Agent': 'ORB-Modpack-Exporter/1.0' } }
      );
      if (!versionsRes.ok) throw new Error(`Modrinth API returned ${versionsRes.status}`);

      const versions = await versionsRes.json() as any[];
      const latestListed = versions
        .filter((v: any) => v.status === 'listed')
        .sort((a: any, b: any) => new Date(b.date_published).getTime() - new Date(a.date_published).getTime())[0];

      if (!latestListed) {
        return mkInitial(`## v${version} — ${today}\n\n🎉 Initial release — no previous version to compare.\n`);
      }

      publishedVersion = latestListed.version_number as string;
      const primaryFile = (latestListed.files as any[])?.find((f: any) => f.primary) ?? (latestListed.files as any[])?.[0];
      if (!primaryFile?.url) throw new Error('No downloadable file found in Modrinth version');

      sendP('diffing', `Downloading v${publishedVersion} manifest…`, 42);
      const mrpackRes = await fetch(primaryFile.url as string, {
        headers: { 'User-Agent': 'ORB-Modpack-Exporter/1.0' },
      });
      if (!mrpackRes.ok) throw new Error(`Failed to download mrpack: ${mrpackRes.status}`);

      const buf = Buffer.from(await mrpackRes.arrayBuffer());
      const zip = new AdmZip(buf);
      const indexEntry = zip.getEntry('modrinth.index.json');
      if (!indexEntry) throw new Error('modrinth.index.json not found in mrpack');

      const publishedManifest = JSON.parse(indexEntry.getData().toString('utf-8'));
      prevFiles = publishedManifest.files || [];
      note = `Mod changes since v${publishedVersion} on Modrinth. File changes compared against local snapshot.`;
    } catch (e: any) {
      console.warn('[changelog] Modrinth fetch failed, falling back to snapshot:', e.message);
      usingFallback = true;
      warning = 'Could not fetch Modrinth release. Comparing against local snapshot.';

      // Fall back to the most recent local export snapshot
      const snapshotSorted = fs.existsSync(releasesDir)
        ? fs.readdirSync(releasesDir)
            .filter((f: string) => /^v[\d.]+\.json$/.test(f))
            .sort((a: string, b: string) => {
              const va = a.slice(1, -5).split('.').map(Number);
              const vb = b.slice(1, -5).split('.').map(Number);
              for (let i = 0; i < Math.max(va.length, vb.length); i++) {
                const d = (va[i] || 0) - (vb[i] || 0);
                if (d !== 0) return d;
              }
              return 0;
            })
        : [];

      if (snapshotSorted.length > 0) {
        const latestFile = snapshotSorted[snapshotSorted.length - 1];
        publishedVersion = latestFile.slice(1, -5);
        try {
          const snap = JSON.parse(fs.readFileSync(path.join(releasesDir, latestFile), 'utf-8'));
          prevFiles = snap.manifest?.files || [];
        } catch {}
      }
    }

    if (!publishedVersion) {
      return mkInitial(`## v${version} — ${today}\n\n🎉 Initial release — no previous version to compare.\n`);
    }

    // ── Step 4: Mod diff (current manifest vs published/snapshot) ────────────
    //
    // Match mods by project_id from Modrinth CDN URLs (primary) or by slug
    // from file path (fallback for local mods with no download URL).
    // This correctly classifies "same mod, new version" as Updated rather than
    // Removed+Added.

    // Parses project_id, version_id, and a semver-like version number out of a
    // Modrinth CDN URL: https://cdn.modrinth.com/data/{projectId}/versions/{versionId}/{filename}
    const parseCdnUrl = (url: string): { projectId: string; versionId: string; versionNumber: string } | null => {
      try {
        const parts = url.split('/');
        if (parts.length < 8 || parts[3] !== 'data' || parts[5] !== 'versions') return null;
        const projectId   = parts[4];
        const versionId   = parts[6];
        const filename    = parts[7] ?? '';
        const m = filename.match(/(\d+\.\d+[\d.]*)/);
        return { projectId, versionId, versionNumber: m ? m[1] : versionId };
      } catch { return null; }
    };

    interface ModEntry {
      key: string;          // project_id (CDN URL) or slug (local/fallback)
      name: string;         // human-readable title
      path: string;         // "mods/..." path from manifest
      versionId: string;    // CDN version segment; empty for local mods
      versionNumber: string; // semver parsed from filename; empty for local mods
      sha512: string;       // for local-mod change detection
    }

    const toModEntry = (file: any): ModEntry => {
      const sha: string  = file.hashes?.sha512 ?? '';
      const url: string  = (file.downloads as string[] | undefined)?.[0] ?? '';
      const parsed       = parseCdnUrl(url);
      if (parsed) {
        const title = (sha && cache[sha]?.title) ? cache[sha].title! : parsed.projectId;
        return { key: parsed.projectId, name: title, path: file.path, versionId: parsed.versionId, versionNumber: parsed.versionNumber, sha512: sha };
      }
      const slug  = path.basename(file.path as string, '.jar');
      const title = (sha && cache[sha]?.title) ? cache[sha].title! : slug;
      return { key: slug, name: title, path: file.path, versionId: '', versionNumber: '', sha512: sha };
    };

    const currFiles: any[] = manifest.files || [];

    // Fast-path: identical if same {path, sha512} set
    const toComparable = (files: any[]) =>
      JSON.stringify(
        [...files].sort((a, b) => String(a.path).localeCompare(String(b.path)))
          .map(f => ({ path: f.path, sha512: f.hashes?.sha512 ?? '' }))
      );
    if (toComparable(currFiles) === toComparable(prevFiles)) {
      return {
        success: true, type: 'no_changes' as const, snapshotExists, diff: null,
        markdown: `## v${version} — ${today}\n\n_No changes since last release — version was already exported._\n`,
      };
    }

    // Build project_id-keyed maps (only mod-path entries)
    const currModMap = new Map<string, ModEntry>();
    const prevModMap = new Map<string, ModEntry>();
    for (const f of currFiles) {
      if ((f.path as string).startsWith('mods/')) { const e = toModEntry(f); currModMap.set(e.key, e); }
    }
    for (const f of prevFiles) {
      if ((f.path as string).startsWith('mods/')) { const e = toModEntry(f); prevModMap.set(e.key, e); }
    }

    const addedMods:   { path: string; name: string }[] = [];
    const removedMods: { path: string; name: string }[] = [];
    const updatedMods: { path: string; name: string }[] = [];

    for (const [key, curr] of currModMap) {
      const prev = prevModMap.get(key);
      if (!prev) {
        // Net-new mod
        addedMods.push({ path: curr.path, name: curr.name });
      } else if (curr.versionId && prev.versionId && curr.versionId !== prev.versionId) {
        // Modrinth mod with a different version → Updated
        const oldVer = prev.versionNumber || prev.versionId;
        const newVer = curr.versionNumber || curr.versionId;
        const label  = (oldVer && newVer && oldVer !== newVer)
          ? `${curr.name} (${oldVer} → ${newVer})`
          : curr.name;
        updatedMods.push({ path: curr.path, name: label });
      } else if (!curr.versionId && !prev.versionId && curr.sha512 && prev.sha512 && curr.sha512 !== prev.sha512) {
        // Local mod whose file changed → Updated (no version to show)
        updatedMods.push({ path: curr.path, name: curr.name });
      }
      // else: same project + same version → skip (unchanged)
    }
    for (const [key, prev] of prevModMap) {
      if (!currModMap.has(key)) removedMods.push({ path: prev.path, name: prev.name });
    }

    // ── Step 5: Override file diff (supplemental, vs local snapshot) ──────────
    //
    // Modrinth doesn't expose override hashes, so we compare configs/resourcepacks/
    // etc. against the nearest local export snapshot as a best-effort supplement.

    const overridesDir = path.join(versionsDir, 'overrides');
    const currHashes: Record<string, string> = {};
    for (const folder of OVERRIDE_FOLDERS) {
      const srcDir = path.join(overridesDir, folder);
      if (!fs.existsSync(srcDir)) continue;
      for (const file of walkDir(srcDir)) {
        const rel = path.relative(overridesDir, file).replace(/\\/g, '/');
        currHashes[rel] = `sha256:${computeSha256(file)}`;
      }
    }

    let addedFiles: string[] = [];
    let removedFiles: string[] = [];
    let changedFiles: string[] = [];

    const snapshotFilesForOverrides = fs.existsSync(releasesDir)
      ? fs.readdirSync(releasesDir)
          .filter((f: string) => /^v[\d.]+\.json$/.test(f))
          .sort((a: string, b: string) => {
            const va = a.slice(1, -5).split('.').map(Number);
            const vb = b.slice(1, -5).split('.').map(Number);
            for (let i = 0; i < Math.max(va.length, vb.length); i++) {
              const d = (va[i] || 0) - (vb[i] || 0);
              if (d !== 0) return d;
            }
            return 0;
          })
      : [];

    if (snapshotFilesForOverrides.length > 0) {
      try {
        const snapData = JSON.parse(fs.readFileSync(path.join(releasesDir, snapshotFilesForOverrides[snapshotFilesForOverrides.length - 1]), 'utf-8'));
        const prevHashes: Record<string, string> = snapData.overrideHashes || {};
        addedFiles   = Object.keys(currHashes).filter(k => !prevHashes[k]);
        removedFiles = Object.keys(prevHashes).filter(k => !currHashes[k]);
        changedFiles = Object.keys(currHashes).filter(k => prevHashes[k] && prevHashes[k] !== currHashes[k]);
      } catch {}
    }

    const diff = { from: publishedVersion, addedMods, removedMods, updatedMods, addedFiles, removedFiles, changedFiles };

    // ── Build markdown ────────────────────────────────────────────────────────

    const lines: string[] = [`## v${version} — ${today}`, ''];
    if (usingFallback) {
      lines.push(`> ⚠️ ${warning}`, '');
    } else {
      lines.push(`> Mod changes since v${publishedVersion} on Modrinth. File changes compared against local snapshot.`, '');
    }
    if (addedMods.length > 0)   { lines.push('### Added Mods');   addedMods.forEach(m => lines.push(`- ${m.name}`));   lines.push(''); }
    if (removedMods.length > 0) { lines.push('### Removed Mods'); removedMods.forEach(m => lines.push(`- ${m.name}`)); lines.push(''); }
    if (updatedMods.length > 0) { lines.push('### Updated Mods'); updatedMods.forEach(m => lines.push(`- ${m.name}`)); lines.push(''); }
    const fileLines = [
      ...addedFiles.map(f => `- ${f} (added)`),
      ...removedFiles.map(f => `- ${f} (removed)`),
      ...changedFiles.map(f => `- ${f}`),
    ];
    if (fileLines.length > 0) { lines.push('### Changed Files'); lines.push(...fileLines); lines.push(''); }
    if (lines.length <= 3) lines.push('_No changes detected since the previous release._');

    return { success: true, type: 'diff' as const, snapshotExists, diff, markdown: lines.join('\n'), warning, note };
  });

  ipcMain.handle('export:mrpack', async (_e, {
    outputPath,
    version,
    changelog,
    overwriteSnapshot = false,
  }: {
    outputPath: string;
    version: string;
    changelog?: string;
    overwriteSnapshot?: boolean;
  }) => {
    const versionsDir = getVersionsRepoDir();
    const root = store.get('modpackRoot');
    const sendP = (stage: string, message: string, percent: number) =>
      mainWindow?.webContents.send('export:progress', { stage, message, percent });

    if (!root) return { success: false, error: 'No modpack root configured.' };

    const manifestPath = path.join(versionsDir, 'modrinth.index.json');
    if (!fs.existsSync(manifestPath)) {
      return { success: false, error: 'No manifest found. Push your changes first to generate one.' };
    }

    let manifest: any;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      if (manifest.formatVersion !== 1 || !Array.isArray(manifest.files)) throw new Error('Unexpected manifest format');
    } catch (e: any) {
      return { success: false, error: `Failed to read manifest: ${e.message}` };
    }

    // ── Save release snapshot + changelog and commit ───────────────────────────

    if (changelog !== undefined) {
      sendP('snapshot', 'Saving release snapshot…', 25);

      const releasesDir  = path.join(versionsDir, 'releases');
      fs.mkdirSync(releasesDir, { recursive: true });

      const snapshotPath  = path.join(releasesDir, `v${version}.json`);
      const changelogPath = path.join(releasesDir, `v${version}_changelog.md`);

      if (!fs.existsSync(snapshotPath) || overwriteSnapshot) {
        // Build override hashes for this snapshot
        const overridesDir = path.join(versionsDir, 'overrides');
        const overrideHashes: Record<string, string> = {};
        for (const folder of OVERRIDE_FOLDERS) {
          const srcDir = path.join(overridesDir, folder);
          if (!fs.existsSync(srcDir)) continue;
          for (const file of walkDir(srcDir)) {
            const rel = path.relative(overridesDir, file).replace(/\\/g, '/');
            overrideHashes[rel] = `sha256:${computeSha256(file)}`;
          }
        }

        const snapshot = {
          version,
          exportedAt: new Date().toISOString(),
          manifest: {
            ...manifest,
            versionId: version,
            files: manifest.files.map(({ source: _s, ...rest }: any) => rest),
          },
          overrideHashes,
        };

        fs.writeFileSync(snapshotPath,  JSON.stringify(snapshot, null, 2), 'utf-8');
        fs.writeFileSync(changelogPath, changelog, 'utf-8');

        // Commit and push snapshot files
        try {
          const token = getToken();
          if (token) {
            try {
              await runGit(['remote', 'set-url', 'origin', `https://x-access-token:${token}@github.com/OR-Beyond/OR-Beyond-Versions.git`], versionsDir);
            } catch {}
          }
          let githubUser = 'orbmodpack';
          try {
            const oc = getOctokit();
            if (oc) { const { data } = await oc.users.getAuthenticated(); githubUser = data.login; }
          } catch {}
          await ensureGitIdentity(versionsDir, githubUser);
          await runGit(['add', `releases/v${version}.json`, `releases/v${version}_changelog.md`], versionsDir);
          const { stdout: status } = await runGit(['status', '--porcelain'], versionsDir);
          if (status.trim()) {
            await runGit(['commit', '-m', `Release v${version}: save snapshot and changelog`], versionsDir);
            await runGit(['push', 'origin', 'main'], versionsDir);
          }
        } catch (e: any) {
          console.warn('[export] snapshot git push failed (non-fatal):', e.message);
        }
      }
    }

    // ── Build the .mrpack ZIP ─────────────────────────────────────────────────

    const exportManifest = {
      ...manifest,
      versionId: version,
      files: manifest.files.map(({ source: _s, ...rest }: any) => rest),
    };

    try {
      const zip = new AdmZip();

      sendP('reading', 'Reading manifest…', 35);
      zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify(exportManifest, null, 2), 'utf-8'));

      sendP('copying', 'Copying override files…', 50);
      const overridesDir = path.join(versionsDir, 'overrides');
      for (const folder of OVERRIDE_FOLDERS) {
        const srcDir = path.join(overridesDir, folder);
        if (!fs.existsSync(srcDir)) continue;
        for (const file of walkDir(srcDir)) {
          const rel = path.relative(overridesDir, file).replace(/\\/g, '/');
          zip.addFile(`overrides/${rel}`, fs.readFileSync(file));
        }
      }

      sendP('bundling', 'Bundling local mods…', 70);
      const localMods = manifest.files.filter((f: any) => f.source === 'local');
      const modsDir = path.join(root, 'mods');
      for (const modEntry of localMods) {
        const filename = path.basename(modEntry.path as string);
        const fromModpack  = path.join(modsDir, filename);
        const fromOverride = path.join(overridesDir, 'mods', filename);
        const jarPath = fs.existsSync(fromModpack) ? fromModpack
          : fs.existsSync(fromOverride) ? fromOverride
          : null;
        if (jarPath) zip.addFile(`overrides/mods/${filename}`, fs.readFileSync(jarPath));
      }

      sendP('zipping', 'Creating .mrpack file…', 85);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      zip.writeZip(outputPath);

      const size = fs.statSync(outputPath).size;
      sendP('done', 'Export complete!', 100);
      return { success: true, path: outputPath, size };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
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
