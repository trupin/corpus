import type {
  AgentLane,
  AgentRoster,
  Doc,
  DocRow,
  DocStatus,
  Job,
  QueueStatus,
  RelatedDoc,
  Resident,
  Thread,
  Warning,
} from "@corpus/contract";
import { DEFAULT_RECENT_JOBS } from "@corpus/contract";
import { docRowFixture } from "@corpus/kit/testing";
import { archivedStatusRefusalBody, unknownRecipientBody } from "./serverRefusals";

/**
 * A recording transport for the reader's suites.
 *
 * Stubbed at the **transport** boundary, like `boardFixture`: a test that mocks
 * the kit hooks proves the reader calls a function, while this one proves it
 * issues the requests the server actually answers — which is what the request
 * assertions (no request per ref, one backlinks query, no `DELETE` before the
 * second click) are about.
 */

export interface ReaderCall {
  readonly method: string;
  readonly path: string;
  readonly search: string;
  /** The parsed JSON body, or the raw text when it is not JSON. */
  readonly body: unknown;
  /** Multipart parts by field name; `files` collects every repeated file part. */
  readonly parts?: Readonly<Record<string, string>> | undefined;
  readonly files?: readonly string[] | undefined;
}

export interface ReaderTransport {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: ReaderCall[];
  readonly of: (method: string, path?: string) => ReaderCall[];
  /** Replaces a document mid-test, for out-of-band edits arriving over SSE. */
  readonly put: (doc: Doc) => void;
  /**
   * **The other writer** (SPEC.md §7): rewrites a document behind the page's
   * back and moves its key, exactly as the agent writing the file does.
   *
   * The document the page is holding therefore names a version that no longer
   * exists, and the next body write it sends is refused with a `409` carrying
   * this new document and its fresh key — which is the state a conflict test
   * needs and the one no `put` of a hand-written `Doc` can produce, because a
   * fixture that also chose the key would be choosing the answer.
   */
  readonly writeAsOther: (docId: string, body: string) => Doc;
  /** Settles or raises a job mid-test, for a queue transition arriving over SSE. */
  readonly setJobs: (jobs: readonly Job[]) => void;
  /**
   * **The other tab** (SPEC.md §7): releases a lane's resident behind this
   * page's back, so `GET /api/agents` stops naming it while whatever this page
   * has already cached still does.
   *
   * That disagreement is the whole of UI-118 and it cannot be seeded — it is two
   * moments, not a state — and it is what arms the recipient check below: a pick
   * naming a lane this transport no longer holds is a `422 unknown_recipient`,
   * exactly as `apps/server/src/queue/scope.ts` refuses one.
   */
  readonly releaseLane: (lane: string) => void;
}

export interface ReaderTransportOptions {
  readonly docs?: readonly Doc[];
  readonly threads?: readonly Thread[];
  /** Rows returned for a `/api/docs` collection query, keyed by search string. */
  readonly rows?: Readonly<Record<string, readonly DocRow[]>>;
  /**
   * The ranked answer `GET /api/docs/{id}/related` gives, keyed by document id
   * (UI-025). A document with no entry gets an empty ranking — an empty list,
   * never an error, which is what the route returns for a document nothing
   * relates to.
   */
  readonly related?: Readonly<Record<string, readonly RelatedDoc[]>>;
  /**
   * The console's job rows `GET /api/jobs` answers with — the queue, which is
   * where "does the agent still owe this thread an answer?" is decided (SPEC.md
   * §8, UI-058). Empty by default: a quiet queue is the ordinary state.
   */
  readonly jobs?: readonly Job[];
  /**
   * `GET /api/queue/status`, whose `agent` field says whether anybody is parked
   * (CONTRACT-045) — read by §8's pending row, which will not say "no agent is
   * connected" without it (UI-097).
   *
   * The default answers **nobody**, because that is the truth about a suite that
   * runs no agent; a test asserting the other wording seeds a live one.
   */
  readonly queue?: QueueStatus;
  /**
   * Designated lanes `GET /api/agents` answers with, beside the orchestrator's
   * unconditional row (SPEC.md §7's roster, UI-108).
   *
   * Empty by default, and that is what keeps every suite written before UI-108
   * describing the composer correctly: with one lane there is nothing to choose
   * between, so the recipient control draws nothing at all.
   */
  readonly lanes?: readonly AgentLane[];
  /** `"<METHOD> <pathname>"` → status, for the failure paths. */
  readonly failing?: Readonly<Record<string, number>>;
  /**
   * Every non-`GET` request waits on this before it is answered.
   *
   * The teardown suites need a write that is genuinely in flight while the
   * surface that started it unmounts (UI-012's `holdWrites` gate, UI-015's
   * second application of it): resolve the promise after `cleanup()` and the
   * response lands on a component that is already gone.
   */
  readonly holdWrites?: Promise<void>;
  /**
   * Warnings `POST /api/threads` answers with (SPEC.md §11). A created thread
   * can succeed and still carry them — an unresolved `[[ref]]`, a skipped
   * commit — and they are the half of the outcome the user has to be told
   * about.
   */
  readonly threadWarnings?: readonly Warning[];
}

