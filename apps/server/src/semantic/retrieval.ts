/**
 * Retrieval's semantic half, as one service both endpoints call (SPEC.md §9.1,
 * §9.2).
 *
 * It answers two questions and one word:
 *
 * - `forQuery` — the documents nearest to a *query string*, which means
 *   embedding that string through the resolved provider at request time.
 * - `forDocument` — the documents nearest to a *document already in the corpus*,
 *   which needs no provider call at all: the vectors are already stored.
 * - `state` — the {@link import("@corpus/contract").SemanticIndexState} both
 *   envelopes carry, computed from the same facts either answer was computed
 *   from, so a single request cannot report a state its own ranking contradicts.
 *
 * **Both halves are gated on one usability predicate**, and that is a decision.
 * `forDocument` could technically produce neighbours with no provider resolved —
 * comparing stored vectors to stored vectors needs nothing live. It does not,
 * because the contract publishes *one* `semanticIndex` word for both endpoints
 * and a workspace answering `disabled` on search while quietly emitting
 * `similar` rows on `related` would make that word a lie about half the surface
 * (sprint-021 TEST-884: "search and related both report `disabled`, both return
 * full lexical results").
 *
 * **Resolution is cached, single-flight, and cooled down.** Resolving embeds a
 * probe — for the embedded engine it also loads a model — so a search that
 * re-resolved would pay that cost per request. It is resolved on the first
 * search rather than at boot for the reason `worker-attach.ts` records: the boot
 * answer is a snapshot, and an engine whose model was still downloading at boot
 * gives a different, better answer later. A failed resolution is not retried for
 * {@link RESOLVE_COOLDOWN_MS}, so an unreachable configured endpoint costs one
 * timeout per cooldown rather than one per request.
 *
 * **A failure degrades the request, never the response code.** A provider that
 * throws while embedding *this* query yields lexical-only results with an honest
 * state word and a 200 — SPEC.md §9.1's promise is that ranking degrades, and a
 * 500 on a search because an embedding service hiccuped would break the endpoint
 * that is supposed to be the degraded one's home.
 */

import type { SemanticIndexState } from "@corpus/contract";
import type { Logger } from "../logger.js";
import type { ProjectionDb } from "../projection/db.js";
import { countPendingChunks } from "./chunks.js";
import type { EmbeddedEngine } from "./embedded-engine.js";
import type { EmbeddingProvider } from "./provider.js";
import { resolveEmbeddingProvider, type ProviderResolution } from "./resolve.js";
import { recordedIdentities } from "./embeddings.js";
import type { EmbeddingSettings } from "./settings.js";
import {
  createIndexRebuildFlag,
  semanticIndexState,
  type IndexRebuildFlag,
  type SemanticIndexFacts,
} from "./state.js";
import {
  documentCentroid,
  nearestDocuments,
  vectorCensus,
  type DocumentVectorMatch,
  type SemanticScope,
} from "./vectors.js";

/**
 * How long a failed or empty resolution is left alone.
 *
 * Long enough that a configured endpoint which is down does not make every
 * search pay its connect timeout; short enough that a model finishing its
 * download, or an `index rebuild` re-picking a provider, is picked up inside the
 * time it takes a person to run the same query again.
 */
export const RESOLVE_COOLDOWN_MS = 30_000;

/** What a semantic half answered, and how caught-up it claims to be. */
export interface SemanticOutcome {
  readonly state: SemanticIndexState;
  /** Nearest documents, best first. Empty whenever the semantic half did not run. */
  readonly docs: readonly DocumentVectorMatch[];
}

export interface SemanticRetrieval {
  /**
   * Binds the in-process engine once `lifecycle.ts` has built it (SERVER-048).
   * `createServer` mounts the routes before the engine exists, so the service is
   * constructed first and learns about the engine afterwards; until it does, and
   * on a build without one, resolution simply reports `engine-not-installed`.
   */
  useEngine(engine: EmbeddedEngine): void;
  /** SERVER-046's rebuild flag — the bit that makes `indexing` outrank `stale`. */
  readonly rebuild: IndexRebuildFlag;
  /** The state word alone, for a path with no ranking to do. */
  state(): Promise<SemanticIndexState>;
  forQuery(text: string, scope: SemanticScope, limit: number): Promise<SemanticOutcome>;
  forDocument(docId: string, scope: SemanticScope, limit: number): Promise<SemanticOutcome>;
}

export interface SemanticRetrievalOptions {
  readonly db: ProjectionDb;
  readonly settings: EmbeddingSettings;
  readonly logger: Logger;
  /**
   * Overrides how a provider is found. Production leaves it out and gets
   * `resolveEmbeddingProvider` over the config plus the bound engine; a test
   * hands over a fixed answer and never touches an engine.
   */
  readonly resolve?: (() => Promise<ProviderResolution>) | undefined;
  readonly now?: (() => number) | undefined;
  readonly cooldownMs?: number | undefined;
}

/** The resolved provider, plus the identity its vectors carry. */
interface ActiveProvider {
  readonly provider: EmbeddingProvider;
  readonly identity: string;
}

/** The facts a request needs before it can decide whether to rank semantically. */
interface Readiness {
  readonly active: ActiveProvider | undefined;
  readonly facts: SemanticIndexFacts;
}

