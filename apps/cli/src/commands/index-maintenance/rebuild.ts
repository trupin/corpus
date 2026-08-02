import type { IndexStatus } from "@corpus/contract";
import { plural } from "../../input.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";

/**
 * `corpus index rebuild` — discards the semantic index, re-queues every chunk,
 * and comes straight back (SPEC.md §9.1, §9.2's index bullet).
 *
 * **It returns before the work is done, and says only what is already true.**
 * The route answers `202` with the `IndexStatus` snapshot taken the moment
 * everything was queued, so the acknowledgment reports a queue depth and an
 * emptied index — never a completion. `identity` is `null` in that snapshot
 * *every time*: it names what the stored vectors record, and the call has just
 * discarded them, which is precisely what frees the sticky model. The newly
 * picked identity is a fact about the future — the worker resolves it after this
 * call returns — so the acknowledgment prints "not yet recorded" and progress is
 * a separate, deliberate act: `corpus index status`.
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

/**
 * What is true at the moment of the call, and nothing beyond it.
 *
 * It deliberately does **not** name an identity. The snapshot's `identity`
 * reports what the stored vectors record, and the call has just deleted every
 * one of them, so the field is `null` on this path by construction — printing it
 * could only ever say "not yet recorded", which reads as a hiccup rather than as
 * the intended effect. The effect is stated instead: the model is re-picked when
 * the first chunk embeds, and `corpus index status` is where it gets named.
 */
export function acknowledgment(status: IndexStatus): string {
  return (
    `queued a full rebuild of the semantic index — ${plural(status.pending, "chunk")} to embed, ` +
    `state ${status.state}. the index holds no vectors until they land, and the provider and ` +
    "model are re-picked when the first one does."
  );
}

export const rebuildCommand: WorkspaceCommandSpec = {
  name: "rebuild",
  summary: "Discard the semantic index and re-queue every chunk; returns immediately.",
  description:
    "Posts `POST /api/index/rebuild`: the server discards the semantic index's vectors and queues " +
    "the whole corpus for embedding (SPEC.md §9.1). Discarding them is the one place the sticky " +
    "identity resets — resolution is sticky to the identities the index records, so an index " +
    "holding none is free to pick the current default. It is the narrow counterpart of " +
    "`corpus db rebuild`, which reconstructs the entire projection.\n\n" +
    "**It returns as soon as the work is queued, not when it is done.** The two lines it prints " +
    "are an acknowledgment — how many chunks are now queued and the resulting state — and never " +
    "a claim of completion. They name no model, because none has been picked yet: the re-pick " +
    "happens when the indexing worker resolves, after this command has returned, and " +
    "`corpus index status` is what names it once the first chunk is embedded. There is " +
    "deliberately **no watch loop**: ask again with `corpus index status` to see the backlog " +
    "drain. Ranked search stays available throughout on its lexical half and says `indexing` " +
    "while it waits.\n\n" +
    "This is also how a `failed` chunk gets another attempt: failures do not drain on their own. " +
    "Nothing here touches a workspace file, so there is no commit and no acting party. `--json` " +
    'emits the queued-moment snapshot untouched — including its `"identity":null`, which is ' +
    "the discard, not a missing model.",
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
        '"identity":null,"rebuilding":true,"state":"indexing"}`. `identity` is null because the ' +
        "vectors that recorded one were just discarded; poll `corpus index status --json` to see " +
        "the re-picked one appear with the first embedded chunk.",
    },
  ],
  handler: (context) => runIndexRebuild(context),
};