/** Every field overridable, `frontmatter` field by field rather than wholesale. */
export type DocOverrides = Omit<Partial<Doc>, "frontmatter"> & {
  readonly frontmatter?: Partial<Doc["frontmatter"]>;
};

/**
 * A distinct, well-formed document key per call (SPEC.md §7): 64 lowercase hex
 * characters, which is the only thing about a key a client may know.
 *
 * A counter rather than a hash of the body, deliberately. The key is *derived*
 * server-side and *opaque* client-side; a fixture that hashed the content would
 * let a test accidentally reproduce the server's derivation and then assert
 * against a key it computed — which is precisely the thing §7 forbids a client
 * to do, and the assertion would keep passing after the client started doing it.
 */
let documentKeys = 0;
export function nextDocumentKey(): string {
  documentKeys += 1;
  return documentKeys.toString(16).padStart(64, "0");
}

export function docFixture(overrides: DocOverrides = {}): Doc {
  const frontmatterOverrides = overrides.frontmatter ?? {};
  return {
    body: "",
    path: "data/docs/finance/fixture.md",
    anchors: [],
    key: nextDocumentKey(),
    // SPEC.md §7's advisory signal, and never a gate: no document is read-only
    // because of it.
    userEditing: false,
    ...overrides,
    frontmatter: {
      id: "doc_fixture",
      type: "note",
      title: "Fixture document",
      created: "2026-07-01T09:00:00.000Z",
      updated: "2026-07-02T09:00:00.000Z",
      tags: [],
      status: "open",
      anchors: {},
      due: null,
      reviewed: null,
      evergreen: false,
      origin: null,
      pinned: false,
      order: null,
      query: null,
      extra: {},
      ...frontmatterOverrides,
    },
  };
}

export function threadFixture(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "th_fixture",
    title: "Fixture thread",
    created: "2026-07-01T09:00:00.000Z",
    updated: "2026-07-01T09:05:00.000Z",
    status: "open",
    tags: [],
    parent: null,
    anchor: null,
    agent: "none",
    resident: null,
    turns: [],
    ...overrides,
  };
}

export function threadRowFixture(overrides: Partial<DocRow> = {}): DocRow {
  return docRowFixture({
    id: "th_fixture",
    type: "thread",
    title: "Fixture thread",
    path: "data/threads/th_fixture.md",
    turnCount: 2,
    lastAuthor: "agent",
    lastTurn: "A reply.",
    unread: false,
    awaitingAgent: false,
    ...overrides,
  });
}

/**
 * `GET /api/jobs` as the server answers it, so a test can tell a caller that
 * asks the right question from one that scans (CONTRACT-030, UI-069).
 *
 * The window is the point. `recent` bounds the console's list and is **ignored
 * once `originId` is given**, which is the whole difference between "the agent
 * owes this thread an answer" and "…as far as the 50 most recently touched jobs
 * can tell". A fixture that returned every job whatever was asked would let a
 * caller that never sends the filter pass a test written to prove it does.
 *
 * `jobs` is taken as already ordered most-recently-touched first, as the server
 * returns it — these suites hand it fixtures, not timestamps to sort.
 */
function answerJobs(jobs: readonly Job[], url: URL): readonly Job[] {
  const originId = url.searchParams.get("originId");
  const statuses = url.searchParams.get("status")?.split(",").filter(Boolean);

  let answer = jobs;
  if (originId !== null) answer = answer.filter((job) => job.originId === originId);
  if (statuses !== undefined && statuses.length > 0) {
    answer = answer.filter((job) => statuses.includes(job.status));
  }
  if (originId !== null) return answer;

  const recent = Number(url.searchParams.get("recent") ?? DEFAULT_RECENT_JOBS);
  return answer.slice(0, Number.isFinite(recent) && recent > 0 ? recent : DEFAULT_RECENT_JOBS);
}

