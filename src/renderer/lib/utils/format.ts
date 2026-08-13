/** Shared formatting helpers — deduplicates timeAgo, formatSize, bumpPatch, pluralize. */

export function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (isNaN(seconds) || seconds < 0) return 'just now';
  const intervals: [number, string][] = [
    [31536000, 'year'],
    [2592000, 'month'],
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
  ];
  for (const [secs, unit] of intervals) {
    const value = Math.floor(seconds / secs);
    if (value >= 1) return `${value} ${unit}${value !== 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/** Bumps the patch component of a semver string (strips pre-release suffixes). */
export function bumpPatch(version: string): string {
  const parts = version.replace(/-.*$/, '').split('.');
  if (parts.length >= 3) {
    parts[2] = String(Number(parts[2]) + 1);
    return parts.join('.');
  }
  return version;
}

export function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Full timestamp for list rows, e.g. "Jan 5, 2026, 14:32". */
export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
