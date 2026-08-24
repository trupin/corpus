// Announcing that the semantic index changed (SPEC.md §9.2, SERVER-116).
//
// The index's **state word** rides on three routes, not one:
//
//   /api/index/status         cached under ["index"]
//   /api/search               cached under ["docs","search",{…}]
//   /api/docs/{id}/related    cached under ["docs",<id>,"related"]
//
// Both emitters — `worker.ts`'s `send` and `maintenance.ts`'s rebuild edges —
// named `["index"]` and nothing else, so an open search overlay kept telling the
// reader that ranking was degraded **after the index had caught up**, until
// something unrelated invalidated its query. The related panel had the same gap.
//
// **What this does.** `["index"]` goes out exactly as it always did, on every
// announcement. `["docs"]` follows **only when the state word actually moved** —
// and the word is *read*, from the same `SemanticRetrieval.state()` the two
// other routes publish, never re-derived here. Every invalidation bug found in
// that sweep was a fact copied onto several surfaces whose copies were not all
// named, and a fourth derivation of the state table would be one more.
//
// **Why not the two designs the issue preferred.**
//
// - *Serve the word only from `/api/index/status` and have the other two
//   surfaces read that route.* This is the design that removes the duplication
//   instead of synchronizing it, and it is the right one — but it is a contract
//   change (`SearchResults.semanticIndex` and `RelatedDocs.semanticIndex` would
//   go), plus a UI change in two components, plus the CLI. Three domains. It is
//   escalated rather than done here, and nothing below stands in its way: the
//   day those fields go, this module goes with them.
// - *Emit a narrower key only the affected surfaces hold.* TanStack matches by
//   prefix, and both affected caches sit **under** `["docs"]` — `["docs","search",…]`
//   and `["docs",<id>,"related"]`. No key covers those two without covering the
//   board's lists as well, unless the UI re-keys them, which is again another
//   domain.
//
// **What it costs.** A state change is rare — a handful per index run, against
// one progress frame per batch — so the board-wide `["docs"]` frame the issue
// was right to fear never lands on a progress tick. The measurement is in
// `announce.test.ts` and in the issue's log.
//
// **The first reading is announced.** The alternative — treat it as a silent
// baseline — misses a transition in exactly the case that matters: a server that
// booted `current`, answered a search, and only *then* had work to do would
// establish its baseline at `stale` and never tell the client the word had left
// `current`. One extra frame per process is the price of not having that hole.

import type { SemanticIndexState } from "@corpus/contract";
import type { InvalidationBus } from "../events/bus.js";
import { DOCS_KEY, INDEX_KEY } from "../events/keys.js";
import type { Logger } from "../logger.js";

export interface IndexAnnouncer {
  /**
   * Something about the index changed. Announces `["index"]` synchronously, and
   * `["docs"]` once the state word has been read and found to have moved.
   *
   * Never throws and never returns a promise: it is called from the worker's
   * synchronous announce path and from a `finally` block, and neither may grow
   * an await or a rejection.
   */
  changed(): void;
}

export interface IndexAnnouncerOptions {
  readonly bus?: InvalidationBus | undefined;
  /**
   * The published state word — `SemanticRetrieval.state()`, which is what
   * `/api/index/status`, `/api/search` and `/api/docs/{id}/related` all report.
   *
   * Omitted, this announcer is exactly what the two emitters did before
   * SERVER-116: `["index"]` and nothing else. That is what every test
   * constructing a worker with a bare `bus` gets, and it keeps the wiring
   * honest — a server that supplies no reader cannot claim to track the word.
   */
  readonly readState?: (() => Promise<SemanticIndexState>) | undefined;
  readonly logger?: Logger | undefined;
}

export function createIndexAnnouncer(options: IndexAnnouncerOptions): IndexAnnouncer {
  const { logger } = options;
  const bus = options.bus;
  const readState = options.readState;
  // Captured into constants the closures below can see as non-optional: an
  // announcer with no bus has nothing to say, and one with no reader has
  // nothing to say it about.
  if (bus === undefined || readState === undefined) {
    const channel = bus;
    return {
      changed: () => {
        channel?.invalidate([INDEX_KEY]);
      },
    };
  }
  const channel = bus;
  const read = readState;

  /** The word the last `["docs"]` frame described; `undefined` before the first. */
  let announced: SemanticIndexState | undefined;
  /** One question at a time; a change arriving during one is answered by a re-read. */
  let asking = false;
  let again = false;

  async function track(): Promise<void> {
    try {
      do {
        again = false;
        const state = await read();
        if (state === announced) continue;
        announced = state;
        // The board's lists are under this prefix too, and that is not
        // collateral: when the index reaches `current`, relevance-ranked
        // columns genuinely rank differently than they did a moment ago.
        channel.invalidate([DOCS_KEY]);
      } while (again);
    } catch (error) {
      // Reading the word touches the projection, and shutdown closes it under
      // whatever is in flight. A frame is never worth a throw there, and the
      // `["index"]` half has already gone out.
      logger?.debug("could not read the semantic index state to announce it", {
        error: String(error),
      });
    } finally {
      asking = false;
    }
  }

  return {
    changed() {
      channel.invalidate([INDEX_KEY]);
      if (asking) {
        again = true;
        return;
      }
      asking = true;
      // Deliberately not awaited: `changed()` is called from a synchronous
      // announce path. `track` never rejects.
      void track();
    },
  };
}
