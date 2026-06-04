import React from 'react';
import { ExternalLink, Loader2, FileText, FileCog } from 'lucide-react';
import type { CommitCard, ModChange } from '../types';

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function ModBadge({ change }: { change: ModChange }) {
  // Spec colors: added=#20AC64, removed=#E24729, updated=#FFA809
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

/** Files considered "config" (worth surfacing in the card). */
function isConfigFile(p: string): boolean {
  return (
    p === 'config.yaml' ||
    p.startsWith('config/') ||
    p === '.last_export_state.json' ||
    p.endsWith('.json5') ||
    p.endsWith('.toml')
  );
}

interface Props { commit: CommitCard }

export default function ActivityCard({ commit }: Props) {
  const handleClick = () => window.electron.app.openExternal(commit.url);
  const configFiles = commit.files.filter(isConfigFile).slice(0, 8);

  return (
    <div
      className="rounded-[12px] p-4 cursor-pointer transition-colors group"
      style={{ background: '#323234' }}
      onClick={handleClick}
      onMouseEnter={e => (e.currentTarget.style.background = '#3a3a3c')}
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
          <div className="flex items-center gap-2 mb-1">
            <span className="text-white text-sm font-medium">{commit.author.login}</span>
            <span className="text-[#A9A9AB] text-xs">{timeAgo(commit.date)}</span>
          </div>
          <p className="text-[#A9A9AB] text-sm mb-2 truncate">{commit.message}</p>

          {!commit.detailsLoaded && (
            <div className="flex items-center gap-1.5 text-[#A9A9AB]">
              <Loader2 size={11} className="animate-spin" />
              <span className="text-xs">Loading changes…</span>
            </div>
          )}

          {commit.detailsLoaded && commit.modChanges.length === 0 && configFiles.length === 0 && commit.files.length > 0 && (
            <p className="text-[#A9A9AB] text-xs">
              {commit.files.length} file{commit.files.length !== 1 ? 's' : ''} changed
            </p>
          )}

          {commit.detailsLoaded && commit.modChanges.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {commit.modChanges.map((c, i) => <ModBadge key={i} change={c} />)}
            </div>
          )}

          {commit.detailsLoaded && configFiles.length > 0 && (
            <div className="flex flex-col gap-0.5 mt-2">
              {configFiles.map(f => (
                <div key={f} className="flex items-center gap-1.5">
                  {f === 'config.yaml' ? (
                    <FileCog size={11} style={{ color: '#FFA809' }} className="flex-shrink-0" />
                  ) : (
                    <FileText size={11} className="text-[#A9A9AB] flex-shrink-0" />
                  )}
                  <span className="text-[#A9A9AB] text-xs font-mono truncate">{f}</span>
                </div>
              ))}
              {commit.files.filter(isConfigFile).length > configFiles.length && (
                <p className="text-[#A9A9AB] text-xs ml-4">
                  +{commit.files.filter(isConfigFile).length - configFiles.length} more
                </p>
              )}
            </div>
          )}
        </div>

        <ExternalLink size={13} className="text-[#A9A9AB] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5" />
      </div>
    </div>
  );
}
