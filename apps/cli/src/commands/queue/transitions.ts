import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";

/**
 * The three terminal transitions of a claimed event (SPEC.md §7). All of them
 * are idempotent server-side, and `QueueEvent` carries no `status` field — so
 * the CLI cannot observe whether this call moved the event or found it already
 * there. It therefore reports the **state** (`event <id> is complete`) and never
 * claims the transition, which keeps a retried call from printing a lie.
 */

/**
 * An empty `--reason` is treated as no reason at all: the contract's `reason` is
 * `min(1)`, so sending `{"reason":""}` would be a `400` for a caller who plainly
 * meant "no annotation".
 */
function reasonBody(raw: string | undefined): { body: { reason: string } } | Record<string, never> {
  if (raw === undefined || raw.trim() === "") return {};
  return { body: { reason: raw } };
}

export async function runComplete(context: WorkspaceCommandContext): Promise<void> {
  const id = context.args.get("event-id");
  const event = await context.client.request((api) =>
    api.POST("/api/queue/{id}/complete", { params: { path: { id } } }),
  );
  context.out.emit(event);
  context.out.line(`event ${event.id} is complete.`);
}

export async function runFail(context: WorkspaceCommandContext): Promise<void> {
  const id = context.args.get("event-id");
  const event = await context.client.request((api) =>
    api.POST("/api/queue/{id}/fail", {
      params: { path: { id } },
      ...reasonBody(context.flags.string("reason")),
    }),
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
  summary: "Mark a claimed event processed.",
  description:
    "Moves the event from `in-progress/` to `processed/`. Idempotent: completing an " +
    "already-completed event is not an error, so a duplicated call after a retry exits 0 like the " +
    "first. The confirmation states the event's state rather than claiming a transition — the " +
    "response carries no status, so the CLI cannot tell the two apart and does not pretend to. " +
    "An unknown id is a server error (exit 5).",
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
  summary: "Mark a claimed event failed.",
  description:
    "Moves the event to `failed/`, where the console can retry it — the recoverable half of " +
    "giving up (`abandon` is the other). A bare `fail` sends no request body at all; `--reason` " +
    "records why, and is shown in the console.",
  args: [EVENT_ID_ARG],
  flags: [
    {
      name: "reason",
      type: "string",
      valueName: "text",
      description: "Why the event failed. Omitted entirely when not given, never sent empty.",
    },
  ],
  examples: [
    {
      command: 'corpus queue fail evt_9f2a --reason "the parent document was deleted"',
      description: "Fail an event and say why.",
    },
    { command: "corpus queue fail evt_9f2a", description: "Fail without an annotation." },
  ],
  handler: (context) => runFail(context),
};

export const abandonCommand: WorkspaceCommandSpec = {
  name: "abandon",
  summary: "Give up on an event for good.",
  description:
    "Moves the event to `abandoned/` — the terminal give-up state, distinct from `failed/` which " +
    "a retry can pick up again. Nothing is deleted: the event file is kept where the audit trail " +
    "can still see it.",
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
