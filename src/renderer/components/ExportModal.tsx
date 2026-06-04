import React, { useState } from 'react';
import { X, Package, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import type { AppConfig, ExportResult } from '../types';

interface Props {
  config: AppConfig;
  onClose: () => void;
  onSuccess: () => void;
}

type Variant = 'standard' | 'lite';
type ReleaseType = 'dev' | 'test' | 'release';

function bumpPatch(version: string): string {
  const parts = version.replace(/-.*$/, '').split('.');
  if (parts.length >= 3) {
    parts[2] = String(Number(parts[2]) + 1);
    return parts.join('.');
  }
  return version;
}

export default function ExportModal({ config, onClose, onSuccess }: Props) {
  const [version, setVersion] = useState(bumpPatch(config.version));
  const [variant, setVariant] = useState<Variant>('standard');
  const [releaseType, setReleaseType] = useState<ReleaseType>('dev');
  const [isExporting, setIsExporting] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);

  const packName = variant === 'lite' ? config.lite_pack_name : config.pack_name;
  const versionSuffix = releaseType !== 'release' ? `-${releaseType}` : '';
  const finalVersion = `${version}${versionSuffix}`;

  const handleExport = async () => {
    setIsExporting(true);
    const r = await window.electron.export.run({
      version: finalVersion,
      isLite: variant === 'lite',
      isRelease: releaseType === 'release',
      packName,
    });
    setIsExporting(false);
    setResult(r);
    if (r.success) {
      toast.success(`Exported ${packName} ${finalVersion}`);
    } else {
      toast.error(`Export failed: ${r.error}`);
    }
  };

  const btnBase = 'px-3 py-1.5 rounded-[8px] text-xs font-medium transition-all border';

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={e => { if (e.target === e.currentTarget && !isExporting) onClose(); }}
    >
      <div className="w-[440px] rounded-[12px] overflow-hidden shadow-2xl" style={{ background: '#323234' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <h2 className="text-white font-semibold text-base">Export New Version</h2>
          <button onClick={onClose} disabled={isExporting} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50">
            <X size={15} className="text-[#A9A9AB]" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {/* Version */}
          <div>
            <label className="text-[#A9A9AB] text-xs font-medium mb-1.5 block">Version</label>
            <input
              value={version}
              onChange={e => setVersion(e.target.value)}
              className="w-full rounded-[8px] px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:ring-1 focus:ring-[#0890FE] transition-all"
              style={{ background: '#1E1E1E', border: '1px solid rgba(255,255,255,0.08)' }}
              disabled={isExporting}
            />
          </div>

          {/* Variant */}
          <div>
            <label className="text-[#A9A9AB] text-xs font-medium mb-1.5 block">Variant</label>
            <div className="flex gap-2">
              {(['standard', 'lite'] as Variant[]).map(v => (
                <button
                  key={v}
                  onClick={() => setVariant(v)}
                  disabled={isExporting}
                  className={`${btnBase} ${variant === v
                    ? 'bg-[#0890FE]/20 border-[#0890FE] text-[#0890FE]'
                    : 'bg-transparent border-white/10 text-[#A9A9AB] hover:border-white/20'
                  } capitalize`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Release type */}
          <div>
            <label className="text-[#A9A9AB] text-xs font-medium mb-1.5 block">Release type</label>
            <div className="flex gap-2">
              {(['dev', 'test', 'release'] as ReleaseType[]).map(t => {
                const active = releaseType === t;
                const colors: Record<ReleaseType, string> = { dev: '#A9A9AB', test: '#FFA809', release: '#20AC64' };
                return (
                  <button
                    key={t}
                    onClick={() => setReleaseType(t)}
                    disabled={isExporting}
                    className={`${btnBase} capitalize ${active ? 'bg-white/10' : 'bg-transparent hover:bg-white/5'}`}
                    style={{
                      borderColor: active ? colors[t] : 'rgba(255,255,255,0.1)',
                      color: active ? colors[t] : '#A9A9AB',
                    }}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Preview */}
          <div
            className="rounded-[8px] px-3 py-2.5 flex items-center gap-2"
            style={{ background: '#1E1E1E', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            <Package size={14} className="text-[#A9A9AB] flex-shrink-0" />
            <span className="text-white text-xs font-mono">{packName} {finalVersion}.mrpack</span>
          </div>

          {/* Success */}
          {result?.success && (
            <div className="flex items-start gap-2 p-3 rounded-[8px]" style={{ background: 'rgba(32,172,100,0.1)', border: '1px solid rgba(32,172,100,0.3)' }}>
              <CheckCircle size={14} className="text-[#20AC64] mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-[#20AC64] text-xs font-medium">Export complete</p>
                {result.stats && (
                  <p className="text-[#A9A9AB] text-xs mt-0.5">{result.stats.resolved} resolved, {result.stats.embedded} embedded</p>
                )}
              </div>
            </div>
          )}

          {/* Error */}
          {result && !result.success && (
            <div
              className="flex items-start gap-2 p-3 rounded-[8px]"
              style={{ background: 'rgba(226,71,41,0.1)', border: '1px solid rgba(226,71,41,0.3)' }}
            >
              <AlertCircle size={14} style={{ color: '#E24729' }} className="mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-[#E24729] text-xs font-medium mb-0.5">Export failed</p>
                <p className="text-[#A9A9AB] text-xs break-words">{result.error || 'Unknown error'}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-white/[0.06]">
          <button onClick={onClose} disabled={isExporting} className="px-4 py-2 rounded-[8px] text-[#A9A9AB] text-sm hover:bg-white/10 transition-colors disabled:opacity-50">
            {result?.success ? 'Close' : 'Cancel'}
          </button>
          {!result?.success && (
            <button
              onClick={handleExport}
              disabled={isExporting || !version.trim()}
              className="flex items-center gap-2 px-4 py-2 rounded-[8px] text-white text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: '#0890FE' }}
              onMouseEnter={e => { if (!isExporting) e.currentTarget.style.background = '#1a9dff'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#0890FE'; }}
            >
              {isExporting ? <Loader2 size={14} className="animate-spin" /> : <Package size={14} />}
              {isExporting ? 'Exporting…' : 'Export'}
            </button>
          )}
          {result?.success && (
            <button
              onClick={onSuccess}
              className="px-4 py-2 rounded-[8px] text-white text-sm font-medium"
              style={{ background: '#20AC64' }}
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