/**
 * A workspace with nobody parked and nothing queued — what a suite that runs no
 * agent process is honestly in (CONTRACT-045).
 */
export const QUIET_QUEUE: QueueStatus = {
  agent: { live: false, since: null },
  halted: false,
  pending: 0,
  inProgress: 0,
  deferred: 0,
  processed: 0,
  failed: 0,
  abandoned: 0,
};

/** The same workspace with an agent parked, for the row that says so. */
export function liveQueue(since: string): QueueStatus {
  return { ...QUIET_QUEUE, agent: { live: true, since } };
}

/**
 * The orchestrator's roster row — always present, because the contract says so:
 * "a caller that finds an empty list has found a bug rather than a workspace
 * with no agents".
 */
const ORCHESTRATOR_ROW: AgentLane = {
  lane: "orchestrator",
  resident: null,
  live: false,
  since: null,
  summary: null,
  origin: null,
};

export function readerTransport(options: ReaderTransportOptions = {}): ReaderTransport {
  const calls: ReaderCall[] = [];
  const docs = new Map((options.docs ?? []).map((doc) => [doc.frontmatter.id, doc]));
  const threads = new Map((options.threads ?? []).map((thread) => [thread.id, thread]));
  let jobs = options.jobs ?? [];
  /**
   * Designations made **through this transport** (SPEC.md §7), keyed by thread
   * id, and the seeded lanes released through it.
   *
   * Seeded `options.lanes` are left exactly as the suite wrote them — their
   * liveness is usually the point — so these two only ever add a lane or take
   * one away.
   */
  // The contract's own `Resident`, both halves nullable since CONTRACT-061, so a
  // fixture cannot store a shape the wire refuses.
  const designated = new Map<string, Resident>();
  const released = new Set<string>();

  /**
   * Is `lane` one this transport would call a lane right now — the server's
   * `isDesignatedRoot`, over the same set `GET /api/agents` answers with.
   */
  const isLane = (lane: string): boolean =>
    lane === "orchestrator" ||
    designated.has(lane) ||
    (options.lanes ?? []).some((row) => row.lane === lane && !released.has(row.lane));

  /**
   * The `422` a posting request naming no lane is refused with (SPEC.md §7,
   * `assertRecipientResolvable`), or `undefined`.
   *
   * Modelled here rather than left to the `{}` fallback because the refusal is
   * the point: a pick can go stale between the roster read and the post, and a
   * fixture that accepted one anyway would let a suite assert a routing the
   * server would never have performed (UI-118).
   *
   * The body comes from `serverRefusals.ts` rather than being written out here
   * (UI-120): this copy had lost the server's recovery sentence, and no
   * assertion noticed because they all match on `names no lane`.
   */
  const recipientRefusal = (stated: unknown): Response | undefined => {
    const lane = (stated as { recipient?: unknown } | undefined)?.recipient;
    if (typeof lane !== "string" || isLane(lane)) return undefined;
    return json(unknownRecipientBody(lane), 422);
  };

  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // The body is deliberately withheld from `new Request`. These suites run in
    // jsdom, so a multipart body is jsdom's `FormData` while `Request` is
    // Node's undici — a foreign realm, which Node 22 (what CI runs) refuses to
    // construct a `Request` around even though Node 25 tolerates it. A caller
    // that built its own `Request` (`openapi-fetch` does) is used as-is; a
    // caller that passed a URL plus an `init` is read off the `init`.
    const request =
      input instanceof Request
        ? input
        : new Request(String(input), {
            method: init?.method ?? "GET",
            ...(init?.headers === undefined ? {} : { headers: init.headers }),
          });
    const url = new URL(request.url);
    const call = await recordCall(request, url, init);
    calls.push(call);

    // Recorded first, answered after: a held write has to be observable on the
    // wire while it is still outstanding, which is what the teardown suites
    // wait for before they unmount.
    if (options.holdWrites !== undefined && request.method !== "GET") await options.holdWrites;

    const route = `${request.method} ${url.pathname}`;
    const failure = options.failing?.[route];
    if (failure !== undefined) {
      return json(refusal(route, failure, call), failure);
    }

    if (url.pathname.startsWith("/attachments/")) {
      return new Response("bytes", { status: 200, headers: { "content-type": "image/png" } });
    }

    if (url.pathname === "/api/jobs") return json({ jobs: answerJobs(jobs, url) });
    if (url.pathname === "/api/queue/status") return json(options.queue ?? QUIET_QUEUE);
    /*
     * `GET /api/agents` — §7's roster (UI-108). The orchestrator's row is
     * unconditional on the wire, so it is answered rather than seeded; a suite
     * that wants a designated lane adds it through `lanes`. With one lane the
     * recipient picker draws nothing, which is what every suite written before
     * this feature expects to see.
     */
    if (url.pathname === "/api/agents") {
      // Seeded lanes, minus anything released, plus every lane a designation
      // made here — the roster *is* the set of designations, as it is on the
      // server, so a suite can designate and then read the board.
      const made: AgentLane[] = [...designated].map(([threadId, resident]) => ({
        lane: threadId,
        resident,
        live: false,
        since: null,
        summary: null,
        origin: { id: threadId, title: "Fixture thread" },
      }));
      const seeded = (options.lanes ?? []).filter(
        (row) => !released.has(row.lane) && !designated.has(row.lane),
      );
      return json({ agents: [ORCHESTRATOR_ROW, ...seeded, ...made] } satisfies AgentRoster);
    }
    if (url.pathname === "/api/tree") return json({ folders: [] });

    if (url.pathname === "/api/docs" && request.method === "GET") {
      const items = options.rows?.[url.search] ?? [];
      return json({ items, page: { total: items.length, limit: 50, offset: 0 } });
    }

    if (url.pathname.startsWith("/api/docs/")) {
      const rest = url.pathname.slice("/api/docs/".length);
      /*
       * `POST …/archive` and `POST …/unarchive` (SPEC.md §7): the routes that own
       * the transition, answered here as the server answers them — the document
       * back with its new `status`, so a reader that refetches sees the flip.
       */
      const [docId = "", verb] = rest.split("/");
      /*
       * `GET …/related` (SPEC.md §9.2), matched before the by-id read below —
       * otherwise `id` is `"doc_m/related"`, misses the map and 404s.
       */
      if (verb === "related") {
        return json({ related: options.related?.[docId] ?? [], semanticIndex: "current" });
      }
      if (verb === "archive" || verb === "unarchive") {
        const subject = docs.get(docId);
        if (subject === undefined) return json({ code: "not_found", message: `no ${docId}` }, 404);
        const flipped: Doc = {
          ...subject,
          frontmatter: {
            ...subject.frontmatter,
            // SPEC.md §5: unarchiving returns a document to `resolved` — the
            // state archiving already implied — not to `open` (SERVER-108).
            // The double is not faithful in the other half and never was: the
            // server writes nothing at all for a document that was not
            // archived, while this flips unconditionally. Nothing reads the
            // result today; if something starts to, fix the unconditionality
            // rather than trusting the value.
            status: verb === "archive" ? "archived" : "resolved",
          },
        };
        docs.set(docId, flipped);
        return json({ doc: flipped, warnings: [] });
      }
      const id = rest;
      if (request.method === "DELETE") {
        docs.delete(id);
        return json({ deletedId: id, orphanedThreadIds: [], warnings: [] });
      }
      const doc = docs.get(id);
      if (doc === undefined) return json({ code: "not_found", message: `no ${id}` }, 404);
      if (request.method === "PUT") {
        const changes = (call.body ?? {}) as {
          body?: string;
          key?: string;
          title?: string;
          tags?: string[];
          status?: DocStatus;
          due?: string | null;
        };
        /*
         * SPEC.md §7's check, in the shape the server performs it: a write that
         * replaces the body presents the key of the version it read, and a key
         * naming any other version is refused with the document **as it now
         * stands**, carrying a fresh key. Answering `200` to a stale key would
         * make every conflict test pass against a client that never sent one.
         */
        if (changes.body !== undefined && changes.key !== doc.key) {
          return json(
            {
              code: "stale_key",
              message: "the key names a version this document no longer is",
              doc,
            },
            409,
          );
        }
        /*
         * **The frontmatter delta is applied**, not echoed back unchanged. A
         * live control reads its value from the document the response carries
         * (UI-093's read-your-write), so a stub that answered with the document
         * as it was would make every landed save look like it had been reverted
         * — and would let a form that dropped the person's value pass.
         *
         * The key moves only for a body write, which is narrower than the
         * server (where the key names the whole file). That is deliberate: the
         * conflict suites choose their own keys through `writeAsOther`, and a
         * key that also moved on a title edit would refuse body saves those
         * tests never asked about.
         */
        const written: Doc = {
          ...doc,
          ...(changes.body === undefined ? {} : { body: changes.body, key: nextDocumentKey() }),
          frontmatter: {
            ...doc.frontmatter,
            ...(changes.title === undefined ? {} : { title: changes.title }),
            ...(changes.tags === undefined ? {} : { tags: changes.tags }),
            ...(changes.status === undefined ? {} : { status: changes.status }),
            ...(changes.due === undefined ? {} : { due: changes.due }),
          },
        };
        docs.set(id, written);
        return json({ doc: written, anchors: { remapped: [], orphaned: [] }, warnings: [] });
      }
      return json(doc);
    }

    if (url.pathname.startsWith("/api/threads/")) {
      const rest = url.pathname.slice("/api/threads/".length);
      const [rawId = "", verb, rawTs, subverb] = rest.split("/");
      const id = decodeURIComponent(rawId);
      if (verb === "seen") {
        return json({ threadId: id, lastSeenTs: "2026-07-02T09:00:00.000Z", unread: false });
      }
      /*
       * `POST`/`DELETE …/resident` — SPEC.md §7's designation (UI-109).
       *
       * Answered rather than left to fall through, and recorded rather than
       * echoed: designating changes `GET /api/agents` — the lane *is* the
       * designation — so a fixture that acknowledged the write and left the
       * roster alone would let a badge test pass against a board that never
       * repainted. `residentLanes` is what the roster answers with from here on.
       *
       * **A body with no `name` designates a general resident** (SHARED-048,
       * SERVER-121): the resolved resident comes back with both halves null,
       * exactly as the route answers it. It was `{name: "", …}` before UI-122 —
       * a shape the contract refuses — and a fixture that kept it would have let
       * every general-designation test pass against a state the server cannot
       * produce.
       */
      if (verb === "resident") {
        const name = (call.body as { name?: string } | undefined)?.name;
        if (request.method === "DELETE") {
          designated.delete(id);
          released.add(id);
          return json({ thread: threadSummary(id, false), warnings: [] });
        }
        released.delete(id);
        designated.set(
          id,
          name === undefined
            ? { name: null, docId: null, weight: null }
            : { name, docId: "doc_agentdef", weight: null },
        );
        return json({
          thread: { ...(threadSummary(id, false) as object), resident: designated.get(id) },
          warnings: [],
        });
      }
      if (verb === "resolve" || verb === "reopen") {
        /*
         * The flip is **recorded**, as the server records it (SPEC.md §6): the
         * next `GET /api/threads/{id}` the invalidation triggers has to come
         * back with the new status, or a test that resolves a conversation and
         * waits for what the status change causes is waiting on a change the
         * fixture quietly undid. Same class of stub-fidelity gap as the one
         * `stubCorpus` closed for the browser suites (UI-077).
         */
        const subject = threads.get(id);
        if (subject !== undefined) {
          threads.set(id, { ...subject, status: verb === "resolve" ? "resolved" : "open" });
        }
        return json({ thread: threadSummary(id, verb === "resolve"), warnings: [] });
      }
      const thread = threads.get(id);
      if (verb === "turns" && rawTs !== undefined && subverb === "form") {
        if (thread === undefined) return json({ code: "not_found", message: `no ${id}` }, 404);
        const answer = call.body as { option: string; note?: string };
        const turn = {
          author: "user" as const,
          ts: nextTs(thread),
          body: `**Answered:** ${answer.option}`,
          model: null,
        };
        threads.set(id, { ...thread, turns: [...thread.turns, turn] });
        return json(
          {
            thread: threadSummary(id, thread.status === "resolved"),
            turn,
            eventId: "evt_form",
            warnings: [],
          },
          201,
        );
      }
      if (verb === "turns" && rawTs !== undefined && request.method === "DELETE") {
        if (thread === undefined) return json({ code: "not_found", message: `no ${id}` }, 404);
        const ts = decodeURIComponent(rawTs);
        const remaining = thread.turns.filter((turn) => turn.ts !== ts);
        const deletedThread = remaining.length === 0;
        if (deletedThread) threads.delete(id);
        else threads.set(id, { ...thread, turns: remaining });
        return json({
          deletedTurn: true,
          deletedThread,
          removedAnchor: deletedThread ? thread.anchor : null,
          parentId: thread.parent,
          warnings: [],
        });
      }
      if (verb === "turns" && rawTs === undefined) {
        if (thread === undefined) return json({ code: "not_found", message: `no ${id}` }, 404);
        const refused = recipientRefusal(call.parts ?? call.body);
        if (refused !== undefined) return refused;
        const text =
          call.parts?.["text"] ?? (call.body as { body?: string } | undefined)?.body ?? "";
        const references = (call.files ?? []).map(
          (name) => `[${name}](attachments/${id}/t/${name})`,
        );
        const turn = {
          author: "user" as const,
          ts: nextTs(thread),
          body: [text, references.join("\n")].filter((part) => part !== "").join("\n\n"),
          model: null,
        };
        threads.set(id, { ...thread, turns: [...thread.turns, turn] });
        return json(
          {
            thread: threadSummary(id, thread.status === "resolved"),
            turn,
            eventId: null,
            warnings: [],
          },
          201,
        );
      }
      if (thread === undefined) return json({ code: "not_found", message: `no ${id}` }, 404);
      return json(thread);
    }

    if (url.pathname === "/api/threads" && request.method === "POST") {
      const refusedRecipient = recipientRefusal(call.parts ?? call.body);
      if (refusedRecipient !== undefined) return refusedRecipient;
      /*
       * The ids are **contract-shaped** (`^th_[A-Za-z0-9]+$`, `^anc_…`), and
       * that is not cosmetic: the multipart branch of `createThread` parses this
       * response with `CreateThreadResponseSchema`, while the JSON branch goes
       * through `openapi-fetch` and validates nothing. A `th_child_0` here
       * therefore answered every plain comment happily and refused every comment
       * carrying a file — which read as "attachments do not work" (UI-111). The
       * shapes are the contract's: `th_` then alphanumerics only, so the second
       * underscore `th_child_0` carried is what made it invalid.
       */
      const created = threadFixture({ id: `th_child${String(threads.size)}` });
      threads.set(created.id, created);
      return json(
        {
          thread: created,
          anchorId: "anc_1",
          eventId: null,
          warnings: options.threadWarnings ?? [],
        },
        201,
      );
    }

    return json({});
  };

  return {
    fetch,
    calls,
    of: (method, path) =>
      calls.filter((call) => call.method === method && (path === undefined || call.path === path)),
    put: (doc) => {
      docs.set(doc.frontmatter.id, doc);
    },
    writeAsOther: (docId, body) => {
      const subject = docs.get(docId);
      if (subject === undefined) throw new Error(`writeAsOther: no ${docId}`);
      const written: Doc = { ...subject, body, key: nextDocumentKey() };
      docs.set(docId, written);
      return written;
    },
    setJobs: (next) => {
      jobs = next;
    },
    releaseLane: (lane) => {
      released.add(lane);
      designated.delete(lane);
    },
  };
}

