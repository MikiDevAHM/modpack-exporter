import React from 'react';
import Badge, { type BadgeTone } from '../base/Badge';

interface SectionProps {
  /** Badge label + count (e.g. "Updated · 3"). */
  label: string;
  count: number;
  tone?: BadgeTone;
  children: React.ReactNode;
}

/** Labeled group of rows in a result list (pull/push/export summaries). */
export default function Section({ label, count, tone = 'neutral', children }: SectionProps) {
  if (count === 0) return null;
  return (
    <div className="flex flex-col gap-2.5">
      <Badge tone={tone}>
        {label} · {count}
      </Badge>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}
