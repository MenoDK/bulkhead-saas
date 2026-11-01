import { useEffect, useRef, useState } from 'react';

/**
 * Keeps a loading screen up for at least `minimumMs`, even when the data arrives sooner.
 * A splash that flashes for 80 ms reads as a glitch; one that is on screen long enough to be seen reads as intent.
 * It never makes a slow load slower: once `loading` is false and the floor has passed, it hides immediately.
 */
export function useMinimumPresentation(loading: boolean, minimumMs = 900): boolean {
  const startedAt = useRef<number>(Date.now());
  const [floorPassed, setFloorPassed] = useState(minimumMs <= 0);

  useEffect(() => {
    if (floorPassed) return;
    const remaining = Math.max(0, minimumMs - (Date.now() - startedAt.current));
    const timer = setTimeout(() => setFloorPassed(true), remaining);
    return () => clearTimeout(timer);
  }, [floorPassed, minimumMs]);

  return loading || !floorPassed;
}