/** One console row, as `GET /api/jobs` returns it (SPEC.md §7). */
export function jobFixture(overrides: Partial<Job> = {}): Job {
  return {
    eventId: "evt_1",
    type: "comment.created",
    status: "pending",
    started: "2026-07-01T10:05:00.000Z",
    updated: "2026-07-01T10:05:00.000Z",
    lastLine: null,
    originId: null,
    originTitle: null,
    blockedOn: null,
    blockedOnTitle: null,
    ...overrides,
  };
}

/**
 * Reads a request's body without assuming JSON: the multipart turn/thread routes
 * send `FormData`, and a fixture that blindly `JSON.parse`d would throw on
 * exactly the attachment paths it exists to exercise.
 */
async function recordCall(request: Request, url: URL, init?: RequestInit): Promise<ReaderCall> {
  const base = { method: request.method, path: url.pathname, search: url.search };
  const contentType = request.headers.get("content-type") ?? "";
  // The `init` is read first because jsdom's `FormData` and Node's `Request`
  // are different realms: a multipart body survives on the init but its
  // content-type header does not survive the `Request` construction. The same
  // environment defect `canForwardAbortSignal` documents in the kit's client.
  const form =
    init?.body instanceof FormData
      ? init.body
      : contentType.startsWith("multipart/form-data")
        ? await request.formData()
        : undefined;
  if (form !== undefined) {
    const parts: Record<string, string> = {};
    const files: string[] = [];
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") parts[key] = value;
      else files.push(value.name);
    }
    return { ...base, body: undefined, parts, files };
  }
  // A string body only ever reaches the fixture on the `init`; a `Request` the
  // caller built is the only thing this may read a body off (see the realm note
  // in `readerTransport`).
  const raw = typeof init?.body === "string" ? init.body : await request.text().catch(() => "");
  if (raw === "") return { ...base, body: undefined };
  try {
    return { ...base, body: JSON.parse(raw) as unknown };
  } catch {
    return { ...base, body: raw };
  }
}

