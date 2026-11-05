const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const absolute = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "12 minutes ago", or "just now" under a minute. */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return 'Never';
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 'Unknown';
  const seconds = Math.round((at - now) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

/** "05/11/2026, 00:21" in the viewer's time zone. */
export function stamp(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 'Unknown';
  return absolute.format(at);
}

export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : 'none';
}

/** `in_progress` -> `In progress`. */
export function label(value: string): string {
  const spaced = value.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Slug rule the project service enforces: lowercase words joined by single hyphens. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
}
