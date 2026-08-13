import React from 'react';

interface ProgressBarProps {
  /** 0–100. Clamped. */
  percent: number;
  /** Fill color (any CSS color; defaults to the primary token). */
  color?: string;
  heightClass?: string;
}

/** Determinate progress bar — push/export/initial-setup progress. */
export default function ProgressBar({
  percent,
  color = 'rgb(var(--color-primary))',
  heightClass = 'h-1.5',
}: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div className={`w-full rounded-full overflow-hidden bg-line/15 ${heightClass}`}>
      <div
        className="h-full rounded-full transition-[width] duration-300 ease-out"
        style={{ width: `${clamped}%`, background: color }}
      />
    </div>
  );
}
