/**
 * The **closed** vocabulary of TanStack Query keys the server announces over SSE
 * (SPEC.md §2.2 rule 3, §9.2). The server never pushes data — it names which
 * query keys went stale and the client refetches over plain HTTP — so this
 * module is the shared source of truth for *which* key arrays exist, what emits
 * each one, and what should refetch on it.
 *
 * {@link QUERY_KEY_NAMES} is the whole of it — no more and no fewer.
 * `query-keys.test.ts` pins the set against that list, so a new shape fails a
 * test rather than quietly appearing in a frame the UI ignores.
 *
 * **Zod-free on purpose.** This module imports nothing. `ACTOR_HEADER`/`ACTORS`
 * live outside `schemas/` for the same reason: a browser consumer must be able
 * to learn the key names without bundling the validator. `QueryKeySchema` in
 * `schemas/sse.ts` is the wire-validation half and is pinned to the {@link
 * QueryKey} type declared here.
 *
 * The server's emitter (`apps/server/src/events/keys.ts`) and the UI's SSE
 * bridge both build their keys from here, which is what makes "the published set
 * is the emitted set" true by construction rather than by coincidence.
 */

/**
 * One segment of a query key. Objects are filter records — TanStack Query
 * compares keys structurally, so a filtered list is a key with its filters in it.
 */
export type QueryKeySegment = string | number | Record<string, unknown>;

/** A TanStack Query key: a non-empty array of segments. */
export type QueryKey = QueryKeySegment[];

/** The document collection behind `GET /api/docs` — every list, board column and search. */
export const DOCS_KEY: QueryKey = ["docs"];

/** The `data/docs/` folder tree behind `GET /api/tree`. */
export const TREE_KEY: QueryKey = ["tree"];

/** Queue depth, counts and halted state behind `GET /api/queue/status` (SPEC.md §7). */
export const QUEUE_KEY: QueryKey = ["queue"];

/** The console's job rows behind `GET /api/jobs`; every queue event is a job (SPEC.md §7). */
export const JOBS_KEY: QueryKey = ["jobs"];

/** Live lock banners behind `GET /api/locks` (SPEC.md §7). */
export const LOCKS_KEY: QueryKey = ["locks"];

/**
 * The semantic index's derived state behind `GET /api/index/status` (SPEC.md
 * §9.1, and §11's console index pill).
 *
 * One segment, exactly as {@link QUEUE_KEY} is one segment for
 * `GET /api/queue/status`: the resource is named, not the endpoint. Anything a
 * client caches under an `["index", …]` prefix therefore refetches on the frame
 * the server actually emits, so a later index query needs no eleventh shape.
 */
export const INDEX_KEY: QueryKey = ["index"];

/**
 * One document, by id. Threads are documents, so a thread id is legal here and
 * both `["docs", threadId]` and `["threads", threadId]` are emitted for a turn.
 */
export const docKey = (docId: string): QueryKey => ["docs", docId];

/** One thread and its turns, by thread id — the thread-specific key. */
export const threadKey = (threadId: string): QueryKey => ["threads", threadId];

/** One job's log, by the queue event id that names it. */
export const jobKey = (eventId: string): QueryKey => ["jobs", eventId];

/** One document's lock, by document id. */
export const lockKey = (docId: string): QueryKey => ["locks", docId];

/**
 * Names of every shape, in the order the vocabulary is documented. Pinned by
 * `query-keys.test.ts`, and the render order of the description that reaches
 * `openapi.json` — so it is also what keeps that document byte-stable.
 */
export const QUERY_KEY_NAMES = [
  "docs",
  "doc",
  "tree",
  "thread",
  "queue",
  "jobs",
  "job",
  "locks",
  "lock",
  "index",
] as const;

export type QueryKeyName = (typeof QUERY_KEY_NAMES)[number];

export interface QueryKeyShape {
  /** The key's literal shape, exactly as it appears in an `invalidate` frame. */
  readonly shape: string;
  /**
   * Builds the key. Unparameterised shapes ignore the argument and return a
   * fresh array, so an exported constant can never be mutated through here.
   */
  readonly key: (id: string) => QueryKey;
  /** True when the shape carries an id segment. */
  readonly parameterised: boolean;
  /** Which server action emits it. */
  readonly emittedBy: string;
  /** Which client query should refetch when it arrives. */
  readonly refetchedBy: string;
}

