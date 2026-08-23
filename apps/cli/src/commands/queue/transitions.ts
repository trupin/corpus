import { UsageError } from "../../errors.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";

/**
 * The three terminal transitions of a claimed event (SPEC.md §7).
 *
 * **They were idempotent server-side until SERVER-145, and are not any more.**
 * Terminal states are terminal now: `complete` and `fail` admit only an
 * `in-progress` event, `abandon` admits everything but a `processed` one, and
 * everything else is a `409` at exit 5. SPEC.md §7's rule is the one being
 * enforced — nobody settles work they did not claim — so a second `complete` is
 * refused rather than waved through, and a second `fail --reason B` no longer
 * answers `200` while reason B goes nowhere.
 *
 * The confirmation line is unchanged and still reports the **state** (`event
 * <id> is complete`) rather than claiming the transition: `QueueEvent` carries
 * no `status` field, so the CLI has never been able to see which of the two
 * happened. What changed is that only one of them can now reach that line.
 */

export async function runComplete(context: WorkspaceCommandContext): Promise<void> {
  const id = context.args.get("event-id");
  const event = await context.client.request((api) =>
    api.POST("/api/queue/{id}/complete", { params: { path: { id } } }),
  );
  context.out.emit(event);
  context.out.line(`event ${event.id} is complete.`);
}

/**
 * `--reason` is required here and checked before anything is sent, exactly as
 * `queue defer` checks `--blocked-on` (CLI-067).
 *
 * **The requirement is the CLI's, not the wire's.** `POST /api/queue/{id}/fail`
 * keeps `required: false` on its body deliberately: the stale-event reaper writes
 * a `failed` event with its own `error` without going through the route, so
 * tightening the schema would break an HTTP caller to no purpose. What the rule
 * is actually about is the row a person reads later — a failed event with nothing
 * to say why is a dead end for whoever finds it — and that reader is served by
 * refusing the *command*, one round trip earlier and with a message that names
 * the flag.
 *
 * An empty or whitespace `--reason` fails the same way rather than being dropped:
 * the contract's `reason` is `min(1)`, so `{"reason":""}` was already a `400`,
 * and a caller who typed `--reason ""` has not given a reason by any reading.
 */
export async function runFail(context: WorkspaceCommandContext): Promise<void> {
  const id = context.args.get("event-id");
  const reason = context.flags.string("reason")?.trim();
  if (reason === undefined || reason === "") {
    throw new UsageError("`corpus queue fail` requires --reason <text>.", {
      hint:
        "Say why the work could not be done — it is what an operator reads in the failed row, " +
        "and the only record of it. `corpus queue abandon` is the verb for giving up with " +
        "nothing to add. Nothing was sent to the server.",
    });
  }

  const event = await context.client.request((api) =>
    api.POST("/api/queue/{id}/fail", { params: { path: { id } }, body: { reason } }),
  );
  context.out.emit(event);
  context.out.line(`event ${event.id} is failed.`);
}

export async function runAbandon(context: WorkspaceCommandContext): Promise<void> {
  const id = context.args.get("event-id");
  const event = await context.client.request((api) =>
    api.DELETE("/api/queue/{id}", { params: { path: { id } } }),
  );
  context.out.emit(event);
  context.out.line(`event ${event.id} is abandoned.`);
}

const EVENT_ID_ARG = {
  name: "event-id",
  required: true,
  description: "The event's id, as printed by `corpus queue claim-all`.",
} as const;

