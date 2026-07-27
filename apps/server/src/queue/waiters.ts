/**
 * The long-poll parking lot (CLAUDE.md Architecture Decision 4). `corpus queue
 * idle` costs the agent zero tokens because it is blocked on a response, not
 * looping — which makes *waking it* this module's only job.
 */

/** How often a parked waiter re-checks the filesystem. */
export const DEFAULT_POLL_INTERVAL_MS = 500;

export interface WaiterRegistryOptions {
  /**
   * Answers "is there work now?". Called on every poll tick while at least one
   * request is parked, **in addition** to the in-process {@link WaiterRegistry.notify}
   * that `enqueue` fires. The poll is permanent, not a stand-in: SPEC.md §7 says
   * an event *is* a file in `.corpus/queue/pending/`, so a file dropped there by
   * a hand, an editor, or a future direct-write path must wake a parked agent
   * exactly like an in-process enqueue does (sprint-003 adjudication 2).
   */
  readonly probe: () => Promise<boolean>;
  readonly pollIntervalMs?: number;
  /** A failing probe must not kill the interval; the next tick tries again. */
  readonly onProbeError?: (error: unknown) => void;
}

type Settle = (woke: boolean) => void;

export class WaiterRegistry {
  private readonly waiters = new Set<Settle>();
  private readonly probe: () => Promise<boolean>;
  private readonly pollIntervalMs: number;
  private readonly onProbeError: (error: unknown) => void;
  private timer: NodeJS.Timeout | undefined;
  private probing = false;
  private closed = false;

  constructor(options: WaiterRegistryOptions) {
    this.probe = options.probe;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.onProbeError = options.onProbeError ?? (() => undefined);
  }

  /** Parked requests right now. Zero means no timer is running. */
  get size(): number {
    return this.waiters.size;
  }

  /**
   * Parks until work arrives (`true`), the window expires, the client
   * disconnects, or the server shuts down (all `false`). Every exit path removes
   * the waiter and its timer — a dropped client leaves nothing behind.
   */
  async wait(timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
    if (this.closed || signal?.aborted === true || timeoutMs <= 0) return false;

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle: Settle = (woke) => {
        if (settled) return;
        settled = true;
        this.waiters.delete(settle);
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.stopPollingWhenIdle();
        resolve(woke);
      };

      const timer = setTimeout(() => {
        settle(false);
      }, timeoutMs);
      // A parked request must never be the reason the process stays alive.
      timer.unref();

      const onAbort = (): void => {
        settle(false);
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      this.waiters.add(settle);
      this.startPolling();
    });
  }

  /** Work is available: release everyone parked. */
  notify(): void {
    for (const settle of [...this.waiters]) settle(true);
  }

  /** Shutdown: release everyone as "expired" and stop the timer. */
  close(): void {
    this.closed = true;
    for (const settle of [...this.waiters]) settle(false);
    this.stopPollingWhenIdle();
  }

  private startPolling(): void {
    if (this.timer !== undefined || this.waiters.size === 0) return;
    this.timer = setInterval(() => {
      this.tick();
    }, this.pollIntervalMs);
    this.timer.unref();
  }

  private stopPollingWhenIdle(): void {
    if (this.timer === undefined || this.waiters.size > 0) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private tick(): void {
    if (this.probing || this.waiters.size === 0) {
      this.stopPollingWhenIdle();
      return;
    }
    this.probing = true;
    this.probe()
      .then((available) => {
        if (available) this.notify();
      })
      .catch((error: unknown) => {
        this.onProbeError(error);
      })
      .finally(() => {
        this.probing = false;
      });
  }
}
