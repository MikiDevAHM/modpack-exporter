import React, { useState } from 'react';

export type ModIconSize = 'sm' | 'md' | 'lg';

interface ModIconProps {
  iconUrl: string | null;
  name: string;
  size?: ModIconSize;
  /** Removed mods render dimmed. */
  dimmed?: boolean;
  className?: string;
}

const SIZE_CLASSES: Record<ModIconSize, string> = {
  sm: 'w-6 h-6 rounded-[4px] text-xs',
  md: 'w-7 h-7 rounded-[4px] text-sm',
  lg: 'w-10 h-10 rounded-md text-base',
};

/**
 * Mod thumbnail with a letter placeholder fallback.
 * Single implementation — used by ActivityFeed, PushModal and PullResultPopup.
 */
export default function ModIcon({ iconUrl, name, size = 'md', dimmed = false, className = '' }: ModIconProps) {
  const [failed, setFailed] = useState(false);
  const letter = (name || '?')[0].toUpperCase();

  if (!iconUrl || failed) {
    return (
      <div
        className={`flex items-center justify-center font-bold select-none flex-shrink-0 bg-subtle border border-line/12 text-muted ${SIZE_CLASSES[size]} ${dimmed ? 'opacity-60' : ''} ${className}`}
        aria-hidden="true"
      >
        {letter}
      </div>
    );
  }
  return (
    <img
      src={iconUrl}
      loading="lazy"
      alt={name}
      onError={() => setFailed(true)}
      className={`flex-shrink-0 object-cover ${SIZE_CLASSES[size]} ${dimmed ? 'opacity-60' : ''} ${className}`}
    />
  );
}
