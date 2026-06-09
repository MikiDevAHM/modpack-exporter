import React, { useRef, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import type { CommitCard, CommitFile, ModChange } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function parseOwnerRepo(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/commit\//);
  return m ? { owner: m[1], repo: m[2] } : null;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ModBadge({ change }: { change: ModChange }) {
  const styles: Record<ModChange['type'], { bg: string; text: string; prefix: string }> = {
    added:   { bg: 'rgba(32,172,100,0.18)',  text: '#20AC64', prefix: '+' },
    removed: { bg: 'rgba(226,71,41,0.18)',   text: '#E24729', prefix: '−' },
    updated: { bg: 'rgba(255,168,9,0.18)',   text: '#FFA809', prefix: '↑' },
  };
  const s = styles[change.type];
  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: s.bg, color: s.text }}
    >
      <span className="font-semibold">{s.prefix}</span>
      <span className="max-w-[160px] truncate">{change.name}</span>
    </span>
  );
}

const STATUS_COLORS: Record<string, string> = {
  added:    '#20AC64',
  modified: '#FFA809',
  removed:  '#E24729',
  renamed:  '#58a6ff',
  copied:   '#58a6ff',
};

function FileLine({ file }: { file: CommitFile }) {
  const dotColor = STATUS_COLORS[file.status] ?? '#A9A9AB';
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span
        className="w-[7px] h-[7px] rounded-full flex-shrink-0"
        style={{ background: dotColor }}
        title={file.status}
      />
      <span
        className="text-xs font-mono truncate flex-1"
        style={{ color: '#C9D1D9' }}
      >
        {file.path}
      </span>
      {(file.additions > 0 || file.deletions > 0) && (
        <span className="text-xs font-mono flex-shrink-0 ml-1 select-none">
          {file.additions > 0 && (
            <span style={{ color: '#57ab5a' }}>+{file.additions}</span>
          )}
          {file.additions > 0 && file.deletions > 0 && (
            <span style={{ color: '#4D5461' }}> </span>
          )}
          {file.deletions > 0 && (
            <span style={{ color: '#e47171' }}>-{file.deletions}</span>
          )}
        </span>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const COLLAPSED_LIMIT = 3;

interface LocalDetails {
  files: CommitFile[];
  modChanges: ModChange[];
}

interface Props { commit: CommitCard }

export default function ActivityCard({ commit }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [localDetails, setLocalDetails] = useState<LocalDetails | null>(null);
  const [fetchLoading, setFetchLoading] = useState(false);
  // Tracks whether we've attempted a per-card fetch (to avoid retrying on re-hover)
  const fetchAttempted = useRef(false);

  // Prefer eagerly-enriched data from the parent; fall back to per-card fetch result.
  const details: LocalDetails | null = commit.detailsLoaded
    ? { files: commit.files, modChanges: commit.modChanges }
    : localDetails;

  const isLoaded = commit.detailsLoaded || localDetails !== null;

  const handleMouseEnter = async () => {
    if (fetchAttempted.current || commit.detailsLoaded) return;
    fetchAttempted.current = true;
    const parsed = parseOwnerRepo(commit.url);
    if (!parsed) return;
    setFetchLoading(true);
    try {
      const r = await window.electron.github.getCommitFiles({ ...parsed, sha: commit.sha });
      if (r.success && r.data) {
        setLocalDetails({ files: r.data.files, modChanges: r.data.modChanges });
      }
    } catch {
      // Silently fail — card still shows commit message without file details
    } finally {
      setFetchLoading(false);
    }
  };

  const handleCardClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-expand]')) return;
    window.electron.app.openExternal(commit.url);
  };

  const files = details?.files ?? [];
  const modChanges = details?.modChanges ?? [];
  const visibleFiles = expanded ? files : files.slice(0, COLLAPSED_LIMIT);
  const hiddenCount = files.length - COLLAPSED_LIMIT;

  return (
    <div
      className="rounded-[12px] p-4 cursor-pointer transition-colors group"
      style={{ background: '#323234' }}
      onClick={handleCardClick}
      onMouseEnter={e => {
        e.currentTarget.style.background = '#3a3a3c';
        handleMouseEnter();
      }}
      onMouseLeave={e => (e.currentTarget.style.background = '#323234')}
    >
      <div className="flex items-start gap-3">
        <img
          src={commit.author.avatar_url}
          alt={commit.author.login}
          className="w-8 h-8 rounded-full flex-shrink-0 mt-0.5"
          onError={e => { e.currentTarget.src = 'https://github.com/ghost.png'; }}
        />

        <div className="flex-1 min-w-0">
          {/* Author + timestamp */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-white text-sm font-medium">{commit.author.login}</span>
            <span className="text-[#A9A9AB] text-xs">{timeAgo(commit.date)}</span>
          </div>

          {/* Commit message */}
          <p className="text-[#A9A9AB] text-sm mb-2 truncate">{commit.message}</p>

          {/* Not yet fetched — waiting for hover */}
          {!isLoaded && !fetchLoading && (
            <p className="text-[#4D5461] text-xs">Hover to load changes</p>
          )}

          {/* Fetching in progress */}
          {!isLoaded && fetchLoading && (
            <div className="flex items-center gap-1.5 text-[#A9A9AB]">
              <Loader2 size={11} className="animate-spin" />
              <span className="text-xs">Loading changes…</span>
            </div>
          )}

          {/* Mod change badges (only when data is loaded and has mod changes) */}
          {isLoaded && modChanges.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1 mb-2">
              {modChanges.map((c, i) => <ModBadge key={i} change={c} />)}
            </div>
          )}

          {/* File list */}
          {isLoaded && files.length > 0 && (
            <div className="flex flex-col gap-[3px] mt-1">
              {visibleFiles.map((f, i) => <FileLine key={i} file={f} />)}

              {/* Expand: show "+N more" */}
              {!expanded && hiddenCount > 0 && (
                <button
                  data-expand="true"
                  className="text-left text-xs mt-0.5 transition-opacity hover:opacity-80"
                  style={{ color: '#58a6ff' }}
                  onClick={e => { e.stopPropagation(); setExpanded(true); }}
                >
                  +{hiddenCount} more file{hiddenCount !== 1 ? 's' : ''}
                </button>
              )}

              {/* Collapse */}
              {expanded && files.length > COLLAPSED_LIMIT && (
                <button
                  data-expand="true"
                  className="text-left text-xs mt-0.5 transition-opacity hover:opacity-80"
                  style={{ color: '#58a6ff' }}
                  onClick={e => { e.stopPropagation(); setExpanded(false); }}
                >
                  Show less
                </button>
              )}
            </div>
          )}

          {/* Loaded but nothing to show */}
          {isLoaded && files.length === 0 && modChanges.length === 0 && (
            <p className="text-[#4D5461] text-xs">No file changes recorded</p>
          )}
        </div>

        <ExternalLink
          size={13}
          className="text-[#A9A9AB] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5"
        />
      </div>
    </div>
  );
}
