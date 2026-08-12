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
  FormFieldAnswer,
  Health,
  IndexStatus,
  Job,
  JobList,
  JobLog,
  MarkSeenResult,
  QueueStatus,
  ReattachRefusalReason,
  ReattachThreadRequest,
  ReattachThreadResponse,
  RelatedDocs,
  SearchResults,
  Thread,
  ThreadMutationResponse,
  UpdateDocRequest,
  UpdateDocResponse,
} from "@corpus/contract";
import { ReattachConflictErrorSchema, StaleKeyErrorSchema } from "@corpus/contract";
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

/** One plugin-route call (SPEC.md §10): JSON in, JSON out, nothing else. */
export interface PluginRequestInit {
  /** Defaults to `GET`. */
  readonly method?: "GET" | "POST" | "PUT" | "DELETE";
  /** JSON-encoded when present. */
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

export interface AppendTurnInput {
  readonly body: string;
  /** Enqueue signal for the agent (SPEC.md §8); omitted lets the server decide. */
  readonly requestsAgent?: boolean;
  /**
   * The weight this request states its work should be done at (SPEC.md §7, §11)
   * — one of the **Key** tokens the workspace's own orchestrate skill declares.
   *
   * **Omit it to state no weight**, which means the orchestrator decides,
   * exactly as every request did before this field existed. There is no default
   * and no second spelling of absence: `null` is not a value here and `""` is a
   * `400` (`packages/contract/src/schemas/weight.ts`).
   */
  readonly weight?: string;
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
  /** As {@link AppendTurnInput.weight}: omit for "the orchestrator decides". */
  readonly weight?: string | undefined;
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
  /** As {@link AppendTurnInput.weight}: omit for "the orchestrator decides". */
  readonly weight?: string | undefined;
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
  /** As {@link AppendTurnInput.weight}: omit for "the orchestrator decides". */
  readonly weight?: string | undefined;
  readonly files?: readonly File[] | undefined;
}

/**
 * The answer to the form in one agent turn (SPEC.md §6), submitted whole.
 *
 * **One entry per field *answered*, never per field asked.** A field with
 * nothing given carries no entry at all — absence is the single spelling of
 * blank (CONTRACT-038), so an empty string or an empty selection must never be
 * sent in its place: the server reads one as a value and rejects it against a
 * field's options, where the omission it meant is legal on an optional field.
 * `answers` may itself be empty, which is the real answer a form of only
 * optional fields gets.
 */
export interface FormAnswerInput {
  /** Timestamp of the agent turn carrying the form — the form's identity. */
  readonly ts: string;
  readonly answers: readonly FormFieldAnswer[];
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
  /**
   * `GET /api/search` — ranked retrieval (SPEC.md §9.2).
   *
   * **Not `listDocs({ q, sort: "relevance" })`, and the difference is the
   * payload.** The collection query answers with document *rows*, whose cost
   * scales with the documents; a hit here is an address plus one line — id,
   * title, the heading path of the best-matching passage, a snippet — and never
   * a body. `q` is required: a ranked list with nothing to rank is the other
   * endpoint.
   *
   * The narrower grammar is deliberate. `/api/search` publishes no `sort`, no
   * `offset` and no `pinned`, and silently ignores them if sent, so a caller
   * that wants paging or a stored order wants {@link listDocs} — which is why
   * saved views and board columns stay on it (SPEC.md §11).
   */
  searchCorpus(params: SearchParams, options?: RequestOptions): Promise<SearchResults>;
  /**
   * `GET /api/docs/{id}/related` — the ranked related set for one document
   * (SPEC.md §9.2).
   *
   * Each row says **why** it is related (`linked`, `similar` or `both`), and a
   * caller renders whatever arrives rather than branching on which retrieval
   * phase the server is in: the vocabulary is complete from day one precisely so
   * semantic neighbours can join the same list without a shape change.
   */
  relatedDocs(id: string, params?: RelatedParams, options?: RequestOptions): Promise<RelatedDocs>;
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
  /** `GET /api/queue/status` — halted flag plus per-status counts (SPEC.md §7). */
  getQueueStatus(options?: RequestOptions): Promise<QueueStatus>;
  /**
   * `GET /api/index/status` — the semantic index's own health report behind the
   * console strip's index pill (SPEC.md §9.1, §11's index-pill rider).
   *
   * Read-only and parameterless, like {@link getQueueStatus}: the endpoint
   * answers one snapshot of derived state, and every field on it is a fact the
   * server derived — `state` is what a caller decides with and `detail` is the
   * sentence it renders. **No rebuild method ships beside it**: kicking a
   * rebuild off is `corpus index rebuild`'s job (SPEC.md §9.1), and a plugin
   * that could discard the workspace's vectors through the kit would be a
   * destructive act on the strength of an import.
   */
  getIndexStatus(options?: RequestOptions): Promise<IndexStatus>;
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
   * `<method> /api/x/<plugin>/<path>` — a plugin's own server routes
   * (SPEC.md §10, PLUGINS-001).
   *
   * Plugin routes live outside the generated contract (a new plugin is zero
   * contract changes), so this is the one deliberately untyped door in the
   * client: the caller hands a plugin-relative path, gets `unknown` back, and
   * validates the payload with its own schema — Zod at the boundary, exactly
   * as the server does on the way in. Going through the client rather than a
   * private `fetch` keeps the bearer token, the base URL and the error shape
   * (`CorpusRequestError`) in one place, and keeps the kit's cache the only
   * cache — see {@link usePluginQuery} for the read path with SSE
   * invalidation included.
   */
  pluginRequest(plugin: string, path: string, init?: PluginRequestInit): Promise<unknown>;
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
   * `POST /api/docs/{id}/archive` — the reversible organizational act
   * (SPEC.md §7).
   *
   * **Not `updateDoc(id, { status: "archived" })`, and the difference is not
   * cosmetic.** Only this route runs the server's folder move: archiving a
   * `type: skill` document relocates it to `.claude/skills-archived/<name>/`,
   * which is what actually disables the skill and frees its name for
   * `corpus skill create`. A `PUT` sets the frontmatter key and leaves the
   * folder in `.claude/skills/` — still discovered, still holding its name —
   * which is §7's "archived" promise with the only part that mattered missing
   * (UI-020, sprint-018 Adjudication 7).
   */
  archiveDoc(id: string): Promise<DocMutationResponse>;
  /**
   * `POST /api/docs/{id}/unarchive` — the inverse, back to `status: resolved`.
   *
   * The **only** way back: `PUT /api/docs/{id}` with a non-archived `status` on
   * an archived document is refused with a `400` whose message names this route
   * (SERVER-039). The document id never changes in either direction.
   */
  unarchiveDoc(id: string): Promise<DocMutationResponse>;
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
  /**
   * `POST /api/docs/{id}/edit-session/flush` — SPEC.md §4's **close** path.
   *
   * §4 gives a user edit session two ends: *"the reader closes (the UI flushes
   * the session), or the document goes inactive for a few minutes while open"*.
   * This is the first of them. Without it every acknowledgment waits out the
   * three-minute window, including the ones the user asked for by putting the
   * document down.
   *
   * **Nothing is returned, and there is nothing to branch on.** The route
   * answers `204` whether or not a session was open — the caller cannot know,
   * since sessions are opened by the server on the first editor save that lands
   * a commit and closed by a timer no client can observe — so this asserts a
   * postcondition (*this document has no open edit session*) rather than
   * performing an action. Calling it twice is calling it once, which is what
   * makes it safe on an unload path where a duplicate is far likelier than a
   * miss. Whether an acknowledgment follows is decided after the response and
   * is deliberately not reported (CONTRACT-031 §2).
   *
   * **Always `keepalive`.** The one call that most needs to arrive is the one
   * issued as the page goes away, and `keepalive: true` is the only spelling
   * that survives it — `navigator.sendBeacon` sends no request headers at all
   * and therefore no bearer token, which this route (not on SPEC.md §2.1's
   * exception list) answers `401`. The request is body-less, so the keepalive
   * budget is never in question, and setting it unconditionally means the
   * in-app close path is not a second, weaker code path.
   *
   * A `404` means the document is unknown — a stale id, a thread id, an
   * `undefined` in a template string. It is the only one, and it is not
   * actionable on a close path: a caller that receives it has nothing to flush
   * either way.
   */
  flushEditSession(docId: string): Promise<void>;
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
   * `POST /api/threads/{id}/reattach` — points an orphaned comment at the
   * passage **a person chose** (SPEC.md §6; SERVER-059 phase B).
   *
   * The request carries a range and the bytes the caller believes are there,
   * never a candidate index: a candidate index would oblige the server to
   * regenerate the list the UI showed and count into it, and the moment the two
   * lists differ the same index means a different passage. A range denotes its
   * own meaning, so a stale list cannot silently attach a comment elsewhere.
   *
   * `409` on a refusal, narrowed by a reason this client leaves on
   * {@link CorpusRequestError.payload} for {@link reattachRefusalReason} to
   * read.
   */
  reattachThread(id: string, input: ReattachThreadRequest): Promise<ReattachThreadResponse>;
  /**
   * `POST /api/threads/{id}/seen` — marks a thread read up to its last turn.
   *
   * Deliberately without the partial-read body: the kit's callers are surfaces
   * that *displayed* a thread, and SPEC.md §7's rule is displayed content only.
   */
  markThreadSeen(id: string): Promise<MarkSeenResult>;
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
type SearchQueryParams = NonNullable<paths["/api/search"]["get"]["parameters"]["query"]>;
type RelatedQueryParams = NonNullable<
  paths["/api/docs/{id}/related"]["get"]["parameters"]["query"]
>;
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
 * `GET /api/search`'s grammar: `q` — the one required parameter — plus the same
 * fourteen structured filters `GET /api/docs` takes, and a cap.
 *
 * Built from the contract's own parameter type rather than restated, so the
 * three parameters ranked retrieval deliberately omits (`sort`, `offset`,
 * `pinned`) are absent here by construction. A caller reaching for one of them
 * gets a type error instead of a parameter the server silently drops.
 *
 * `tag` and `type` widen to arrays for {@link DocsFilter}'s reason: a caller
 * holds `["note", "view"]`, and joining at the boundary keeps it honest.
 */
export type SearchParams = Clearable<Omit<SearchQueryParams, "q" | "tag" | "type">> & {
  readonly q: string;
  readonly tag?: string | readonly string[] | undefined;
  readonly type?: string | readonly string[] | undefined;
};

/** `GET /api/docs/{id}/related`'s grammar — a cap and the archived flag, and nothing else. */
export type RelatedParams = Clearable<RelatedQueryParams>;

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
 * the server sent one so a caller can branch on `code` (`stale_key`, `forbidden`)
 * without re-parsing the response.
 *
 * **The message is the server's sentence, not the request's shape** (PR #28
 * re-review). Roughly thirty surfaces across the board render a failure as
 * `<verb> failed — ${error.message}`, so what this string leads with is what a
 * person reads in a 360px toast that dismisses itself after six seconds. It used
 * to lead with `POST /api/threads/{id}/turns/{ts}/form failed (HTTP 400): ` — an
 * **un-substituted** route template and a status code, ahead of the one sentence
 * the server wrote for a human, and one that pushes it out of the toast. The
 * route and the status did not go anywhere: they are {@link operation} and
 * {@link status}, which is where a developer was always going to look, and the
 * message keeps them when there is no `ApiError` to speak instead — a proxy's
 * HTML error page or an empty `2xx` has no sentence of its own, and there the
 * shape of the request is all there is to say.
 */
export class CorpusRequestError extends Error {
  override readonly name = "CorpusRequestError";
  /** The route template and verb, e.g. `POST /api/threads/{id}/turns/{ts}/form`. */
  readonly operation: string;
  readonly status: number;
  readonly code: string | undefined;
  readonly issues: readonly { readonly path: string; readonly message: string }[];
  /**
   * The error body exactly as the server sent it, parsed.
   *
   * `code`, `message` and `issues` are the parts of an `ApiError` every caller
   * needs; a few responses carry **more** than that envelope —
   * `ReattachConflictError` adds `reason`, `StaleKeyError` adds the whole `doc`
   * — and a `code` alone cannot hand those over. Keeping the payload lets the
   * one caller that understands a given shape parse it with the contract's own
   * schema, without this class growing a field per route.
   */
  readonly payload: unknown;

