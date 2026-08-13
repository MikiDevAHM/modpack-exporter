import React from 'react';

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: React.ReactNode;
}

export default function Textarea({ label, className = '', id, ...rest }: TextareaProps) {
  const inputId = id ?? (label ? `textarea-${label.toString().replace(/\s+/g, '-').toLowerCase()}` : undefined);
  return (
    <div className="flex flex-col gap-0">
      {label && (
        <label htmlFor={inputId} className="block text-xs font-medium mb-1.5 text-muted">
          {label}
        </label>
      )}
      <textarea
        id={inputId}
        className={`w-full rounded-lg px-3 py-2.5 text-sm resize-none bg-subtle border border-line/8 text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-ring transition-all ${className}`}
        {...rest}
      />
    </div>
  );
}
