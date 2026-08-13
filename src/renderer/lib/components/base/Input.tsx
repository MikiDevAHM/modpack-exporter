import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
  hint?: React.ReactNode;
}

export const FIELD_CLASSES =
  'w-full rounded-lg px-3 py-2.5 text-sm bg-subtle border border-line/8 text-foreground ' +
  'placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-ring transition-all';

export const LABEL_CLASSES = 'block text-xs font-medium mb-1.5 text-muted';

export default function Input({ label, hint, className = '', id, ...rest }: InputProps) {
  const inputId = id ?? (label ? `input-${label.toString().replace(/\s+/g, '-').toLowerCase()}` : undefined);
  return (
    <div className="flex flex-col gap-0">
      {label && (
        <label htmlFor={inputId} className={LABEL_CLASSES}>
          {label}
        </label>
      )}
      <input id={inputId} className={`${FIELD_CLASSES} ${className}`} {...rest} />
      {hint && <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}