/** A timestamp strictly after every turn the thread already holds (SPEC.md §6). */
function nextTs(thread: Thread): string {
  const last = thread.turns.at(-1)?.ts;
  const at = last === undefined ? Date.now() : new Date(last).getTime() + 60_000;
  return new Date(at).toISOString();
}

function threadSummary(id: string, resolved: boolean): unknown {
  return {
    id,
    title: "Fixture thread",
    status: resolved ? "resolved" : "open",
    parent: null,
    anchor: null,
    agent: "none",
    resident: null,
    created: "2026-07-01T09:00:00.000Z",
    updated: "2026-07-01T09:05:00.000Z",
    turnCount: 1,
    lastAuthor: "user",
    lastTs: "2026-07-01T09:05:00.000Z",
  };
}

/**
 * The `ApiError` a refused status answers with — the server's own body, not an
 * invented one, because what the board renders is `error.message` and, for a
 * `400`, the `issues` it branches on.
 *
 * Route-specific where the route's own `400` is: `POST /api/threads` refuses an
 * ambiguous quote (SERVER-071) — a quote naming more than one passage is an
 * underspecified request, and §6 would rather refuse at creation than guess
 * which passage a conversation is about. Its sentence is written for an API
 * caller, which is exactly why the board has to translate it (UI-068). Every
 * other route keeps the shapeless refusal the failure paths were written
 * against.
 *
 * `PUT /api/docs/{id}` is route-specific for the same reason: its `400` is
 * SERVER-039's *an archived document is not brought back by a `PUT`*, and the
 * form branches on the `issues` that refusal names. A shapeless body there would
 * let a test certify a behaviour — a refused `status` leaving the local map —
 * that the real refusal would never trigger. The body names the status the
 * request actually sent, exactly as the server's does.
 */
