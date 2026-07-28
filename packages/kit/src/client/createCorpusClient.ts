import type {
  AppendTurnResponse,
  CaptureResult,
  CreateDocRequest,
  CreateThreadRequest,
  CreateThreadResponse,
  DeleteDocResult,
  DeleteTurnResult,
  Doc,
  DocList,
  DocMutationResponse,
  FolderTree,
  FormAnswerResponse,
  Health,
  Job,
  JobList,
  JobLog,
  Lock,
  LockList,
  MarkSeenResult,
  QueueStatus,
  ReleaseLockResult,
  Thread,
  ThreadMutationResponse,
  UpdateDocRequest,
  UpdateDocResponse,
} from "@corpus/contract";
import {
  createCorpusClient as createContractClient,
  isApiError,
  UploadError,
  uploadCapture,
  uploadCreateThread,
  uploadTurn,
  type EventSourceFactory,
  type EventStream,
  type EventStreamOptions,
  type paths,
} from "@corpus/contract/client";

/**
 * The kit's data path, and the only one plugins get (SPEC.md §10).
 *
 * It wraps `@corpus/contract`'s generated client rather than re-exporting it.
 * The generated `CorpusApi` is an open `client.GET("/any/path")` surface: handing
 * it to a plugin would make "the kit is the only import surface" unenforceable,
 * because every route would be reachable through the kit's own export. What
 * ships instead is one method per operation the kit actually supports, typed
 * from the contract's schemas, with a uniform thrown error.
 */

export interface CorpusClientConfig {
  /**
   * Origin of the workspace server. In the browser this is the page's own
   * origin — the dev proxy and the installed server both make `/api` and
   * `/events` local paths (SPEC.md §3).
   */
  readonly baseUrl: string;
  /**
   * Workspace bearer token (SPEC.md §2.1). **Configuration, never discovery**:
   * the kit reads no file, no environment variable and no cookie. Whoever mounts
   * the provider decides where the token came from.
   */
  readonly token: string;
  /** Injectable transport, for tests and for runtimes with a non-global fetch. */
  readonly fetch?: typeof globalThis.fetch;
}

/** Per-call options every read method accepts, so TanStack can cancel a query. */
export interface RequestOptions {
  readonly signal?: AbortSignal;
}

export interface AppendTurnInput {
  readonly body: string;
  /** Enqueue signal for the agent (SPEC.md §8); omitted lets the server decide. */
  readonly requestsAgent?: boolean;
}

/**
 * The multipart form of the same append (SPEC.md §6 — attachments).
 *
 * `text` is optional because a turn may be attachment-only; a call carrying
 * neither text nor files is rejected before it reaches the network.
 */
export interface AppendTurnUpload {
  readonly text?: string | undefined;
  readonly requestsAgent?: boolean | undefined;
  readonly files: readonly File[];
}

/**
 * The multipart form of `POST /api/threads` (SPEC.md §6, §8) — the global
 * composer's *Ask* with a screenshot, and a selection comment carrying a file.
 *
 * Same relationship to {@link CreateThreadInput} as {@link AppendTurnUpload} has
 * to {@link AppendTurnInput}, and for the same mechanical reason: the multipart
 * branch names the first turn's prose `text` rather than `body`, carries
 * `selector` as one JSON-encoded part, and repeats `files` — none of which
 * `openapi-fetch` can serialise.
 */
export interface CreateThreadUpload {
  readonly parent?: string | undefined;
  /**
   * The context strings are genuinely absent rather than present-and-undefined:
   * every part of a multipart body is a part that was sent, so an `undefined`
   * suffix would be the string `"undefined"` on the wire.
   */
  readonly selector?:
    { readonly exact: string; readonly prefix?: string; readonly suffix?: string } | undefined;
  readonly title?: string | undefined;
  /** Optional: a first turn may be attachment-only, but not empty. */
  readonly text?: string | undefined;
  readonly requestsAgent?: boolean | undefined;
  readonly files: readonly File[];
}

/**
 * `POST /api/capture` (SPEC.md §11) — the composer's *Capture*, which is
 * multipart-only on the wire even without files.
 *
 * `text` is required by the contract: a capture becomes a document's body, and
 * a document with no body is not a thought that should live on.
 */
