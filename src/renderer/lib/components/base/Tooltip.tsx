import React from 'react';

interface TooltipProps {
  label: string;
  children: React.ReactNode;
  side?: 'top' | 'bottom';
}

/** Hover label — replaces ad-hoc `title` attributes in the shell chrome. */
export default function Tooltip({ label, children, side = 'bottom' }: TooltipProps) {
  const position =
    side === 'top'
      ? 'bottom-full mb-1.5'
      : 'top-full mt-1.5';
  return (
    <span className="relative inline-flex group/tooltip">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute left-1/2 -translate-x-1/2 z-50 px-2 py-1 rounded-md text-[11px] font-medium whitespace-nowrap bg-subtle border border-line-strong text-foreground opacity-0 group-hover/tooltip:opacity-100 transition-opacity ${position}`}
      >
        {label}
      </span>
    </span>
  );
}