/**
 * The vocabulary itself: every key shape with the emitter that produces it and
 * the consumer that refetches on it. Publishing the *meaning* is the point — a
 * UI that had to re-derive "what does `["locks", docId]` mean" from the server's
 * source would drift the first time either side changed.
 */
export const QUERY_KEY_VOCABULARY: Readonly<Record<QueryKeyName, QueryKeyShape>> = {
  docs: {
    shape: '["docs"]',
    key: () => [...DOCS_KEY],
    parameterised: false,
    emittedBy:
      "every document or thread mutation (create, update, move, archive, unarchive, delete, " +
      "thread create, turn append, resolve/reopen, mark-seen) and every out-of-band file change " +
      "the watcher projects",
    refetchedBy:
      "`GET /api/docs` — every board column, the search overlay, Attention, and every autocomplete",
  },
  doc: {
    shape: '["docs", "<docId|threadId>"]',
    key: docKey,
    parameterised: true,
    emittedBy:
      "a mutation of that one document, and a thread mutation for both the thread and its parent",
    refetchedBy: "`GET /api/docs/{id}` — the open reader for that document",
  },
  tree: {
    shape: '["tree"]',
    key: () => [...TREE_KEY],
    parameterised: false,
    emittedBy:
      "anything that changes the folder hierarchy: create, move, delete, archive of a skill",
    refetchedBy: "`GET /api/tree` — the folder-column picker",
  },
  thread: {
    shape: '["threads", "<threadId>"]',
    key: threadKey,
    parameterised: true,
    emittedBy:
      "thread creation, turn append, turn deletion, resolve/reopen, and mark-seen for that thread",
    refetchedBy: "`GET /api/threads/{id}` — the open thread view and its unread badge",
  },
  queue: {
    shape: '["queue"]',
    key: () => [...QUEUE_KEY],
    parameterised: false,
    emittedBy:
      "every queue transition: enqueue, claim, complete, fail, defer, abandon, reap, halt/resume, " +
      "and any lock release, break or reap that re-enters a deferred event",
    refetchedBy: "`GET /api/queue/status` — the console strip's depth and halted state",
  },
  jobs: {
    shape: '["jobs"]',
    key: () => [...JOBS_KEY],
    parameterised: false,
    emittedBy: "every queue transition, plus any job-log append (coalesced)",
    refetchedBy: "`GET /api/jobs` — the console's job list",
  },
  job: {
    shape: '["jobs", "<eventId>"]',
    key: jobKey,
    parameterised: true,
    emittedBy:
      "an append to that job's log — over HTTP or out of band — and its retry/abandon transitions",
    refetchedBy: "`GET /api/jobs/{id}/log` — the console's live log panel for the selected job",
  },
  locks: {
    shape: '["locks"]',
    key: () => [...LOCKS_KEY],
    parameterised: false,
    emittedBy: "lock acquire, release, force-break and reap",
    refetchedBy: "`GET /api/locks` — the console's held-locks list",
  },
  lock: {
    shape: '["locks", "<docId>"]',
    key: lockKey,
    parameterised: true,
    emittedBy: "acquire, release, force-break and reap of that one document's lock",
    refetchedBy:
      "the open reader for that document, which renders read-only with a holder banner while held",
  },
  index: {
    shape: '["index"]',
    key: () => [...INDEX_KEY],
    parameterised: false,
    emittedBy:
      "the embed worker whenever the index's derived state moves: provider adoption, a new " +
      "disabled or model-download reason, throttled progress while a backlog drains, and the " +
      "caught-up transition — plus an index rebuild's start and end",
    refetchedBy: "`GET /api/index/status` — the console strip's index pill",
  },
};

/**
 * Renders the vocabulary as a markdown list for the `GET /events` description,
 * so `openapi.json` carries the same emitter/consumer notes the module does and
 * a client author reading only the generated document is not left guessing.
 */
export function describeQueryKeyVocabulary(): string {
  return QUERY_KEY_NAMES.map((name) => {
    const entry = QUERY_KEY_VOCABULARY[name];
    return `- \`${entry.shape}\` — emitted by ${entry.emittedBy}. Refetch: ${entry.refetchedBy}.`;
  }).join("\n");
}
