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
 * Runs `handler` **once**, on the first SIGINT/SIGTERM, and de-registers every
 * listener before doing so. Returns the same idempotent disposer as above.
 *
 * The one-shot part is the point (CLI-030). `corpus upgrade` holds a window it
 * cannot leave cleanly — the server is stopped and npm is rewriting the global
 * package — and an interrupt there has to be turned into the ordinary failure
 * path rather than into a dead process, or the board never comes back. But a
 * command that swallowed *every* interrupt would be a tool an operator cannot
 * get out of. Removing the listeners as the first signal fires restores Node's
 * default disposition, so the second Ctrl-C terminates the process outright:
 * the tool gets one chance to tidy up, and the operator always has the last
 * word.
 */
export function onInterrupt(
  handler: (signal: InterruptSignal) => void,
  target: SignalTarget = process,
): () => void {
  const listeners = new Map<InterruptSignal, () => void>();

  let done = false;
  const dispose = (): void => {
    if (done) return;
    done = true;
    for (const [signal, listener] of listeners) target.off(signal, listener);
  };

  for (const signal of INTERRUPT_SIGNALS) {
    const listener = (): void => {
      if (done) return;
      dispose();
      handler(signal);
    };
    listeners.set(signal, listener);
    target.on(signal, listener);
  }
  return dispose;
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
