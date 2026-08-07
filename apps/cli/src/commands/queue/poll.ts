import { MAX_IDLE_TIMEOUT_SECONDS, type InProgressSet, type QueueEvent } from "@corpus/contract";
import { responseError, transportError, type CliClient } from "../../client.js";
import { isCliError, ServerResponseError } from "../../errors.js";
import { delay } from "../../signals.js";

/**
 * The parking window behind `corpus queue idle` (CLAUDE.md Architecture
 * Decision 4). The **window** belongs to the client and the **hold** belongs to
 * the server: the client asks for `min(remaining, MAX_IDLE_TIMEOUT_SECONDS)`
 * seconds at a time until its window runs out, so a server-side expiry in the
 * middle of a longer window is invisible to the caller.
 *
 * With `DEFAULT_IDLE_TIMEOUT_SECONDS === MAX_IDLE_TIMEOUT_SECONDS` the default
 * window is exactly one request; the loop exists for the windows that are not
 * (`--wait 900` issues two, the second shorter), and it never extends past the
 * deadline it computed at the start.
 */

/**
 * Backoff before the single retry that absorbs a server restart mid-poll.
 *
 * Sized against the failure it exists for: `corpus server stop && corpus server
 * start` measures ~0.75 s end to end, and the poll's socket drops at the very
 * start of it, so anything under a second retries into the gap and reports a
 * live workspace as unreachable. Two seconds clears a restart with margin and
 * is still 0.4% of the eight-minute window it interrupts.
 */
export const IDLE_RETRY_BACKOFF_MS = 2_000;

/**
 * Added to the segment when arming the per-request abort. It has to exceed the
 * server's own expiry or the client would abort a hold that was about to answer
 * `204` — which is a normal outcome, not a transport failure.
 */
export const IDLE_REQUEST_MARGIN_MS = 5_000;

/**
 * A window that returned work carries the whole `200` body, not just its events:
 * the in-progress set is the other half of what the loop's entry point owes the
 * agent (SPEC.md §7), and a poll that kept only `events` would drop it before
 * `idle` ever saw it. The `expired` outcome has no set by construction — the
 * `204` has no body, and an agent with nothing to claim has nothing to reconcile
 * against.
 */
export type PollOutcome =
  | {
      readonly kind: "events";
      readonly events: readonly QueueEvent[];
      readonly inProgress: InProgressSet;
      readonly requests: number;
    }
  | { readonly kind: "expired"; readonly requests: number }
  | { readonly kind: "interrupted"; readonly requests: number };

export interface PollWindowOptions {
  readonly client: CliClient;
  /** Total time to park, in milliseconds. Zero means a single non-blocking probe. */
  readonly windowMs: number;
  /** Aborted on SIGINT/SIGTERM; an aborted poll resolves rather than throwing. */
  readonly signal: AbortSignal;
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Overridable only so tests can exercise a multi-segment window quickly. */
  readonly maxSegmentSeconds?: number;
}

export async function pollWindow(options: PollWindowOptions): Promise<PollOutcome> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? delay;
  const maxSegmentSeconds = options.maxSegmentSeconds ?? MAX_IDLE_TIMEOUT_SECONDS;
  const deadline = now() + options.windowMs;

  let requests = 0;
  let consecutiveFailures = 0;

  for (;;) {
    if (options.signal.aborted) return { kind: "interrupted", requests };

    const segmentSeconds = segmentFor(deadline - now(), maxSegmentSeconds);
    requests += 1;
    const attempt = await requestIdle(options.client, segmentSeconds, options.signal);

    if (attempt.kind === "failure") {
      if (options.signal.aborted) return { kind: "interrupted", requests };
      consecutiveFailures += 1;
      if (consecutiveFailures > 1) {
        throw transportError(
          attempt.cause,
          options.client.baseUrl,
          segmentSeconds * 1000 + IDLE_REQUEST_MARGIN_MS,
        );
      }
      await sleep(IDLE_RETRY_BACKOFF_MS, options.signal);
      if (options.signal.aborted) return { kind: "interrupted", requests };
      continue;
    }

    consecutiveFailures = 0;
    if (attempt.kind === "events") {
      return { kind: "events", events: attempt.events, inProgress: attempt.inProgress, requests };
    }
    // A clock that jumped, or a hold that answered late, must not buy the window
    // another segment: the deadline is fixed when the window opens.
    if (now() >= deadline) return { kind: "expired", requests };
  }
}

/**
 * `IdleQuerySchema.timeout` is `min(1)`, so `--wait 0` cannot ask the server for
 * zero seconds. It asks for one and returns whatever that single request gets —
 * documented as a non-blocking probe rather than silently skipping the request.
 */
function segmentFor(remainingMs: number, maxSegmentSeconds: number): number {
  return Math.min(maxSegmentSeconds, Math.max(1, Math.ceil(remainingMs / 1000)));
}

type IdleAttempt =
  | {
      readonly kind: "events";
      readonly events: readonly QueueEvent[];
      readonly inProgress: InProgressSet;
    }
  | { readonly kind: "expired" }
  | { readonly kind: "failure"; readonly cause: unknown };

/**
 * One long poll. A non-2xx answer is a real answer and is thrown straight
 * through (exit 5); only a socket that never carried one is a `failure` the
 * caller may retry.
 */
async function requestIdle(
  client: CliClient,
  segmentSeconds: number,
  signal: AbortSignal,
): Promise<IdleAttempt> {
  // The park owns its own deadline, which is why it goes through `untimedApi`:
  // the global `--timeout` is the transport timeout for ordinary requests and
  // would abort an eight-minute hold after ten seconds.
  const timeout = AbortSignal.timeout(segmentSeconds * 1000 + IDLE_REQUEST_MARGIN_MS);
  const combined = AbortSignal.any([signal, timeout]);

  try {
    const result = await client.untimedApi.GET("/api/queue/idle", {
      params: { query: { timeout: segmentSeconds } },
      signal: combined,
    });

    if (result.response.status === 204) return { kind: "expired" };
    if (!result.response.ok) throw responseError(result.response, result.error);
    if (result.data === undefined) {
      throw new ServerResponseError(
        `${String(result.response.status)} empty_response: the server returned no body.`,
        { code: "empty_response", status: result.response.status },
      );
    }
    return { kind: "events", events: result.data.events, inProgress: result.data.inProgress };
  } catch (cause) {
    if (isCliError(cause)) throw cause;
    return { kind: "failure", cause };
  }
}