export interface CaptureInput {
  readonly text: string;
  readonly requestsAgent?: boolean | undefined;
  readonly files?: readonly File[] | undefined;
}

/** The answer to the form in one agent turn (SPEC.md §6). */
export interface FormAnswerInput {
  /** Timestamp of the agent turn carrying the form — the form's identity. */
  readonly ts: string;
  readonly option: string;
  readonly note?: string | undefined;
}

export interface CorpusEventStreamOptions extends Omit<
  EventStreamOptions,
  "baseUrl" | "token" | "onInvalidate"
> {
  readonly onInvalidate: EventStreamOptions["onInvalidate"];
}

export interface CorpusClient {
  readonly baseUrl: string;
  listDocs(filter: DocsFilter, options?: RequestOptions): Promise<DocList>;
  getDoc(id: string, options?: RequestOptions): Promise<Doc>;
  getThread(id: string, options?: RequestOptions): Promise<Thread>;
  getTree(options?: RequestOptions): Promise<FolderTree>;
  listJobs(params: JobsParams, options?: RequestOptions): Promise<JobList>;
  /**
   * `GET /api/jobs/{id}/log?cursor=` — the console's log pane (SPEC.md §7).
   *
   * Cursored because the stream never carries log content: SSE announces that a
   * job's log grew and the console refetches over HTTP. Passing back the
   * previous `nextCursor` is what makes that refetch incremental *and* what
   * prevents duplicates — there is no client-side line diff.
   */
  getJobLog(eventId: string, cursor: number, options?: RequestOptions): Promise<JobLog>;
  listLocks(options?: RequestOptions): Promise<LockList>;
  /** `GET /api/queue/status` — halted flag plus per-status counts (SPEC.md §7). */
  getQueueStatus(options?: RequestOptions): Promise<QueueStatus>;
  getHealth(options?: RequestOptions): Promise<Health>;
  appendTurn(threadId: string, input: AppendTurnInput): Promise<AppendTurnResponse>;
  /**
   * `POST /api/threads/{id}/turns` as `multipart/form-data` — the attachment
   * path (SPEC.md §6).
   *
   * A separate method rather than an optional `files` on {@link appendTurn}
   * because the two are different requests: `openapi-fetch` serialises JSON and
   * has no notion of a repeated binary part, so the multipart branch goes
   * through the contract's hand-written `uploadTurn`. Both answer the same
   * `AppendTurnResponse` and both raise {@link CorpusRequestError}, so a caller
   * branches on which one to call and on nothing else — in particular the `413`
   * an over-cap upload earns arrives with `status: 413` here exactly as a `409`
   * does from the JSON path.
   */
  appendTurnWithFiles(threadId: string, input: AppendTurnUpload): Promise<AppendTurnResponse>;
  /**
   * `DELETE /api/threads/{id}/turns/{ts}` — **user-only** (SPEC.md §6).
   *
   * `ts` is the turn's identity and contains `:`, so it is URL-encoded on the
   * way out. The result names every consequence of the cascade — the thread may
   * have gone with the turn, and the parent's anchor entry with the thread — so
   * a caller drops the right caches instead of guessing.
   */
  deleteTurn(threadId: string, ts: string): Promise<DeleteTurnResult>;
  /**
   * `POST /api/threads/{id}/turns/{ts}/form` — answering the form an agent turn
   * carries (SPEC.md §6).
   *
   * The dedicated route, never a hand-composed turn posted to `/turns`: the
   * server validates the option against the fence it answers, writes the
   * structured answer turn, and enqueues the `form.respond` event that
   * re-triggers the agent. A turn built by hand produces the first of those and
   * none of the rest.
   */
  respondToForm(threadId: string, input: FormAnswerInput): Promise<FormAnswerResponse>;
  /**
   * `GET /attachments/<thread>/<turn-ts>/<name>` — the bytes behind a turn's
   * attachment reference (SPEC.md §6).
   *
   * Fetched rather than linked because the route is behind the workspace bearer
   * token and an `<img src>` carries no `Authorization` header. The caller gets
   * a `Blob` and owns the object URL it makes from it.
   */
  fetchAttachment(target: string, options?: RequestOptions): Promise<Blob>;
  /**
   * `POST /api/docs` — zero-form creation (SPEC.md §11).
   *
   * Also how a board column comes into being: a column IS a `type: view`
   * document with `pinned: true`, so pinning a list is this call with the §11
   * view keys set, and nothing else. See {@link CreateDocInput}.
   */
  createDoc(input: CreateDocInput): Promise<DocMutationResponse>;
  /**
   * `PUT /api/docs/{id}` — the frontmatter/body edit (SPEC.md §9.2).
   *
   * Every field is optional and the server changes only what the body names, so
   * `{ reviewed }` is the "still current" act of SPEC.md §5 and nothing else: it
   * must not carry `body`, and it must not carry `updated`, which is not even a
   * settable field. See {@link UpdateDocChanges}.
   */
  updateDoc(id: string, changes: UpdateDocChanges): Promise<UpdateDocResponse>;
  /**
   * `DELETE /api/docs/{id}` — **user-only** (SPEC.md §7, §9.2).
   *
   * The agent archives and never deletes, so this method exists for exactly one
   * caller: the reader's ⋯ menu, behind an explicit two-click confirmation.
   * Nothing is lost from history — git keeps the file and every version of it —
   * but the document's threads become orphaned records, which is why the result
   * names them.
   */
  deleteDoc(id: string): Promise<DeleteDocResult>;
  /** `POST /api/threads` — a thread on a selection, a whole document, or standalone (SPEC.md §6). */
  createThread(input: CreateThreadInput): Promise<CreateThreadResponse>;
  /**
   * `POST /api/threads` as `multipart/form-data` — a thread whose **first turn**
   * carries attachments (SPEC.md §6, §8).
   *
   * The split mirrors {@link appendTurnWithFiles} exactly: same reason, same
   * error type, same response, so a caller branches on which one to call and on
   * nothing else.
   */
  createThreadWithFiles(input: CreateThreadUpload): Promise<CreateThreadResponse>;
  /**
   * `POST /api/capture` — the composer's Capture (SPEC.md §11).
   *
   * One call, because it is one act: the server creates the `data/docs/inbox/`
   * document, the agent-requested whole-document filing thread that asks for it
   * to be retitled, moved, expanded and tagged, and the event that wakes the
   * agent. Composing that client-side from `createDoc` + `createThread` would be
   * three round trips, two of which can fail after the first succeeded.
   */
  capture(input: CaptureInput): Promise<CaptureResult>;
  /** `POST /api/threads/{id}/resolve` — closes a conversation without deleting it (SPEC.md §6). */
  resolveThread(id: string): Promise<ThreadMutationResponse>;
  /** `POST /api/threads/{id}/reopen` — the inverse; an engaged thread re-triggers the agent again. */
  reopenThread(id: string): Promise<ThreadMutationResponse>;
  /**
   * `POST /api/threads/{id}/seen` — marks a thread read up to its last turn.
   *
   * Deliberately without the partial-read body: the kit's callers are surfaces
   * that *displayed* a thread, and SPEC.md §7's rule is displayed content only.
   */
  markThreadSeen(id: string): Promise<MarkSeenResult>;
  /**
   * `POST /api/locks/{docId}` — take (or renew) this document's edit lock.
   *
   * SPEC.md §7 gives the user's editor session a lock *while actively editing*:
   * "acquired via the server on first keystroke, released on idle/close". It is
   * what the orchestrator's deferral has to look at — without it the agent has
   * no way to know a human is typing, and §7's "the work stays queued and
   * applies when the lock clears" has nothing to wait on.
   *
   * Re-acquiring a lock the caller already holds **renews the lease**, which is
   * how an editing session heartbeats. A lock held by the other party is a
   * `409` carrying that lock — the caller's document is already read-only in
   * that case, so the refusal is information, not an error to surface.
   */
  acquireLock(docId: string, ttlSeconds?: number): Promise<Lock>;
  /**
   * `DELETE /api/locks/{docId}` — give the lock back.
   *
   * Only the holder may release; releasing somebody else's is
   * {@link CorpusClient.breakLock}, which is a different, audited act.
   */
  releaseLock(docId: string): Promise<ReleaseLockResult>;
  /**
   * `POST /api/locks/{docId}/break` — the Force unlock escape hatch (SPEC.md §7).
   *
   * **User-only**, and honest about it: the server records the break in the
   * audit-trail commit and re-queues the agent's deferred edit, so a caller may
   * report both — but only after this resolves, never optimistically.
   */
  breakLock(docId: string): Promise<ReleaseLockResult>;
  /**
   * `POST /api/queue/halt` — writes the `.corpus/HALT` sentinel (SPEC.md §7).
   *
   * The halted flag is **server** state, not a console toggle: `corpus queue
   * halt` from a terminal and this button write the same sentinel, and both
   * surfaces read it back from {@link CorpusClient.getQueueStatus}.
   */
  haltQueue(reason?: string): Promise<QueueStatus>;
  /** `POST /api/queue/resume` — removes the sentinel. */
  resumeQueue(): Promise<QueueStatus>;
  /** `POST /api/jobs/{id}/retry` — returns a failed job's event to `pending/`. */
  retryJob(eventId: string): Promise<Job>;
  /** `POST /api/jobs/{id}/abandon` — gives up on a job; nothing is deleted. */
  abandonJob(eventId: string): Promise<Job>;
  /**
   * Opens the SSE invalidation stream. Kept off `api` upstream because
   * EventSource is not fetch; kept here because the bridge needs it and nothing
   * else does.
   */
  connectEvents(options: CorpusEventStreamOptions): EventStream;
}

