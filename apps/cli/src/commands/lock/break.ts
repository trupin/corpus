import { ServerResponseError, UsageError } from "../../errors.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";

/**
 * The human escape hatch for a stuck lock (SPEC.md §7) — the CLI twin of the
 * banner's Force unlock button.
 *
 * Two deliberate deviations from every other verb:
 *
 * - **It is user-only, and `--from agent` is refused rather than rewritten.**
 *   `POST /api/locks/{docId}/break` is user-only by design: an agent breaking
 *   its own contention would defeat the mechanism the lock exists to provide.
 *   This verb used to send `user` whatever the caller asked for, which silently
 *   turned an agent's break into an operator's — an attribution the audit trail
 *   then recorded as fact. It now refuses before anything is sent, exactly as
 *   `doc delete` does (exit 2), and sends the actor it was actually given.
 *   The server's `403` remains the backstop; this guard exists so the agent
 *   gets the reason instead of a status code (CLI-008 item 2).
 * - **A `404` is a no-op, not a failure.** "No lock held" is indistinguishable
 *   from "already broken", which is the outcome the caller wanted; the loop must
 *   not crash on a duplicated call after a retry. The cost is that a genuinely
 *   unknown document id also exits 0, which the verb's help states.
 */

/** Mirrors `doc delete`'s `AGENT_REFUSAL`: one guard shape for the two user-only verbs. */
export const AGENT_REFUSAL = "breaking a lock is user-only — the agent waits, never breaks";

export interface BreakResult {
  readonly docId: string;
  readonly broken: boolean;
  readonly holder?: "user" | "agent";
}

export async function runBreak(context: WorkspaceCommandContext): Promise<void> {
  const docId = context.args.get("doc-id");

  if (context.actor !== "user") {
    throw new UsageError(AGENT_REFUSAL, {
      hint:
        "Wait for the holder and retry — a job blocked on a lock is deferred, not forced. " +
        "Nothing was sent to the server. Check who holds it with `corpus lock list`.",
    });
  }

  try {
    const result = await context.client.request((api) =>
      api.POST("/api/locks/{docId}/break", {
        params: { path: { docId }, header: { "x-corpus-author": context.actor } },
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
    "**The agent may not run this.** `--from agent` (or `CORPUS_FROM=agent`) is refused here, " +
    "before any request is sent, with exit 2: breaking a lock is a human recovery action, and an " +
    "agent that could break its own contention would defeat the mechanism the lock exists to " +
    "provide (SPEC.md §7). The server refuses it too; this guard exists so the agent gets the " +
    "reason rather than a `403`. Idempotent by design — a document with no lock reports " +
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
