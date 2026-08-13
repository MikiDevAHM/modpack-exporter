import React, { useEffect, useRef, useState } from 'react';
import { Copy, Check, Trash2, AlertTriangle, Info, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import Button from '../base/Button';
import {
  getLogs, clearLogs, subscribe, formatLogsForClipboard, type LogEntry,
} from '../../utils/logger';
import type { LogLevel } from '../../types';

const TAG_COLORS: Record<string, string> = {
  'main': '#58a6ff',
  'updater': '#bc8cff',
  'scan': '#f0883e',
  'git:pull': '#3fb950',
  'git:ensure-versions-repo': '#3fb950',
  'git': '#3fb950',
  'pull': '#3fb950',
  'push': '#d29922',
  'undo-push': '#f85149',
  'discord': '#5865f2',
  'changelog': '#79c0ff',
  'export': '#ffa657',
  'modrinth-cache': '#ffa657',
  'pull-state': '#8b949e',
};

const DEFAULT_TAG_COLOR = '#8b949e';

// `all` shows everything; info/warn/error show that severity and above.
const FILTERS: { value: 'all' | LogLevel; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'info', label: 'Info+' },
  { value: 'warn', label: 'Warnings+' },
  { value: 'error', label: 'Errors' },
];

const SEVERITY: Record<LogLevel, number> = { log: 0, info: 1, warn: 2, error: 3 };

function parseTag(message: string): { tag: string | null; rest: string } {
  const m = message.match(/^\[([^\]]+)\]\s*(.*)/);
  if (m) return { tag: m[1], rest: m[2] };
  return { tag: null, rest: message };
}

function tagColor(tag: string): string {
  if (TAG_COLORS[tag]) return TAG_COLORS[tag];
  for (const [prefix, color] of Object.entries(TAG_COLORS)) {
    if (tag.startsWith(prefix)) return color;
  }
  return DEFAULT_TAG_COLOR;
}

function formatMessage(message: string): React.ReactNode {
  const { tag, rest } = parseTag(message);
  if (!tag) {
    return <span>{message}</span>;
  }
  const color = tagColor(tag);
  return (
    <>
      <span
        className="font-mono rounded px-1 py-0.5 text-[11px] font-semibold flex-shrink-0"
        style={{
          color,
          background: `${color}18`,
          border: `1px solid ${color}30`,
        }}
      >
        {tag}
      </span>
      <span className="text-inherit">{rest}</span>
    </>
  );
}

function LogIcon({ level }: { level: LogEntry['level'] }) {
  switch (level) {
    case 'error':
      return <XCircle size={13} className="text-danger flex-shrink-0 mt-0.5" />;
    case 'warn':
      return <AlertTriangle size={13} className="text-warning flex-shrink-0 mt-0.5" />;
    case 'info':
      return <Info size={13} className="text-primary flex-shrink-0 mt-0.5" />;
    default:
      return <Info size={13} className="text-muted flex-shrink-0 mt-0.5" />;
  }
}

function levelClass(level: LogEntry['level']): string {
  switch (level) {
    case 'error':
      return 'bg-danger/10 border-l-2 border-danger/50';
    case 'warn':
      return 'bg-warning/10 border-l-2 border-warning/50';
    default:
      return '';
  }
}

function levelTextClass(level: LogEntry['level']): string {
  switch (level) {
    case 'error':
      return 'text-danger';
    case 'warn':
      return 'text-warning';
    default:
      return 'text-foreground';
  }
}

export default function LogsPage() {
  const [, forceUpdate] = useState(0);
  const [filter, setFilter] = useState<'all' | LogLevel>('all');
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Live store: renderer console captures + main-process stream, no polling.
  useEffect(() => subscribe(() => forceUpdate(n => n + 1)), []);

  const logs = getLogs();
  const visibleLogs =
    filter === 'all' ? logs : logs.filter(e => SEVERITY[e.level] >= SEVERITY[filter]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visibleLogs.length]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formatLogsForClipboard(visibleLogs));
      setCopied(true);
      toast.success('Logs copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy logs');
    }
  };

  const handleClear = () => {
    clearLogs();
    toast.success('Logs cleared');
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-line/6 flex-shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="text-foreground font-semibold text-base">Logs</h2>
          <div className="flex items-center gap-0.5">
            {FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`px-2.5 py-1 rounded-[6px] text-xs font-medium transition-colors whitespace-nowrap ${
                  filter === f.value ? 'bg-line/8 text-foreground' : 'text-muted hover:bg-line/4'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={Trash2}
            disabled={logs.length === 0}
            onClick={handleClear}
          >
            Clear
          </Button>
          <Button
            variant={copied ? 'soft-success' : 'primary'}
            size="sm"
            icon={copied ? Check : Copy}
            disabled={logs.length === 0}
            onClick={handleCopy}
          >
            {copied ? 'Copied' : 'Copy Logs'}
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 font-mono">
        {logs.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted text-sm">No logs yet. App activity will appear here.</p>
          </div>
        ) : visibleLogs.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted text-sm">No logs match this filter.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {visibleLogs.map(entry => (
              <div
                key={`${entry.source}-${entry.id}`}
                className={`flex items-start gap-2 px-3 py-1.5 rounded-[6px] text-xs leading-relaxed ${levelClass(entry.level)}`}
              >
                <LogIcon level={entry.level} />
                <span className="text-muted-foreground flex-shrink-0 w-20 select-none">
                  {entry.timestamp}
                </span>
                <span
                  className={`${levelTextClass(entry.level)} flex-1 min-w-0`}
                  style={{ wordBreak: 'break-word', display: 'flex', alignItems: 'baseline', gap: '6px', flexWrap: 'wrap' }}
                >
                  {formatMessage(entry.message)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
