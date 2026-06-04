import React, { useEffect, useState } from 'react';
import { X, Upload, FileText, Loader2, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

export default function PushModal({ onClose, onSuccess }: Props) {
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [isPushing, setIsPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.electron.git.stagedFiles().then(r => { if (r.success && r.data) setFiles(r.data); });
  }, []);

  const handlePush = async () => {
    if (!message.trim()) { toast.error('Commit message required'); return; }
    setError(null);
    setIsPushing(true);
    const r = await window.electron.git.push({ message: message.trim() });
    setIsPushing(false);
    if (r.success) {
      toast.success('Changes pushed successfully');
      onSuccess();
    } else {
      setError(r.error || 'Push failed');
      toast.error(`Push failed: ${r.error}`);
    }
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-[480px] rounded-[12px] overflow-hidden shadow-2xl" style={{ background: '#323234' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <h2 className="text-white font-semibold text-base">Push Changes</h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors">
            <X size={15} className="text-[#A9A9AB]" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {/* Commit message */}
          <div>
            <label className="text-[#A9A9AB] text-xs font-medium mb-1.5 block">Commit message *</label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Describe what changed…"
              rows={3}
              className="w-full rounded-[8px] px-3 py-2.5 text-sm text-white resize-none focus:outline-none focus:ring-1 focus:ring-[#0890FE] transition-all"
              style={{ background: '#1E1E1E', border: '1px solid rgba(255,255,255,0.08)' }}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handlePush(); }}
            />
          </div>

          {/* Files to commit */}
          <div>
            <label className="text-[#A9A9AB] text-xs font-medium mb-1.5 block">Files to commit</label>
            <div
              className="rounded-[8px] p-3 flex flex-col gap-1.5 max-h-36 overflow-y-auto"
              style={{ background: '#1E1E1E', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              {files.length === 0 ? (
                <p className="text-[#A9A9AB] text-xs">No tracked files found</p>
              ) : (
                files.map(f => (
                  <div key={f} className="flex items-center gap-2">
                    <FileText size={12} className="text-[#A9A9AB] flex-shrink-0" />
                    <span className="text-[#A9A9AB] text-xs font-mono">{f}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Notice */}
          <p className="text-[#A9A9AB] text-xs">
            Local mod JARs are excluded — only manifests and config are committed.
          </p>

          {/* Error */}
          {error && (
            <div
              className="flex items-start gap-2 p-3 rounded-[8px]"
              style={{ background: 'rgba(226,71,41,0.1)', border: '1px solid rgba(226,71,41,0.3)' }}
            >
              <AlertCircle size={14} style={{ color: '#E24729' }} className="mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-[#E24729] text-xs font-medium mb-0.5">Push failed</p>
                <p className="text-[#A9A9AB] text-xs break-words">{error}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-white/[0.06]">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-[8px] text-[#A9A9AB] text-sm hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handlePush}
            disabled={isPushing || !message.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-[8px] text-white text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: '#0890FE' }}
            onMouseEnter={e => { if (!isPushing) e.currentTarget.style.background = '#1a9dff'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#0890FE'; }}
          >
            {isPushing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {isPushing ? 'Pushing…' : 'Push'}
          </button>
        </div>
      </div>
    </div>
  );
}
