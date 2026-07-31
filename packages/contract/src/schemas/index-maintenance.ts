import { z } from "@hono/zod-openapi";
import { SemanticIndexStateSchema } from "./retrieval.js";

/**
 * The semantic index's own health report (SPEC.md §9.1's verbs bullet, §9.2's
 * index bullet) — what `corpus index status` prints, and what
 * `corpus index rebuild` answers with.
 *
 * **Named `index-maintenance`, not `index`**, for the same reason the route file
 * beside it is: `./index.ts` is this directory's barrel, and a second module
 * competing for that name on a case-insensitive filesystem is a rename waiting
 * to go wrong.
 *
 * **One vocabulary for staleness, not two.** `state` is
 * {@link SemanticIndexStateSchema} — the identical schema the two retrieval
 * envelopes carry as `semanticIndex` (`./retrieval.ts`) — so `/api/search`,
 * `GET /api/docs/{id}/related` and `GET /api/index/status` cannot disagree about
 * one workspace by construction. The enum is frozen at four values
 * (`current` / `indexing` / `stale` / `disabled`, SHARED-006); this file adds the
 * *mapping* from countable facts to those values, and adds no value to them.
 *
 * **Counts, not a percentage.** `indexed` / `pending` / `failed` are the three
 * numbers an operator can act on: a backlog that is draining, a backlog that is
 * not, and a number that will never drain by itself. A progress fraction would
 * lose the third, which is the only one that needs a person.
 *
 * **Derived state only.** Nothing here is in git and nothing here is a workspace
 * file: the semantic index is the projection's third search structure, beside the
 * full-text index and the links graph (SPEC.md §2.2 rule 1, §9.1). That is why
 * neither route carries an acting party, and why a pending backlog is *staleness*
 * rather than drift — `corpus db doctor` stays clean while indexing is merely in
 * flight (SPEC.md §14), and this endpoint is where the backlog is visible.
 */

const chunkCount = (what: string) => z.number().int().min(0).describe(what);

export const IndexStatusSchema = z
  .object({
    indexed: chunkCount(
      "Content chunks that have a usable vector recorded under `identity`. With `pending` and " +
        "`failed` it accounts for every chunk in the corpus, so there is no separate total: a " +
        "fourth number that must equal the sum of three others is a number that can be wrong.",
    ),
    pending: chunkCount(
      "Chunks queued for embedding and not yet embedded — the backlog. Indexing is asynchronous " +
        "and never blocks a write (SPEC.md §9.1: **no save ever waits on indexing**), so a " +
        "non-zero backlog is the normal state right after an edit, an import or a rebuild. It is " +
        "staleness, not drift: `corpus db doctor` stays clean while this drains, and this is the " +
        "surface that makes it visible instead of hidden.",
    ),
    failed: chunkCount(
      "Chunks whose embedding failed and that the server has stopped retrying. Counted rather " +
        "than dropped: a chunk that vanished quietly would leave a corpus that is silently less " +
        "searchable than it looks. Unlike `pending`, this number does not drain on its own — " +
        "`POST /api/index/rebuild` is what re-queues them, after whatever made them fail is fixed.",
    ),
    identity: z
      .string()
      .min(1)
      .nullable()
      .describe(
        "The provider and model that produced this index's vectors, recorded on the first write " +
          "and **sticky** thereafter (SPEC.md §9.1: one index, one model — results from different " +
          "models are never mixed, and the effective model changes only through an explicit act). " +
          "Rendered verbatim and compared for equality, never parsed: the server writes it as " +
          "`provider/model@dim` (e.g. `ollama/nomic-embed-text@768`), with the dimension read from " +
          "the provider's own first response rather than assumed from a table. `null` when nothing " +
          "has been indexed yet — a fresh workspace has no identity, which is not the same claim as " +
          "`disabled`.",
      ),
    rebuilding: z
      .boolean()
      .describe(
        "Whether a **full** rebuild is in flight — `POST /api/index/rebuild`, or the invalidation " +
          "a changed provider/model identity forces. It is what separates `indexing` from " +
          "`stale`: both have work pending, but only one of them is starting over, and an operator " +
          "watching a backlog wants to know which. False during ordinary incremental catch-up, " +
          "however large the backlog.",
      ),
    state: SemanticIndexStateSchema.describe(
      "How caught-up the semantic half of ranking is — the same value, from the same schema, that " +
        "`GET /api/search` and `GET /api/docs/{id}/related` report as `semanticIndex`, so no two " +
        "surfaces can describe one workspace differently. **Derived from the fields above rather " +
        "than stored**, by exactly this mapping: `current` — an identity is recorded and `pending` " +
        "is 0 with no rebuild in flight; `indexing` — `rebuilding` is true, which outranks `stale` " +
        "even though both have work pending; `stale` — an incremental backlog only (`pending > 0`, " +
        "no rebuild in flight); `disabled` — no provider resolved, no recorded identity, or no " +
        "usable vectors, which means lexical ranking only and is an honest answer rather than an " +
        "error (SPEC.md §9.1's local-first default). Required here, unlike the optional " +
        "`semanticIndex` on the retrieval envelopes: this response *is* the claim, so there is " +
        "nothing for its absence to mean.",
    ),
  })
  .openapi("IndexStatus");

export type IndexStatus = z.infer<typeof IndexStatusSchema>;
