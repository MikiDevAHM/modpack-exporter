import React, { useEffect, useRef, useState } from 'react';
import ModIcon, { type ModIconSize } from './ModIcon';
import { ensureModIcon, getCachedModIcon } from '../../utils/modIcons';

interface Props {
  slug: string;
  name: string;
  size?: ModIconSize;
  /** Removed mods render dimmed. */
  dimmed?: boolean;
  className?: string;
}

/**
 * Lazy mod icon — defers the Modrinth icon lookup until the element approaches
 * the viewport (IntersectionObserver), so long commit feeds don't fire a burst
 * of IPC requests up front. Resolved URLs are cached per session by
 * utils/modIcons; renders the ModIcon letter placeholder while pending.
 */
export default function ModIconLazy({ slug, name, size = 'md', dimmed = false, className = '' }: Props) {
  const [iconUrl, setIconUrl] = useState<string | null | undefined>(() => getCachedModIcon(slug));
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    // Already resolved (or known missing) this session — nothing to do.
    if (iconUrl !== undefined) return;
    const el = ref.current;
    if (!el) return;
    let disposed = false;

    const io = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          io.disconnect();
          void ensureModIcon(slug).then(url => {
            if (!disposed) setIconUrl(url);
          });
        }
      },
      { rootMargin: '200px' }
    );
    io.observe(el);

    return () => {
      disposed = true;
      io.disconnect();
    };
  }, [slug, iconUrl]);

  return (
    <span ref={ref} className="inline-flex flex-shrink-0">
      <ModIcon iconUrl={iconUrl ?? null} name={name} size={size} dimmed={dimmed} className={className} />
    </span>
  );
}
