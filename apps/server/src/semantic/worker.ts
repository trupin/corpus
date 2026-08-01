/**
 * The embed worker (SPEC.md §9.1, "asynchronous"): the server-internal loop that
 * turns pending chunks into vectors. It is **not** the agent-facing job queue —
 * nothing about it is a file under `.corpus/queue/`, nothing about it is visible
 * to a subagent, and no `corpus queue` verb reaches it.
 *
 * Four properties define it, and each one is a decision rather than a detail.
 *
 * **Nothing enqueues.** "Pending" is `chunks` left-joined against
 * `chunk_embeddings` (`chunks.ts`) — a fact about content, not a flag. Every
 * source that can create pending work does so by writing chunk rows, and every
 * chunk row in this codebase is written by `projectDocument`
 * (`insertChunkRows`/`deleteDocumentChunks` have exactly one caller,
 * `projection/project-document.ts`). `projectDocument` in turn has exactly three
 * production callers — `runMutation` (`docs/write.ts`, every server-originated
 * save), the watcher's `collectDocument` (out-of-band edits) and
 * `populateFromFiles` (`corpus db rebuild` and the boot catch-up) — and the
 * fourth source, identity invalidation, is the `DELETE` below. So the four
 * sources sprint-021 TEST-853 enumerates funnel into the derived pending set *by
 * construction*, and a hook in any of them would be a second, weaker copy of a
 * guarantee the schema already gives.
 *
 * **The write path never waits.** The worker is driven by the invalidation bus
 * (`events/bus.ts`) — the one channel every mutation already publishes on — and
 * a debounce timer, never by a call inside a request. `runMutation` projects,
 * invalidates and responds; the worker learns about the new chunks after the
 * response is on the wire. A save's latency is therefore independent of how
 * saturated, slow or broken the provider is.
 *
 * **A chunk is embedded or pending, never half.** `writeEmbedding` is a single
 * `INSERT OR REPLACE` carrying the vector, its dimension and the identity that
 * produced them together, so `SIGKILL` at any instant leaves every row either
 * complete or absent, and the pending count on restart is re-derived from the
 * rows rather than recovered from a counter. Nothing here caches a count in
 * memory — {@link indexCounts} is one SQL statement, which is also what
 * SERVER-046's status endpoint reads.
 *
 * **Failure is counted, not swallowed.** A chunk the provider refuses gets a
 * `failed` row with a failure count and a growing retry delay; a provider that
 * refuses *everything* is diagnosed as a provider outage instead, and its chunks
 * stay pending. The difference is decided by evidence rather than assumed — see
 * `splitBatch` below — because "the model cannot encode this passage" and "the
 * endpoint is down" have opposite correct responses.
 */

import type { InvalidationBus } from "../events/bus.js";
import type { Logger } from "../logger.js";
import type { ProjectionDb } from "../projection/db.js";
import { writeEmbedding } from "./embeddings.js";
import type { EmbeddingProvider } from "./provider.js";
import type { ProviderResolution } from "./resolve.js";

/**
 * Chunks handed to the provider in one call. Small on purpose: it bounds how
 * much work a shutdown, a crash or a provider death abandons, and it is the
 * granularity at which progress becomes observable to a second connection
 * (TEST-862). The embedded engine re-batches internally anyway
 * (`engine/engine.ts`'s `EMBED_BATCH_ROWS`), so a larger number here buys
 * throughput from nobody.
 */
export const EMBED_BATCH_SIZE = 16;

/**
 * Chunks selected from SQLite per round. Bodies live in `chunk_search`, an FTS5
 * table with no index on `chunk_id`, so fetching them costs one scan per round
 * regardless of how many are fetched — which is precisely why a round claims far
 * more than a provider batch and slices it up in memory.
 */
export const EMBED_CLAIM_SIZE = 256;

