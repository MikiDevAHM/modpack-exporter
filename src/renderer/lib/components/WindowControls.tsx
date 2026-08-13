import React from 'react';
import { Minus, X } from 'lucide-react';

/**
 * Platform-aware window control buttons.
 * macOS: traffic-light circles (left). Windows/Linux: minimize + close icons.
 * Drag region is handled by the parent — buttons are explicitly `no-drag`.
 */
const MAC_TRAFFIC_LIGHT_COLORS = {
  close: '#E24729',
  minimize: '#FFBD2E',
  zoom: '#28C840',
};

export default function WindowControls() {
  const isMac = window.electron.platform === 'darwin';

  if (isMac) {
    return (
      <div className="flex items-center gap-1 pl-2 pr-3 no-drag">
        <button
          onClick={() => window.electron.app.close()}
          className="w-3.5 h-3.5 rounded-full flex items-center justify-center hover:brightness-75 transition-all"
          style={{ background: MAC_TRAFFIC_LIGHT_COLORS.close }}
          aria-label="Close"
          title="Close"
        />
        <button
          onClick={() => window.electron.app.minimize()}
          className="w-3.5 h-3.5 rounded-full flex items-center justify-center hover:brightness-75 transition-all"
          style={{ background: MAC_TRAFFIC_LIGHT_COLORS.minimize }}
          aria-label="Minimize"
          title="Minimize"
        />
        <div
          className="w-3.5 h-3.5 rounded-full"
          style={{ background: MAC_TRAFFIC_LIGHT_COLORS.zoom }}
          aria-hidden="true"
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-0.5 no-drag">
      <button
        onClick={() => window.electron.app.minimize()}
        className="w-8 h-8 flex items-center justify-center rounded hover:bg-line/10 transition-colors"
        aria-label="Minimize"
      >
        <Minus size={13} className="text-muted" />
      </button>
      <button
        onClick={() => window.electron.app.close()}
        className="w-8 h-8 flex items-center justify-center rounded hover:bg-brand transition-colors"
        aria-label="Close"
      >
        <X size={13} className="text-muted" />
      </button>
    </div>
  );
}