type DocsQueryParams = NonNullable<paths["/api/docs"]["get"]["parameters"]["query"]>;
type JobsQueryParams = NonNullable<paths["/api/jobs"]["get"]["parameters"]["query"]>;
type PutDocBody = NonNullable<
  paths["/api/docs/{id}"]["put"]["requestBody"]
>["content"]["application/json"];
type PostDocBody = NonNullable<
  paths["/api/docs"]["post"]["requestBody"]
>["content"]["application/json"];
type PostThreadBody = NonNullable<
  paths["/api/threads"]["post"]["requestBody"]
>["content"]["application/json"];

/**
 * The full `GET /api/docs` grammar (SPEC.md §9.2), with the two comma-separated
 * filters also accepting arrays — a board column holds `["note", "view"]`, not
 * `"note,view"`, and joining at the boundary keeps the caller honest.
 */
/**
 * Every member optional *and* explicitly `undefined`-able.
 *
 * `exactOptionalPropertyTypes` is on repo-wide, which normally means `{ q:
 * undefined }` is not a legal `{ q?: string }`. For a filter type that is
 * exactly backwards: a board column clears a chip by setting the field to
 * `undefined`, and the canonicaliser's whole job is to drop those. Requiring
 * callers to delete keys instead would push a cast into every consumer.
 */