/**
 * The retry ladder, in milliseconds, indexed by failure count. It is one
 * constant serving two purposes: how long a *chunk* waits before it is offered
 * again, and how long the *worker* waits after a pass in which the provider
 * produced nothing. Growth is what keeps an unreachable endpoint from becoming a
 * request loop; the 10-minute ceiling is what keeps it from becoming a permanent
 * silence.
 */
export const EMBED_BACKOFF_MS = [1_000, 5_000, 30_000, 120_000, 600_000] as const;

/**
 * After this many failures a chunk is left alone: it keeps its `failed` row, it
 * keeps its failure count, it is visible in {@link indexCounts} and in
 * `corpus index status`, and nothing retries it until someone rebuilds the
 * index. Silently retrying forever and silently dropping the chunk are the two
 * dishonest options this number rules out.
 */
export const MAX_CHUNK_FAILURES = 5;

/** Quiet period after a mutation before the worker looks at the corpus. */
export const EMBED_DEBOUNCE_MS = 500;

/**
 * How long the debounce may keep deferring under continuous churn. The watcher's
 * `batchDeadline` guard, for the same reason (`watcher/watcher.ts`): a bound
 * that can decline to make progress is a livelock, not a bound. Ten rapid saves
 * inside the window cost one embed of the final content; a save every 400 ms
 * forever still gets embedded, every {@link EMBED_MAX_DEFER_MS}.
 */
export const EMBED_MAX_DEFER_MS = 5_000;

/** Delay before the next pass when a pass ended with work still to do. */
export const EMBED_INTERVAL_MS = 1_000;

/**
 * How often the worker re-asks the embedded engine whether its model has
 * finished downloading. Deliberately not on {@link EMBED_BACKOFF_MS}: a download
 * in flight is progress, not failure, and escalating a backoff against it would
 * leave a freshly-cached model idle for ten minutes. The engine's own
 * single-flight and cooldown (`engine/engine.ts`) are what stop this from
 * becoming a request storm.
 */
export const EMBED_MODEL_POLL_MS = 5_000;

/**
 * Backoff for a chunk that has failed `failures` times, or for a pass whose
 * provider failed `failures` times in a row. Clamped at both ends: the ladder is
 * 1-based (a `failed` row always has at least one failure) and saturates at its
 * last rung.
 */
export function embedBackoffMs(failures: number): number {
  const last = EMBED_BACKOFF_MS[EMBED_BACKOFF_MS.length - 1] ?? 0;
  if (failures < 1) return EMBED_BACKOFF_MS[0] ?? 0;
  return EMBED_BACKOFF_MS[Math.min(failures, EMBED_BACKOFF_MS.length) - 1] ?? last;
}

/** Staleness accounting, derived. Never cached — a crash or a rename cannot desync it. */
export interface IndexCounts {
  /** Distinct chunk ids the corpus currently has. `indexed + pending + failed`. */
  readonly total: number;
  readonly indexed: number;
  readonly pending: number;
  readonly failed: number;
}

/**
 * The three §9.1 numbers, computed from rows in one statement.
 *
 * Counted from `chunks` outwards, so an embedding whose chunk no longer exists
 * — an orphan, kept deliberately because a restored section re-attaches to it
 * for free (`chunks.ts`) — is in none of the three. That is what makes
 * `indexed + pending + failed === total` an identity rather than a coincidence.
 */