function refusal(route: string, status: number, call: ReaderCall): unknown {
  if (status === 413) {
    return { code: "payload_too_large", message: "the upload is over the per-file limit" };
  }
  if (status === 400 && route.startsWith("PUT /api/docs/")) {
    const sent = call.body;
    const next =
      typeof sent === "object" &&
      sent !== null &&
      typeof (sent as Record<string, unknown>)["status"] === "string"
        ? String((sent as Record<string, unknown>)["status"])
        : "open";
    return archivedStatusRefusalBody(route.slice("PUT /api/docs/".length), next);
  }
  if (status === 400 && route === "POST /api/threads") {
    const message =
      "the quoted text occurs more than once in the parent document; send `prefix`/`suffix` " +
      "copied from the file around the occurrence you mean";
    return { code: "bad_request", message, issues: [{ path: "selector.exact", message }] };
  }
  return { code: "conflict", message: "the server refused" };
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The two collection searches a reader always issues, for keying `rows`. */
export function threadsSearch(docId: string): string {
  return `?parent=${docId}&type=thread`;
}

export function backlinksSearch(docId: string): string {
  return `?references=${docId}`;
}

/** The related read a reader issues for the document it has open. */
export function relatedPath(docId: string): string {
  return `/api/docs/${docId}/related`;
}

/** A related row, for the ranking the panel renders (SPEC.md §10). */
export function relatedFixture(overrides: Partial<RelatedDoc> = {}): RelatedDoc {
  return {
    id: "doc_related",
    title: "A related document",
    excerpt: "One line, never a body.",
    relation: "linked",
    ...overrides,
  };
}
