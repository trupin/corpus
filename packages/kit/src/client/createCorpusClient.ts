import type {
  AgentRoster,
  AppendTurnResponse,
  CaptureResult,
  CreateDocRequest,
  CreateThreadRequest,
  CreateThreadResponse,
  DeleteDocResult,
  DeleteFolderResult,
  DeleteTurnResult,
  DesignateResidentRequest,
  Doc,
  DocList,
  DocMutationResponse,
  FolderStatusResult,
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
  ReflectAskResult,
  ReorderBoardsResult,
  ReflectStatus,
  RelatedDocs,
  RenameFolderResult,
  SearchResults,
  Thread,
  ThreadMutationResponse,
  ThreadScope,
  UpdateDocRequest,
  UpdateDocResponse,
} from "@corpus/contract";
import {
  ReattachConflictErrorSchema,
  StaleKeyErrorSchema,
  UnknownRecipientErrorSchema,
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
 * The kit's data path, and the only one the board gets (SPEC.md §10).
 *
 * It wraps `@corpus/contract`'s generated client rather than re-exporting it.
 * The generated `CorpusApi` is an open `client.GET("/any/path")` surface, and a
 * surface that reaches it caches under no query key, so nothing ever tells it
 * its data went stale. What ships instead is one method per operation the kit
 * actually supports, typed from the contract's schemas, with a uniform thrown
 * error.
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
  /**
   * The lane this message is addressed to (SPEC.md §7) — `orchestrator`, or the
   * id of a designated root thread.
   *
   * **Omit it for the default**, which the server computes from where the
   * message is posted: inside a designated scope it addresses that scope's
   * resident, anywhere else the orchestrator. Absence is the ordinary case and
   * the only spelling of it, which is what stops a client's own idea of the
   * default from ever disagreeing with the server's.
   */
  readonly recipient?: string;
  /** Enqueue signal for the agent (SPEC.md §8); omitted lets the server decide. */
  readonly requestsAgent?: boolean;
  /**
   * The weight this request states its work should be done at (SPEC.md §7, §10)
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
  /** As {@link AppendTurnInput.recipient}: omit for the computed default. */
  readonly recipient?: string | undefined;
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
  /** As {@link AppendTurnInput.recipient}: omit for the computed default. */
  readonly recipient?: string | undefined;
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
 * `POST /api/capture` (SPEC.md §10) — the composer's *Capture*, which is
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
  /**
   * `GET /api/threads/{id}/scope` — **what a designated thread's lane owns**
   * (SPEC.md §7, CONTRACT-068): the thread, every thread whose parent chain
   * reaches it, every document whose `origin` reaches it, and every thread on
   * such a document.
   *
   * The answer is **computed per request by the same walk the queue routes
   * with**, so a caller renders what arrives and derives nothing: a surface that
   * re-walked the graph client-side would be a second implementation of one
   * rule, which is the defect `packages/kit/src/recipient/scopeWalk.ts` records
   * the cost of. One frugal line per member and never a body.
   *
   * **Bounded, and the bound is in the contract** (`SCOPE_PAGE_SIZE`): there is
   * no cursor and no total, because the cap exists so a scope cannot be
   * enumerated rather than to make paging a feature. `truncated` is the field
   * that says the cut happened, and a caller that hides it is presenting a
   * capped list as a complete one.
   *
   * **`409` for a thread with no resident**: the orchestrator's lane is not a
   * scope, so an undesignated thread has no scope to list rather than an empty
   * one. `404` when the id is unknown or names a document that is not a thread.
   */
  getThreadScope(threadId: string, options?: RequestOptions): Promise<ThreadScope>;
  getTree(options?: RequestOptions): Promise<FolderTree>;
  /**
   * The four **folder acts** (SPEC.md §9.2, rider 7 signed 2026-08-22), behind
   * the explorer's folder menu (§10, rider 1).
   *
   * Four methods rather than one with a verb, because the contract declares four
   * routes answering three different result shapes — and because only `delete`
   * is user-only and only `rename` can conflict.
   *
   * **The path is sent byte for byte.** It is relative to `data/docs/`, carries
   * no `data/docs/` prefix and no leading or trailing slash, and is compared
   * exactly by the server: `FINANCE` is a `404` in a workspace holding
   * `finance` (SERVER-136). Nothing here normalises a caller's spelling, because
   * a rename that resolved a guess wrongly moves files.
   *
   * **Each result names every document the act changed**, and `documents` is the
   * state *after* the act rather than what changed: archive lists documents that
   * were already archived, because the act applied to them.
   */
  renameFolder(from: string, to: string): Promise<RenameFolderResult>;
  archiveFolder(path: string): Promise<FolderStatusResult>;
  unarchiveFolder(path: string): Promise<FolderStatusResult>;
  /**
   * `POST /api/folders/delete` — user-only, like deleting a document.
   *
   * **It does not remove the folder's threads**, which survive as orphaned
   * records naming a deleted parent, and the response does not name them
   * (SERVER-136). A caller must not present a count from this result as a count
   * of everything the act touched. It also leaves the folder itself behind when
   * something that is not a document is still in it.
   */
  deleteFolder(path: string): Promise<DeleteFolderResult>;
  /**
   * `POST /api/boards/order` — the board bar, renumbered in **one** commit
   * (SPEC.md §10, rider 2: "reordering boards writes `order` on every board, in
   * one commit").
   *
   * **The ids are the bar, in the order it should be in**, first tab first; the
   * positions are the server's to derive, and it numbers them from one. Nothing
   * here sends an `order` value, because a caller that computed its own could
   * disagree with the next caller about the same bar.
   *
   * **Boards it does not name are left alone**, so a bar showing only unarchived
   * boards states its own order without inventing positions for boards nobody
   * can see. The whole reorder is refused before anything is written when an id
   * names no document (`404`) or names something that is not a board (`400`) —
   * `order` is a board's position among boards and nothing else.
   */
  reorderBoards(boards: readonly string[]): Promise<ReorderBoardsResult>;
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
   * saved views and board columns stay on it (SPEC.md §10).
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
   * `GET /api/agents` — every lane, who is resident on it, and whether anybody
   * is listening (SPEC.md §7's roster).
   *
   * Parameterless and read-only, like {@link getQueueStatus}: §7 makes the
   * roster *"a read, never a push"*, so this answers over HTTP and the SSE
   * stream only ever names `["agents"]`. There is deliberately no designate or
   * release method beside it — designation is user-only state (§7), so a
   * surface that could re-designate a conversation through the kit would be
   * rewiring a scope nobody asked it to.
   */
  getAgentRoster(options?: RequestOptions): Promise<AgentRoster>;
  /**
   * `GET /api/index/status` — the semantic index's own health report behind the
   * console strip's index pill (SPEC.md §9.1, §10's index-pill rider).
   *
   * Read-only and parameterless, like {@link getQueueStatus}: the endpoint
   * answers one snapshot of derived state, and every field on it is a fact the
   * server derived — `state` is what a caller decides with and `detail` is the
   * sentence it renders. **No rebuild method ships beside it**: kicking a
   * rebuild off is `corpus index rebuild`'s job (SPEC.md §9.1), and a surface
   * that could discard the workspace's vectors through the kit would make a
   * destructive act reachable from a pill that only reports.
   */
  getIndexStatus(options?: RequestOptions): Promise<IndexStatus>;
  /**
   * `GET /api/workspace/reflect` — the reflection clock, what is unreflected,
   * the pending reflection, the last digest thread and the quiet window
   * (SPEC.md §7's rider 9).
   *
   * Read-only and parameterless, like {@link getQueueStatus}. **`changed` is a
   * corpus-wide count and rides on the response rather than being derived here**:
   * deriving it client-side means listing every document to produce one number,
   * and the server counts it with the contract's own `isUnreflected` — the same
   * call the board applies row by row — so the number in the control and the
   * marks on the rows cannot disagree.
   */
  getReflectStatus(options?: RequestOptions): Promise<ReflectStatus>;
  /**
   * `POST /api/workspace/reflect` — **ask for a reflection over the whole
   * corpus** (SPEC.md §7: the board bar's Reflect control, and `corpus reflect`).
   *
   * **`202` always, never a `409`.** An ask while one is pending is answered
   * with the pending one rather than doubled or refused, and `pending: true` is
   * what tells the two apart — so a caller says "asked" or "already asked"
   * without comparing ids, and never renders an error for a person who pressed
   * the button twice.
   *
   * It carries no body: the window is server state, and a caller that could name
   * its own `since` would be asking for a different act than the one §7 defines.
   */
  askReflection(): Promise<ReflectAskResult>;
  /**
   * `PUT /api/workspace/reflect/quiet` — **set the quiet window, or switch the
   * automatic path off** (SPEC.md §7's rider signed 2026-08-25).
   *
   * `0` disables the automatic path and leaves asking as the only way a
   * reflection happens, which is the spelling §7 has always given to *off*.
   * There is no separate boolean, because two keys with one effect are two ways
   * to say the same thing.
   *
   * **It answers the whole `ReflectStatus`**, exactly as the `GET` does, so a
   * caller that switches the path off learns in the same round trip what is
   * still pending and how many documents are unreflected — and a cache can take
   * the response rather than invalidating and reading again.
   */
  setReflectQuiet(quiet: number): Promise<ReflectStatus>;
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
   * `POST /api/docs` — zero-form creation (SPEC.md §10).
   *
   * Also how a board column comes into being: a column IS a `type: view`
   * document with `pinned: true`, so pinning a list is this call with the §10
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
   * `POST /api/docs/{id}/move` — relocation, and **only** relocation
   * (SPEC.md §9.2).
   *
   * It rewrites the file path and nothing else. The id is assigned at creation
   * and is immutable, so every `[[ref]]`, anchor entry and thread `parent`
   * survives the move untouched, and the projection re-maps id → path. A move
   * presents no document key for the same reason (SPEC.md §7): it does not
   * touch the content, so it can overwrite nobody's edit.
   *
   * `folder` is under `data/docs/`, spelled either bare (`finance`) or with the
   * full prefix (`data/docs/finance`), and it is **required** — a move names
   * where the document is going, and there is no inbox-first default here. The
   * filename does not change, so a destination already holding a file of that
   * name is a `400` and never an overwrite. `400` too for a document whose
   * location is fixed: a thread is flat under `data/threads/` and a skill lives
   * in its own folder under `.claude/`.
   */
  moveDoc(id: string, folder: string): Promise<DocMutationResponse>;
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
   * `POST /api/capture` — the composer's Capture (SPEC.md §10).
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
   * `POST /api/threads/{id}/resident` — **designate** a standalone thread's
   * resident agent (SPEC.md §7).
   *
   * `input.name` is the invocable name, never a document id: the same resolution
   * `@<subagent>` mentions use, so a person designates by the word they already
   * type after a sigil. The response carries the thread with `resident` resolved
   * to `{name, docId, weight}`.
   *
   * **Omitting `name` designates a general resident** — §7's ordinary case,
   * which names no profile and requires nothing to exist in the workspace first.
   * It sends `{}` rather than a `null` name, because the route's body is
   * optional in full and `null` has two other jobs one level away on the
   * response (`residentField`, `ResidentSchema`). The resolved resident comes
   * back with both halves null.
   *
   * **`input.weight` is the level the resident runs at** (CONTRACT-067, SPEC.md
   * §7's rider signed 2026-08-19: a resident's weight is set when it is
   * designated, not per message). It takes the whole request object rather than
   * a second positional argument for the reason the field is optional at all:
   * absence is the meaning — *the launcher decides* — and
   * {@link DesignateResidentRequest} under `exactOptionalPropertyTypes` is the
   * one spelling in which a caller cannot write `undefined` into a key and
   * quietly send a second spelling of nothing. `body` is `input ?? {}`, so what
   * this method sends is exactly what the caller assembled.
   *
   * **User-only, and single-valued.** The server refuses an agent actor (`403`)
   * and a thread with a parent (`409`); designating a thread that already has a
   * resident replaces it rather than conflicting.
   *
   * ## Why this exists on the kit's client at all
   *
   * It did not until UI-109, and the absence was load-bearing prose:
   * `useComposerRecipient` cited it as the structural enforcement of §7's first
   * two prohibitions on an override — *"an override never rewires a scope, never
   * re-designates anything"*. That argument has moved rather than lapsed. §10
   * puts designate/release in the conversation's own menu, which is a board
   * surface and therefore a kit consumer, so the capability has to be reachable;
   * what enforces the prohibitions now is that the recipient path never calls
   * these two methods and spreads `{}` or `{recipient}` onto the message body
   * and nothing else — asserted directly (`useComposerRecipient.test.tsx`)
   * rather than implied by a missing method.
   */
  designateResident(
    threadId: string,
    input?: DesignateResidentRequest,
  ): Promise<ThreadMutationResponse>;
  /**
   * `DELETE /api/threads/{id}/resident` — **release** it, returning the scope to
   * ordinary routing (SPEC.md §7).
   *
   * **Idempotent**: releasing a thread that has none is the state the caller
   * asked for, not an error, and it answers with the thread either way because a
   * release that does write can raise §11 warnings.
   */
  releaseResident(threadId: string): Promise<ThreadMutationResponse>;
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
type PostResidentBody = NonNullable<
  paths["/api/threads/{id}/resident"]["post"]["requestBody"]
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
 * creation may carry is the contract's decision. In particular the §10 view
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

/**
 * The lane a **`422 unknown_recipient`** refused, or `null` when the failure was
 * something else (SPEC.md §7; `UnknownRecipientErrorSchema`).
 *
 * Read for the reason the contract states in the schema's own docblock — *"a
 * client that offered a picker needs to know **which** entry went stale so it
 * can drop that row rather than reload the world"*. A composer needs it for one
 * thing more: the refusal is the only evidence it will ever get that its own
 * roster is behind the server's, and it has to be sure the refusal names the
 * lane **this** message was addressed to before it acts on it.
 *
 * Parsed with the contract's own schema rather than by reading `code` off the
 * payload, exactly as {@link reattachRefusalReason} and {@link staleKeyDoc} are:
 * a `422` this build does not recognise reads as `null` instead of handing a
 * half-shaped object to a surface that would then draw a claim from it.
 */
export function unknownRecipientLane(error: unknown): string | null {
  if (!(error instanceof CorpusRequestError) || error.status !== 422) return null;
  const parsed = UnknownRecipientErrorSchema.safeParse(error.payload);
  return parsed.success ? parsed.data.recipient : null;
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

    async getThreadScope(threadId, options) {
      return unwrap(
        "GET /api/threads/{id}/scope",
        await api.GET("/api/threads/{id}/scope", {
          params: { path: { id: threadId } },
          ...signalOf(options),
        }),
      );
    },

    async getTree(options) {
      return unwrap("GET /api/tree", await api.GET("/api/tree", { ...signalOf(options) }));
    },

    async renameFolder(from, to) {
      return unwrap(
        "POST /api/folders/rename",
        await api.POST("/api/folders/rename", { body: { from, to } }),
      );
    },

    async archiveFolder(path) {
      return unwrap(
        "POST /api/folders/archive",
        await api.POST("/api/folders/archive", { body: { path } }),
      );
    },

    async unarchiveFolder(path) {
      return unwrap(
        "POST /api/folders/unarchive",
        await api.POST("/api/folders/unarchive", { body: { path } }),
      );
    },

    async deleteFolder(path) {
      return unwrap(
        "POST /api/folders/delete",
        await api.POST("/api/folders/delete", { body: { path } }),
      );
    },

    async reorderBoards(boards) {
      return unwrap(
        "POST /api/boards/order",
        await api.POST("/api/boards/order", { body: { boards: [...boards] } }),
      );
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

    async getAgentRoster(options) {
      return unwrap("GET /api/agents", await api.GET("/api/agents", { ...signalOf(options) }));
    },

    async getIndexStatus(options) {
      return unwrap(
        "GET /api/index/status",
        await api.GET("/api/index/status", { ...signalOf(options) }),
      );
    },

    async getReflectStatus(options) {
      return unwrap(
        "GET /api/workspace/reflect",
        await api.GET("/api/workspace/reflect", { ...signalOf(options) }),
      );
    },

    async askReflection() {
      return unwrap("POST /api/workspace/reflect", await api.POST("/api/workspace/reflect", {}));
    },

    async setReflectQuiet(quiet) {
      return unwrap(
        "PUT /api/workspace/reflect/quiet",
        await api.PUT("/api/workspace/reflect/quiet", { body: { quiet } }),
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
            ...(input.recipient === undefined ? {} : { recipient: input.recipient }),
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
          ...(input.recipient === undefined ? {} : { recipient: input.recipient }),
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

    async moveDoc(id, folder) {
      return unwrap(
        "POST /api/docs/{id}/move",
        await api.POST("/api/docs/{id}/move", { params: { path: { id } }, body: { folder } }),
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
          ...(input.recipient === undefined ? {} : { recipient: input.recipient }),
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

    async designateResident(threadId, input) {
      // The `createDoc`/`updateDoc` mismatch again: the generated body type and
      // the zod-inferred `DesignateResidentRequest` describe identical values
      // under different `exactOptionalPropertyTypes` stances. The **values** are
      // what matters here and they are the caller's verbatim — an absent key
      // stays absent, which is how "the launcher decides" is spelled on the
      // wire.
      const body = (input ?? {}) as PostResidentBody;
      return unwrap(
        "POST /api/threads/{id}/resident",
        await api.POST("/api/threads/{id}/resident", {
          params: { path: { id: threadId } },
          body,
        }),
      );
    },

    async releaseResident(threadId) {
      return unwrap(
        "DELETE /api/threads/{id}/resident",
        await api.DELETE("/api/threads/{id}/resident", { params: { path: { id: threadId } } }),
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
