import type { ThreadStatus } from "@corpus/contract";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";

/**
 * `corpus thread resolve` and `corpus thread reopen` (SPEC.md §6, §8) — one
 * write with two targets, so they share an implementation the way the server's
 * own handler does.
 *
 * **Idempotent, and it says so.** The server treats a redundant flip as a `200`
 * that writes nothing, commits nothing and announces nothing, but its response
 * is identical either way — so the current status is read first purely to report
 * "already resolved" instead of claiming a change that did not happen. The
 * agent's loop must never have to branch on this.
 */

export async function runThreadStatus(
  context: WorkspaceCommandContext,
  status: ThreadStatus,
): Promise<void> {
  const id = context.args.get("id");

  const before = await context.client.request((api) =>
    api.GET("/api/threads/{id}", { params: { path: { id } } }),
  );
  const already = before.status === status;

  const summary = await context.client.request((api) =>
    status === "resolved"
      ? api.POST("/api/threads/{id}/resolve", { params: { path: { id } } })
      : api.POST("/api/threads/{id}/reopen", { params: { path: { id } } }),
  );

  context.out.emit(summary);
  context.out.line(
    already
      ? `${id} is already ${status}`
      : `${status === "resolved" ? "resolved" : "reopened"} ${id}`,
  );
}

export const resolveCommand: WorkspaceCommandSpec = {
  name: "resolve",
  summary: "Resolve a thread.",
  description:
    "Sets `status: resolved`. The thread collapses in the document view and later turns stop " +
    "re-triggering the agent even while it is `engaged` (SPEC.md §8) — resolving is how a " +
    "conversation is closed without deleting anything. Resolving an already-resolved thread " +
    "reports “already resolved” and exits 0, having written and committed nothing.",
  args: [{ name: "id", required: true, description: "The thread's id." }],
  flags: [],
  examples: [
    {
      command: "corpus thread resolve th_a1b2c3",
      description: "Close a conversation that has run its course.",
    },
    {
      command: "corpus thread resolve th_a1b2c3 --from agent --json",
      description: "One JSON value: the thread summary, with `status` now `resolved`.",
    },
  ],
  handler: (context) => runThreadStatus(context, "resolved"),
};

export const reopenCommand: WorkspaceCommandSpec = {
  name: "reopen",
  summary: "Reopen a resolved thread.",
  description:
    "Sets `status: open` again; an `engaged` thread resumes re-triggering the agent on later " +
    "turns (SPEC.md §8). Reopening an already-open thread reports “already open” and exits 0, " +
    "having written and committed nothing.",
  args: [{ name: "id", required: true, description: "The thread's id." }],
  flags: [],
  examples: [
    {
      command: "corpus thread reopen th_a1b2c3",
      description: "Bring a resolved conversation back because something new came up.",
    },
    {
      command: "corpus thread reopen th_a1b2c3 --json",
      description: "One JSON value: the thread summary, with `status` back to `open`.",
    },
  ],
  handler: (context) => runThreadStatus(context, "open"),
};