type Clearable<T> = { readonly [K in keyof T]?: T[K] | undefined };

export type DocsFilter = Clearable<Omit<DocsQueryParams, "tag" | "type">> & {
  readonly tag?: string | readonly string[] | undefined;
  readonly type?: string | readonly string[] | undefined;
};

export type JobsParams = Clearable<JobsQueryParams>;

/**
 * The `PUT /api/docs/{id}` body, exactly as the contract declares it.
 *
 * Aliased rather than redeclared: the set of editable fields is the contract's
 * decision, and a hand-written copy here would be one more place to forget
 * `reviewed` — the field whose absence makes staleness lie (SPEC.md §5).
 */
export type UpdateDocChanges = UpdateDocRequest;

/**
 * The `POST /api/docs` body, exactly as the contract declares it.
 *
 * Aliased for the same reason as {@link UpdateDocChanges}: which fields a
 * creation may carry is the contract's decision. In particular the §11 view
 * keys (`pinned`, `order`, `query`, `column`) live here, which is what lets the
 * board create a column without a second write.
 */
export type CreateDocInput = CreateDocRequest;

/** The JSON form of `POST /api/threads`. Attachments are multipart and are not this. */
export type CreateThreadInput = CreateThreadRequest;

/**
 * A non-2xx response, or a 2xx with no body. Carries the parsed `ApiError` when
 * the server sent one so a caller can branch on `code` (`locked`, `forbidden`)
 * without re-parsing the response.
 */
