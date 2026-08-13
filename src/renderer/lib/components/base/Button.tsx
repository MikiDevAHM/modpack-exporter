import React from 'react';
import { Loader2, type LucideIcon } from 'lucide-react';

export type ButtonVariant =
  | 'primary'
  | 'success'
  | 'danger'
  | 'warning'
  | 'soft'
  | 'soft-success'
  | 'soft-warning'
  | 'soft-danger'
  | 'ghost'
  | 'secondary';

export type ButtonSize = 'sm' | 'md';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows an inline spinner and disables the button. */
  loading?: boolean;
  icon?: LucideIcon;
  iconPlacement?: 'left' | 'right';
  fullWidth?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-accent hover:bg-primary-hover',
  success: 'bg-success-strong text-on-accent hover:opacity-90',
  danger: 'bg-danger-strong text-on-accent hover:opacity-90',
  warning: 'bg-warning text-on-accent hover:opacity-90',
  soft: 'text-primary border border-primary/35 hover:bg-primary/10',
  'soft-success': 'text-success border border-success/35 hover:bg-success/10',
  'soft-warning': 'text-warning border border-warning/35 hover:bg-warning/10',
  'soft-danger': 'text-danger border border-danger/35 hover:bg-danger/10',
  ghost: 'text-muted hover:bg-line/10 hover:text-foreground',
  secondary: 'bg-card text-foreground border border-line/8 hover:bg-line/10',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs gap-1.5',
  md: 'px-4 py-2 text-sm gap-2',
};

const BASE_CLASSES =
  'inline-flex items-center justify-center rounded-lg font-medium select-none whitespace-nowrap ' +
  'transition-colors disabled:opacity-50 disabled:cursor-not-allowed ' +
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon: Icon,
  iconPlacement = 'left',
  fullWidth = false,
  className = '',
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`${BASE_CLASSES} ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${
        fullWidth ? 'w-full' : ''
      } ${className}`}
      {...rest}
    >
      {loading ? (
        <Loader2 size={size === 'sm' ? 12 : 14} className="animate-spin" />
      ) : Icon && iconPlacement === 'left' ? (
        <Icon size={size === 'sm' ? 13 : 15} />
      ) : null}
      {children}
      {Icon && iconPlacement === 'right' && !loading ? (
        <Icon size={size === 'sm' ? 13 : 15} />
      ) : null}
    </button>
  );
}
