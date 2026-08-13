import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** subtle = inset surface (inputs/preview panels), card = raised surface. */
  variant?: 'card' | 'subtle';
}

export default function Card({ variant = 'card', className = '', ...rest }: CardProps) {
  const variantClass =
    variant === 'subtle'
      ? 'bg-subtle border border-line/8'
      : 'bg-card border border-line/8';
  return <div className={`${variantClass} rounded-lg ${className}`} {...rest} />;
}
