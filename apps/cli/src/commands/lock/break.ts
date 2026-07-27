import { ServerResponseError } from "../../errors.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";

/**
 * The human escape hatch for a stuck lock (SPEC.md §7) — the CLI twin of the
 * banner's Force unlock button.
 *
 * Two deliberate deviations from every other verb:
 *
 * - **It acts as `user`, not as the agent.** The CLI is otherwise the agent's
 *   interface and attributes its writes accordingly, but `POST /api/locks/{docId}/break`
 *   is user-only by design: an agent breaking its own contention would defeat
 *   the mechanism the lock exists to provide. Breaking a lock is definitionally
 *   an operator action, so the actor is overridden per call.
 * - **A `404` is a no-op, not a failure.** "No lock held" is indistinguishable
 *   from "already broken", which is the outcome the caller wanted; the loop must
 *   not crash on a duplicated call after a retry. The cost is that a genuinely
 *   unknown document id also exits 0, which the verb's help states.
 */

export interface BreakResult {
  readonly docId: string;
  readonly broken: boolean;
  readonly holder?: "user" | "agent";
}

export async function runBreak(context: WorkspaceCommandContext): Promise<void> {
  const docId = context.args.get("doc-id");
  try {
    const result = await context.client.request((api) =>
      api.POST("/api/locks/{docId}/break", {
        params: { path: { docId }, header: { "x-corpus-author": "user" } },
      }),
    );
    const broken: BreakResult = { docId: result.docId, broken: true, holder: result.holder };
    context.out.emit(broken);
    context.out.line(`broke the ${result.holder} lock on ${docId}.`);
  } catch (error) {
    if (!(error instanceof ServerResponseError) || error.status !== 404) throw error;
    const absent: BreakResult = { docId, broken: false };
    context.out.emit(absent);
    context.out.line(`no lock held on ${docId}.`);
  }
}

export const breakCommand: WorkspaceCommandSpec = {
  name: "break",
  summary: "Force-unlock a document (an operator action).",
  description:
    "Clears whoever holds the document's edit lock and records the break in the audit trail. " +
    "This is the one verb the CLI sends as **`user` rather than `agent`**: breaking a lock is a " +
    "human recovery action, and the server refuses it from the agent precisely so that an agent " +
    "cannot break its own contention. Idempotent by design — a document with no lock reports " +
    "`no lock held` and exits 0, which also means an unknown document id exits 0 rather than 5.",
  args: [{ name: "doc-id", required: true, description: "The locked document's id." }],
  flags: [],
  examples: [
    {
      command: "corpus lock break doc_a1b2c3",
      description: "Clear a lock a crashed session left behind.",
    },
    {
      command: "corpus lock break doc_a1b2c3 --json",
      description:
        'One JSON value: `{"docId":"doc_a1b2c3","broken":true,"holder":"agent"}`, or `{"docId":"doc_a1b2c3","broken":false}` when nothing was held.',
    },
  ],
  handler: (context) => runBreak(context),
};
