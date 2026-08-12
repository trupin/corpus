import { UsageError } from "../../errors.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";

/**
 * The fourth transition of a claimed event, and the only non-terminal one
 * (SPEC.md §7, CONTRACT-021/SERVER-030): work the agent claimed and chose not to
 * do yet, because a **person** has an edit session open on a document it needs.
 *
 * **A judgement, not a refusal** (SHARED-041). Nothing stopped the agent — a key
 * would have let the write through, and no document is ever read-only. It
 * deferred because `corpus doc show` told it someone was editing, which is
 * information the agent acts on politely rather than a gate it ran into. That is
 * the trade §7 makes deliberately: ignoring the signal costs politeness, where
 * forgetting the old lock cost correctness.
 *
 * Two things make it unlike its three siblings in `transitions.ts`:
 *
 * - **It names a document, and that is not optional.** Re-entry is the server's
 *   reaction to that editing session ending, so a deferral that named no
 *   document could never come back. The event payload cannot supply it either —
 *   `comment.created` happens to carry `parentId`, `form.respond` names no
 *   document at all, and plugin payloads are their own shapes — so the party
 *   that saw the session names what it is waiting for. A missing `--blocked-on`
 *   is refused here, before anything is sent: the server would answer `400`, but
 *   a usage error costs no round trip and says which flag.
 * - **There is no reverse verb.** Nothing asks for the event back; the person
 *   closing their edit session on `--blocked-on` returns it to `pending` by
 *   itself and unparks `corpus queue idle`. `corpus job retry` stays the manual
 *   override for a deferral automatic re-entry never reached.
 *
 * Like the terminal three, the confirmation states the event's **state** rather
 * than claiming a transition: `QueueEvent` carries no status, so the CLI cannot
 * tell "I moved it" from "it was already there" and does not pretend to.
 */

export async function runDefer(context: WorkspaceCommandContext): Promise<void> {
  const id = context.args.get("event-id");
  const blockedOn = context.flags.string("blocked-on")?.trim();
  if (blockedOn === undefined || blockedOn === "") {
    throw new UsageError("`corpus queue defer` requires --blocked-on <doc-id>.", {
      hint:
        "Name the document the work is waiting on — that person's edit session ending is what " +
        "returns the event to pending. `corpus doc show <id>` is what reports an open session. " +
        "Nothing was sent to the server.",
    });
  }

  // An empty `--reason` is treated as no reason at all: the contract's `reason`
  // is `min(1)`, so `{"reason":""}` would be a 400 for a caller who plainly
  // meant "no annotation" — the same rule `queue fail` and `queue halt` follow.
  const reason = context.flags.string("reason")?.trim();
  const body = reason === undefined || reason === "" ? { blockedOn } : { blockedOn, reason };

  const event = await context.client.request((api) =>
    api.POST("/api/queue/{id}/defer", { params: { path: { id } }, body }),
  );
  context.out.emit(event);
  context.out.line(`event ${event.id} is deferred on ${blockedOn}.`);
}

export const deferCommand: WorkspaceCommandSpec = {
  name: "defer",
  summary: "Park a claimed event while a person is editing a document.",
  description:
    "Moves the event to `deferred/` — **waiting, not failed** (SPEC.md §7). The agent calls it " +
    "when the work it claimed needs a document a person has an edit session open on (the " +
    "“someone is editing this” line of `corpus doc show`): reply to the waiting thread, defer the " +
    "event, move on. It is the successor to the interim protocol of " +
    "failing the event with a `deferred:`-prefixed reason, so no prefix is needed or wanted here " +
    "— the status says that now.\n\n" +
    "**It is a judgement, not a refusal.** Nothing stopped the agent writing: a key would have " +
    "let the write through, no document is ever read-only, and there is nothing to acquire or " +
    "release. It defers because it saw, and because writing beside someone who is typing is " +
    "impolite rather than incorrect.\n\n" +
    "**The event comes back on its own** when that edit session ends: it returns to `pending` " +
    "and unparks `corpus queue idle` — no retry call, no " +
    "operator. Until then it is not claimable, and `corpus queue status` counts it under " +
    "`deferred` rather than `failed`. Nothing is silently dropped: it stays on disk across a " +
    "restart and stays retryable by hand with `corpus job retry`.\n\n" +
    "`--blocked-on` is required and checked before any request — a deferral that named no " +
    "document could never re-enter. Only claimed work can be deferred: an event that is not " +
    "`in-progress` is a server conflict (exit 5), as is an unknown id.",
  args: [
    {
      name: "event-id",
      required: true,
      description: "The event's id, as printed by `corpus queue claim-all`.",
    },
  ],
  flags: [
    {
      name: "blocked-on",
      type: "string",
      valueName: "doc-id",
      description:
        "**Required.** The document a person is editing that the work is waiting on. That " +
        "session ending is what returns this event to `pending`, so naming the wrong document " +
        "waits forever.",
    },
    {
      name: "reason",
      type: "string",
      valueName: "text",
      description:
        "Why the work is waiting, shown in the console beside the blocking document. Omitted " +
        "entirely when not given, never sent empty.",
    },
  ],
  examples: [
    {
      command: "corpus queue defer evt_9f2a --blocked-on doc_a1b2c3",
      description: "Park the event until the person editing that document is done.",
    },
    {
      command:
        'corpus queue defer evt_9f2a --blocked-on doc_a1b2c3 --reason "the user is editing it"',
      description: "Defer with a note for the console.",
    },
    {
      command: "corpus queue defer evt_9f2a --blocked-on doc_a1b2c3 --json",
      description: "Machine-readable form: the event as one JSON value.",
    },
  ],
  handler: (context) => runDefer(context),
};
