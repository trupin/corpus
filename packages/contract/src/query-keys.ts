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

/**
 * The semantic index's derived state behind `GET /api/index/status` (SPEC.md
 * §9.1, and §10's console index pill).
 *
 * One segment, exactly as {@link QUEUE_KEY} is one segment for
 * `GET /api/queue/status`: the resource is named, not the endpoint. Anything a
 * client caches under an `["index", …]` prefix therefore refetches on the frame
 * the server actually emits, so a later index query needs no eleventh shape.
 */
export const INDEX_KEY: QueryKey = ["index"];

/**
 * The roster behind `GET /api/agents` — every lane, its resident and its
 * liveness (SPEC.md §7, rider SHARED-043).
 *
 * **This key is what makes §7's "a read, never a push" implementable.** The
 * rider is explicit that the roster and each lane's liveness are *"read behind
 * the ordinary invalidate keys, like any other projection"* — so presence
 * arrives here, as a key name that says "ask again", and never as agent state
 * pushed down the stream. Without a key of its own the only way to deliver
 * liveness would have been to put it in the frame, which is the one thing §2.2
 * rule 3 forbids.
 *
 * One segment, like {@link QUEUE_KEY} and {@link INDEX_KEY}: the resource is
 * named, not the endpoint, so anything a client caches under an `["agents", …]`
 * prefix refetches on the frame the server actually emits.
 *
 * **A roster row is derived, so this key travels with frames named after other
 * resources.** A lane's summary is read off the same `events` and `jobs` rows a
 * queue transition or a job-log append writes, and a row names its conversation
 * by the root thread's current title — so a write that never mentions an agent
 * still changes what `GET /api/agents` answers. The rule an emitter follows is
 * therefore *name every key a route carrying the changed fact is cached under,
 * not the key of the route the fact is named after*; {@link
 * QUERY_KEY_VOCABULARY}'s `agents` entry enumerates the cases, and is the
 * published half of this note.
 */
export const AGENTS_KEY: QueryKey = ["agents"];

/**
 * The reflection clock behind `GET /api/workspace/reflect` (SPEC.md §7, rider 9).
 *
 * **A key of its own, because nothing else invalidates on the right events.**
 * The resource moves on two unrelated things: a document write changes
 * `changed`, and a queue transition changes `pending`, `reflected` and
 * `lastDigest`. A client caching it under `["docs"]` would refetch it on the
 * first and miss the second; under `["queue"]`, the reverse. So the emitter's
 * rule is the union — **name this key wherever `["docs"]` is named, and wherever
 * `["queue"]` is named** — which is a rule an emitter can follow without
 * knowing what a reflection is.
 *
 * One segment, like {@link QUEUE_KEY} and {@link AGENTS_KEY}: the resource is
 * named, not the endpoint.
 */
export const REFLECT_KEY: QueryKey = ["reflect"];

/**
 * One document, by id. Threads are documents, so a thread id is legal here and
 * both `["docs", threadId]` and `["threads", threadId]` are emitted for a turn.
 */
export const docKey = (docId: string): QueryKey => ["docs", docId];

/** One thread and its turns, by thread id — the thread-specific key. */
export const threadKey = (threadId: string): QueryKey => ["threads", threadId];

/** One job's log, by the queue event id that names it. */
export const jobKey = (eventId: string): QueryKey => ["jobs", eventId];

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
  "index",
  "agents",
  "reflect",
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
 * UI that had to re-derive "what does `["jobs", eventId]` mean" from the server's
 * source would drift the first time either side changed.
 */
export const QUERY_KEY_VOCABULARY: Readonly<Record<QueryKeyName, QueryKeyShape>> = {
  docs: {
    shape: '["docs"]',
    key: () => [...DOCS_KEY],
    parameterised: false,
    emittedBy:
      "every document or thread mutation (create, update, move, archive, unarchive, delete, " +
      "thread create, turn append, resolve/reopen, re-attach, mark-seen) and every out-of-band " +
      "file change " +
      "the watcher projects — plus every queue transition, since `needs=failed-job` is computed " +
      "from an event's status and a transition therefore changes what `GET /api/docs?needs=me` " +
      "answers, and a projection rebuild, which replaces every row the collection is read from",
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
      "anything that changes the folder hierarchy: create, move, delete, archive of a skill — " +
      "plus a projection rebuild, which names this key whether or not the hierarchy moved, since " +
      "a rebuild is a resynchronisation instruction rather than a report of a change",
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
      "and the end of an edit session that re-enters a deferred event — plus every change to " +
      "agent presence, since the status carries it: a listener parking, its hold ending, and the " +
      "grace window lapsing — and a projection rebuild, which replaces the rows the counts are " +
      'read from. **A queue transition names `["agents"]` in the same frame**, because a lane row ' +
      "of the roster is derived from the `events` and `jobs` rows the transition writes: see that " +
      "key for the rule behind it",
    refetchedBy: "`GET /api/queue/status` — the console strip's agent pill, depth and halted state",
  },
  jobs: {
    shape: '["jobs"]',
    key: () => [...JOBS_KEY],
    parameterised: false,
    emittedBy:
      "every queue transition, plus any job-log append (coalesced) — over HTTP or out of band — " +
      "and a projection rebuild, which replaces the rows the list is read from. **A transition " +
      'and an append each name `["agents"]` in the same frame**, because a lane row of the roster ' +
      "is derived from the same `events` and `jobs` rows: see that key for the rule behind it",
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
  agents: {
    shape: '["agents"]',
    key: () => [...AGENTS_KEY],
    parameterised: false,
    emittedBy:
      "designating or releasing a thread's resident, a thread's resolution releasing one with it, " +
      "and every change to a lane's liveness — a scoped `idle` parking, its hold ending, and a " +
      "lane lapsing past the grace window — **plus every write that moves a row a lane is " +
      "derived from**: a queue transition or a job-log append, over HTTP or out of band, since a " +
      "lane's `summary` is read off the same `events` and `jobs` rows that write touches; a " +
      "designated root thread being retitled or deleted, since a row carries that conversation's " +
      "title and its existence; and a projection rebuild, which re-derives all of it. The rule " +
      "behind that list is worth stating, because no single call site shows it: **a lane row is " +
      "computed at read time and never stored**, so the roster goes stale on frames named after " +
      "other resources, and an emitter names this key whenever it writes a row the roster reads — " +
      "not only when it writes something called an agent. The derivation itself may change " +
      "without a contract change (`AgentLane.summary` says as much of its own content); the " +
      "invalidation may not",
    refetchedBy:
      "`GET /api/agents` — the composer's recipient picker and every surface showing who is running",
  },
  reflect: {
    shape: '["reflect"]',
    key: () => [...REFLECT_KEY],
    parameterised: false,
    emittedBy:
      '**every frame that names `["docs"]` or `["queue"]`, and no others** — the union, ' +
      "because the resource moves on two unrelated things and each half would miss the other: a " +
      "document mutation or an out-of-band file change moves the unreflected count, while a " +
      "queue transition moves whether a reflection is pending, when the clock last advanced and " +
      "which thread is the latest digest. Stating it as a rule rather than as a list is " +
      "deliberate: an emitter can follow it without knowing what a reflection is, and a write " +
      "added later inherits it",
    refetchedBy:
      "`GET /api/workspace/reflect` — the board bar's Reflect control, its unreflected count and " +
      "the marks each column renders",
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