  constructor(operation: string, status: number, payload: unknown) {
    const api = isApiError(payload) ? payload : undefined;
    super(
      api?.message ?? `${operation} failed (HTTP ${String(status)}): ${JSON.stringify(payload)}`,
    );
    this.operation = operation;
    this.status = status;
    this.code = api?.code;
    this.issues = api !== undefined && api.code === "bad_request" ? api.issues : [];
    this.payload = payload;
  }
}

/**
 * Which state refused a `POST /api/threads/{id}/reattach`, or `null` when the
 * failure was not one of the three (a moved range, a `404`, an unreachable
 * server).
 *
 * The three refusals want three different things from the person — re-read and
 * choose again, choose somewhere else, or nothing at all — so a caller that had
 * to match on the message's prose would get it wrong the first time the prose
 * was improved (CONTRACT-041). Parsed with the contract's own schema rather than
 * by reading a field, so a reason this build has never heard of reads as `null`
 * instead of leaking into a `switch`.
 */
export function reattachRefusalReason(error: unknown): ReattachRefusalReason | null {
  if (!(error instanceof CorpusRequestError) || error.status !== 409) return null;
  const parsed = ReattachConflictErrorSchema.safeParse(error.payload);
  return parsed.success ? parsed.data.reason : null;
}

/**
 * The document a **stale key** refusal carried, or `null` when the failure was
 * something else (SPEC.md §7 "A key, not a lock"; `StaleKeyError`).
 *
 * §7's *what a refusal says*: a refused write comes back with the document as it
 * now stands and a fresh key for it — not merely "no" — so that one exchange is
 * enough for the writer to see what changed, decide, and write again. This is
 * the reader for that document, and it is the whole of what a caller needs: the
 * fresh key is `doc.key`, in the field every read carries it in, because a
 * second copy beside it could disagree with the first.
 *
 * Parsed with the contract's own schema rather than by reading fields off the
 * payload, exactly as {@link reattachRefusalReason} is: a `409` this build does
 * not recognise reads as `null` instead of leaking a half-shaped object into an
 * adopt-then-retry path that would then write against a key it invented.
 *
 * **A refusal is never a lost edit.** Nothing was written, and the content the
 * caller tried to save is still the caller's to resend against this document's
 * key — which is what `useAutosave` does, and why the person's in-flight
 * sentence survives a conflict that arrives mid-word.
 */
export function staleKeyDoc(error: unknown): Doc | null {
  if (!(error instanceof CorpusRequestError) || error.status !== 409) return null;
  const parsed = StaleKeyErrorSchema.safeParse(error.payload);
  return parsed.success ? parsed.data.doc : null;
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

    async searchCorpus(params, options) {
      // Same widening as `listDocs`: the canonicalised record forwards filters
      // the kit has never heard of, which the generated query type cannot
      // express without closing the grammar.
      const query = toQueryParams(params) as SearchQueryParams;
      return unwrap(
        "GET /api/search",
        await api.GET("/api/search", { params: { query }, ...signalOf(options) }),
      );
    },

    async relatedDocs(id, params, options) {
      const query = toQueryParams(params ?? {}) as RelatedQueryParams;
      return unwrap(
        "GET /api/docs/{id}/related",
        await api.GET("/api/docs/{id}/related", {
          params: { path: { id }, query },
          ...signalOf(options),
        }),
      );
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

    async getQueueStatus(options) {
      return unwrap(
        "GET /api/queue/status",
        await api.GET("/api/queue/status", { ...signalOf(options) }),
      );
    },

    async getIndexStatus(options) {
      return unwrap(
        "GET /api/index/status",
        await api.GET("/api/index/status", { ...signalOf(options) }),
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
            // Spread rather than assigned: `weight: undefined` would serialise
            // to nothing here but is a second spelling of absence one refactor
            // away from becoming a `null` the server has to interpret.
            ...(input.weight === undefined ? {} : { weight: input.weight }),
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
          ...(input.weight === undefined ? {} : { weight: input.weight }),
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
            /*
             * Rebuilt key by key rather than spread: under
             * `exactOptionalPropertyTypes` the generated body type spells an
             * absent value as a *missing key*, and `{ option: undefined }` is
             * not that. It is also the wire rule — a field with nothing given
             * has no entry, and an entry carries exactly one value key — so the
             * two agree by construction rather than by a cast.
             */
            answers: input.answers.map((entry) => ({
              question: entry.question,
              ...(entry.option === undefined ? {} : { option: entry.option }),
              ...(entry.options === undefined ? {} : { options: [...entry.options] }),
              ...(entry.text === undefined ? {} : { text: entry.text }),
            })),
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

    async pluginRequest(plugin, path, init) {
      const send = config.fetch ?? globalThis.fetch;
      const method = init?.method ?? "GET";
      // Leading slashes normalised away rather than trusted, exactly as for
      // attachment targets: a path may address the plugin's own routes only.
      const url = `${config.baseUrl}/api/x/${plugin}/${path.replace(/^\/+/, "")}`;
      const operation = `${method} /api/x/${plugin}/${path.replace(/^\/+/, "")}`;
      const response = await send(url, {
        method,
        headers: {
          Authorization: `Bearer ${config.token}`,
          ...(init?.body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        ...(init?.signal && canForwardAbortSignal() ? { signal: init.signal } : {}),
      });
      const payload: unknown =
        response.status === 204 ? null : await response.json().catch(() => null);
      if (!response.ok) throw new CorpusRequestError(operation, response.status, payload);
      return payload;
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

    async archiveDoc(id) {
      return unwrap(
        "POST /api/docs/{id}/archive",
        await api.POST("/api/docs/{id}/archive", { params: { path: { id } } }),
      );
    },

    async unarchiveDoc(id) {
      return unwrap(
        "POST /api/docs/{id}/unarchive",
        await api.POST("/api/docs/{id}/unarchive", { params: { path: { id } } }),
      );
    },

    async deleteDoc(id) {
      return unwrap(
        "DELETE /api/docs/{id}",
        await api.DELETE("/api/docs/{id}", { params: { path: { id } } }),
      );
    },

    async flushEditSession(docId) {
      const operation = "POST /api/docs/{id}/edit-session/flush";
      const result = await api.POST("/api/docs/{id}/edit-session/flush", {
        params: { path: { id: docId } },
        // See the interface docblock: `keepalive` is what lets this reach the
        // server from a page that is going away, and it is the only spelling
        // that can still carry the bearer token.
        keepalive: true,
      });
      // Not `unwrap`: a `204` carries no body, so `data` is `undefined` on the
      // success path and "did it work" has to be read off the response itself.
      if (result.response.ok) return;
      throw new CorpusRequestError(operation, result.response.status, result.error ?? null);
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
          ...(input.weight === undefined ? {} : { weight: input.weight }),
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
          ...(input.weight === undefined ? {} : { weight: input.weight }),
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

    async reattachThread(id, input) {
      return unwrap(
        "POST /api/threads/{id}/reattach",
        await api.POST("/api/threads/{id}/reattach", {
          params: { path: { id } },
          body: input,
        }),
      );
    },

    async markThreadSeen(id) {
      return unwrap(
        "POST /api/threads/{id}/seen",
        await api.POST("/api/threads/{id}/seen", { params: { path: { id } } }),
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
