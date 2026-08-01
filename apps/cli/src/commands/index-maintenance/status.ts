import type { IndexStatus } from "@corpus/contract";
import { renderColumns } from "../columns.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";

/**
 * `corpus index status` — the semantic index's own health, as one block
 * (SPEC.md §9.1's verbs bullet, §9.2's index bullet).
 *
 * Indexing is asynchronous and never blocks a save, so a backlog is the normal
 * state right after an edit, an import or a rebuild. This verb is the surface
 * that makes the backlog visible rather than hidden: it is the only place a
 * person sees the corpus draining, and the reason a pending backlog can be
 * *staleness* rather than drift — `corpus db doctor` stays clean while this
 * number falls (SPEC.md §14), and the two checks answer different questions.
 *
 * The rendering is a label/value block through the shared {@link renderColumns},
 * so it lines up like every other tabular verb, and the field order is fixed:
 * identity, indexed, pending, failed, rebuilding, state. Fixed because an agent
 * reads these positionally, and because the last line is the one word the two
 * retrieval envelopes report as `semanticIndex` — the same value from the same
 * schema, so no two surfaces can describe one workspace differently.
 *
 * Nothing here is an error. A workspace with no semantic index answers
 * `disabled` with a null identity and zero counts; that is an honest report of
 * lexical-only ranking (SPEC.md §9.1's local-first default), not a failure, and
 * the exit code stays 0 in every state.
 */

/** What a null identity reads as: a fact, never `null` or `undefined`. */
export const NO_IDENTITY = "none recorded yet";

/** The block, in the one order every caller may rely on. */
export function renderIndexStatus(status: IndexStatus): readonly string[] {
  return renderColumns([
    ["identity", status.identity ?? NO_IDENTITY],
    ["indexed", String(status.indexed)],
    ["pending", String(status.pending)],
    ["failed", String(status.failed)],
    ["rebuilding", status.rebuilding ? "yes" : "no"],
    ["state", status.state],
  ]);
}

export async function runIndexStatus(context: WorkspaceCommandContext): Promise<void> {
  const status = await context.client.request((api) => api.GET("/api/index/status"));

  context.out.emit(status);
  for (const line of renderIndexStatus(status)) context.out.line(line);
}

export const statusCommand: WorkspaceCommandSpec = {
  name: "status",
  summary: "Report the semantic index's coverage, identity and state.",
  description:
    "Reads `GET /api/index/status` and prints one block: the provider/model **identity** the " +
    "index's vectors were produced under, the `indexed` / `pending` / `failed` chunk counts, " +
    "whether a full rebuild is in flight, and the single `state` word those facts derive to " +
    "(SPEC.md §9.1). The three counts account for every chunk in the corpus, so there is no " +
    "separate total.\n\n" +
    "**A backlog is normal.** Indexing is asynchronous and no save ever waits on it, so `pending` " +
    "is non-zero right after an edit, an import or a rebuild, and watching it fall is what this " +
    "verb is for. That is staleness rather than drift: `corpus db doctor` stays clean while it " +
    "drains (SPEC.md §14). `failed` is the number that does _not_ drain by itself — those chunks " +
    "are re-queued by `corpus index rebuild`, once whatever made them fail is fixed.\n\n" +
    "`state` is the same value, from the same schema, that `corpus search` and `corpus doc " +
    "related` report as `semanticIndex` and warn about when it is anything but `current`. A " +
    "workspace with no semantic index answers `disabled` with no identity and zero counts — an " +
    "honest answer about lexical-only ranking, never an error, and the exit code is 0 in every " +
    "state. `--json` emits the server's report untouched.",
  args: [],
  flags: [],
  examples: [
    {
      command: "corpus index status",
      description:
        "The block: identity, indexed/pending/failed chunks, whether a rebuild is running, and the state word.",
    },
    {
      command: "corpus index status --json",
      description:
        'One JSON value: `{"indexed":660,"pending":0,"failed":0,' +
        '"identity":"local/all-MiniLM-L6-v2@384","rebuilding":false,"state":"current"}`.',
    },
  ],
  handler: (context) => runIndexStatus(context),
};
