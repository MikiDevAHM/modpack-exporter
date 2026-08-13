import React from 'react';
import { type LucideIcon } from 'lucide-react';

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name for the icon-only button. */
  label: string;
  icon: LucideIcon;
  iconSize?: number;
  variant?: 'ghost' | 'secondary';
  sizeClass?: string;
}

const VARIANT_CLASSES = {
  ghost: 'text-muted hover:bg-line/10',
  secondary: 'bg-card text-muted border border-line/8 hover:bg-line/10',
} as const;

export default function IconButton({
  label,
  icon: Icon,
  iconSize = 15,
  variant = 'ghost',
  sizeClass = 'w-7 h-7',
  className = '',
  disabled,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${sizeClass} ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    >
      <Icon size={iconSize} />
    </button>
  );
}
