import type { IndexStatus } from "@corpus/contract";
import { plural } from "../../input.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";

/**
 * `corpus index rebuild` — discards the semantic index, re-queues every chunk,
 * and comes straight back (SPEC.md §9.1, §9.2's index bullet).
 *
 * **It returns before the work is done, and says only what is already true.**
 * The route answers `202` with the `IndexStatus` snapshot taken the moment
 * everything was queued, so the acknowledgment reports a queue depth and a
 * re-picked identity — never a completion. Progress is a separate, deliberate
 * act: `corpus index status`.
 *
 * **There is no watch loop here, and there must not be one.** A verb that polled
 * until the backlog drained would turn a 40 ms call into an open-ended one, and
 * an agent's zero-token parking already has exactly one shape in this CLI —
 * `corpus queue idle`'s long poll. A rebuild of a large corpus is watched by
 * asking again, not by holding a process open.
 *
 * For the same reason this is an **ordinary timed call**, unlike `corpus db
 * rebuild` next door, which does its work synchronously and needs the untimed
 * client and a ten-minute deadline of its own. Nothing here waits on embedding,
 * so the global ten-second transport timeout is the right deadline: if the
 * server has not acknowledged a queueing operation in ten seconds, something is
 * wrong and the caller should hear about it.
 */

export async function runIndexRebuild(context: WorkspaceCommandContext): Promise<void> {
  const status = await context.client.request((api) => api.POST("/api/index/rebuild"));

  context.out.emit(status);
  context.out.line(acknowledgment(status));
  context.out.line("it runs in the background — watch it with `corpus index status`.");
}

/** What is true at the moment of the call, and nothing beyond it. */
export function acknowledgment(status: IndexStatus): string {
  return (
    `queued a full rebuild of the semantic index — ${plural(status.pending, "chunk")} to embed, ` +
    `identity ${status.identity ?? "not yet recorded"}, state ${status.state}.`
  );
}

export const rebuildCommand: WorkspaceCommandSpec = {
  name: "rebuild",
  summary: "Discard the semantic index and re-queue every chunk; returns immediately.",
  description:
    "Posts `POST /api/index/rebuild`: the server discards the semantic index's vectors, re-picks " +
    "the current default provider and model — the one place the sticky identity resets — and " +
    "queues the whole corpus for embedding (SPEC.md §9.1). It is the narrow counterpart of " +
    "`corpus db rebuild`, which reconstructs the entire projection.\n\n" +
    "**It returns as soon as the work is queued, not when it is done.** The two lines it prints " +
    "are an acknowledgment — how many chunks are now queued, the identity that was just re-picked " +
    "and the resulting state — and never a claim of completion. There is deliberately **no watch " +
    "loop**: ask again with `corpus index status` to see the backlog drain. Ranked search stays " +
    "available throughout on its lexical half and says `indexing` while it waits.\n\n" +
    "This is also how a `failed` chunk gets another attempt: failures do not drain on their own. " +
    "Nothing here touches a workspace file, so there is no commit and no acting party. `--json` " +
    "emits the queued-moment snapshot untouched.",
  args: [],
  flags: [],
  examples: [
    {
      command: "corpus index rebuild",
      description:
        "Re-embed the whole corpus after changing the embedding model, or to retry failed chunks.",
    },
    {
      command: "corpus index rebuild && corpus index status",
      description: "Fire the rebuild, then look at the backlog it just queued.",
    },
    {
      command: "corpus index rebuild --json",
      description:
        'One JSON value, true at the moment of the call: `{"indexed":0,"pending":660,"failed":0,' +
        '"identity":"local/all-MiniLM-L6-v2@384","rebuilding":true,"state":"indexing"}`.',
    },
  ],
  handler: (context) => runIndexRebuild(context),
};
