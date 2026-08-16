/**
 * The long-poll parking lot (CLAUDE.md Architecture Decision 4). `corpus queue
 * idle` costs the agent zero tokens because it is blocked on a response, not
 * looping — which makes *waking it* this module's only job.
 *
 * **Parking is per lane** since SERVER-111 (SPEC.md §7). Every waiter registers
 * under the lane its request asked to consume, and both ways of waking one — the
 * in-process {@link WaiterRegistry.notify} an enqueue fires, and the poll tick —
 * are asked *which* lanes are concerned rather than releasing everyone.
 *
 * A waiter woken for a lane it cannot see costs no agent anything: `idle`'s loop
 * re-reads its own lane, finds nothing, and parks again without the HTTP request
 * returning. What it costs is a scan of `pending/` per parked lane per message,
 * which on a busy orchestrator lane is paid by every resident in the workspace.
 * The correctness that the targeting *does* carry is the other direction: a lane
 * whose work has arrived must be among those woken, which is why the predicate
 * the service passes is the same one its claim filters with.
 *
 * The registry deliberately knows nothing about what a lane *is* or which lanes
 * see which events. Both questions are `queue/lanes.ts`'s, and both arrive here
 * as a predicate over the parked scope.
 */

import type { Lane } from "@corpus/contract";

/** How often a parked waiter re-checks the filesystem. */
export const DEFAULT_POLL_INTERVAL_MS = 500;

export interface WaiterRegistryOptions {
  /**
   * Answers "is there work for this scope now?". Called once per **distinct
   * parked lane** on every poll tick, **in addition** to the in-process
   * {@link WaiterRegistry.notify} that `enqueue` fires. The poll is permanent,
   * not a stand-in: SPEC.md §7 says an event *is* a file in
   * `.corpus/queue/pending/`, so a file dropped there by a hand, an editor, or a
   * future direct-write path must wake a parked agent exactly like an in-process
   * enqueue does (sprint-003 adjudication 2).
   *
   * It takes the scope because the answer differs by lane — that is the whole
   * point of the partition — and because a tick that probed "is there any work
   * at all" would wake every parked agent for one lane's event.
   */
  readonly probe: (scope: Lane) => Promise<boolean>;
  readonly pollIntervalMs?: number;
  /** A failing probe must not kill the interval; the next tick tries again. */
  readonly onProbeError?: (error: unknown) => void;
}

type Settle = (woke: boolean) => void;

/**
 * Which parked scopes a wake-up concerns.
 *
 * Always a predicate over the *parked* scope rather than a lane to match
 * against, because the relation is not equality: the orchestrator's parked
 * `idle` is woken by an event on a lapsed thread lane, since that is an event
 * its next claim would hand over. `queue/lanes.ts`'s `visibleTo` is what the
 * service passes in.
 */
export type Reaches = (scope: Lane) => boolean;

export class WaiterRegistry {
  /** Value is the lane the parked request asked to consume. */
  private readonly waiters = new Map<Settle, Lane>();
  private readonly probe: (scope: Lane) => Promise<boolean>;
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

  /** Parked requests right now, across every lane. Zero means no timer is running. */
  get size(): number {
    return this.waiters.size;
  }

  /** The distinct lanes something is parked on right now. */
  get parkedLanes(): Lane[] {
    return [...new Set(this.waiters.values())];
  }

  /**
   * Parks until work arrives on a lane this `scope` can see (`true`), the window
   * expires, the client disconnects, or the server shuts down (all `false`).
   * Every exit path removes the waiter and its timer — a dropped client leaves
   * nothing behind.
   */
  async wait(scope: Lane, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
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

      this.waiters.set(settle, scope);
      this.startPolling();
    });
  }

  /** Work is available: release everyone whose scope `reaches` says it concerns. */
  notify(reaches: Reaches): void {
    for (const [settle, scope] of [...this.waiters]) {
      if (reaches(scope)) settle(true);
    }
  }

  /** Shutdown: release everyone as "expired" and stop the timer. */
  close(): void {
    this.closed = true;
    for (const settle of [...this.waiters.keys()]) settle(false);
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

  /**
   * One probe per distinct parked lane, and each lane's waiters woken on its own
   * answer — never on another lane's. The probes run together rather than in
   * sequence so a tick costs one round of filesystem reads however many lanes
   * are parked, and the whole tick is still guarded by `probing` so a slow
   * filesystem cannot stack ticks on top of each other.
   */
  private tick(): void {
    if (this.probing || this.waiters.size === 0) {
      this.stopPollingWhenIdle();
      return;
    }
    this.probing = true;
    const scopes = this.parkedLanes;
    Promise.all(scopes.map(async (scope) => ({ scope, available: await this.probe(scope) })))
      .then((results) => {
        const ready = new Set(
          results.filter((result) => result.available).map((result) => result.scope),
        );
        if (ready.size > 0) this.notify((scope) => ready.has(scope));
      })
      .catch((error: unknown) => {
        this.onProbeError(error);
      })
      .finally(() => {
        this.probing = false;
      });
  }
}
