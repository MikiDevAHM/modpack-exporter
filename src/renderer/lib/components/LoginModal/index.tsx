import React, { useEffect, useRef, useState } from 'react';
import { Copy, ExternalLink, Github, Loader2, Check, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import type { DeviceCodeInfo } from '../../types';
import Modal, { ModalHeader } from '../base/Modal';
import Button from '../base/Button';

interface Props {
  /** Closes the modal. If the device flow is still pending, this also aborts it. */
  onClose: () => void;
  /** Called after the device flow succeeds and the token is stored. */
  onSuccess: () => void;
}

type Status = 'requesting' | 'waiting' | 'success' | 'error';

export default function LoginModal({ onClose, onSuccess }: Props) {
  const [status, setStatus] = useState<Status>('requesting');
  const [codeInfo, setCodeInfo] = useState<DeviceCodeInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  // Track unmount so async resolves don't update state
  const cancelledRef = useRef(false);

  // ── Start the device flow on mount ─────────────────────────────────────────
  useEffect(() => {
    cancelledRef.current = false;

    window.electron.auth.onDeviceCode(info => {
      if (cancelledRef.current) return;
      setCodeInfo(info);
      setStatus('waiting');
      setSecondsLeft(info.expires_in);
      // Auto-open the verification page in the default browser
      window.electron.app.openExternal(info.verification_uri).catch(() => {});
    });

    window.electron.auth
      .start()
      .then(result => {
        if (cancelledRef.current) return;
        if (result.success) {
          setStatus('success');
          // Brief success state, then notify parent
          setTimeout(() => {
            if (!cancelledRef.current) onSuccess();
          }, 800);
        } else {
          setStatus('error');
          setError(result.error || 'Authentication failed');
        }
      })
      .catch(e => {
        if (cancelledRef.current) return;
        setStatus('error');
        setError(e?.message || String(e));
      });

    return () => {
      cancelledRef.current = true;
      window.electron.auth.offDeviceCode();
    };
  }, [onSuccess]);

  // ── Countdown ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (secondsLeft === null || status !== 'waiting') return;
    if (secondsLeft <= 0) return;
    const t = setInterval(() => setSecondsLeft(s => (s !== null && s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [secondsLeft, status]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleCancel = async () => {
    cancelledRef.current = true;
    await window.electron.auth.logout().catch(() => {});
    onClose();
  };

  const handleCopy = async () => {
    if (!codeInfo) return;
    try {
      await navigator.clipboard.writeText(codeInfo.user_code);
      toast.success('Code copied to clipboard');
    } catch {
      toast.error('Could not copy code');
    }
  };

  const handleOpenBrowser = () => {
    if (!codeInfo) return;
    window.electron.app.openExternal(codeInfo.verification_uri).catch(() => {});
  };

  const formatExpiry = (s: number) => {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, '0')}`;
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Modal open onClose={handleCancel} dismissible={false} widthClass="w-[440px]">
      <ModalHeader onClose={handleCancel} locked={status === 'success'}>
        <div className="flex items-center gap-2">
          <Github size={16} className="text-foreground" />
          <h2 className="text-foreground font-semibold text-base">Sign in to GitHub</h2>
        </div>
      </ModalHeader>

      {/* Body */}
      <div className="p-6">
        {status === 'requesting' && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 size={28} className="animate-spin text-muted" />
            <p className="text-muted text-sm">Requesting device code…</p>
          </div>
        )}

        {status === 'waiting' && codeInfo && (
          <>
            <p className="text-muted text-sm mb-5 leading-relaxed">
              Enter the code below at{' '}
              <button
                onClick={handleOpenBrowser}
                className="inline-flex items-center gap-0.5 hover:underline text-primary"
              >
                {codeInfo.verification_uri.replace(/^https?:\/\//, '')}
                <ExternalLink size={11} />
              </button>{' '}
              to authorize this app.
            </p>

            {/* User code */}
            <div className="rounded-xl p-5 flex flex-col items-center gap-3 mb-5 bg-subtle border border-line/8">
              <span
                className="font-mono font-bold text-foreground tracking-[0.3em] select-text"
                style={{ fontSize: 32, lineHeight: 1.1 }}
              >
                {codeInfo.user_code}
              </span>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted border border-line/8 hover:bg-line/10 transition-colors"
              >
                <Copy size={12} />
                Copy code
              </button>
            </div>

            {/* Status row */}
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-muted">
                <Loader2 size={12} className="animate-spin" />
                Waiting for approval…
              </div>
              {secondsLeft !== null && secondsLeft > 0 && (
                <span className="text-muted font-mono">{formatExpiry(secondsLeft)}</span>
              )}
            </div>
          </>
        )}

        {status === 'success' && (
          <div className="flex flex-col items-center gap-3 py-8">
            <div className="w-12 h-12 rounded-full flex items-center justify-center bg-success/15">
              <Check size={24} className="text-success" />
            </div>
            <p className="text-foreground text-sm font-medium">Signed in successfully</p>
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="w-12 h-12 rounded-full flex items-center justify-center bg-brand/15">
              <AlertCircle size={24} className="text-brand" />
            </div>
            <p className="text-foreground text-sm font-medium">Sign-in failed</p>
            {error && <p className="text-muted text-xs max-w-[320px]">{error}</p>}
            <Button variant="primary" className="mt-2" onClick={onClose}>
              Close
            </Button>
          </div>
        )}
      </div>

      {/* Footer with cancel during wait */}
      {status === 'waiting' && (
        <div className="flex items-center justify-between px-5 py-4 border-t border-line/6 flex-shrink-0">
          <button
            onClick={handleOpenBrowser}
            className="flex items-center gap-1.5 text-xs font-medium hover:underline text-primary"
          >
            Open browser <ExternalLink size={11} />
          </button>
          <Button variant="ghost" size="sm" onClick={handleCancel}>
            Cancel
          </Button>
        </div>
      )}
    </Modal>
  );
}