export function indexCounts(db: ProjectionDb): IndexCounts {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT c.chunk_id) AS total,
              COUNT(DISTINCT CASE WHEN e.state = 'ready' THEN c.chunk_id END) AS indexed,
              COUNT(DISTINCT CASE WHEN e.state = 'failed' THEN c.chunk_id END) AS failed,
              COUNT(DISTINCT CASE WHEN e.chunk_id IS NULL THEN c.chunk_id END) AS pending
         FROM chunks c LEFT JOIN chunk_embeddings e ON e.chunk_id = c.chunk_id`,
    )
    .get() as { total: number; indexed: number; failed: number; pending: number };
  return { total: row.total, indexed: row.indexed, pending: row.pending, failed: row.failed };
}

/**
 * `updated_ms + backoff(failures)` as SQL — the instant a failed chunk becomes
 * eligible again.
 *
 * Built from {@link EMBED_BACKOFF_MS} rather than written out, so the ladder has
 * one definition. Every value is an integer literal from a frozen constant, so
 * there is no interpolation of anything a caller supplies.
 */
function retryDueSql(alias: string): string {
  const rungs = EMBED_BACKOFF_MS.map((ms, index) => `WHEN ${String(index + 1)} THEN ${String(ms)}`);
  const last = EMBED_BACKOFF_MS[EMBED_BACKOFF_MS.length - 1] ?? 0;
  return `(${alias}.updated_ms + (CASE ${alias}.failures ${rungs.join(" ")} ELSE ${String(last)} END))`;
}

interface ClaimedChunk {
  readonly chunkId: string;
  readonly headingPath: string;
  readonly body: string;
  readonly failures: number;
}

/**
 * What the provider is asked to encode: the chunk's heading path above its text.
 *
 * The path is the only thing a chunk carries that its own bytes do not — "Rates"
 * under "Billing › EU" and "Rates" under "Billing › US" are different passages
 * that a body-only encoding would map to the same point. Queries are encoded
 * bare (they have no heading path), which is the ordinary asymmetry of dense
 * retrieval and not a mismatch to fix.
 */
export function chunkEmbedInput(chunk: {
  readonly headingPath: string;
  readonly body: string;
}): string {
  return chunk.headingPath === "" ? chunk.body : `${chunk.headingPath}\n\n${chunk.body}`;
}

/**
 * Scales a vector to unit length so a dot product *is* a cosine similarity.
 *
 * Done at write time rather than at query time because it is paid once per chunk
 * instead of once per chunk per query, and because it makes "the stored vectors
 * are normalised" a property of the table rather than an assumption a reader has
 * to remember (SERVER-045's scan reads it that way). The embedded engine already
 * normalises, so this is a no-op for it; a configured HTTP provider may not.
 */
function toUnitVector(vector: Float32Array): Float32Array {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum);
  if (norm === 0 || Math.abs(norm - 1) <= 1e-6) return vector;
  const scaled = new Float32Array(vector.length);
  for (let index = 0; index < vector.length; index += 1) {
    scaled[index] = (vector[index] ?? 0) / norm;
  }
  return scaled;
}

export interface EmbedWorkerHandle {
  /**
   * Runs one pass to completion: resolve if needed, then drain until there is
   * nothing eligible left, the provider fails, or {@link close} is called.
   * Concurrent calls share the pass in flight. Never rejects.
   */
  tick(): Promise<void>;
  /** The derived counts, read fresh. */
  counts(): IndexCounts;
  close(): Promise<void>;
}

export interface EmbedWorkerOptions {
  readonly db: ProjectionDb;
  readonly logger: Logger;
  /**
   * The invalidation bus. Subscribing to it is how the worker learns that
   * something was written without any write path knowing the worker exists.
   * Omitted in tests that drive {@link EmbedWorkerHandle.tick} directly.
   */
  readonly bus?: InvalidationBus | undefined;
  /**
   * Resolves a provider. Called only when the worker has none *and* has work,
   * which is what makes "the model downloads on the first index need, never at
   * boot" true from this end.
   */
  readonly resolve: () => Promise<ProviderResolution>;
  /**
   * SERVER-048's lazy download trigger, called when resolution reports the
   * model is not in the cache yet. Returns immediately; the engine is
   * single-flight and cooldown-guarded, and its progress surfaces through the
   * availability detail the next resolution reports.
   */
  readonly requestModel?: (() => void) | undefined;
  /** `0` means never self-schedule: the SSE heartbeat's convention (`events/sse.ts`). */
  readonly intervalMs?: number | undefined;
  readonly debounceMs?: number | undefined;
  readonly maxDeferMs?: number | undefined;
  readonly modelPollMs?: number | undefined;
  readonly batchSize?: number | undefined;
  readonly claimSize?: number | undefined;
  readonly maxFailures?: number | undefined;
  readonly now?: (() => number) | undefined;
}

type Outcome<T> =
  | { readonly kind: "done"; readonly value: T }
  | { readonly kind: "failed"; readonly error: unknown }
  | { readonly kind: "cancelled" };

interface ActiveProvider {
  readonly provider: EmbeddingProvider;
  readonly identity: string;
  /**
   * Whether this provider has ever returned a vector. It is the only evidence
   * available when a *single* chunk fails and there is no batch to split: a
   * provider that has demonstrably worked is not the suspect, so the chunk is
   * counted; a provider that has never produced anything is, so the chunk stays
   * pending. Scoped to the provider rather than to the pass, because a retry
   * pass carrying one previously-failed chunk is exactly the case where a
   * pass-scoped flag would misread a poisoned chunk as an outage forever.
   */
  healthy: boolean;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function startEmbedWorker(options: EmbedWorkerOptions): EmbedWorkerHandle {
  const { db, logger } = options;
  const intervalMs = options.intervalMs ?? EMBED_INTERVAL_MS;
  const debounceMs = options.debounceMs ?? EMBED_DEBOUNCE_MS;
  const maxDeferMs = options.maxDeferMs ?? EMBED_MAX_DEFER_MS;
  const modelPollMs = options.modelPollMs ?? EMBED_MODEL_POLL_MS;
  const batchSize = Math.max(1, options.batchSize ?? EMBED_BATCH_SIZE);
  const claimSize = Math.max(batchSize, options.claimSize ?? EMBED_CLAIM_SIZE);
  const maxFailures = Math.max(1, options.maxFailures ?? MAX_CHUNK_FAILURES);
  const now = options.now ?? Date.now;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pass: Promise<void> | undefined;
  let active: ActiveProvider | undefined;
  let providerFailures = 0;
  let waitUntil = 0;
  /** Debounce deadline: the instant the quiet period stops being extended. */
  let deferUntil = 0;
  /** Last line reported about *why* nothing is embedding, so it is said once. */
  let notice = "";
  /** The identity whose adoption has already been announced. */
  let announced = "";
  /**
   * Whether the one startup identity check has run. §9.1's invalidation is a
   * question about vectors, not about pending work: an index whose model changed
   * is invalid whether or not anybody has edited anything since.
   */
  let identityChecked = false;

  // Resolved by `close()`. Every await in the pass races against it, which is
  // what lets a shutdown abandon an in-flight provider call instead of waiting
  // out its timeout — and, because the abandoned batch is simply never written,
  // leaves its chunks pending rather than half-indexed.
  let signalClosed = (): void => undefined;
  const closed = new Promise<void>((resolve) => {
    signalClosed = resolve;
  });

  async function untilClosed<T>(work: Promise<T>): Promise<Outcome<T>> {
    // `settled` never rejects, so losing the race cannot float an unhandled one.
    const settled: Promise<Outcome<T>> = work.then(
      (value) => ({ kind: "done", value }) as const,
      (error: unknown) => ({ kind: "failed", error }) as const,
    );
    return Promise.race([settled, closed.then(() => ({ kind: "cancelled" }) as const)]);
  }

  // --- reads -------------------------------------------------------------
  //
  // Statements are prepared through `db.prepare` at the moment of use and never
  // held across an `await`: `POST /api/db/rebuild` closes the connection and
  // reopens it under this same `ProjectionDb` object (`projection/db.ts`'s
  // `reopenAround`), clearing the statement cache, and a `Statement` captured
  // before that swap belongs to a database that no longer has a name.

  function hasWork(at: number): boolean {
    const row = db
      .prepare(
        `SELECT EXISTS(
                  SELECT 1 FROM chunks c
                    LEFT JOIN chunk_embeddings e ON e.chunk_id = c.chunk_id
                   WHERE e.chunk_id IS NULL) AS pending,
                EXISTS(
                  SELECT 1 FROM chunk_embeddings e
                    JOIN chunks c ON c.chunk_id = e.chunk_id
                   WHERE e.state = 'failed' AND e.failures < ?
                     AND ${retryDueSql("e")} <= ?) AS retryable`,
      )
      .get(maxFailures, at) as { pending: number; retryable: number };
    return row.pending === 1 || row.retryable === 1;
  }

  /** Whether the index holds anything at all — the precondition for a mismatch. */
  function hasVectors(): boolean {
    const row = db.prepare("SELECT EXISTS(SELECT 1 FROM chunk_embeddings) AS any").get() as {
      any: number;
    };
    return row.any === 1;
  }

  /** When the soonest not-yet-eligible failed chunk becomes eligible, if any. */
  function nextRetryAt(): number | undefined {
    const row = db
      .prepare(
        `SELECT MIN(${retryDueSql("e")}) AS due
           FROM chunk_embeddings e JOIN chunks c ON c.chunk_id = e.chunk_id
          WHERE e.state = 'failed' AND e.failures < ?`,
      )
      .get(maxFailures) as { due: number | null };
    return row.due === null ? undefined : row.due;
  }

  function pendingIds(limit: number): { chunkId: string; failures: number }[] {
    const rows = db
      .prepare(
        `SELECT DISTINCT c.chunk_id AS chunk_id
           FROM chunks c LEFT JOIN chunk_embeddings e ON e.chunk_id = c.chunk_id
          WHERE e.chunk_id IS NULL
          ORDER BY c.chunk_id
          LIMIT ?`,
      )
      .all(limit) as { chunk_id: string }[];
    return rows.map((row) => ({ chunkId: row.chunk_id, failures: 0 }));
  }

  function retryIds(limit: number, at: number): { chunkId: string; failures: number }[] {
    const rows = db
      .prepare(
        `SELECT e.chunk_id AS chunk_id, e.failures AS failures
           FROM chunk_embeddings e JOIN chunks c ON c.chunk_id = e.chunk_id
          WHERE e.state = 'failed' AND e.failures < ? AND ${retryDueSql("e")} <= ?
          GROUP BY e.chunk_id
          ORDER BY e.updated_ms
          LIMIT ?`,
      )
      .all(maxFailures, at, limit) as { chunk_id: string; failures: number }[];
    return rows.map((row) => ({ chunkId: row.chunk_id, failures: row.failures }));
  }

  /**
   * Bodies for a set of chunk ids, in one pass over `chunk_search`.
   *
   * `chunk_id` is an FTS5 `UNINDEXED` column, so any predicate on it is a scan;
   * asking for the whole claim at once turns what would be one scan per chunk
   * into one scan per round. `GROUP BY` because two positions in a document can
   * share a content-addressed id — one embedding, one text, two rows.
   */
  function bodiesFor(ids: readonly string[]): Map<string, { headingPath: string; body: string }> {
    const found = new Map<string, { headingPath: string; body: string }>();
    if (ids.length === 0) return found;
    const placeholders = ids.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT chunk_id, heading_path, body FROM chunk_search
          WHERE chunk_id IN (${placeholders})
          GROUP BY chunk_id`,
      )
      .all(...ids) as { chunk_id: string; heading_path: string; body: string }[];
    for (const row of rows) {
      found.set(row.chunk_id, { headingPath: row.heading_path, body: row.body });
    }
    return found;
  }

  function claim(at: number): ClaimedChunk[] {
    // Fresh work first: a retry storm must never starve a document somebody just
    // saved.
    const wanted = pendingIds(claimSize);
    if (wanted.length < claimSize) wanted.push(...retryIds(claimSize - wanted.length, at));
    const bodies = bodiesFor(wanted.map((entry) => entry.chunkId));

    const claimed: ClaimedChunk[] = [];
    for (const entry of wanted) {
      const text = bodies.get(entry.chunkId);
      // A chunk row with no `chunk_search` row cannot happen — they are written
      // and deleted together — but embedding an empty string would poison the
      // index far more quietly than skipping it does.
      if (text === undefined) continue;
      claimed.push({ chunkId: entry.chunkId, ...text, failures: entry.failures });
    }
    return claimed;
  }

  // --- writes ------------------------------------------------------------

  function recordReady(
    chunks: readonly ClaimedChunk[],
    vectors: readonly Float32Array[],
    identity: string,
    at: number,
  ): void {
    // Progress resets the complaint: the next outage is news again, and until
    // then a provider failing identically is reported once and not once per
    // attempt.
    notice = "";
    db.transaction(() => {
      chunks.forEach((chunk, index) => {
        const vector = vectors[index];
        if (vector === undefined) return;
        writeEmbedding(db, {
          state: "ready",
          chunkId: chunk.chunkId,
          identity,
          vector: toUnitVector(vector),
          updatedMs: at,
        });
      });
    })();
  }

  function recordFailure(chunk: ClaimedChunk, identity: string, at: number): void {
    writeEmbedding(db, {
      state: "failed",
      chunkId: chunk.chunkId,
      identity,
      failures: chunk.failures + 1,
      updatedMs: at,
    });
  }

  /**
   * Drops every vector this index holds that the resolved provider did not
   * produce — §9.1's "one index, one model", enforced the moment a different
   * model becomes the effective one.
   *
   * It fires for both shapes `checkIndexIdentity` distinguishes: a `mismatch`
   * (every row carries the old identity, so every row goes and the whole corpus
   * re-queues) and a `mixed` index (only the rows from other models go). It
   * cannot fire by accident, because resolution refuses to adopt a provider
   * whose identity differs from a recorded one unless an operator changed the
   * config or rebuilt the index (`resolve.ts`'s stickiness) — a
   * sticky-model-unavailable boot resolves to `disabled`, never reaches here,
   * and leaves every vector valid and searchable.
   */
  function invalidateForeignIdentities(identity: string): void {
    const { changes } = db
      .prepare("DELETE FROM chunk_embeddings WHERE identity <> ?")
      .run(identity);
    if (changes > 0) {
      logger.info(
        `semantic index: discarded ${String(changes)} vectors from another model; ` +
          `re-indexing with ${identity}`,
        { identity, discarded: changes },
      );
    }
  }

  // --- resolution --------------------------------------------------------

  function report(message: string, level: "info" | "error" = "info"): void {
    if (notice === message) return;
    notice = message;
    if (level === "error") logger.error(message);
    else logger.info(message);
  }

  async function ensureProvider(): Promise<ActiveProvider | undefined> {
    if (active !== undefined) return active;

    const outcome = await untilClosed(options.resolve());
    if (outcome.kind === "cancelled" || stopped) return undefined;
    // Whatever the answer, the question has now been asked once.
    identityChecked = true;
    if (outcome.kind === "failed") {
      // `resolveEmbeddingProvider` is written not to throw; if it ever does, it
      // is a provider problem like any other and takes the same ladder.
      noteProviderFailure(`semantic index: resolution failed: ${messageOf(outcome.error)}`);
      return undefined;
    }

    const resolution = outcome.value;
    if (resolution.kind === "provider") {
      invalidateForeignIdentities(resolution.identity);
      active = { provider: resolution.provider, identity: resolution.identity, healthy: false };
      providerFailures = 0;
      waitUntil = 0;
      // Announced on its own variable rather than through `report`: re-adopting
      // the same provider after a failure must not erase the reason the failure
      // was reported, or every retry would log the outage again.
      if (announced !== resolution.identity) {
        announced = resolution.identity;
        logger.info(`semantic index: embedding with ${resolution.identity} (${resolution.source})`);
      }
      return active;
    }

    if (resolution.kind === "error") {
      noteProviderFailure(`semantic index unavailable: ${resolution.detail}`);
      return undefined;
    }

    if (resolution.reason === "model-not-downloaded") {
      // The first index need is what triggers the download (SERVER-048): this
      // call is the product caller its `requestModel` was built for. It returns
      // immediately, and the next resolution's detail carries the progress.
      options.requestModel?.();
      report(`semantic index: ${resolution.detail}`);
      waitUntil = now() + modelPollMs;
      return undefined;
    }

    // Off by config, no engine, unsupported platform, or a sticky model this
    // machine cannot offer: nothing will change without an operator acting, so
    // the worker idles at the ladder's ceiling rather than re-asking every
    // second. It stays on the ladder rather than stopping outright because a
    // permanently silent worker is indistinguishable from a broken one.
    report(`semantic index disabled: ${resolution.detail}`);
    waitUntil = now() + embedBackoffMs(EMBED_BACKOFF_MS.length);
    return undefined;
  }

  function noteProviderFailure(message: string): void {
    active = undefined;
    providerFailures += 1;
    waitUntil = now() + embedBackoffMs(providerFailures);
    // `report` dedupes by message, so a provider failing identically every
    // window logs once, not once per attempt.
    report(message, "error");
  }

  // --- the pass ----------------------------------------------------------

  /** `true` when the batch was written, `false` when the provider is the suspect. */
  async function embedBatch(
    current: ActiveProvider,
    batch: readonly ClaimedChunk[],
  ): Promise<boolean> {
    const outcome = await untilClosed(
      current.provider.embed(batch.map((chunk) => chunkEmbedInput(chunk))),
    );
    if (outcome.kind === "cancelled" || stopped) return false;
    if (outcome.kind === "done") {
      current.healthy = true;
      recordReady(batch, outcome.value, current.identity, now());
      return true;
    }

    if (batch.length === 1) {
      const only = batch[0];
      if (only === undefined) return false;
      // No split to run: whether this provider has ever worked is the only
      // evidence there is. Without it, assume the endpoint rather than the
      // passage and leave the chunk pending.
      if (!current.healthy) {
        noteProviderFailure(`semantic index: embedding failed: ${messageOf(outcome.error)}`);
        return false;
      }
      recordFailure(only, current.identity, now());
      logger.debug("semantic index: chunk failed to embed", {
        chunkId: only.chunkId,
        failures: only.failures + 1,
        error: messageOf(outcome.error),
      });
      return true;
    }

    return splitBatch(current, batch, outcome.error);
  }

  /**
   * The rule that tells a poisoned chunk from a dead provider.
   *
   * A batch that throws says nothing about *which* of its chunks the provider
   * choked on, so it is re-attempted one chunk at a time. If any of those
   * attempts succeeds, the provider is demonstrably working right now and the
   * ones that failed are the chunks' own problem: they get counted. If every one
   * of them fails, the provider is the suspect — the chunks are left pending,
   * untouched and uncounted, and the worker backs off.
   *
   * The cost is bounded by one batch's worth of extra calls per failing batch,
   * and it is what makes TEST-861 true: one bad chunk at the head of the queue
   * never starves the twenty behind it.
   */
  async function splitBatch(
    current: ActiveProvider,
    batch: readonly ClaimedChunk[],
    cause: unknown,
  ): Promise<boolean> {
    const failed: { chunk: ClaimedChunk; error: unknown }[] = [];
    let succeeded = 0;

    for (const chunk of batch) {
      if (stopped) return false;
      const outcome = await untilClosed(current.provider.embed([chunkEmbedInput(chunk)]));
      if (outcome.kind === "cancelled" || stopped) return false;
      if (outcome.kind === "done") {
        current.healthy = true;
        recordReady([chunk], outcome.value, current.identity, now());
        succeeded += 1;
        continue;
      }
      failed.push({ chunk, error: outcome.error });
    }

    if (succeeded === 0) {
      noteProviderFailure(`semantic index: embedding failed: ${messageOf(cause)}`);
      return false;
    }

    for (const entry of failed) {
      recordFailure(entry.chunk, current.identity, now());
      logger.debug("semantic index: chunk failed to embed", {
        chunkId: entry.chunk.chunkId,
        failures: entry.chunk.failures + 1,
        error: messageOf(entry.error),
      });
    }
    return true;
  }

  async function runPass(): Promise<void> {
    if (stopped) return;
    const at = now();
    if (waitUntil > at) return;
    // Two reasons to wake a provider: there is something to embed, or the index
    // holds vectors whose model this process has not verified yet. The second is
    // what makes an identity mismatch a *startup* event rather than something
    // that waits for the next edit — and it fires at most once per process,
    // never on a fresh workspace with nothing to invalidate.
    if (!hasWork(at) && (identityChecked || !hasVectors())) {
      providerFailures = 0;
      return;
    }

    const current = await ensureProvider();
    if (current === undefined || stopped) return;

    while (!stopped) {
      const claimed = claim(now());
      if (claimed.length === 0) break;

      let wrote = false;
      for (let offset = 0; offset < claimed.length && !stopped; offset += batchSize) {
        const batch = claimed.slice(offset, offset + batchSize);
        if (!(await embedBatch(current, batch))) return;
        wrote = true;
      }
      // A round that claimed rows but wrote none would loop forever on the same
      // rows; the only way here is cancellation, which the `while` re-checks.
      if (!wrote) break;
    }

    if (!stopped) {
      providerFailures = 0;
      waitUntil = 0;
    }
  }

  // --- scheduling --------------------------------------------------------

  function schedule(delayMs: number): void {
    if (stopped || intervalMs === 0) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(
      () => {
        timer = undefined;
        void run();
      },
      Math.max(0, delayMs),
    );
    // Never a reason for the process to stay alive: the worker is a background
    // consumer of a corpus nobody is changing while the process is exiting.
    timer.unref?.();
  }

  function run(): Promise<void> {
    pass ??= runPass()
      .catch((error: unknown) => {
        logger.error("semantic index worker failed", { error: messageOf(error) });
      })
      .finally(() => {
        pass = undefined;
        deferUntil = 0;
        scheduleNext();
      });
    return pass;
  }

  function scheduleNext(): void {
    if (stopped || intervalMs === 0) return;
    const at = now();
    const waits: number[] = [];
    // A backoff in force is the whole answer: nothing a query could report can
    // happen before it expires, and waking every `intervalMs` to re-discover
    // that is how a ten-minute ceiling turns into six hundred pointless ticks.
    if (waitUntil > at) {
      schedule(waitUntil - at);
      return;
    }
    try {
      if (hasWork(at)) waits.push(intervalMs);
      const retryAt = nextRetryAt();
      if (retryAt !== undefined && retryAt > at) waits.push(retryAt - at);
    } catch {
      // The database can be closing under us on the shutdown path; there is
      // nothing to schedule in that case and nothing to say about it.
      return;
    }
    if (waits.length === 0) return; // Idle: the bus is what wakes us next.
    schedule(Math.min(...waits));
  }

  const unsubscribe = options.bus?.subscribe(() => {
    if (stopped || intervalMs === 0) return;
    const at = now();
    // The livelock guard: the quiet period may be extended, but only until the
    // deadline opened by the first signal of this burst.
    if (deferUntil === 0) deferUntil = at + maxDeferMs;
    schedule(Math.max(0, Math.min(debounceMs, deferUntil - at)));
  });

  // Boot: a workspace can have pending chunks nobody is about to write to, and
  // an invalidation that never comes is not a signal to wait for.
  schedule(0);

  return {
    tick: () => run(),
    counts: () => indexCounts(db),
    async close() {
      stopped = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      unsubscribe?.();
      signalClosed();
      await pass;
    },
  };
}
