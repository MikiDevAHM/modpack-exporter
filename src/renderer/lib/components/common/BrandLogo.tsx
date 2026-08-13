import React from 'react';
import { Package, type LucideIcon } from 'lucide-react';

interface BrandLogoProps {
  /** Size class for the tile (e.g. "w-9 h-9"). */
  sizeClass?: string;
  /** Icon rendered inside the gradient tile (defaults to Package). */
  icon?: LucideIcon;
  /** Icon size in px (defaults to 15 for a 36px tile). */
  iconSize?: number;
  /** Rounded corners class (defaults to rounded-xl). */
  roundedClass?: string;
}

/** ORB brand tile — the triplicated logo gradient, defined once. */
export default function BrandLogo({
  sizeClass = 'w-9 h-9',
  icon: Icon = Package,
  iconSize = 15,
  roundedClass = 'rounded-xl',
}: BrandLogoProps) {
  return (
    <div
      className={`flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-brand to-brand-end ${sizeClass} ${roundedClass}`}
    >
      <Icon size={iconSize} className="text-on-accent" />
    </div>
  );
}
