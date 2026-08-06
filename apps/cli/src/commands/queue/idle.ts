import { DEFAULT_IDLE_TIMEOUT_SECONDS } from "@corpus/contract";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";
import { abortOnInterrupt, type SignalTarget } from "../../signals.js";
import { reportInProgress } from "./in-progress.js";
import { pollWindow } from "./poll.js";

/**
 * The agent's parking spot (SPEC.md §7). While parked it writes **nothing** —
 * no heartbeat, no dots — so an eight-minute window costs the agent's context
 * exactly one line. Everything else here follows from that: the timeout is a
 * success, an interrupt is a success, and the only bytes on stdout are the
 * outcome.
 */

/** Why a window ended with no events. Halted is a state the server owns, so it is asked. */
export type IdleReason = "timeout" | "halted";

/** `idle`'s own timeout shape — the `204` carries no body, so this has no contract counterpart. */
export interface IdleTimeout {
  readonly idle: true;
  readonly reason: IdleReason;
}

export interface IdleDependencies {
  readonly signals?: SignalTarget;
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly maxSegmentSeconds?: number;
}

export async function runIdle(
  context: WorkspaceCommandContext,
  dependencies: IdleDependencies = {},
): Promise<void> {
  const { client, out } = context;
  const waitSeconds = context.flags.number("wait") ?? DEFAULT_IDLE_TIMEOUT_SECONDS;

  const controller = new AbortController();
  const dispose = abortOnInterrupt(controller, dependencies.signals);

  try {
    const outcome = await pollWindow({
      client,
      windowMs: Math.max(0, waitSeconds) * 1000,
      signal: controller.signal,
      ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
      ...(dependencies.sleep === undefined ? {} : { sleep: dependencies.sleep }),
      ...(dependencies.maxSegmentSeconds === undefined
        ? {}
        : { maxSegmentSeconds: dependencies.maxSegmentSeconds }),
    });

    // Ctrl-C is how an operator ends a park. Nothing is printed: a partial JSON
    // value would be worse than silence for whoever is parsing stdout.
    if (outcome.kind === "interrupted") return;

    // A window that returned work carries the in-progress set too (SPEC.md §7),
    // and it is passed through as its own key rather than folded into `events`:
    // one list is what is waiting to be claimed, the other is what the server
    // thinks is already owed, and an agent that merged them would either redo
    // settled work or claim nothing. Human mode keeps them in different streams
    // for the same reason — pending ids on stdout, the report on stderr.
    if (outcome.kind === "events") {
      out.emit({ events: outcome.events, inProgress: outcome.inProgress });
      for (const event of outcome.events) out.line(`${event.id} ${event.type}`);
      reportInProgress(out, outcome.inProgress);
      return;
    }

    // The `204` says the window expired; it cannot say whether the queue was
    // halted the whole time, so the reason is one extra cheap request.
    const status = await client.request((api) => api.GET("/api/queue/status"));
    const reason: IdleReason = status.halted ? "halted" : "timeout";
    const timeout: IdleTimeout = { idle: true, reason };
    out.emit(timeout);
    out.line(`idle — no events (${reason})`);
  } finally {
    dispose();
  }
}

export const idleCommand: WorkspaceCommandSpec = {
  name: "idle",
  summary: "Park until work arrives, then exit.",
  description:
    "Long-polls `GET /api/queue/idle` and returns the instant a pending event exists or arrives. " +
    "Parking costs the agent zero tokens and prints nothing at all: the command is blocked on a " +
    "response, not looping. When the window elapses with nothing pending it exits **0** with a " +
    'timeout value (`{"idle":true,"reason":"timeout"}`), so the orchestrate skill\'s loop simply ' +
    "re-invokes it — a timeout is not an error. While the queue is halted, idle parks for the full " +
    'window and reports `reason: "halted"` instead, which costs one extra `GET /api/queue/status` ' +
    "on expiry (the `204` carries no halted indicator). **Idle observes and never claims**: the " +
    "events stay in `pending/` until `corpus queue claim-all`, so a crash between the two loses " +
    "nothing. Ctrl-C exits 0 with no output.\n\n" +
    "**When it returns work, it also reports what the server still thinks you are doing** " +
    "(SPEC.md §7) — the same `inProgress` field `corpus queue claim-all` carries, as its own key " +
    "beside `events` and never mixed into them: those events are already in `in-progress/` and " +
    "are not the ones waiting to be claimed. In human mode it prints as a readable block on " +
    "stderr with ages rendered as `held 3h`; under `--json` `heldSince` stays an ISO instant so " +
    "you compute the age against your own clock, and `total` plus `truncated` say whether the " +
    "20-row cap cut the list. A timeout carries no list at all — the `204` has no body, and an " +
    "agent with nothing to claim has nothing to reconcile against.",
  args: [],
  flags: [
    {
      name: "wait",
      type: "number",
      valueName: "seconds",
      default: DEFAULT_IDLE_TIMEOUT_SECONDS,
      description:
        "How long to park before exiting with a timeout. The server holds each request for at " +
        "most its own maximum, so a longer window is served by successive requests. `0` is a " +
        "single non-blocking probe: is anything queued right now?",
    },
  ],
  examples: [
    {
      command: "corpus queue idle",
      description: "Park for the default rearm window; prints one line per event when work lands.",
    },
    {
      command: "corpus queue idle --json",
      description:
        'The agent loop\'s form: one JSON value — `{"events":[{"id":"evt_…","type":"comment.created",…}],"inProgress":{"events":[],"total":0,"truncated":false}}` on work, `{"idle":true,"reason":"timeout"}` or `{"idle":true,"reason":"halted"}` on expiry.',
    },
    {
      command: "corpus queue idle --wait 0 --json",
      description: "Probe the queue without blocking, for a script that must not park.",
    },
  ],
  handler: (context) => runIdle(context),
};
