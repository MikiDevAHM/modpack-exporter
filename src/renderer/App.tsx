import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';

import Header from './components/Header';
import ActivityFeed from './components/ActivityFeed';
import Sidebar from './components/Sidebar';
import PushModal from './components/PushModal';
import ExportModal from './components/ExportModal';
import SettingsModal from './components/SettingsModal';
import LoginModal from './components/LoginModal';

import type {
  AppConfig,
  CommitCard,
  GitHubUser,
  Issue,
  ModChange,
  SyncStatus,
} from './types';

type AuthState = 'loading' | 'unauthenticated' | 'authenticated';

function parseRepoUrl(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com[/:]([^/]+)\/([^/.]+)(\.git)?/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

export default function App() {
  // ── Core state ─────────────────────────────────────────────────────────────
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [modpackRootSet, setModpackRootSet] = useState(false);

  // ── Dashboard data ─────────────────────────────────────────────────────────
  const [commits, setCommits] = useState<CommitCard[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    branch: '', ahead: 0, behind: 0, modified: [], lastPull: null,
  });
  const [lastExportTime, setLastExportTime] = useState<string | null>(null);
  const [isLoadingCommits, setIsLoadingCommits] = useState(false);

  // ── Modal visibility ───────────────────────────────────────────────────────
  const [showPush, setShowPush] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showLogin, setShowLogin] = useState(false);

  // ── Auth check ─────────────────────────────────────────────────────────────
  const checkAuth = useCallback(async () => {
    const r = await window.electron.auth.check();
    if (r.authenticated && r.user) {
      setUser(r.user);
      setAuthState('authenticated');
      return true;
    }
    setUser(null);
    setAuthState('unauthenticated');
    return false;
  }, []);

  // ── Config / git / GitHub loaders ──────────────────────────────────────────
  const loadConfig = useCallback(async () => {
    const r = await window.electron.config.read();
    if (r.success && r.data) setConfig(r.data);
  }, []);

  const loadExportState = useCallback(async () => {
    const r = await window.electron.config.readExportState();
    if (r.success && r.data) setLastExportTime(r.data.timestamp);
    const saved = await window.electron.settings.get('lastExportTime');
    if (saved) setLastExportTime(saved);
  }, []);

  const loadGitStatus = useCallback(async () => {
    const r = await window.electron.git.status();
    if (r.success && r.data) setSyncStatus(r.data);
  }, []);

  const loadIssues = useCallback(async (cfg: AppConfig) => {
    const parsed = parseRepoUrl(cfg.github_repo);
    if (!parsed) return;
    const r = await window.electron.github.getIssues(parsed);
    if (r.success && r.data) setIssues(r.data);
  }, []);

  const enrichCommitDetails = useCallback(
    async (cards: CommitCard[], owner: string, repo: string) => {
      for (const card of cards.slice(0, 8)) {
        const r = await window.electron.github.getCommitFiles({ owner, repo, sha: card.sha });
        if (r.success && r.data) {
          setCommits(prev =>
            prev.map(c =>
              c.sha === card.sha
                ? {
                    ...c,
                    files: r.data!.files,
                    modChanges: r.data!.modChanges,
                    configChanged: r.data!.configChanged,
                    detailsLoaded: true,
                  }
                : c
            )
          );
        }
      }
    },
    []
  );

  const loadCommits = useCallback(
    async (cfg: AppConfig) => {
      const parsed = parseRepoUrl(cfg.github_repo);
      if (!parsed) return;
      setIsLoadingCommits(true);
      try {
        const r = await window.electron.github.getCommits({
          ...parsed,
          branch: cfg.github_branch || 'main',
        });
        if (r.success && r.data) {
          const cards: CommitCard[] = r.data.map((c: any) => ({
            sha: c.sha,
            message: c.commit.message.split('\n')[0],
            author: {
              login: c.author?.login || c.commit.author?.name || 'unknown',
              avatar_url: c.author?.avatar_url || 'https://github.com/ghost.png',
              html_url: c.author?.html_url || '',
            },
            date: c.commit.author?.date || new Date().toISOString(),
            url: c.html_url,
            modChanges: [] as ModChange[],
            configChanged: false,
            files: [],
            detailsLoaded: false,
          }));
          setCommits(cards);
          enrichCommitDetails(cards, parsed.owner, parsed.repo);
        }
      } finally {
        setIsLoadingCommits(false);
      }
    },
    [enrichCommitDetails]
  );

  // ── Bootstrap on auth ──────────────────────────────────────────────────────
  const loadDashboard = useCallback(async () => {
    await loadConfig();
    await loadExportState();
    const cfgRes = await window.electron.config.read();
    if (cfgRes.success && cfgRes.data) {
      setConfig(cfgRes.data);
      await Promise.all([loadCommits(cfgRes.data), loadIssues(cfgRes.data), loadGitStatus()]);
    }

    // Surface a hint if modpack root isn't configured yet.
    const root = await window.electron.settings.get('modpackRoot');
    setModpackRootSet(!!root);
    if (!root) {
      toast('Set your modpack root in Settings to enable git + export', { icon: '⚙️' });
      setShowSettings(true);
    }
  }, [loadConfig, loadExportState, loadCommits, loadIssues, loadGitStatus]);

  // ── App startup ────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const ok = await checkAuth();
      if (ok) await loadDashboard();
    })();
  }, [checkAuth, loadDashboard]);

  // ── Auto-refresh on window focus (debounced – ignore if last refresh <30s) ─
  const lastFocusRefresh = React.useRef(0);
  useEffect(() => {
    if (authState !== 'authenticated') return;
    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocusRefresh.current < 30_000) return;
      lastFocusRefresh.current = now;
      if (config) {
        loadCommits(config);
        loadGitStatus();
        loadIssues(config);
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [authState, config, loadCommits, loadGitStatus, loadIssues]);

  const handleRefreshActivity = useCallback(() => {
    if (config) {
      loadCommits(config);
      loadGitStatus();
    }
  }, [config, loadCommits, loadGitStatus]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const handlePull = async () => {
    const tid = toast.loading('Pulling latest…');
    const r = await window.electron.git.pull();
    toast.dismiss(tid);
    if (r.success) {
      toast.success('Pulled & synced mods');
      await loadGitStatus();
      if (config) await loadCommits(config);
    } else {
      toast.error(`Pull failed: ${r.error}`);
    }
  };

  const handlePushSuccess = async () => {
    setShowPush(false);
    await loadGitStatus();
    if (config) await loadCommits(config);
  };

  const handleExportSuccess = async () => {
    setShowExport(false);
    await loadConfig();
    await loadExportState();
    if (config) await loadCommits(config);
  };

  const handleSettingsSaved = async () => {
    setShowSettings(false);
    const root = await window.electron.settings.get('modpackRoot');
    setModpackRootSet(!!root);
    // Refresh anything that depends on modpackRoot
    await Promise.all([loadGitStatus(), loadExportState()]);
  };

  const handleLoginRequest = () => setShowLogin(true);

  const handleLoginSuccess = async () => {
    setShowLogin(false);
    const ok = await checkAuth();
    if (ok) {
      toast.success('Signed in successfully');
      await loadDashboard();
    }
  };

  const handleLogout = async () => {
    await window.electron.auth.logout();
    setUser(null);
    setAuthState('unauthenticated');
    setCommits([]);
    setIssues([]);
    setSyncStatus({ branch: '', ahead: 0, behind: 0, modified: [], lastPull: null });
    setShowSettings(false);
    toast.success('Signed out');
  };

  // ── Render: loading splash ─────────────────────────────────────────────────
  if (authState === 'loading') {
    return (
      <div className="flex items-center justify-center h-screen bg-[#1E1E1E] drag-region">
        <div className="flex flex-col items-center gap-3 no-drag">
          <div
            className="w-10 h-10 rounded-[12px] flex items-center justify-center text-white font-bold"
            style={{ background: 'linear-gradient(135deg, #E24729 0%, #FF3F6E 100%)' }}
          >
            O
          </div>
          <div className="flex items-center gap-2 text-[#A9A9AB] text-sm">
            <Loader2 size={14} className="animate-spin" />
            Checking credentials…
          </div>
        </div>
      </div>
    );
  }

  // ── Render: unauthenticated (only SettingsModal visible) ──────────────────
  if (authState === 'unauthenticated') {
    return (
      <div className="flex flex-col h-screen bg-[#1E1E1E] overflow-hidden">
        {/* Empty drag region for window movement */}
        <div className="h-14 drag-region flex items-center px-5">
          <div className="flex items-center gap-3 no-drag">
            <div
              className="w-8 h-8 rounded-[10px] flex items-center justify-center text-white font-bold text-sm"
              style={{ background: 'linear-gradient(135deg, #E24729 0%, #FF3F6E 100%)' }}
            >
              O
            </div>
            <span className="font-semibold text-white text-[15px]">ORB Modpack Exporter</span>
          </div>
        </div>

        <SettingsModal
          dismissible={false}
          user={null}
          onClose={() => {}}
          onSaved={handleSettingsSaved}
          onRequestLogin={handleLoginRequest}
          onLogout={handleLogout}
        />

        {showLogin && (
          <LoginModal onClose={() => setShowLogin(false)} onSuccess={handleLoginSuccess} />
        )}
      </div>
    );
  }

  // ── Render: authenticated dashboard ────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-[#1E1E1E] overflow-hidden">
      <Header
        user={user}
        onExport={() => setShowExport(true)}
        onSettings={() => setShowSettings(true)}
        onLogout={handleLogout}
      />
      <div className="flex flex-1 overflow-hidden">
        <ActivityFeed
          commits={commits}
          isLoading={isLoadingCommits}
          hasToken={true}
          onRefresh={handleRefreshActivity}
        />
        <Sidebar
          config={config}
          syncStatus={syncStatus}
          issues={issues}
          lastExportTime={lastExportTime}
          onPull={handlePull}
          onPush={() => setShowPush(true)}
          onReportBug={() =>
            config &&
            window.electron.app.openExternal(`${config.github_repo.replace('.git', '')}/issues/new`)
          }
        />
      </div>

      {showPush && <PushModal onClose={() => setShowPush(false)} onSuccess={handlePushSuccess} />}
      {showExport && config && (
        <ExportModal config={config} onClose={() => setShowExport(false)} onSuccess={handleExportSuccess} />
      )}
      {showSettings && (
        <SettingsModal
          user={user}
          onClose={() => setShowSettings(false)}
          onSaved={handleSettingsSaved}
          onRequestLogin={handleLoginRequest}
          onLogout={handleLogout}
        />
      )}
      {showLogin && (
        <LoginModal onClose={() => setShowLogin(false)} onSuccess={handleLoginSuccess} />
      )}

      {/* Hint indicator at bottom if modpackRoot still unset */}
      {!modpackRootSet && !showSettings && (
        <button
          onClick={() => setShowSettings(true)}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full text-xs font-medium transition-colors shadow-lg z-30"
          style={{ background: '#FFA809', color: '#1E1E1E' }}
        >
          ⚙ Set modpack root in Settings
        </button>
      )}
    </div>
  );
}