export class CorpusRequestError extends Error {
  override readonly name = "CorpusRequestError";
  readonly status: number;
  readonly code: string | undefined;
  readonly issues: readonly { readonly path: string; readonly message: string }[];

  constructor(operation: string, status: number, payload: unknown) {
    const api = isApiError(payload) ? payload : undefined;
    super(
      `${operation} failed (HTTP ${String(status)}): ${api?.message ?? JSON.stringify(payload)}`,
    );
    this.status = status;
    this.code = api?.code;
    this.issues = api !== undefined && api.code === "bad_request" ? api.issues : [];
  }
}

interface FetchResult<T> {
  readonly data?: T | undefined;
  readonly error?: unknown;
  readonly response: Response;
}

function unwrap<T>(operation: string, result: FetchResult<T>): T {
  if (result.data === undefined) {
    throw new CorpusRequestError(operation, result.response.status, result.error ?? null);
  }
  return result.data;
}

/**
 * Renders a canonical filter record as query parameters.
 *
 * Arrays become comma-separated values (the §9.2 separator; tags are validated
 * comma-free on write, so no escaping scheme is needed). Everything else passes
 * through for `openapi-fetch` to serialise — including parameters the kit has
 * never heard of, so a contract that grows a filter does not need a kit release.
 */
export function toQueryParams(filter: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filter)) {
    params[key] = Array.isArray(value) ? value.join(",") : value;
  }
  return params;
}

/**
 * Runs a multipart upload and re-raises its failure as the kit's own error.
 *
 * The contract's upload helpers throw `UploadError` because they predate this
 * client; a caller must not have to catch two error types depending on whether
 * the turn it sent carried a file. The parsed `ApiError` is carried through, so
 * `code` and `status` survive the translation and a `413` still reads as one.
 */
async function rethrowUploadError<T>(operation: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof UploadError) {
      throw new CorpusRequestError(
        operation,
        error.status,
        error.apiError ?? { code: "bad_request", message: error.message, issues: [] },
      );
    }
    throw error;
  }
}

/**
 * An attachment reference as it appears in a turn body is relative
 * (`attachments/<thread>/<ts>/<name>`); the route is absolute. Leading slashes
 * are normalised away rather than trusted, so a body cannot point this at
 * another origin's path by writing `//evil.example/x`.
 */
function normalizeAttachmentTarget(target: string): string {
  return target.replace(/^\/+/, "");
}

let abortSignalIsPortable: boolean | undefined;

/**
 * Whether this runtime's `Request` accepts this runtime's `AbortSignal`.
 *
 * It always does in a browser, and always does in plain Node. It does **not**
 * under jsdom, which implements `AbortSignal` itself while leaving `fetch` and
 * `Request` to Node's — two realms, and `new Request(url, { signal })` throws
 * `Expected signal to be an instance of AbortSignal`. Every kit consumer tests
 * its components under jsdom, so a client that forwarded the signal
 * unconditionally would be untestable for all of them (this is the same class
 * of environment defect as the shadowed `localStorage` in `apps/ui`).
 *
 * Probed once, on the first request. Query cancellation is therefore live in
 * the browser and quietly absent under jsdom, where nothing is on the wire to
 * cancel.
 */
function canForwardAbortSignal(): boolean {
  if (abortSignalIsPortable === undefined) {
    try {
      new Request("http://127.0.0.1/", { signal: new AbortController().signal });
      abortSignalIsPortable = true;
    } catch {
      abortSignalIsPortable = false;
    }
  }
  return abortSignalIsPortable;
}

