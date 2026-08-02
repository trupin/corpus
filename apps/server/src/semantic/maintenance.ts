/**
 * The semantic index's operational surface: what `GET /api/index/status`
 * reports and what `POST /api/index/rebuild` does (SPEC.md §9.1's verbs bullet,
 * §9.2's index bullet).
 *
 * It is a service rather than two route handlers because the two verbs share
 * three facts that must not be derived twice — the counts, the recorded
 * identity, and the rebuild flag — and because the rebuild has to reach the
 * worker, which does not exist when the routes are mounted. `useWorker` is that
 * late binding, and it is the same shape `SemanticRetrieval.useEngine` already
 * uses for the embedded engine.
 *
 * **Nothing here derives the state word, and nothing here writes the sentence
 * beside it.** `semanticIndexState` in `state.ts` is the single mapping from
 * countable facts to CONTRACT-022's frozen enum, `SemanticRetrieval.status()` is
 * the single caller a request path uses, and the `detail` string is the
 * resolution's or the engine's own words carried through unchanged — so
 * `GET /api/index/status`, `GET /api/search` and `GET /api/docs/{id}/related`
 * cannot describe one workspace differently. Re-deriving it here would be the
 * second copy the contract reuses one schema to prevent.
 */

import type { IndexStatus } from "@corpus/contract";
import type { Logger } from "../logger.js";
import type { ProjectionDb } from "../projection/db.js";
import { recordedIdentity } from "./embeddings.js";
import type { SemanticRetrieval } from "./retrieval.js";
import { semanticIndexState, type EffectiveModel } from "./state.js";
import { indexCounts, type EmbedWorkerHandle, type IndexCounts } from "./worker.js";

export interface IndexMaintenance {
  /**
   * Binds the embed worker once `lifecycle.ts` has started it. Without one —
   * a server built for a unit test, or one with no projection — a rebuild still
   * discards and re-queues; there is simply nothing to drain it.
   */
  useWorker(worker: EmbedWorkerHandle): void;
  /** `GET /api/index/status`. */
  status(): Promise<IndexStatus>;
  /** `POST /api/index/rebuild`, returning the snapshot taken the moment it queued. */
  rebuild(): IndexStatus;
  /** What this server can embed with right now — `GET /api/db/doctor`'s input. */
  effectiveModel(): Promise<EffectiveModel>;
}

export interface IndexMaintenanceOptions {
  readonly db: ProjectionDb;
  readonly semantic: SemanticRetrieval;
  readonly logger: Logger;
}

export function createIndexMaintenance(options: IndexMaintenanceOptions): IndexMaintenance {
  const { db, semantic, logger } = options;
  let worker: EmbedWorkerHandle | undefined;

  /**
   * The counts, the recorded identity and the flag, as the wire's five
   * non-`state` fields.
   *
   * `identity` is the index's own — what produced the vectors that are there —
   * and not what resolution would pick now. `recordedIdentity` answers `null`
   * both for an empty index and for one holding more than one identity; the
   * second is drift, and naming one of two would be picking a winner the
   * contract's "compare for equality, never parse" rule gives no basis for.
   * `corpus db doctor` is the surface that names both.
   */
  const facts = (counts: IndexCounts, rebuilding: boolean): Omit<IndexStatus, "state"> => ({
    indexed: counts.indexed,
    pending: counts.pending,
    failed: counts.failed,
    identity: recordedIdentity(db),
    rebuilding,
  });

  /**
   * Runs the rebuild's pass to completion and then lowers the flag.
   *
   * Detached from the request on purpose: the route answers `202`, and a caller
   * that waited would be waiting on one model inference per chunk. The flag is
   * lowered when the pass has nothing eligible left — drained, or the provider
   * gave up. Either way the rebuild is no longer *in flight*, and a backlog that
   * remains is ordinary staleness, which is exactly what `stale` means.
   */
  async function drain(): Promise<void> {
    try {
      await worker?.wake();
    } catch (error) {
      // `wake` swallows the pass's own failures; anything reaching here is a
      // bug in the worker's scheduling, and it must not become an unhandled
      // rejection that takes the process down.
      logger.error("semantic index rebuild drain failed", {
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      semantic.rebuild.end();
    }
  }

  return {
    useWorker(next) {
      worker = next;
    },

    async status() {
      // The state word first, the counts second, and that order is deliberate.
      // Neither reading is transactional against a draining worker, so one of
      // them is always the older; the counts being the *newer* pair makes the
      // only observable skew "state says `stale`, pending already reached 0",
      // which reads as a drain that just finished. The other order produces
      // "state says `current`, pending is 5", which reads as a bug.
      //
      // `detail` comes from the same reading as `state`, never from a second
      // question: the sentence has to explain *this* word, and a workspace whose
      // model finished downloading between the two calls would otherwise report
      // `current` beside "downloading … 98%".
      const { state, detail } = await semantic.status();
      return {
        ...facts(indexCounts(db), semantic.rebuild.active),
        state,
        // Omitted rather than `undefined`: the contract's field is optional, and
        // `exactOptionalPropertyTypes` makes the difference a type error rather
        // than a review note.
        ...(detail === undefined ? {} : { detail }),
      };
    },

    rebuild() {
      // Raised before anything is discarded, so no request can observe an index
      // with zero vectors and no rebuild in flight — which `semanticIndexState`
      // would honestly, and uselessly, call `disabled`.
      semantic.rebuild.begin();

      let queued: IndexStatus;
      try {
        // The one place stickiness resets (SPEC.md §9.1: "the effective model
        // changes only through an explicit act … or `corpus index rebuild`,
        // which re-picks the current default"). Re-picking is not a separate
        // step: resolution is sticky *to the recorded identities*, so deleting
        // every row is what leaves the next resolution free to choose. Orphaned
        // embeddings go with them — they exist so a restored section re-attaches
        // for free, and after a discard there is nothing to re-attach to.
        const discarded = db.prepare("DELETE FROM chunk_embeddings").run().changes;
        const counts = indexCounts(db);
        logger.info(
          `semantic index rebuild: discarded ${String(discarded)} vector(s); ` +
            `${String(counts.pending)} chunk(s) queued`,
          { discarded, pending: counts.pending },
        );
        queued = {
          ...facts(counts, true),
          // `rebuilding` outranks every other fact (`state.ts`), so the ones
          // this snapshot does not have — whether a provider resolves, how many
          // vectors are usable — cannot change the answer. That is precisely why
          // the acknowledgement needs no provider resolution and can be returned
          // before any work starts.
          state: semanticIndexState({
            providerResolved: false,
            usableVectors: 0,
            pending: counts.pending,
            rebuilding: true,
          }),
        };
      } catch (error) {
        semantic.rebuild.end();
        throw error;
      }

      void drain();
      return queued;
    },

    effectiveModel: () => semantic.effectiveModel(),
  };
}
