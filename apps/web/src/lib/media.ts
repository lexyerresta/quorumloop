import { useSyncExternalStore } from 'react';

/** Tracks a CSS media query. Matches the 640px phone breakpoint in styles.css by default. */
export function useMediaQuery(query = '(max-width: 640px)'): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
