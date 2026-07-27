import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";

/**
 * The atomic step of the agent loop (SPEC.md §7). Its output is deliberately
 * identical in both modes — the batch *is* the payload, and a human-readable
 * variant would be a different command — so it writes through `out.write`
 * rather than `out.emit`, which only speaks under `--json`.
 */
export async function runClaimAll(context: WorkspaceCommandContext): Promise<void> {
  const batch = await context.client.request((api) => api.POST("/api/queue/claim-all"));
  if (context.out.json) {
    context.out.emit(batch);
    return;
  }
  context.out.write(`${JSON.stringify(batch)}\n`);
}

export const claimAllCommand: WorkspaceCommandSpec = {
  name: "claim-all",
  summary: "Claim every pending event as one batch.",
  description:
    "Moves all `pending/*` events to `in-progress/` in a single call and prints them as **one " +
    "JSON line on stdout, in both human and `--json` mode** — no prose, no summary line, no " +
    "pretty-printing, and no pagination however large the batch. This command exists for machine " +
    "consumption and the batch is the payload; do not add a human-readable line to it. An empty " +
    'batch is still a batch: `{"events":[]}` and exit 0, which is the normal outcome when another ' +
    "idle client claimed first or the queue is halted. Concurrent claims never hand the same event " +
    "to two callers.",
  args: [],
  flags: [],
  examples: [
    {
      command: "corpus queue claim-all",
      description: 'One JSON line: `{"events":[{"id":"evt_…","type":"comment.created",…}]}`.',
    },
    {
      command: "corpus queue claim-all | jq -r '.events[].id'",
      description: "Drive a loop over the claimed event ids.",
    },
  ],
  handler: (context) => runClaimAll(context),
};
