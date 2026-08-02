/**
 * The one place countable facts become the one word both retrieval envelopes
 * carry (SPEC.md §9.1; CONTRACT-022's frozen `SEMANTIC_INDEX_STATES`).
 *
 * **The vocabulary is four values and this sprint does not get a fifth.** The
 * issue files for SERVER-045, CONTRACT-023 and CLI-020 all say `catching-up` and
 * `lexical-only`; neither exists, and sprint-021's premise correction C3
 * supersedes them with the published mapping, which
 * `IndexStatusSchema.state`'s description states verbatim:
 *
 * | Wire value | Condition |
 * | --- | --- |
 * | `current` | an identity is recorded, `pending` is 0, no rebuild in flight |
 * | `indexing` | a full rebuild is in flight (`index rebuild`, identity invalidation) |
 * | `stale` | an incremental backlog only: `pending > 0`, no rebuild |
 * | `disabled` | no provider resolved, no recorded identity, or no usable vectors |
 *
 * Two precedence rules make the mapping total, and both are decisions:
 *
 * - **`indexing` outranks everything** (sprint-021 Open Conflict 4, ruled). A
 *   rebuild always implies `pending > 0`, so `stale` would fit as well; the
 *   rebuild flag is the more specific claim and it is the one an operator
 *   watching a backlog needs. It outranks `disabled` too: a rebuild discards the
 *   index before refilling it, so the honest word for "zero vectors, because
 *   something is deliberately rebuilding them" is `indexing`, not `disabled`.
 * - **`disabled` is decided against the *resolved* identity**, not against the
 *   table's contents. Vectors recorded by a model that is not the one resolved
 *   now are unusable by definition — §9.1 forbids mixing results from different
 *   models — so an identity mismatch reports `disabled` and the semantic half is
 *   never consulted, rather than quietly ranking against the wrong model.
 *
 * The whole function is pure, which is what lets SERVER-046's
 * `GET /api/index/status` derive the same word from the same facts without a
 * second copy of the table (`IndexStatus.state` reuses the retrieval envelopes'
 * schema for exactly this reason).
 */

import type { SemanticIndexState } from "@corpus/contract";

export interface SemanticIndexFacts {
  /** Whether a provider resolved *and* answered — false degrades this request to lexical. */
  readonly providerResolved: boolean;
  /** Ready vectors recorded under the resolved provider's identity. */
  readonly usableVectors: number;
  /** Chunks with no embedding yet — §9.1's backlog, derived, never a flag. */
  readonly pending: number;
  /** A full rebuild is in flight (SERVER-046's `POST /api/index/rebuild`). */
  readonly rebuilding: boolean;
}

export function semanticIndexState(facts: SemanticIndexFacts): SemanticIndexState {
  if (facts.rebuilding) return "indexing";
  if (!facts.providerResolved || facts.usableVectors === 0) return "disabled";
  if (facts.pending > 0) return "stale";
  return "current";
}

/**
 * Whether a full rebuild is in flight.
 *
 * A one-bit process-local flag rather than a projection row, because it
 * describes *this server's* in-flight work and not the corpus: a kill mid-rebuild
 * leaves a backlog, which the counts already describe as `stale`, and a flag
 * persisted through the crash would claim a rebuild that no longer has a worker.
 *
 * It lives here rather than in SERVER-046's route module because the three
 * surfaces that publish the state word must read the *same* bit — a workspace
 * that answered `indexing` on `GET /api/index/status` and `stale` on
 * `/api/search` would be exactly the disagreement `IndexStatus` reuses
 * `SemanticIndexStateSchema` to prevent.
 */
export interface IndexRebuildFlag {
  readonly active: boolean;
  begin(): void;
  end(): void;
}

/**
 * The model this server can embed with **right now**, independent of what the
 * index already holds.
 *
 * It exists because two questions look alike and are not: "what produced these
 * vectors?" is answered by the rows (`recordedIdentities`), while "what would
 * produce a vector if we asked?" is answered only by resolution. `db doctor`
 * needs both to tell an index that is merely idle from one whose every vector
 * was produced by a model that is no longer the effective one — the second is
 * §14's drift, the first is not (SERVER-046).
 *
 * The third case is not a fact about the workspace at all: **nobody asked**.
 * `doctor(config)` run standalone — a pre-commit hook, a workspace whose server
 * is not running — has no provider to resolve and must not invent one, so it
 * reports `unknown` and the identity comparison is simply not made. Collapsing
 * `unknown` into `none` would turn "this check did not run" into "nothing can
 * embed", which is a claim about the machine that a read-only file check has no
 * standing to make.
 */
export type EffectiveModel =
  /** No resolution was attempted; the identity comparison is skipped entirely. */
  | { readonly kind: "unknown" }
  /** Resolution ran and produced nothing. `detail` is the operator-facing reason. */
  | { readonly kind: "none"; readonly detail: string }
  /** Resolution produced a provider, and this is the identity it writes. */
  | { readonly kind: "identity"; readonly identity: string };

export function createIndexRebuildFlag(): IndexRebuildFlag {
  // Counted rather than boolean: two overlapping rebuild requests must not have
  // the first one's completion clear the second one's claim.
  let depth = 0;
  return {
    get active() {
      return depth > 0;
    },
    begin() {
      depth += 1;
    },
    end() {
      depth = Math.max(0, depth - 1);
    },
  };
}
