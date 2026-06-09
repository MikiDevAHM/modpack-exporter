import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileText, Upload, X } from 'lucide-react';
import toast from 'react-hot-toast';

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

type Phase = 'idle' | 'pushing' | 'success' | 'error';

interface ProgressState {
  percent: number;
  message: string;
  stage: string;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const COLORS = {
  bg:        '#0d1117',
  surface:   '#323234',
  border:    'rgba(255,255,255,0.08)',
  divider:   'rgba(255,255,255,0.06)',
  muted:     '#8b949e',
  accent:    '#58a6ff',
  success:   '#3fb950',
  error:     '#f85149',
  barBg:     '#21262d',
  btnGreen:  '#238636',
  btnGreenHover: '#2ea043',
} as const;

// ── Sub-components ────────────────────────────────────────────────────────────

function ProgressBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div
      className="w-full rounded-full overflow-hidden"
      style={{ background: COLORS.barBg, height: '6px' }}
    >
      <div
        className="h-full rounded-full"
        style={{
          width: `${Math.min(100, Math.max(0, percent))}%`,
          background: color,
          transition: 'width 300ms ease, background 300ms ease',
        }}
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PushModal({ onClose, onSuccess }: Props) {
  const [commitMessage, setCommitMessage] = useState('');
  const [stagedFiles, setStagedFiles] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<ProgressState>({ percent: 0, message: '', stage: '' });
  const [error, setError] = useState<string | null>(null);
  const [mouseDownTarget, setMouseDownTarget] = useState<EventTarget | null>(null);
  const [countdown, setCountdown] = useState(2);

  // Prevent stale closures in the progress handler
  const setProgressRef = useRef(setProgress);
  setProgressRef.current = setProgress;

  // Load staged files on mount
  useEffect(() => {
    window.electron.git.stagedFiles().then(r => {
      if (r.success && r.data) setStagedFiles(r.data);
    });
  }, []);

  // Auto-close 2 s after success
  useEffect(() => {
    if (phase !== 'success') return;
    setCountdown(2);
    const interval = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { clearInterval(interval); onSuccess(); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [phase, onSuccess]);

  const handlePush = async () => {
    if (!commitMessage.trim()) { toast.error('Commit message required'); return; }

    setError(null);
    setProgress({ percent: 0, message: 'Starting…', stage: '' });
    setPhase('pushing');

    // Register listener synchronously so no events are missed
    window.electron.git.onSyncProgress(data => {
      setProgressRef.current({
        percent: data.percent ?? 0,
        message: data.message ?? '',
        stage: data.stage ?? '',
      });
    });

    try {
      const r = await window.electron.git.push({ message: commitMessage.trim() });
      if (r.success) {
        setProgress({ percent: 100, message: 'Push complete!', stage: 'done' });
        setPhase('success');
        toast.success('Changes pushed successfully');
      } else {
        setError(r.error ?? 'Push failed');
        setPhase('error');
      }
    } catch (e: any) {
      setError(e?.message ?? 'Unexpected error');
      setPhase('error');
    } finally {
      window.electron.git.offSyncProgress();
    }
  };

  // ── Derived values ──────────────────────────────────────────────────────────

  const isPushing = phase === 'pushing';
  const isActive  = phase === 'pushing' || phase === 'success';

  const barColor =
    phase === 'error'   ? COLORS.error   :
    phase === 'success' ? COLORS.success  :
                          COLORS.accent;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onMouseDown={e => setMouseDownTarget(e.target)}
      onMouseUp={e => {
        if (mouseDownTarget === e.target && e.target === e.currentTarget && !isPushing) onClose();
        setMouseDownTarget(null);
      }}
    >
      <div
        className="w-[480px] rounded-[14px] overflow-hidden shadow-2xl"
        style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}
      >
        {/* ── Header ── */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: `1px solid ${COLORS.divider}` }}
        >
          <h2 className="text-white font-semibold text-[15px]">Push Changes</h2>
          <button
            onClick={onClose}
            disabled={isPushing}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ color: COLORS.muted }}
            onMouseEnter={e => { if (!isPushing) (e.currentTarget.style.background = 'rgba(255,255,255,0.08)'); }}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </div>

        {/* ── Body: idle / error ── */}
        {(phase === 'idle' || phase === 'error') && (
          <div className="p-5 flex flex-col gap-4">
            {/* Commit message */}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: COLORS.muted }}>
                Commit message <span style={{ color: COLORS.error }}>*</span>
              </label>
              <textarea
                value={commitMessage}
                onChange={e => setCommitMessage(e.target.value)}
                placeholder="Describe what changed…"
                rows={3}
                className="w-full rounded-[8px] px-3 py-2.5 text-sm text-white resize-none focus:outline-none transition-colors"
                style={{
                  background: COLORS.bg,
                  border: `1px solid ${phase === 'error' ? 'rgba(248,81,73,0.35)' : COLORS.border}`,
                }}
                onFocus={e => (e.currentTarget.style.borderColor = COLORS.accent)}
                onBlur={e => (e.currentTarget.style.borderColor =
                  phase === 'error' ? 'rgba(248,81,73,0.35)' : COLORS.border)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handlePush(); }}
              />
            </div>

            {/* Staged files */}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: COLORS.muted }}>
                Files to commit
              </label>
              <div
                className="rounded-[8px] p-3 flex flex-col gap-1.5 max-h-28 overflow-y-auto"
                style={{ background: COLORS.bg, border: `1px solid ${COLORS.divider}` }}
              >
                {stagedFiles.length === 0 ? (
                  <p className="text-xs" style={{ color: COLORS.muted }}>No tracked files found</p>
                ) : (
                  stagedFiles.map(f => (
                    <div key={f} className="flex items-center gap-2">
                      <FileText size={11} style={{ color: COLORS.muted }} className="flex-shrink-0" />
                      <span className="text-xs font-mono" style={{ color: COLORS.muted }}>{f}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Error banner */}
            {phase === 'error' && error && (
              <div
                className="flex items-start gap-2.5 p-3 rounded-[8px]"
                style={{
                  background: 'rgba(248,81,73,0.08)',
                  border: '1px solid rgba(248,81,73,0.25)',
                }}
              >
                <AlertCircle size={14} style={{ color: COLORS.error }} className="mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold mb-0.5" style={{ color: COLORS.error }}>Push failed</p>
                  <p className="text-xs break-words leading-relaxed" style={{ color: COLORS.muted }}>{error}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Body: pushing / success ── */}
        {isActive && (
          <div className="p-6 flex flex-col gap-5">
            {/* Success icon */}
            {phase === 'success' && (
              <div className="flex justify-center">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center"
                  style={{
                    background: 'rgba(63,185,80,0.10)',
                    border: `1px solid rgba(63,185,80,0.25)`,
                  }}
                >
                  <CheckCircle2 size={24} style={{ color: COLORS.success }} />
                </div>
              </div>
            )}

            {/* Progress bar row */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium" style={{ color: COLORS.muted }}>
                  {phase === 'success' ? 'Complete' : 'Progress'}
                </span>
                <span
                  className="text-xs font-mono tabular-nums"
                  style={{ color: phase === 'success' ? COLORS.success : COLORS.accent }}
                >
                  {progress.percent}%
                </span>
              </div>
              <ProgressBar percent={progress.percent} color={barColor} />
            </div>

            {/* Step message */}
            <p
              className="text-sm text-center leading-relaxed"
              style={{ color: COLORS.muted }}
            >
              {progress.message || 'Starting…'}
            </p>

            {/* Countdown */}
            {phase === 'success' && (
              <p className="text-xs text-center" style={{ color: COLORS.muted }}>
                Closing in {countdown}s…
              </p>
            )}
          </div>
        )}

        {/* ── Footer ── */}
        <div
          className="flex items-center justify-end gap-3 px-5 py-4"
          style={{ borderTop: `1px solid ${COLORS.divider}` }}
        >
          {phase === 'idle' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-[8px] text-sm transition-colors"
                style={{ color: COLORS.muted }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                Cancel
              </button>
              <button
                onClick={handlePush}
                disabled={!commitMessage.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-[8px] text-white text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: COLORS.btnGreen }}
                onMouseEnter={e => { if (commitMessage.trim()) e.currentTarget.style.background = COLORS.btnGreenHover; }}
                onMouseLeave={e => (e.currentTarget.style.background = COLORS.btnGreen)}
              >
                <Upload size={14} />
                Push
              </button>
            </>
          )}

          {phase === 'pushing' && (
            <span className="px-4 py-2 text-sm" style={{ color: COLORS.muted }}>
              Pushing…
            </span>
          )}

          {phase === 'success' && (
            <button
              onClick={onSuccess}
              className="px-4 py-2 rounded-[8px] text-sm font-medium transition-colors"
              style={{ color: COLORS.success }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(63,185,80,0.08)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              Done
            </button>
          )}

          {phase === 'error' && (
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-[8px] text-sm transition-colors"
              style={{ color: COLORS.muted }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
