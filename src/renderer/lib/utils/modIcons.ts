/**
 * Renderer-side mod icon cache.
 *
 * The main process persists mod icons on disk (`<userData>/cache/mod-icons/`)
 * and returns them as data URLs over IPC. This module adds an in-memory layer
 * so each slug is resolved at most once per session — re-rendering the same
 * mod across the activity feed, push previews, or pull popups never re-hits
 * the IPC/disk path. Concurrent requests for the same slug share one call.
 */

const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

/**
 * Session-cached icon data URL for a slug.
 * `undefined` = not resolved yet, `null` = known to have no icon.
 */
export function getCachedModIcon(slug: string): string | null | undefined {
  return cache.get(slug);
}

/** Resolve a slug's icon once per session, deduplicating in-flight requests. */
export function ensureModIcon(slug: string): Promise<string | null> {
  if (cache.has(slug)) return Promise.resolve(cache.get(slug)!);
  const pending = inflight.get(slug);
  if (pending) return pending;

  const task = window.electron.modrinth
    .getIcons([slug])
    .then(res => {
      const url = res[slug] ?? null;
      cache.set(slug, url);
      return url;
    })
    .catch(() => {
      cache.set(slug, null);
      return null;
    })
    .finally(() => {
      inflight.delete(slug);
    });

  inflight.set(slug, task);
  return task;
}
