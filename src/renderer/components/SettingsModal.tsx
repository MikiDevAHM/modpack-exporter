import React, { useEffect, useState } from 'react';
import { X, FolderOpen, Loader2, Github, Check, LogOut, AlertCircle, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import type { GitHubUser, ModrinthProfile } from '../types';

interface Props {
  /** When false, the X button and overlay-click dismiss are hidden (used for first-run / unauthenticated state). */
  dismissible?: boolean;
  /** Current GitHub user, if already signed in. */
  user: GitHubUser | null;
  /** Closes the modal. */
  onClose: () => void;
  /** Called after Save. The parent should refresh state. */
  onSaved: () => void;
  /** Called when the user clicks "Login with GitHub". Parent shows LoginModal. */
  onRequestLogin: () => void;
  /** Called when the user clicks "Log out". */
  onLogout: () => void;
}

export default function SettingsModal({
  dismissible = true,
  user,
  onClose,
  onSaved,
  onRequestLogin,
  onLogout,
}: Props) {
  const [modpackRoot, setModpackRoot] = useState('');
  const [exportDir, setExportDir] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [scanningProfiles, setScanningProfiles] = useState(false);
  const [profiles, setProfiles] = useState<ModrinthProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState('');
  const authenticated = !!user;

  // ── Load settings + scan for Modrinth profiles on open ────────────────────
  const loadProfiles = async (existingRoot?: string) => {
    setScanningProfiles(true);
    const result = await window.electron.modpack.listProfiles();
    setScanningProfiles(false);
    if (!result.success || result.data.length === 0) return;

    setProfiles(result.data);

    if (result.data.length === 1 && !existingRoot) {
      // Single profile: auto-select and save
      const p = result.data[0];
      setSelectedProfile(p.path);
      setModpackRoot(p.path);
      await window.electron.modpack.setRootFromProfile(p.path);
      toast.success(`Modrinth profile "${p.name}" detected automatically`);
    } else {
      // Pre-select whichever profile matches the current root (if any)
      const match = result.data.find(p => p.path === existingRoot);
      if (match) setSelectedProfile(match.path);
    }
  };

  useEffect(() => {
    (async () => {
      const all = await window.electron.settings.getAll();
      if (all.exportDir) setExportDir(all.exportDir);
      if (all.modpackRoot) setModpackRoot(all.modpackRoot);
      await loadProfiles(all.modpackRoot || undefined);
    })();

    // If the background startup scan finishes while the modal is open, reflect it
    window.electron.modpack.onRootFound(({ path: p }) => {
      setModpackRoot(prev => prev || p);
    });
    return () => window.electron.modpack.offRootFound();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Profile handlers ───────────────────────────────────────────────────────
  const handleUseProfile = async () => {
    if (!selectedProfile) return;
    setModpackRoot(selectedProfile);
    await window.electron.modpack.setRootFromProfile(selectedProfile);
    const profile = profiles.find(p => p.path === selectedProfile);
    toast.success(`Profile "${profile?.name ?? selectedProfile}" selected`);
  };

  const handleRescan = () => loadProfiles(modpackRoot || undefined);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const selectModpackRoot = async () => {
    const dir = await window.electron.app.selectDirectory();
    if (dir) setModpackRoot(dir);
  };

  const selectExportDir = async () => {
    const dir = await window.electron.app.selectDirectory();
    if (dir) setExportDir(dir);
  };

  const handleSave = async () => {
    if (!authenticated) {
      toast.error('Sign in with GitHub before saving');
      return;
    }
    if (!modpackRoot.trim()) {
      toast.error('Modpack root is required');
      return;
    }
    setIsSaving(true);
    await Promise.all([
      window.electron.settings.set('modpackRoot', modpackRoot.trim()),
      window.electron.settings.set('exportDir', exportDir.trim()),
    ]);
    setIsSaving(false);
    toast.success('Settings saved');
    onSaved();
  };

  // ── Styling shortcuts ──────────────────────────────────────────────────────
  const inputClass =
    'w-full rounded-[8px] px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#0890FE] transition-all';
  const inputStyle = { background: '#1E1E1E', border: '1px solid rgba(255,255,255,0.08)' } as const;
  const labelClass = 'text-[#A9A9AB] text-xs font-medium mb-1.5 block';

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={e => {
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[500px] rounded-[12px] overflow-hidden shadow-2xl" style={{ background: '#323234' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <h2 className="text-white font-semibold text-base">
            {dismissible ? 'Settings' : 'Welcome to ORB Modpack Exporter'}
          </h2>
          {dismissible && (
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors"
            >
              <X size={15} className="text-[#A9A9AB]" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col gap-5">
          {/* GitHub auth section */}
          <div>
            <label className={labelClass}>GitHub Account</label>
            {authenticated ? (
              <div
                className="flex items-center justify-between rounded-[8px] px-3 py-2.5"
                style={inputStyle}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {user.avatar_url && (
                    <img
                      src={user.avatar_url}
                      alt={user.login}
                      className="w-7 h-7 rounded-full flex-shrink-0"
                    />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Check size={12} style={{ color: '#20AC64' }} />
                      <span className="text-white text-sm font-medium truncate">{user.login}</span>
                    </div>
                    <p className="text-[#A9A9AB] text-xs">Signed in via device flow</p>
                  </div>
                </div>
                <button
                  onClick={onLogout}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-medium transition-colors hover:bg-white/10"
                  style={{ color: '#A9A9AB', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  <LogOut size={12} />
                  Sign out
                </button>
              </div>
            ) : (
              <button
                onClick={onRequestLogin}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-[8px] text-white text-sm font-medium transition-all"
                style={{ background: '#0890FE' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#1a9dff')}
                onMouseLeave={e => (e.currentTarget.style.background = '#0890FE')}
              >
                <Github size={15} />
                Sign in with GitHub
              </button>
            )}
            <p className="text-[#A9A9AB] text-xs mt-1.5">
              Required to fetch commits, issues, and push changes.
            </p>
          </div>

          <div className="h-px bg-white/[0.06]" />

          {/* Modpack root */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={labelClass} style={{ marginBottom: 0 }}>
                Modpack Root Directory <span className="text-[#E24729]">*</span>
              </label>
              <button
                onClick={handleRescan}
                disabled={scanningProfiles}
                className="flex items-center gap-1 text-xs text-[#A9A9AB] hover:text-white transition-colors disabled:opacity-40"
                title="Re-scan all drives"
              >
                <RefreshCw size={11} className={scanningProfiles ? 'animate-spin' : ''} />
                {scanningProfiles ? 'Scanning…' : 'Rescan'}
              </button>
            </div>
            <p className="text-[#A9A9AB] text-xs mb-2">
              Your Modrinth instance folder (must contain a <code className="bg-white/10 px-1 rounded">mods/</code> subfolder).
            </p>

            {/* Profile dropdown or status */}
            {scanningProfiles ? (
              <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-[8px] text-xs" style={{ background: 'rgba(8,144,254,0.12)', color: '#0890FE' }}>
                <Loader2 size={12} className="animate-spin flex-shrink-0" />
                Scanning all drives for Modrinth profiles…
              </div>
            ) : profiles.length > 0 ? (
              <div className="mb-2 flex gap-2">
                <select
                  value={selectedProfile}
                  onChange={e => setSelectedProfile(e.target.value)}
                  className="flex-1 rounded-[8px] px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#0890FE] transition-all appearance-none"
                  style={{ background: '#1E1E1E', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  {profiles.length > 1 && <option value="">Select a Modrinth profile…</option>}
                  {profiles.map(p => (
                    <option key={p.path} value={p.path} title={p.path}>
                      {p.name}  —  {p.launcherPath}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleUseProfile}
                  disabled={!selectedProfile}
                  className="px-3 py-2 rounded-[8px] text-white text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                  style={{ background: '#20AC64' }}
                  onMouseEnter={e => { if (selectedProfile) (e.currentTarget as HTMLButtonElement).style.background = '#25bd72'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#20AC64'; }}
                >
                  Use
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-[8px] text-xs" style={{ background: 'rgba(255,168,9,0.12)', color: '#FFA809' }}>
                <AlertCircle size={12} className="flex-shrink-0" />
                No Modrinth profiles found on any drive. Browse manually below.
              </div>
            )}

            {/* Confirmed selection badge */}
            {!scanningProfiles && modpackRoot && selectedProfile === modpackRoot && (
              <div className="flex items-center gap-1.5 mb-2 text-xs" style={{ color: '#20AC64' }}>
                <Check size={11} />
                <span className="truncate">{modpackRoot}</span>
              </div>
            )}

            {/* Manual path input + browse */}
            <div className="flex gap-2">
              <input
                value={modpackRoot}
                onChange={e => setModpackRoot(e.target.value)}
                placeholder="C:\Users\you\AppData\Roaming\ModrinthApp\profiles\ORB"
                className={`${inputClass} flex-1`}
                style={inputStyle}
              />
              <button
                onClick={selectModpackRoot}
                disabled={scanningProfiles}
                className="px-3 py-2 rounded-[8px] hover:bg-white/10 transition-colors disabled:opacity-40"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
                aria-label="Browse for modpack root"
                title="Browse for modpack root"
              >
                <FolderOpen size={15} className="text-[#A9A9AB]" />
              </button>
            </div>
          </div>

          {/* Export dir */}
          <div>
            <label className={labelClass}>
              Export Directory <span className="text-[#A9A9AB] font-normal">(optional)</span>
            </label>
            <p className="text-[#A9A9AB] text-xs mb-2">
              Where <code className="bg-white/10 px-1 rounded">.mrpack</code> files are saved.
              Defaults to <code className="bg-white/10 px-1 rounded">modpack_root/Modpack Export/</code>.
            </p>
            <div className="flex gap-2">
              <input
                value={exportDir}
                onChange={e => setExportDir(e.target.value)}
                placeholder="Leave blank for default"
                className={`${inputClass} flex-1`}
                style={inputStyle}
              />
              <button
                onClick={selectExportDir}
                className="px-3 py-2 rounded-[8px] hover:bg-white/10 transition-colors"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
                aria-label="Browse"
              >
                <FolderOpen size={15} className="text-[#A9A9AB]" />
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-white/[0.06]">
          {dismissible && (
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-[8px] text-[#A9A9AB] text-sm hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={isSaving || !authenticated || !modpackRoot.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-[8px] text-white text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: '#0890FE' }}
            onMouseEnter={e => { if (!isSaving) e.currentTarget.style.background = '#1a9dff'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#0890FE'; }}
          >
            {isSaving ? <Loader2 size={14} className="animate-spin" /> : null}
            {isSaving ? 'Saving…' : authenticated ? 'Save & Continue' : 'Sign in to continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
