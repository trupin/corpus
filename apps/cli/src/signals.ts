/**
 * Interrupt handling for the commands that block (`corpus queue idle` parks for
 * eight minutes). Ctrl-C during a park is normal operator behaviour rather than
 * a failure: the handler aborts the in-flight request and the command exits 0
 * with nothing on stdout, so a half-written JSON value can never reach the agent.
 *
 * The target is a parameter so tests never touch the real process's listener
 * table, and so every installation has a matching removal — a command that left
 * its handlers behind would leak one listener per invocation.
 */

export const INTERRUPT_SIGNALS = ["SIGINT", "SIGTERM"] as const;

export type InterruptSignal = (typeof INTERRUPT_SIGNALS)[number];

/** The slice of `process` this module uses; `process` itself satisfies it. */
export interface SignalTarget {
  on(signal: InterruptSignal, listener: () => void): unknown;
  off(signal: InterruptSignal, listener: () => void): unknown;
}

/**
 * Aborts `controller` on SIGINT/SIGTERM. Returns the disposer that removes the
 * handlers; it is idempotent, so a `finally` may call it after an early return
 * has already run it.
 */
export function abortOnInterrupt(
  controller: AbortController,
  target: SignalTarget = process,
): () => void {
  const listener = (): void => {
    controller.abort();
  };
  for (const signal of INTERRUPT_SIGNALS) target.on(signal, listener);

  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    for (const signal of INTERRUPT_SIGNALS) target.off(signal, listener);
  };
}

/**
 * `setTimeout` that resolves early when the signal aborts, so an interrupt
 * arriving inside a retry backoff is not made to wait the backoff out.
 */
export function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}