export function createCorpusClient(config: CorpusClientConfig): CorpusClient {
  const contract = createContractClient({
    baseUrl: config.baseUrl,
    token: config.token,
    ...(config.fetch ? { fetch: config.fetch } : {}),
  });
  const api = contract.api;

  const signalOf = (options?: RequestOptions): { signal?: AbortSignal } =>
    options?.signal && canForwardAbortSignal() ? { signal: options.signal } : {};

  return {
    baseUrl: config.baseUrl,

    async listDocs(filter, options) {
      // The canonicalised record is intentionally wider than the generated query
      // type (unknown filters are forwarded, see `toQueryParams`), which the type
      // system cannot express without closing the grammar the kit deliberately
      // leaves open.
      const query = toQueryParams(filter) as DocsQueryParams;
      return unwrap(
        "GET /api/docs",
        await api.GET("/api/docs", { params: { query }, ...signalOf(options) }),
      );
    },

    async getDoc(id, options) {
      return unwrap(
        "GET /api/docs/{id}",
        await api.GET("/api/docs/{id}", { params: { path: { id } }, ...signalOf(options) }),
      );
    },

    async getThread(id, options) {
      return unwrap(
        "GET /api/threads/{id}",
        await api.GET("/api/threads/{id}", { params: { path: { id } }, ...signalOf(options) }),
      );
    },

    async getTree(options) {
      return unwrap("GET /api/tree", await api.GET("/api/tree", { ...signalOf(options) }));
    },

    async listJobs(params, options) {
      const query = toQueryParams(params) as JobsQueryParams;
      return unwrap(
        "GET /api/jobs",
        await api.GET("/api/jobs", { params: { query }, ...signalOf(options) }),
      );
    },

    async getJobLog(eventId, cursor, options) {
      return unwrap(
        "GET /api/jobs/{id}/log",
        await api.GET("/api/jobs/{id}/log", {
          params: { path: { id: eventId }, query: { cursor } },
          ...signalOf(options),
        }),
      );
    },

    async listLocks(options) {
      return unwrap("GET /api/locks", await api.GET("/api/locks", { ...signalOf(options) }));
    },

    async getQueueStatus(options) {
      return unwrap(
        "GET /api/queue/status",
        await api.GET("/api/queue/status", { ...signalOf(options) }),
      );
    },

    async getHealth(options) {
      return unwrap("GET /api/health", await api.GET("/api/health", { ...signalOf(options) }));
    },

    async appendTurn(threadId, input) {
      return unwrap(
        "POST /api/threads/{id}/turns",
        await api.POST("/api/threads/{id}/turns", {
          params: { path: { id: threadId } },
          body: {
            body: input.body,
            ...(input.requestsAgent === undefined ? {} : { requestsAgent: input.requestsAgent }),
          },
        }),
      );
    },

    async appendTurnWithFiles(threadId, input) {
      return rethrowUploadError("POST /api/threads/{id}/turns", () =>
        uploadTurn({
          baseUrl: config.baseUrl,
          token: config.token,
          ...(config.fetch ? { fetch: config.fetch } : {}),
          threadId,
          ...(input.text === undefined ? {} : { text: input.text }),
          ...(input.requestsAgent === undefined ? {} : { requestsAgent: input.requestsAgent }),
          files: input.files,
        }),
      );
    },

    async deleteTurn(threadId, ts) {
      return unwrap(
        "DELETE /api/threads/{id}/turns/{ts}",
        await api.DELETE("/api/threads/{id}/turns/{ts}", {
          params: { path: { id: threadId, ts } },
        }),
      );
    },

    async respondToForm(threadId, input) {
      return unwrap(
        "POST /api/threads/{id}/turns/{ts}/form",
        await api.POST("/api/threads/{id}/turns/{ts}/form", {
          params: { path: { id: threadId, ts: input.ts } },
          body: {
            option: input.option,
            ...(input.note === undefined ? {} : { note: input.note }),
          },
        }),
      );
    },

    async fetchAttachment(target, options) {
      const send = config.fetch ?? globalThis.fetch;
      const url = new URL(normalizeAttachmentTarget(target), `${config.baseUrl}/`);
      const response = await send(url, {
        headers: { Authorization: `Bearer ${config.token}` },
        ...(options?.signal && canForwardAbortSignal() ? { signal: options.signal } : {}),
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        throw new CorpusRequestError("GET /attachments", response.status, payload);
      }
      return response.blob();
    },

    async createDoc(input) {
      // Same two-spellings-of-optional mismatch as `updateDoc` below: the
      // generated body type and the zod-inferred request describe identical
      // values under different `exactOptionalPropertyTypes` stances.
      const body = input as PostDocBody;
      return unwrap("POST /api/docs", await api.POST("/api/docs", { body }));
    },

    async updateDoc(id, changes) {
      // `openapi-fetch` types the body from the generated `paths`, which spells
      // the same optional fields with a different `exactOptionalPropertyTypes`
      // stance than the zod-inferred `UpdateDocRequest`. The values are
      // identical; only the two spellings of "optional" differ.
      const body = changes as PutDocBody;
      return unwrap(
        "PUT /api/docs/{id}",
        await api.PUT("/api/docs/{id}", { params: { path: { id } }, body }),
      );
    },

    async deleteDoc(id) {
      return unwrap(
        "DELETE /api/docs/{id}",
        await api.DELETE("/api/docs/{id}", { params: { path: { id } } }),
      );
    },

    async createThread(input) {
      const body = input as PostThreadBody;
      return unwrap("POST /api/threads", await api.POST("/api/threads", { body }));
    },

    async createThreadWithFiles(input) {
      return rethrowUploadError("POST /api/threads", () =>
        uploadCreateThread({
          baseUrl: config.baseUrl,
          token: config.token,
          ...(config.fetch ? { fetch: config.fetch } : {}),
          ...(input.parent === undefined ? {} : { parent: input.parent }),
          ...(input.selector === undefined ? {} : { selector: input.selector }),
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.text === undefined ? {} : { text: input.text }),
          ...(input.requestsAgent === undefined ? {} : { requestsAgent: input.requestsAgent }),
          files: input.files,
        }),
      );
    },

    async capture(input) {
      return rethrowUploadError("POST /api/capture", () =>
        uploadCapture({
          baseUrl: config.baseUrl,
          token: config.token,
          ...(config.fetch ? { fetch: config.fetch } : {}),
          text: input.text,
          ...(input.requestsAgent === undefined ? {} : { requestsAgent: input.requestsAgent }),
          files: input.files ?? [],
        }),
      );
    },

    async resolveThread(id) {
      return unwrap(
        "POST /api/threads/{id}/resolve",
        await api.POST("/api/threads/{id}/resolve", { params: { path: { id } } }),
      );
    },

    async reopenThread(id) {
      return unwrap(
        "POST /api/threads/{id}/reopen",
        await api.POST("/api/threads/{id}/reopen", { params: { path: { id } } }),
      );
    },

    async markThreadSeen(id) {
      return unwrap(
        "POST /api/threads/{id}/seen",
        await api.POST("/api/threads/{id}/seen", { params: { path: { id } } }),
      );
    },

    async acquireLock(docId, ttlSeconds) {
      // The body is optional on the wire, but sending `{}` rather than nothing
      // keeps one code path: a bodyless POST would have to negotiate
      // content-type with the route's JSON validator.
      const body = ttlSeconds === undefined ? {} : { ttl: ttlSeconds };
      return unwrap(
        "POST /api/locks/{docId}",
        await api.POST("/api/locks/{docId}", { params: { path: { docId } }, body }),
      );
    },

    async releaseLock(docId) {
      return unwrap(
        "DELETE /api/locks/{docId}",
        await api.DELETE("/api/locks/{docId}", { params: { path: { docId } } }),
      );
    },

    async breakLock(docId) {
      return unwrap(
        "POST /api/locks/{docId}/break",
        await api.POST("/api/locks/{docId}/break", { params: { path: { docId } } }),
      );
    },

    async haltQueue(reason) {
      // The body is optional in full — a bare POST halts — so an omitted reason
      // sends no body at all rather than `{reason: undefined}`, which would
      // serialise to `{}` and re-record the sentinel with an empty annotation.
      const body = reason === undefined ? undefined : { reason };
      return unwrap(
        "POST /api/queue/halt",
        await api.POST("/api/queue/halt", body === undefined ? {} : { body }),
      );
    },

    async resumeQueue() {
      return unwrap("POST /api/queue/resume", await api.POST("/api/queue/resume", {}));
    },

    async retryJob(eventId) {
      return unwrap(
        "POST /api/jobs/{id}/retry",
        await api.POST("/api/jobs/{id}/retry", { params: { path: { id: eventId } } }),
      );
    },

    async abandonJob(eventId) {
      return unwrap(
        "POST /api/jobs/{id}/abandon",
        await api.POST("/api/jobs/{id}/abandon", { params: { path: { id: eventId } } }),
      );
    },

    connectEvents(options) {
      return contract.connectEvents(options);
    },
  };
}

export type { EventSourceFactory, EventStream };