export const completeCommand: WorkspaceCommandSpec = {
  name: "complete",
  summary: "Mark work you claimed processed — completing anything else is refused.",
  description:
    "Moves the event from `in-progress/` to `processed/`. **Only claimed work can be completed:** " +
    "an event you did not claim, or one already settled, is a conflict (exit 5) and nothing " +
    "moves.\n\n" +
    "That is SPEC.md §7's rule — nobody settles work they did not claim — and it is **not** " +
    "idempotent. A second `complete` after a retry does not exit 0 like the first; it is refused, " +
    "and the refusal says `already`, which is how a duplicated call learns the outcome it wanted " +
    "is the one on record. Reconcile with `corpus queue in-progress` when you are not sure what " +
    "you still hold.\n\n" +
    "The confirmation states the event's state rather than claiming a transition — the response " +
    "carries no status, so the CLI cannot tell the two apart and does not pretend to. An unknown " +
    "id is a server error (exit 5).",
  args: [EVENT_ID_ARG],
  flags: [],
  examples: [
    { command: "corpus queue complete evt_9f2a", description: "Finish an event that was handled." },
    {
      command: "corpus queue complete evt_9f2a --json",
      description: "Machine-readable form: the event as one JSON value.",
    },
  ],
  handler: (context) => runComplete(context),
};

export const failCommand: WorkspaceCommandSpec = {
  name: "fail",
  summary: "Mark work you claimed failed, saying why in the required --reason.",
  description:
    "Moves the event to `failed/`, where the console can retry it — the recoverable half of " +
    "giving up (`abandon` is the other). **`--reason` is required and checked before any request " +
    "is sent**, and **only claimed work can be failed:** an event you did not claim, or one " +
    "already settled, is a conflict (exit 5).\n\n" +
    "The reason is the whole record of why the work stopped — it is what an operator reads in " +
    "the failed row, and nothing else carries it. A missing or empty one is a usage error " +
    "(exit 2) with nothing sent, so the failed row can never exist with nothing to say for " +
    "itself. Use `corpus queue abandon` when there is genuinely nothing to add.\n\n" +
    "It is **not** idempotent (SPEC.md §7 — nobody settles work they did not claim). A second " +
    "`fail` is refused rather than accepted, which is also what stops it quietly discarding the " +
    "new reason it carried: the first annotation was never going to be overwritten.",
  args: [EVENT_ID_ARG],
  flags: [
    {
      name: "reason",
      type: "string",
      valueName: "text",
      // The requirement and the meaning share one sentence deliberately: brief
      // help renders the first sentence only (CLI-056), and "**Required.**"
      // alone is a gloss that says nothing about what to write.
      description:
        "**Required** — why the event failed, shown in the console's failed row. An empty or " +
        "whitespace value is refused the same way a missing one is, before any request is sent.",
    },
  ],
  examples: [
    {
      command: 'corpus queue fail evt_9f2a --reason "the parent document was deleted"',
      description: "Fail an event and say why.",
    },
    {
      command: 'corpus queue fail evt_9f2a --reason "the API it needs is down" --json',
      description: "Machine-readable form: the event as one JSON value.",
    },
  ],
  handler: (context) => runFail(context),
};

export const abandonCommand: WorkspaceCommandSpec = {
  name: "abandon",
  summary: "Give up on an event for good, from any state but processed.",
  description:
    "Moves the event to `abandoned/` — the terminal give-up state, distinct from `failed/` which " +
    "a retry can pick up again. Nothing is deleted: the event file is kept where the audit trail " +
    "can still see it.\n\n" +
    "It is the one settle that is **not** restricted to claimed work, because it is the " +
    "operator's give-up rather than the agent's report: a `pending`, `in-progress`, `deferred` " +
    "or `failed` event can all be abandoned, which is what lets the console offer it beside " +
    "`retry` on a failed job. What it may not do is give up on work that is **done** — " +
    "abandoning a `processed` event is a conflict (exit 5), since there is nothing left to give " +
    "up on and the move would rewrite the history the kept file exists to be. A repeat is " +
    "refused too, and says `already`.",
  args: [EVENT_ID_ARG],
  flags: [],
  examples: [
    {
      command: "corpus queue abandon evt_9f2a",
      description: "Stop trying to handle an event.",
    },
  ],
  handler: (context) => runAbandon(context),
};
