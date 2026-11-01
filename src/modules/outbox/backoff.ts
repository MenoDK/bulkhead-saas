/**
 * Exponential backoff with jitter. `attempt` is the number of attempts already made (>= 1).
 * Jitter spreads retries so that a recovering endpoint is not hit by every failed event at once.
 */
export function nextDelayMs(
  attempt: number,
  random: () => number = Math.random,
  baseMs = 2_000,
  capMs = 15 * 60_000,
): number {
  const exponential = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  const jitter = 0.8 + random() * 0.4; // +-20 %
  return Math.round(exponential * jitter);
}
