import React from 'react';
import { Download, AlertTriangle, RotateCw, Package, Loader2 } from 'lucide-react';
import Button from '../base/Button';
import BrandLogo from '../common/BrandLogo';

export type InitState = 'cloning' | 'pulling' | 'error';

export interface InitProgress {
  stage: string;
  message: string;
  percent: number;
}

interface Props {
  /** Current phase of first-run initialization. */
  state: InitState;
  /** Latest progress event from the pull (null while cloning / before first event). */
  progress: InitProgress | null;
  /** Error message when `state === 'error'`. */
  error: string | null;
  /** Retry the whole initialization (clone + pull) from the top. */
  onRetry: () => void;
}

/**
 * Full-height panel shown in the dashboard body during first-run setup while the
 * versions repo is cloned and the initial modpack pull downloads every mod +
 * override. Replaces the empty ActivityFeed/Sidebar so the user is never left
 * staring at a blank dashboard with no mods.
 */
export default function InitialSetupScreen({ state, progress, error, onRetry }: Props) {
  // ── Error state ────────────────────────────────────────────────────────────
  if (state === 'error') {
    return (
      <div className="flex flex-1 items-center justify-center overflow-hidden px-6">
        <div className="w-full max-w-[440px] rounded-xl p-7 flex flex-col items-center text-center shadow-2xl bg-card border border-danger/25">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 bg-danger/10">
            <AlertTriangle size={22} className="text-danger" />
          </div>
          <h2 className="text-foreground font-semibold text-[17px] mb-1.5">Setup couldn’t finish</h2>
          <p className="text-muted text-sm leading-relaxed mb-1">
            We couldn’t download the modpack. Your files were not changed — you can safely retry.
          </p>
          {error && (
            <p className="text-xs font-mono mt-2 mb-4 px-3 py-2 rounded-lg w-full break-words bg-subtle text-danger/90 border border-danger/20">
              {error}
            </p>
          )}
          <Button variant="primary" icon={RotateCw} className="mt-2" onClick={onRetry}>
            Retry setup
          </Button>
        </div>
      </div>
    );
  }

  // ── Cloning / pulling state ────────────────────────────────────────────────
  const isCloning = state === 'cloning';

  // While cloning we have no percentage — show an indeterminate bar. During the
  // pull we track the real percent reported by the sync:progress events.
  const percent = isCloning ? null : Math.max(0, Math.min(100, progress?.percent ?? 0));

  const heading = isCloning ? 'Setting things up…' : 'Downloading modpack…';
  const subtext = isCloning
    ? 'Connecting to the versions repository.'
    : 'This may take a few minutes on first setup — grabbing every mod and override for your profile.';
  const detail = isCloning
    ? 'Preparing versions repository'
    : progress?.message || 'Starting download…';

  return (
    <div className="flex flex-1 items-center justify-center overflow-hidden px-6">
      <div className="w-full max-w-[460px] rounded-xl p-8 flex flex-col items-center text-center shadow-2xl bg-card border border-line/8">
        {/* Icon badge */}
        <div className="mb-5">
          <BrandLogo
            sizeClass="w-14 h-14 rounded-[14px]"
            icon={isCloning ? Package : Download}
            iconSize={24}
          />
        </div>

        <h2 className="text-foreground font-semibold text-[18px] mb-2">{heading}</h2>
        <p className="text-muted text-sm leading-relaxed mb-6 max-w-[360px]">{subtext}</p>

        {/* Progress bar */}
        <div className="w-full h-2 rounded-full overflow-hidden mb-3 relative bg-subtle">
          {percent === null ? (
            // Indeterminate sweep while cloning
            <div className="absolute top-0 bottom-0 w-1/3 rounded-full initial-setup-indeterminate bg-gradient-to-r from-brand to-brand-end" />
          ) : (
            <div
              className="h-full rounded-full transition-[width] duration-300 ease-out bg-gradient-to-r from-brand to-brand-end"
              style={{ width: `${percent}%` }}
            />
          )}
        </div>

        {/* Live detail line */}
        <div className="flex items-center gap-2 text-xs text-muted min-h-[18px] w-full justify-center">
          <Loader2 size={12} className="animate-spin flex-shrink-0" />
          <span className="truncate" title={detail}>{detail}</span>
          {percent !== null && <span className="tabular-nums flex-shrink-0">· {percent}%</span>}
        </div>
      </div>
    </div>
  );
}
