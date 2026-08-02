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
 *   `status` is the same word plus the sentence explaining it, which is the one
 *   extra thing `GET /api/index/status` publishes (`IndexStatus.detail`).
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
 * **The cooldown is ended by the event, not by the clock.** It exists for
 * endpoints that stay down; a model artifact finishing its download is the one
 * unavailability that resolves itself, and waiting out 30 s of `disabled` after
 * the bytes have landed is a first-run experience that reads as "permanently
 * off" (the SERVER-048 evaluation, LEDGER-1). So the engine calls
 * {@link SemanticRetrieval.invalidateResolution} when the download completes,
 * and a status read asks the engine's `availability()` — a `stat`, not a
 * network call — while the cache says the model is missing.
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
import {
  resolveEmbeddingProvider,
  type DisabledReason,
  type ProviderResolution,
  type ResolutionErrorReason,
} from "./resolve.js";
import { recordedIdentities } from "./embeddings.js";
import type { EmbeddingSettings } from "./settings.js";
import {
  createIndexRebuildFlag,
  semanticIndexState,
  type EffectiveModel,
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

/**
 * The state word plus the sentence beside it — `GET /api/index/status`'s two
 * derived fields (`IndexStatus.state` and the 2026-08-01 rider's `detail`).
 *
 * `detail` is present only when the word alone is not the whole story: a model
 * downloading, a model absent, a configured endpoint that did not answer, an
 * index built by another model. A caught-up index explains itself through the
 * counts, and inventing a sentence for it would be noise on every render.
 */
export interface SemanticStatus {
  readonly state: SemanticIndexState;
  readonly detail?: string | undefined;
}

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
  /**
   * Drops the resolution cooldown, so the next question re-resolves instead of
   * repeating the last "nothing resolved" answer.
   *
   * The cooldown exists for endpoints that stay down: an unreachable configured
   * provider must cost one timeout per cooldown rather than one per request. A
   * model finishing its download is the opposite event — the machine changed,
   * and the cached answer is now about a machine that no longer exists — so the
   * engine calls this the moment the bytes land (`lifecycle.ts` wires
   * `onModelReady` to it). Explicit invalidation rather than a shorter cooldown
   * globally, for `wake()`'s reason (SERVER-046): the caller that knows the wait
   * is over is the one that should end it.
   *
   * It clears only the *timer*. A provider that resolved stays resolved; there
   * is nothing here to invalidate about a working answer.
   */
  invalidateResolution(): void;
  /** SERVER-046's rebuild flag — the bit that makes `indexing` outrank `stale`. */
  readonly rebuild: IndexRebuildFlag;
  /** The state word alone, for a path with no ranking to do. */
  state(): Promise<SemanticIndexState>;
  /** The state word and the sentence that explains it — `GET /api/index/status`. */
  status(): Promise<SemanticStatus>;
  /**
   * What this server can embed with right now (SERVER-046's `db doctor` half).
   *
   * Deliberately **not** `readiness().active`: that one is filtered by what the
   * index holds, and reports "no provider" in exactly the case the doctor needs
   * to see — an index whose vectors all carry a foreign identity. This answers
   * the narrower question resolution alone decides.
   */
  effectiveModel(): Promise<EffectiveModel>;
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
  /**
   * Why the semantic half is not ranking, when it is not — the sentence
   * {@link SemanticStatus.detail} publishes. `undefined` whenever `active` is
   * set: a working index needs no explanation.
   */
  readonly detail?: string | undefined;
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
  /**
   * Bumped by {@link SemanticRetrieval.invalidateResolution}, captured by each
   * resolution when it starts.
   *
   * A resolution is a *snapshot question*, and the answer can outlive the machine
   * it was asked about: a resolution that begins while the model is still
   * downloading is already in flight when the bytes land, so its "nothing
   * resolved" verdict lands **after** the invalidation that was supposed to end
   * the wait — and re-arms the full cooldown from a fact that stopped being true
   * mid-call. That is LEDGER-1's symptom reproduced by a race rather than by the
   * clock. So a resolution whose generation has moved does not get to write the
   * cooldown; the next question resolves fresh instead.
   *
   * A *successful* resolution is adopted regardless of generation, for the reason
   * `invalidateResolution` states in its own contract: it clears the timer, and
   * there is nothing to invalidate about a working answer.
   */
  let generation = 0;
  /**
   * The last two answers resolution gave, kept for {@link SemanticRetrieval.effectiveModel}
   * alone. `active` is cleared both by a genuine failure and by `forget()`'s
   * cooldown — and `forget()` fires precisely on the foreign-identity case the
   * doctor exists to catch, so a doctor reading `active` would see "nothing
   * resolved" exactly when something did.
   */
  let lastIdentity: string | null = null;
  let lastUnavailable = "no embedding provider has resolved yet";
  /**
   * Why the last resolution produced nothing, kept because exactly one of those
   * reasons expires by itself: a model that has not been downloaded *yet*. See
   * {@link modelWatch}.
   */
  let lastReason: DisabledReason | ResolutionErrorReason | undefined;

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

  /**
   * Drops the cached provider and starts a cooldown.
   *
   * `cause` is what the cooled-down answers that follow will say. Without it
   * they would repeat the last *resolution* failure — and both callers here drop
   * a provider that resolved perfectly well, so that sentence would be about an
   * event that did not happen. `lastIdentity` is deliberately left alone: a
   * cooldown is a reason to stop dialling, never a reason to forget what
   * answered (see {@link SemanticRetrieval.effectiveModel}).
   */
  const forget = (cause?: {
    readonly detail: string;
    readonly reason: DisabledReason | ResolutionErrorReason;
  }): void => {
    active = undefined;
    retryAfterMs = now() + cooldownMs;
    if (cause === undefined) return;
    lastUnavailable = cause.detail;
    lastReason = cause.reason;
  };

  async function ensureProvider(): Promise<ActiveProvider | undefined> {
    if (active !== undefined) return active;
    if (now() < retryAfterMs) return undefined;
    // Single-flight: two searches arriving together must not both load a model.
    inFlight ??= (async () => {
      const startedAt = generation;
      const resolution = await resolveProvider();
      if (resolution.kind === "provider") {
        active = { provider: resolution.provider, identity: resolution.identity };
        lastIdentity = resolution.identity;
        lastReason = undefined;
        retryAfterMs = 0;
        return active;
      }
      logger.debug("semantic ranking is lexical-only", {
        reason: resolution.reason,
        detail: resolution.detail,
      });
      // Answered about a machine that has since changed — see {@link generation}.
      // The verdict is still true of *this* request (nothing resolved, so this
      // one is lexical), but it may not shut the door on the next one.
      if (startedAt !== generation) return undefined;
      lastIdentity = null;
      lastUnavailable = resolution.detail;
      lastReason = resolution.reason;
      retryAfterMs = now() + cooldownMs;
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
        detail: lastUnavailable,
      };
    }

    const census = vectorCensus(db, resolved.identity);
    const foreign = census.atIdentity === 0 && census.total > 0;
    if (foreign) {
      forget({
        detail:
          `the index's ${String(census.total)} vector(s) were produced by ` +
          `${recordedIdentities(db).join(", ")}, and ${resolved.identity} is what resolves now; ` +
          "`corpus index rebuild` re-picks",
        reason: "sticky-model-unavailable",
      });
    }

    const facts: SemanticIndexFacts = {
      providerResolved: true,
      usableVectors: census.atIdentity,
      pending,
      rebuilding: rebuild.active,
    };

    if (census.atIdentity > 0) return { active: resolved, facts };
    return {
      active: undefined,
      facts,
      // Two different silences, and the operator's next move differs: one needs
      // a rebuild, the other needs nothing but time.
      detail: foreign
        ? lastUnavailable
        : `${resolved.identity} is ready; the index has no vectors yet, so ranking is ` +
          "lexical until the first ones land",
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
      const detail = error instanceof Error ? error.message : String(error);
      logger.info("query embedding failed; this search is lexical only", { detail });
      forget({
        detail: `${provider.ref.provider}/${provider.ref.model} failed while embedding: ${detail}`,
        reason: "provider-unreachable",
      });
      return null;
    }
  }

  /**
   * The engine's answer *right now*, when the cached one is a download that may
   * have moved.
   *
   * Exactly one unavailability reason expires on its own: `model-not-downloaded`
   * stops being true when the bytes land. So while that is what the cache holds,
   * a status read asks the engine again — which is a `stat` of two files, no
   * network and no model load — and gets back the live sentence, progress
   * percentage and all (`engine/engine.ts` puts it in `availability().detail`
   * precisely so it can be read here). Without this, a first-run download
   * renders as one frozen sentence for the whole cooldown, or as nothing at all.
   *
   * Finding the model *present* also ends the cooldown, which covers the
   * download this process did not perform — another workspace's server, or a
   * hand-primed cache. The download this process did perform is handled by
   * {@link SemanticRetrieval.invalidateResolution}, which the engine calls
   * without waiting for anybody to ask.
   *
   * Returns the sentence while the model is still missing, `undefined`
   * otherwise — including when the engine throws, which is resolution's problem
   * to report, not a status read's.
   */
  async function modelWatch(): Promise<string | undefined> {
    if (engine === undefined || active !== undefined) return undefined;
    if (lastReason !== "model-not-downloaded") return undefined;

    let availability;
    try {
      availability = await engine.availability();
    } catch {
      return undefined;
    }
    if (!availability.available) return availability.detail;

    // Same event as `invalidateResolution`, reached by asking rather than by
    // being told, so it ends the cooldown the same way — generation included.
    retryAfterMs = 0;
    generation += 1;
    return undefined;
  }

  /** The state word and its sentence, from one reading of the same facts. */
  async function currentStatus(): Promise<SemanticStatus> {
    // The engine first, because it can end the cooldown: a model that finished
    // downloading between two reads must be adopted by *this* read rather than
    // by the next one, which is the half-minute of "disabled" a first run
    // otherwise ends with (the SERVER-048 evaluation, LEDGER-1).
    const downloading = await modelWatch();
    const { facts, detail } = await readiness();
    // The live sentence outranks the cached one: `readiness` answers from the
    // resolution that was cooled down, and that detail is a snapshot of a
    // percentage which has moved since.
    const sentence = downloading ?? detail;
    return {
      state: semanticIndexState(facts),
      ...(sentence === undefined ? {} : { detail: sentence }),
    };
  }

  const lexicalOnly = (facts: SemanticIndexFacts): SemanticOutcome => ({
    state: semanticIndexState(facts),
    docs: [],
  });

  return {
    useEngine(next) {
      engine = next;
    },
    invalidateResolution() {
      retryAfterMs = 0;
      // A resolution already in flight was asked about the machine as it was
      // before this call; it may no longer re-arm the cooldown behind it.
      generation += 1;
    },
    rebuild,
    async state() {
      return (await currentStatus()).state;
    },
    status: currentStatus,
    async effectiveModel() {
      const resolved = await ensureProvider();
      if (resolved !== undefined) return { kind: "identity", identity: resolved.identity };
      // A cooldown is a reason to stop *dialling*, never a reason to forget what
      // answered last: the identity a provider reported does not expire, and
      // reporting `none` here would make the doctor's verdict depend on how
      // recently somebody searched.
      if (lastIdentity !== null) return { kind: "identity", identity: lastIdentity };
      return { kind: "none", detail: lastUnavailable };
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