export function createSemanticRetrieval(options: SemanticRetrievalOptions): SemanticRetrieval {
  const { db, logger } = options;
  const now = options.now ?? Date.now;
  const cooldownMs = options.cooldownMs ?? RESOLVE_COOLDOWN_MS;
  const rebuild = createIndexRebuildFlag();

  let engine: EmbeddedEngine | undefined;
  let active: ActiveProvider | undefined;
  let inFlight: Promise<ActiveProvider | undefined> | undefined;
  let retryAfterMs = 0;

  const resolveProvider =
    options.resolve ??
    (() =>
      resolveEmbeddingProvider({
        settings: options.settings,
        // Read fresh on every resolution, exactly as the worker does: an
        // `index rebuild` or a first vector changes what the index is sticky
        // to, and a value captured at construction would steer by a snapshot.
        recordedIdentities: recordedIdentities(db),
        ...(engine === undefined ? {} : { embeddedEngine: engine }),
      }));

  const forget = (): void => {
    active = undefined;
    retryAfterMs = now() + cooldownMs;
  };

  async function ensureProvider(): Promise<ActiveProvider | undefined> {
    if (active !== undefined) return active;
    if (now() < retryAfterMs) return undefined;
    // Single-flight: two searches arriving together must not both load a model.
    inFlight ??= (async () => {
      const resolution = await resolveProvider();
      if (resolution.kind === "provider") {
        active = { provider: resolution.provider, identity: resolution.identity };
        retryAfterMs = 0;
        return active;
      }
      retryAfterMs = now() + cooldownMs;
      logger.debug("semantic ranking is lexical-only", {
        reason: resolution.reason,
        detail: resolution.detail,
      });
      return undefined;
    })().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  }

  /**
   * Everything a request must know before scanning: whether a provider is here,
   * whether the index holds vectors it can be compared against, and how big the
   * backlog is.
   *
   * A provider whose identity matches nothing in a *non-empty* index is dropped
   * rather than kept: the index moved to another model — an `index rebuild`
   * re-picked, or a configured block changed — and the cached answer is now
   * about a model this workspace no longer uses. An index that is merely empty
   * changes nothing, because the provider that resolved is exactly the one that
   * will fill it.
   */
  async function readiness(): Promise<Readiness> {
    const resolved = await ensureProvider();
    const pending = countPendingChunks(db);

    if (resolved === undefined) {
      return {
        active: undefined,
        facts: {
          providerResolved: false,
          usableVectors: 0,
          pending,
          rebuilding: rebuild.active,
        },
      };
    }

    const census = vectorCensus(db, resolved.identity);
    if (census.atIdentity === 0 && census.total > 0) forget();

    return {
      active: census.atIdentity === 0 ? undefined : resolved,
      facts: {
        providerResolved: true,
        usableVectors: census.atIdentity,
        pending,
        rebuilding: rebuild.active,
      },
    };
  }

  /**
   * The query as a vector, or `null` when this request must fall back to
   * lexical. The provider is dropped on failure so the next request re-resolves
   * after the cooldown instead of calling a provider that has started failing.
   */
  async function embedQuery(
    provider: EmbeddingProvider,
    text: string,
  ): Promise<Float32Array | null> {
    try {
      const [vector] = await provider.embed([text]);
      if (vector === undefined || vector.length === 0) return null;
      return vector;
    } catch (error) {
      logger.info("query embedding failed; this search is lexical only", {
        detail: error instanceof Error ? error.message : String(error),
      });
      forget();
      return null;
    }
  }

  const lexicalOnly = (facts: SemanticIndexFacts): SemanticOutcome => ({
    state: semanticIndexState(facts),
    docs: [],
  });

  return {
    useEngine(next) {
      engine = next;
    },
    rebuild,
    async state() {
      const { facts } = await readiness();
      return semanticIndexState(facts);
    },
    async forQuery(text, scope, limit) {
      const { active: resolved, facts } = await readiness();
      if (resolved === undefined) return lexicalOnly(facts);

      const vector = await embedQuery(resolved.provider, text);
      // The one place a *request* degrades below what the index can do: the
      // state has to say so, so it is recomputed with the provider counted as
      // absent rather than reported as whatever the index would have claimed.
      if (vector === null) return lexicalOnly({ ...facts, providerResolved: false });

      return {
        state: semanticIndexState(facts),
        docs: nearestDocuments(db, {
          identity: resolved.identity,
          query: vector,
          scope,
          limit,
        }),
      };
    },
    async forDocument(docId, scope, limit) {
      const { active: resolved, facts } = await readiness();
      if (resolved === undefined) return lexicalOnly(facts);

      const centroid = documentCentroid(db, docId, resolved.identity);
      // Not a degrade: the index is fine, this document just has no vector yet
      // (never embedded, or still pending). The state already says which.
      if (centroid === null) return lexicalOnly(facts);

      return {
        state: semanticIndexState(facts),
        docs: nearestDocuments(db, {
          identity: resolved.identity,
          query: centroid,
          scope,
          limit,
          excludeDocId: docId,
        }),
      };
    },
  };
}
