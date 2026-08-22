import {
  DEFAULT_RECENT_JOBS,
  ORCHESTRATOR_LANE,
  extractFormSource,
  formAnswerRecord,
  formatFormAnswerBody,
  FormSchema,
  isFormAnswerBody,
  parseFormAnswerBody,
  turnHeadings,
  unreadableAnswer,
  unterminatedFence,
  validateFormAnswer,
  type CaptureResult,
  type ConflictError,
  type CreateThreadResponse,
  type DeleteDocResult,
  type DeleteTurnResult,
  type Doc,
  type DocList,
  type DocMutationResponse,
  type DocRow,
  type DocStatus,
  type FolderTree,
  type Health,
  type Form,
  type IndexStatus,
  type InternalError,
  type JobLog,
  type FormAnswerRequest,
  type FormAnswerResponse,
  type AgentLane,
  type AppendTurnResponse,
  type AgentRoster,
  type Job,
  type JobList,
  type MarkSeenResult,
  type NeedsReason,
  type NotFoundError,
  type QueueEventStatus,
  type QueueStatus,
  type ReattachConflictError,
  type ReattachThreadResponse,
  type Relation,
  type RelatedDocs,
  type Resident,
  type ResolvedAnchor,
  type SearchResults,
  type ThreadScope,
  type StaleKeyError,
  type StaleTier,
  type TextQuoteSelector,
  type TextQuoteSelectorRequest,
  type Thread,
  type ThreadMutationResponse,
  type ThreadStatus,
  type UnknownRecipientError,
  type UpdateDocResponse,
  type ValidationError,
  type ViewQuery,
} from "@corpus/contract";
import type { Page, Request, Route } from "@playwright/test";
import { Buffer } from "node:buffer";
import * as YAML from "yaml";
import {
  canonicalInstant,
  nextThreadStatus,
  parseThreadTurns,
  renderTurn,
  resolveAgentDefName,
  resolveAnchorExact,
  type StubTurn,
} from "./serverParity";
import { unknownRecipientBody } from "../src/testing/serverRefusals";

/**
 * A corpus, in the browser, for the specs that need one.
 *
 * `playwright.config.ts` deliberately starts **no** workspace server — the
 * shell has to render honestly with nothing behind it, and `smoke.spec.ts`
 * pins exactly that. So a spec about what the board *does* with documents has
 * two options: point the whole suite at a real server (which turns three
 * unrelated tests red) or serve the API from inside the page.
 *
 * This is the second. Everything above the transport is the real application —
 * real React, real TanStack cache, real DOM, real pointer and keyboard events —
 * and only `fetch` is answered from here. It is therefore **half** the
 * evidence, exactly as sprint-016 Adjudication 19 says: the disk, git and
 * projection half comes from each issue's real-app drill against a real
 * `corpus` server, and neither half is acceptance on its own.
 */

/**
 * Every JSON body this stub is allowed to put on the wire: a contract response
 * shape, or one of the contract's error shapes.
 *
 * **Why the transport is typed at all.** The generated client validates nothing
 * at runtime, so a field the stub omits arrives at the board as `undefined` and
 * nothing complains — and `undefined` is not loud. `unansweredForms` landed on
 * `DocRow` (CONTRACT-040), the stub did not carry it, and every stubbed row said
 * `undefined`; the threshold reading it is `> 1`, which against `undefined` is
 * merely *false*, so the spec asserting it would have **passed** against a row
 * the server never sends (UI-102). A spec that fails confusingly costs an hour;
 * a spec that passes dishonestly costs whatever it was guarding.
 *
 * So every payload below is either produced by a builder with a contract return
 * type, or is an object literal carrying `satisfies <ContractType>`. Both make a
 * missing field a **compile** error, which is the only kind of error a stub's
 * omission can be — there is no runtime check to fail.
 *
 * This union is the backstop for the third case: a route added later whose
 * author forgets the `satisfies`. It cannot catch a payload sent on the wrong
 * route (any member satisfies it), which is exactly what the per-call-site
 * `satisfies` is for.
 *
 * A spec that genuinely wants bytes the contract forbids stays possible — the
 * stub answers at the transport boundary and always will — but it costs an
 * explicit cast, which is a place to write down *why*. **There are none left**:
 * the unhandled-route fallback was the last one, and since UI-085 it refuses
 * with the contract's own error shape instead of casting `{}` into a success.
 */
type StubPayload =
  | AgentRoster
  | AppendTurnResponse
  | CaptureResult
  | ConflictError
  | CreateThreadResponse
  | DeleteDocResult
  | DeleteTurnResult
  | Doc
  | DocList
  | DocMutationResponse
  | FolderTree
  | FormAnswerResponse
  | Health
  | IndexStatus
  | InternalError
  | Job
  | JobList
  | JobLog
  | MarkSeenResult
  | NotFoundError
  | QueueStatus
  | ReattachConflictError
  | ReattachThreadResponse
  | RelatedDocs
  | StaleKeyError
  | SearchResults
  | Thread
  | ThreadMutationResponse
  | ThreadScope
  | UnknownRecipientError
  | UpdateDocResponse
  | ValidationError;

export interface StubRow {
  readonly id: string;
  readonly type?: string;
  readonly title?: string;
  readonly path?: string;
  /**
   * The document's markdown, exactly as the file holds it.
   *
   * For a `type: thread` document that means the **turn format** (SPEC.md §6):
   * `## <author> · <ISO instant>` H2 headings, seconds precision, U+00B7 as the
   * separator. `GET /api/threads/{id}` reports the turns this body parses to, so
   * a body with no headings is a thread with no turns — which is what the server
   * says about it too.
   */
  readonly body?: string;
  /**
   * Which model wrote which turn, keyed by the turn's timestamp (SPEC.md §6,
   * CONTRACT-043).
   *
   * A separate seed from `body` because the record is a separate place on disk:
   * §6 keeps it in the thread document's **frontmatter**, so the turn's own text
   * carries none of it and a body alone names no model. Seeding it here is what
   * lets a spec meet the mixed conversation §11 is written about — a turn with a
   * model, an agent turn without, and a person's turn — rather than only the
   * all-null thread a body-only stub can produce. A timestamp with no entry
   * reports `null`, exactly as the server reports a turn nobody recorded one for.
   */
  readonly turnModels?: Readonly<Record<string, string>>;
  /**
   * The contract's three statuses and no others. A seed of `"draft"` would have
   * produced a row whose `status` no `DocRow` the server sends can hold, and
   * every consumer branching on it would have been asserted against a value that
   * cannot occur (UI-102).
   */
  readonly status?: DocStatus;
  /**
   * SPEC.md §5's optional deadline, as the file holds it.
   *
   * Seeded rather than flatly `null`, which is what it was until the review of
   * PR #55: nothing read it, so nothing noticed, and no spec could put a **date**
   * in front of a surface that shows one. `derived-due.spec.ts` is the surface —
   * a `due` a plugin derives is stated rather than offered — and it needs a
   * document whose deadline is not null to say anything about it at all.
   */
  readonly due?: string | null;
  readonly pinned?: boolean;
  readonly order?: number | null;
  /** A view document's query — the contract's `ViewQuery`, not free-form JSON. */
  readonly query?: ViewQuery | null;
  readonly column?: string | null;
  readonly parent?: string | null;
  readonly extra?: Readonly<Record<string, unknown>>;
  /** A staleness tier, or `null` for fresh — SPEC.md §5's ramp, never a string. */
  readonly stale?: StaleTier | null;
  /**
   * Anchors the document already carries, as a workspace that has been
   * commented on before this page loaded (UI-027).
   *
   * Seeding them matters because the stub pushes no `invalidate` over SSE: a
   * spec that could only *create* an anchor was always asserting the state one
   * comment produces, never the state a **fresh load** finds — which is exactly
   * the state that shipped broken. Ranges are still resolved on every read, so
   * a seeded anchor orphans the moment its quote leaves the body.
   */
  readonly anchors?: readonly SeedAnchor[];
  /**
   * The thread holds a turn nobody has displayed yet (SPEC.md §7).
   *
   * Seeded because the flag is what the one collapse rule defers to: "a
   * conversation carrying a turn you have not seen is never collapsed by the
   * rule" (§11, UI-077), and a stub that answered `unread: false` for everything
   * could not tell a rule that honours the interlock from one that ignores it.
   * Cleared by `POST /api/threads/{id}/seen`, as the server clears it.
   */
  readonly unread?: boolean;
  /**
   * How many of this document's child threads carry a turn nobody has seen —
   * `DocRow.unreadThreads` (CONTRACT-012), the number the row's unread pill
   * shows on a **document** row.
   *
   * Seeded rather than derived, and the reason is in `asRow`'s own list of what
   * this stub does not know: the server counts child threads whose last turn is
   * newer than the seen mark, which is a comparison against a mark this stub has
   * no store for. The field stayed flatly `0`, so no spec could reach the pill
   * at all — and it is the one badge whose content is a *word or a number*
   * (`new` vs `12`), which is a width question a stub that never lights it
   * cannot ask (UI-134). Absent, it is still `0`.
   */
  readonly unreadThreads?: number;
  /**
   * The ranked answer `GET /api/docs/{id}/related` gives for this document
   * (UI-025), in the server's order.
   *
   * Seeded rather than derived whenever a spec needs a **`similar`** or `both`
   * row: semantic neighbours come out of an index no browser stub can hold, and
   * a spec that could only assert `linked` would pin half the vocabulary. With
   * no seed the stub derives the `linked` set from the `[[ref]]` graph in both
   * directions, which is what the projection's `links` table does.
   */
  readonly related?: readonly SeedRelated[];
}

/** One row of a seeded related set: which document, and why it is related. */
export interface SeedRelated {
  readonly id: string;
  /** `linked`, `similar` or `both` — the wire's vocabulary, unabridged. */
  readonly relation: Relation;
}

/** A seeded anchor: the selector, and the thread it belongs to. */
export interface SeedAnchor {
  readonly anchorId: string;
  readonly threadId: string;
  readonly exact: string;
  readonly prefix?: string;
  readonly suffix?: string;
  /** A thread is `open` or `resolved`; an anchor never points at an archived one. */
  readonly threadStatus?: ThreadStatus;
}

interface StoredDoc {
  id: string;
  type: string;
  title: string;
  path: string;
  body: string;
  /** The frontmatter record of which model wrote which turn, keyed by `ts`. */
  turnModels: Record<string, string>;
  status: DocStatus;
  /** See {@link StubRow.due}. */
  due: string | null;
  pinned: boolean;
  order: number | null;
  query: ViewQuery | null;
  column: string | null;
  parent: string | null;
  extra: Record<string, unknown>;
  stale: StaleTier | null;
  /** Seeded, never derived — see {@link StubRow.unreadThreads}. */
  unreadThreads: number;
  /**
   * Stamped on every write, exactly as the server stamps it. Kept per document
   * rather than as one frozen constant because a surface may legitimately key
   * on "has this document changed" — the todos column's `(id, updated)`
   * fingerprint is the shipped case (PLUGINS-007) — and a stub that never moves
   * `updated` would make such a query look correct while pinning nothing.
   */
  updated: string;
  /**
   * SPEC.md §7's key for this document's current version — moved by every write
   * that lands, and by an out-of-band one.
   */
  key: string;
  /**
   * Whether the agent is in this thread (SPEC.md §8) — `none` until a turn asks
   * for it. Meaningless on a non-thread document, and reported as `null` there.
   */
  agent: "none" | "requested" | "engaged";
  /** Resolved anchors, as `GET /api/docs/{id}` reports them. */
  anchors: StoredAnchor[];
  /** A seeded related answer, or `null` to derive one from the ref graph. */
  related: readonly SeedRelated[] | null;
  /** Holds a turn nobody has displayed yet; cleared by the seen route. */
  unread: boolean;
}

/**
 * One anchor on a document, kept the way the server keeps it: the selector is
 * stored verbatim and the **range is recomputed on every read**, so a body edit
 * moves it and a deleted quote orphans it.
 */
interface StoredAnchor {
  readonly anchorId: string;
  readonly threadId: string;
  /**
   * The contract's selector, with `prefix` and `suffix` **present** — the read
   * side defaults both to `""`, so a resolved anchor always carries all three
   * strings. Storing them optional let a thread created without context report a
   * selector missing two of its fields, which no server response ever is.
   */
  selector: TextQuoteSelector;
  threadStatus: ThreadStatus;
}

/** The seeded instant every document starts at, and the clock a write advances. */
const SEEDED_AT = "2026-07-01T09:00:00.000Z";
let writes = 0;

/**
 * A fresh, well-formed document key (SPEC.md §7): 64 lowercase hex characters,
 * which is the only thing about a key any client may know.
 *
 * A counter, deliberately not a hash of the body. The real key is derived
 * server-side and **opaque** client-side; a stub that hashed content would let a
 * spec reproduce the server's derivation and assert against a key it computed —
 * exactly the thing §7 forbids a client to do, and the spec would keep passing
 * after the board started doing it.
 */
let stubKeys = 0;
function nextStubKey(): string {
  stubKeys += 1;
  return stubKeys.toString(16).padStart(64, "0");
}

/** One text part of a multipart body, in wire order. */
export interface MultipartTextPart {
  readonly field: string;
  readonly value: string;
}

/**
 * One file part. Enough to say *which* file went and under what part name — the
 * question a spec about attachments actually asks — and no more: the bytes
 * themselves are the server's business, and this stub has no disk.
 */
export interface MultipartFilePart {
  readonly field: string;
  readonly filename: string;
  /** The part's own `Content-Type`, or `""` when it declared none. */
  readonly type: string;
  /** Byte length of the part's content. */
  readonly size: number;
}

/**
 * A `multipart/form-data` body, split into its two kinds of part (SPEC.md §6).
 *
 * **Deliberately not a general parser** (UI-116). It reads the three things the
 * contract's own builders put on the wire — `Content-Disposition`'s `name` and
 * `filename`, and a part's `Content-Type` — and nothing else: no nested
 * multiparts, no `Content-Transfer-Encoding`, no RFC 2231 continuations, no
 * header folding. `packages/contract/src/client/upload.ts` is the only thing
 * that builds these bodies, and it builds them with `FormData`, so a part this
 * cannot read is a part the application cannot send.
 */
export interface MultipartBody {
  readonly text: readonly MultipartTextPart[];
  readonly files: readonly MultipartFilePart[];
}

export interface StubRequest {
  readonly method: string;
  readonly path: string;
  readonly search: string;
  /**
   * The parsed JSON body, or `undefined` when the request carried none **or was
   * multipart** — a multipart body is not JSON and pretending otherwise is what
   * used to throw here. Read {@link StubRequest.multipart} for those.
   */
  readonly body: unknown;
  /** Present only for `multipart/form-data`; `body` is `undefined` alongside it. */
  readonly multipart?: MultipartBody;
}

/** `boundary=` off a `multipart/form-data` content type, quoted or bare. */
const MULTIPART_BOUNDARY = /^multipart\/form-data\s*;.*\bboundary=(?:"([^"]*)"|([^;\s]+))/i;

/** `name="…"` / `filename="…"` out of a part's `Content-Disposition`. */
const PART_NAME = /\bname="([^"]*)"/;
const PART_FILENAME = /\bfilename="([^"]*)"/;
const PART_TYPE = /^content-type:[ \t]*([^\r\n]*)$/im;

/**
 * Splits a multipart body into its parts.
 *
 * Byte-wise on purpose: a file part is arbitrary bytes, and decoding the whole
 * body as UTF-8 first would both corrupt a PNG and make its reported size a
 * count of replacement characters rather than of bytes. Only the headers and the
 * *text* parts are decoded, which are the two places the format promises text.
 */
function parseMultipart(boundary: string, raw: Buffer): MultipartBody {
  const text: MultipartTextPart[] = [];
  const files: MultipartFilePart[] = [];
  const delimiter = Buffer.from(`--${boundary}`, "utf8");
  const separator = Buffer.from("\r\n\r\n", "utf8");

  let at = raw.indexOf(delimiter);
  while (at !== -1) {
    const after = at + delimiter.length;
    // The closing delimiter is `--boundary--`; everything past it is epilogue.
    if (raw.subarray(after, after + 2).toString("utf8") === "--") break;
    const headerEnd = raw.indexOf(separator, after);
    if (headerEnd === -1) break;
    const headers = raw.subarray(after, headerEnd).toString("utf8");
    const next = raw.indexOf(delimiter, headerEnd);
    // The CRLF before the next delimiter belongs to the delimiter, not the part.
    const contentEnd = (next === -1 ? raw.length : next) - 2;
    const content = raw.subarray(headerEnd + separator.length, Math.max(contentEnd, headerEnd));

    const field = PART_NAME.exec(headers)?.[1];
    const filename = PART_FILENAME.exec(headers)?.[1];
    if (field !== undefined) {
      if (filename === undefined) text.push({ field, value: content.toString("utf8") });
      else {
        files.push({
          field,
          filename,
          type: PART_TYPE.exec(headers)?.[1]?.trim() ?? "",
          size: content.length,
        });
      }
    }
    at = next;
  }

  return { text, files };
}

/**
 * A multipart body read the way a JSON body's handlers read theirs, so one
 * handler can answer both halves of a route that declares both (SPEC.md §6).
 *
 * **Field names are kept verbatim** — the multipart branch spells a turn's prose
 * `text` where the JSON branch spells it `body`
 * (`packages/contract/src/client/upload.ts`), and folding the two spellings into
 * one here would let a composer send the wrong one and still be answered. Only
 * the two *encodings* the format forces are undone: every multipart value is a
 * string, so `requestsAgent` arrives as `"true"`, and the selector arrives as
 * one JSON-encoded part.
 */
/**
 * The multipart body of a request, or `undefined` when it carried none.
 *
 * Exported for the specs that answer a route **themselves** — a refusal
 * registered ahead of the stub, which never reaches the recorder — so a test
 * about what happens to a refused upload can still say what it refused. Without
 * it such a test can assert only that a request went, which is satisfied by a
 * composer that attached nothing.
 */
export function multipartBodyOf(request: Request): MultipartBody | undefined {
  const boundary = MULTIPART_BOUNDARY.exec(request.headers()["content-type"] ?? "");
  if (boundary === null) return undefined;
  return parseMultipart(
    boundary[1] ?? boundary[2] ?? "",
    request.postDataBuffer() ?? Buffer.alloc(0),
  );
}

/**
 * A posted turn's prose, under whichever name it arrived: `body` on a JSON body,
 * `text` on a multipart one. Empty when neither is present, which is an
 * attachment-only turn (SPEC.md §6) rather than an error.
 */
function prose(input: Record<string, unknown>): string {
  if (typeof input["body"] === "string") return input["body"];
  if (typeof input["text"] === "string") return input["text"];
  return "";
}

function fieldsOf(body: MultipartBody): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const part of body.text) {
    if (part.field === "requestsAgent") fields[part.field] = part.value === "true";
    else if (part.field === "selector") fields[part.field] = JSON.parse(part.value) as unknown;
    else fields[part.field] = part.value;
  }
  return fields;
}

/**
 * A queue event the server is still working on, as `GET /api/jobs` reports it
 * (SPEC.md §7, §8).
 *
 * Seeded rather than derived, because a job is *the agent's* state and nothing
 * in a stubbed page produces one: the answer route reports an `eventId`, but the
 * work behind it happens in a process this suite does not run. Without a seed
 * `/api/jobs` was flatly `{jobs: []}`, so §8's pending indicator — the row that
 * says the agent still owes this thread a reply — could never appear in any
 * spec, and "neither signal suppresses the other" was an argument rather than an
 * assertion (UI-084).
 *
 * Only the fields a spec chooses; the rest are filled the way the projection
 * fills them (`originTitle` read from the store at response time, never stored).
 */
export interface StubJob {
  readonly eventId: string;
  /** `comment.created`, `form.respond`, `doc.edited`, or a plugin's own. */
  readonly type: string;
  /** One of `QUEUE_EVENT_STATUSES`; the queue's three non-terminal ones are what §8 reads. */
  readonly status: QueueEventStatus;
  /** When the event was enqueued — what the pending indicator counts from. */
  readonly started: string;
  readonly updated?: string;
  readonly lastLine?: string | null;
  /** The document or thread the event originated from. */
  readonly originId?: string | null;
  readonly blockedOn?: string | null;
}

/** Everything a spec seeds that is not a document. */
export interface StubOptions {
  readonly jobs?: readonly StubJob[];
  /**
   * Who is parked, as `GET /api/queue/status` reports it (`QueueStatus.agent`,
   * CONTRACT-045).
   *
   * Seeded because it is not derivable from anything else in a stubbed page —
   * presence is a request the server is holding open, and this suite runs no
   * server — and because it changes what §8's pending row *says*: an unclaimed
   * request with nobody listening reads differently from one an agent is about
   * to take (UI-097). The default is **nobody**, which is the state a stub
   * without an agent process is actually in.
   */
  readonly agent?: QueueStatus["agent"];
  /**
   * The lanes `GET /api/agents` answers with (SPEC.md §7's roster) — **beyond**
   * the orchestrator's row, which the stub always includes because the contract
   * says it is unconditional.
   *
   * Seeded for `agent`'s reason and one of its own: a composer's recipient
   * picker draws nothing at all when the roster names one lane (UI-108), so a
   * spec that wants the control has to designate something, and a spec that does
   * not gets the composer exactly as it was before the feature.
   */
  readonly lanes?: readonly AgentLane[];
}

export interface StubCorpus {
  /** Every `/api` request the page made, in order. */
  readonly requests: () => Promise<readonly StubRequest[]>;
  readonly of: (method: string, path?: string) => Promise<readonly StubRequest[]>;
  /**
   * Every request this stub **refused** because no handler claimed it, as
   * `"<METHOD> <path>"` (UI-085).
   *
   * The refusal is already loud — a `501` naming the route, and a line on the
   * runner's stderr — so nothing has to read this to be told. It exists for the
   * spec that wants to assert the refusal itself, and for one that wants to say
   * "and nothing else fell through" at the end of a flow.
   */
  readonly unhandled: () => Promise<readonly string[]>;
  /** The stored document, or `undefined` once it has been deleted. */
  readonly doc: (id: string) => Promise<StoredDoc | undefined>;
  readonly ids: () => Promise<readonly string[]>;
  /**
   * Answers a form **behind the page's back** — the second tab, the other
   * column, the second browser (UI-084's own edge case list).
   *
   * The corpus changes and the page is told nothing, which is precisely the
   * state an `invalidate` frame is the only cure for: no mutation of this page's
   * ran, so no `invalidateQueries` of its own is coming. Writes through the same
   * formatter and the same commit the route uses, so what lands in the thread is
   * what a real answer lands.
   */
  readonly answerForm: (
    threadId: string,
    ts: string,
    answer: FormAnswerRequest,
  ) => Promise<StubTurn>;
  /**
   * **The other writer** — the agent rewriting a document this page has open
   * (SPEC.md §7's realistic conflict).
   *
   * The corpus moves and the page is told nothing, exactly as
   * {@link StubCorpus.answerForm} does it: the key the board is holding now
   * names a version that no longer exists, so its next body write is refused
   * with a `409` carrying this document and a fresh key. Returns the key it
   * left behind, which is the one the board's retry must present.
   */
  readonly writeAsAgent: (docId: string, body: string) => Promise<string>;
  /**
   * **An agent taking the work** — the queue transition §8's pending row is
   * about (UI-097).
   *
   * A claim happens in a process this suite does not run, so a spec that wants
   * to see `pending → in-progress` has to move the event itself. Like every
   * other writer on this interface it moves the corpus **behind the page's
   * back**: nothing the page did caused it, so no `invalidateQueries` of its own
   * is coming, and what repaints the card is the `invalidate` frame a spec
   * pushes afterwards — which is the whole point, since "updates live over SSE"
   * is otherwise indistinguishable from "was right on first paint".
   */
  readonly claimJob: (eventId: string) => Promise<void>;
  /**
   * **The other tab** — a resident released while this page is looking at a
   * composer (SPEC.md §7, UI-118).
   *
   * `GET /api/agents` stops naming the lane from here on, and the page is told
   * nothing: no invalidate frame is pushed, so its cached roster still names it
   * and its recipient picker still offers it. That disagreement is exactly what
   * lets a stale pick reach the wire and be refused, and it cannot be seeded —
   * it is two moments, not a state.
   */
  readonly releaseLane: (lane: string) => Promise<void>;
}

function seeded(row: StubRow): StoredDoc {
  return {
    id: row.id,
    type: row.type ?? "note",
    title: row.title ?? "Untitled",
    path: row.path ?? `data/docs/inbox/${row.id}.md`,
    body: row.body ?? "",
    turnModels: { ...(row.turnModels ?? {}) },
    status: row.status ?? "open",
    due: row.due ?? null,
    pinned: row.pinned ?? false,
    order: row.order ?? null,
    query: row.query ?? null,
    column: row.column ?? null,
    parent: row.parent ?? null,
    extra: { ...(row.extra ?? {}) },
    stale: row.stale ?? null,
    updated: SEEDED_AT,
    key: nextStubKey(),
    agent: "none",
    related: row.related ?? null,
    unread: row.unread ?? false,
    unreadThreads: row.unreadThreads ?? 0,
    anchors: (row.anchors ?? []).map((anchor) => ({
      anchorId: anchor.anchorId,
      threadId: anchor.threadId,
      selector: { exact: anchor.exact, prefix: anchor.prefix ?? "", suffix: anchor.suffix ?? "" },
      threadStatus: anchor.threadStatus ?? "open",
    })),
  };
}

/**
 * Resolves one anchor against the body it lives in, by **the server's own
 * rules** — SPEC.md §6's rungs 1–2, ported and pinned in `serverParity.ts`.
 *
 * It used to be rung 2 alone (a unique `exact`), which made a framed selector
 * for a duplicated phrase — the case the framing exists to serve — resolve
 * against the real server and orphan here (UI-051's finding, UI-056). A spec
 * written against that would have encoded a lie about the product.
 *
 * Resolution happens on every read, which is what makes a highlight a
 * **persistent** fact about the document rather than the optimistic decoration a
 * creation briefly shows.
 */
function resolveAnchor(doc: StoredDoc, anchor: StoredAnchor): ResolvedAnchor {
  const range = resolveAnchorExact(doc.body, anchor.selector);
  return {
    anchorId: anchor.anchorId,
    threadId: anchor.threadId,
    threadStatus: anchor.threadStatus,
    selector: anchor.selector,
    range,
    orphaned: range === null,
  };
}

/**
 * The `[[ref]]` grammar, as `packages/kit/src/markdown/refs.ts` spells it — the
 * stub's stand-in for the projection's `links` table.
 *
 * Kept as its own regex rather than imported: this module is the *transport*,
 * and a stub that shared the application's parser would stop being able to catch
 * the application misreading its own grammar.
 */
const STUB_REF_PATTERN = /\[\[([A-Za-z][A-Za-z0-9]*_[A-Za-z0-9]+)(?:\|[^\]\n]*)?\]\]/g;

/** Every document id this body references, deduplicated. */
function refIdsIn(body: string): readonly string[] {
  return [...new Set([...body.matchAll(STUB_REF_PATTERN)].map((match) => match[1] ?? ""))];
}

/**
 * `includeArchived=true` on a related request — the archived exclusion every
 * list applies by default (SPEC.md §11), lifted into the union.
 */
function subjectWantsArchived(url: URL): boolean {
  return url.searchParams.get("includeArchived") === "true";
}

/** The form an agent turn carries, or `undefined` — the contract's grammar, whole. */
function formIn(turn: StubTurn): Form | undefined {
  if (turn.author !== "agent") return undefined;
  const source = extractFormSource(turn.body);
  if (source === undefined) return undefined;
  try {
    const parsed = FormSchema.safeParse(YAML.parse(source) ?? undefined);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The forms of a thread that are still unanswered, in order — the projection's
 * `needs=form` condition (SPEC.md §6), read the same way the server reads it:
 * a form is open until a later turn is an answer to **it**.
 *
 * The stub derives this rather than taking a seed for it, because the whole
 * point of the Attention half of UI-084 is that the row clears by *answering*
 * and by nothing else. A seeded boolean would clear whenever a spec said so,
 * which would make the asymmetry untestable here.
 */
function openForms(turns: readonly StubTurn[]): readonly StubTurn[] {
  const open: { turn: StubTurn; form: Form }[] = [];
  for (const turn of turns) {
    if (isFormAnswerBody(turn.body)) {
      const at = open.findIndex(
        (entry) => parseFormAnswerBody(turn.body, entry.form) !== undefined,
      );
      if (at !== -1) open.splice(at, 1);
    }
    const form = formIn(turn);
    if (form !== undefined) open.push({ turn, form });
  }
  return open.map((entry) => entry.turn);
}

/**
 * `DocRow.unansweredForms` (CONTRACT-040) — how many forms this thread still
 * holds unanswered, under the same open-thread guard the reason uses.
 *
 * The server derives the count and the `form` reason from **one** SQL
 * expression, so the published invariant holds in both directions:
 * `unansweredForms > 0` **iff** `attention` contains `form`. The stub keeps that
 * property structurally rather than by coincidence — {@link attentionOf} reads
 * its `form` reason off this function's result instead of testing the same set a
 * second time — because a stub whose count and reason could drift is exactly the
 * stub that would let a spec pass against a row the server never sends.
 *
 * `0` on a non-thread row and on a resolved thread, never null and never absent.
 */
function unansweredFormsOf(doc: StoredDoc): number {
  if (doc.type !== "thread" || doc.status !== "open") return 0;
  return openForms(parseThreadTurns(doc.body)).length;
}

/**
 * The row's attention reasons (SPEC.md §11), derived rather than seeded.
 *
 * Two of the five, which are the two UI-084's asymmetry is about: an unanswered
 * form (which survives being read) and an unread agent reply (which does not).
 * Both are computed from the thread's own state, so `POST …/seen` clears one and
 * only answering clears the other — exactly the difference the spec asserts.
 *
 * **The other three are absent, and the guards here are tighter than the
 * server's** (UI-102's sweep). `apps/server/src/docs/needs.ts` derives `stale`,
 * `due` and `failed-job` with no thread guard at all, and its `unread-reply` has
 * no open-status guard either — so a resolved thread holding an unseen agent
 * turn carries the reason there and not here. Nothing shipped asserts over the
 * difference; a spec that wants one of those three needs this function to grow,
 * not a seeded `attention` array, for the reason the two reasons below are
 * derived rather than seeded.
 */
function attentionOf(doc: StoredDoc): NeedsReason[] {
  if (doc.type !== "thread" || doc.status !== "open") return [];
  const turns = parseThreadTurns(doc.body);
  const reasons: NeedsReason[] = [];
  if (doc.unread && turns.at(-1)?.author === "agent") reasons.push("unread-reply");
  if (unansweredFormsOf(doc) > 0) reasons.push("form");
  return reasons;
}

/**
 * A thread's status as the **thread** surfaces report it (SPEC.md §6): `open` or
 * `resolved` and never `archived`.
 *
 * A document has three statuses and a `Thread`/`ThreadSummary` has two, so the
 * narrowing has to happen somewhere. It happens here, once, rather than at each
 * of the four responses that carry one — `GET /api/threads/{id}` already did it
 * inline and the other three passed the document's status straight through, so
 * an archived thread would have reported `status: "archived"` on three routes
 * whose contract has no such value (UI-102).
 */
function threadStatusOf(doc: StoredDoc): ThreadStatus {
  return doc.status === "resolved" ? "resolved" : "open";
}

/** Whether a `PUT` body's `status` is one the contract defines. */
function isDocStatus(value: unknown): value is DocStatus {
  return value === "open" || value === "resolved" || value === "archived";
}

/**
 * What a write stamps: a monotonic `updated`, so two saves never collide, and a
 * fresh **key**, because the document is now a different version (SPEC.md §7).
 *
 * The two move together on purpose. A stub that advanced `updated` and left the
 * key alone would hand out a key that no longer names what it was read from,
 * which is precisely the state the mechanism exists to detect — and every
 * conflict spec would then be testing the stub's memory rather than the board's.
 */
function stampUpdated(doc: StoredDoc): void {
  writes += 1;
  doc.updated = new Date(Date.parse(SEEDED_AT) + writes * 1000).toISOString();
  doc.key = nextStubKey();
}

/**
 * Installs the stub. Call before `page.goto` — the board queries on first
 * render, and a route added afterwards would miss the first request.
 */
export async function stubCorpus(
  page: Page,
  rows: readonly StubRow[],
  options: StubOptions = {},
): Promise<StubCorpus> {
  const store = new Map<string, StoredDoc>(rows.map((row) => [row.id, seeded(row)]));
  // A mutable copy: `claimJob` moves an event's status, and the seed the spec
  // handed in is not the stub's to rewrite.
  const jobs: StubJob[] = [...(options.jobs ?? [])];
  // Mutable for `releaseLane`'s reason: a roster is what the server holds *now*,
  // and the page's copy of it is what it last read.
  const lanes: AgentLane[] = [...(options.lanes ?? [])];
  const requests: StubRequest[] = [];
  /** `"<METHOD> <path>"` for every request no handler claimed — see {@link StubCorpus.unhandled}. */
  const unhandled: string[] = [];
  let created = 0;
  let appended = 0;
  /*
   * Whether the queue is halted (SPEC.md §7). Mutable because `POST
   * /api/queue/halt` and `/resume` are the two routes whose whole observable
   * effect is this flag: a stub that answered them without moving it would let
   * the strip's HALT button look correct while the state it reports never
   * changed.
   */
  let halted = false;

  /*
   * The roster **is** the set of designations, as it is on the server (SPEC.md
   * §7 names a lane after its designated root thread), so designating, releasing
   * and resolving all go through these three rather than each rewriting `lanes`.
   * A designation this stub acknowledged without touching the roster would leave
   * every badge and every recipient picker reading the state before it.
   */
  const laneOf = (id: string): AgentLane | undefined => lanes.find((row) => row.lane === id);

  const dropLane = (id: string): void => {
    const index = lanes.findIndex((row) => row.lane === id);
    if (index !== -1) lanes.splice(index, 1);
  };

  const setLane = (id: string, resident: Resident): void => {
    dropLane(id);
    lanes.push({
      lane: id,
      resident,
      // A designation creates a lane nobody has parked on yet: presence is the
      // parked `idle` and nothing else, and no agent runs in this suite.
      live: false,
      since: null,
      summary: null,
      origin: { id, title: store.get(id)?.title ?? id },
    });
  };

  /** One stored thread as a `ThreadMutationResponse`, resident and all. */
  const threadMutation = (doc: StoredDoc): ThreadMutationResponse => {
    const parent = doc.parent === null ? undefined : store.get(doc.parent);
    const anchor = parent?.anchors.find((entry) => entry.threadId === doc.id);
    const turns = parseThreadTurns(doc.body);
    return {
      thread: {
        id: doc.id,
        title: doc.title,
        status: threadStatusOf(doc),
        parent: doc.parent,
        anchor: anchor?.anchorId ?? null,
        agent: doc.agent,
        resident: laneOf(doc.id)?.resident ?? null,
        created: SEEDED_AT,
        updated: doc.updated,
        turnCount: turns.length,
        lastAuthor: turns.at(-1)?.author ?? "user",
        lastTs: turns.at(-1)?.ts ?? SEEDED_AT,
      },
      warnings: [],
    };
  };

  const json = async (route: Route, payload: StubPayload, status = 200): Promise<void> => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  };

  /**
   * A `204`, for the routes whose contract says the success carries no body.
   *
   * Separate from {@link json} rather than `json(route, {})` with a status: the
   * client reads those two differently — `flushEditSession` checks
   * `response.ok` precisely because a `204` leaves `data` undefined — and a stub
   * that sent `200 {}` there would be answering a shape the route does not have.
   */
  const noContent = async (route: Route): Promise<void> => {
    await route.fulfill({ status: 204, body: "" });
  };

  /**
   * The turns of a thread document — its body for the text, its frontmatter for
   * the model (SPEC.md §6).
   *
   * The two halves come from two places on purpose, because they do on disk:
   * `parseThreadTurns` is the body-only parser the server's own is mirrored from
   * and names no model, and the `turnModels` map keyed by turn timestamp is what
   * supplies one. A timestamp with no entry stays `null` — the honest answer
   * §11 requires for a turn nobody recorded a model for.
   */
  const turnsOf = (doc: StoredDoc): readonly StubTurn[] =>
    doc.type === "thread"
      ? parseThreadTurns(doc.body).map((turn) => ({
          ...turn,
          model: doc.turnModels[turn.ts] ?? null,
        }))
      : [];

  /** A thread's anchored text, from the entry its parent holds for it. */
  const parentAnchorQuote = (doc: StoredDoc): string | null => {
    if (doc.type !== "thread" || doc.parent === null) return null;
    const parent = store.get(doc.parent);
    return parent?.anchors.find((anchor) => anchor.threadId === doc.id)?.selector.exact ?? null;
  };

  /**
   * One row of `GET /api/docs`, as `DocRow` — **typed, so a field added to the
   * contract stops this file compiling** rather than arriving at the board as
   * `undefined` (UI-102). That is the whole of the protection: nothing
   * runtime-validates a response, so the compiler is the only thing that can
   * notice an omission.
   *
   * **It builds the row literally rather than on `docRowFixture`**
   * (`@corpus/kit/testing`), which models a complete row for unit tests. The
   * fixture is right there and wrong here: spreading over it would fill any
   * field this function forgets with the fixture's "nothing to report" value, so
   * the next `DocRow` field would compile clean and answer a plausible-looking
   * default on every stubbed row — the same silence in a new costume. A test
   * that does not care what a field says wants that default; a *stand-in for the
   * server* has to be made to decide.
   *
   * **What it still does not know, named rather than left to be discovered.**
   * These are type-legal and honest-looking, and each is a place a spec can
   * assert less than the server would show it (no shipped spec does today —
   * UI-102's sweep checked):
   *
   * - `unreadThreads` is whatever the spec **seeded** and never derived. The
   *   server counts a document's child threads whose last turn is newer than the
   *   seen mark; this stub holds no seen mark, so an unseeded parent of an
   *   unread conversation still wears no pill here.
   * - `awaitingAgent` is always `false` on a thread. The server's rule is
   *   `agent <> 'none' AND status = 'open' AND last_author = 'user'`, which a
   *   thread created through this stub's own `POST /api/threads` with
   *   `requestsAgent` satisfies — so the row's working dot is missing.
   * - `attention` carries only `unread-reply` and `form` (see {@link attentionOf}).
   *   The server also emits `stale`, `due` and `failed-job`, none of which are
   *   thread-scoped, so `needs=stale` answers empty here on a corpus the server
   *   would report rows for.
   * - `tags`, `due`, `reviewed` and `evergreen` are fixed, so no spec can reach
   *   the surfaces that read them.
   * - `snippets` is always empty, including under `q` — the server returns the
   *   matched passages.
   */
  const asRow = (doc: StoredDoc): DocRow => {
    const turns = turnsOf(doc);
    const last = turns.at(-1);
    return {
      id: doc.id,
      type: doc.type,
      title: doc.title,
      path: doc.path,
      status: doc.status,
      tags: [],
      created: SEEDED_AT,
      updated: doc.updated,
      due: doc.due,
      reviewed: null,
      evergreen: false,
      origin: null,
      excerpt: doc.body.slice(0, 120),
      stale: doc.stale,
      parent: doc.parent,
      agent: doc.type === "thread" ? doc.agent : null,
      /*
       * The anchored words, read off the **parent's** anchor entry — which is
       * where a thread's selector lives (SPEC.md §6), and so the only place the
       * projection can get this from either.
       *
       * It used to be flatly `null`, which no surface noticed until a collapsed
       * conversation had to say what it is about (UI-077): every anchored thread
       * described itself as a "whole document" one. A stub that answers `null`
       * for everything cannot tell a row that carries its quote from one that
       * drops it.
       */
      anchorQuote: parentAnchorQuote(doc),
      /*
       * The conversation columns of the projection (SPEC.md §9.1), read off the
       * thread's own body rather than asserted: a body whose turns the server
       * would count as two must not be a row claiming one. A body carrying no
       * turn headings has no turns, and the row says so — the same answer
       * `GET /api/threads/{id}` gives for it.
       */
      turnCount: doc.type === "thread" ? turns.length : null,
      lastAuthor: doc.type === "thread" ? (last?.author ?? "user") : null,
      lastTurn: doc.type === "thread" ? (last?.body ?? null) : null,
      unread: doc.type === "thread" ? doc.unread : null,
      awaitingAgent: doc.type === "thread" ? false : null,
      unreadThreads: doc.type === "thread" ? 0 : doc.unreadThreads,
      unansweredForms: unansweredFormsOf(doc),
      attention: attentionOf(doc),
      snippets: [],
      parentTitle: doc.parent === null ? null : (store.get(doc.parent)?.title ?? null),
      pinned: doc.pinned,
      order: doc.order,
      query: doc.query,
      column: doc.column,
      extra: doc.extra,
    };
  };

  /**
   * One seeded job as the wire reports it. `originTitle` and `blockedOnTitle`
   * are read from the store here rather than seeded, because the contract says
   * they are denormalised copies resolved at response time — a renamed document
   * shows its new title on the next read.
   */
  const asJob = (job: StubJob): Job => ({
    eventId: job.eventId,
    type: job.type,
    status: job.status,
    started: job.started,
    updated: job.updated ?? job.started,
    lastLine: job.lastLine ?? null,
    originId: job.originId ?? null,
    originTitle: job.originId === undefined ? null : (store.get(job.originId ?? "")?.title ?? null),
    blockedOn: job.blockedOn ?? null,
    blockedOnTitle:
      job.blockedOn === undefined ? null : (store.get(job.blockedOn ?? "")?.title ?? null),
  });

  /**
   * The answer turn write itself, shared by the route and by the out-of-band
   * {@link StubCorpus.answerForm} — so a form answered in another tab lands as
   * the same bytes, stamped by the same clock, as one answered in this page.
   *
   * The body it is handed is the exact string the refusal ladder judged; this
   * never re-renders it.
   */
  const commitAnswerTurn = (doc: StoredDoc, answerBody: string): StubTurn => {
    stampUpdated(doc);
    // Seconds precision, `Z`: the turn-heading grammar rejects milliseconds,
    // and a heading the parser rejects is a turn that silently disappears.
    const turn: StubTurn = {
      author: "user",
      ts: canonicalInstant(doc.updated),
      body: answerBody,
      model: null,
    };
    doc.body = `${doc.body.trimEnd()}\n\n${renderTurn(turn)}`;
    return turn;
  };

  const asDoc = (doc: StoredDoc): Doc => ({
    body: doc.body,
    path: doc.path,
    /*
     * SPEC.md §7's **key**, on every document read. Derived from the version the
     * document is *at* — a counter this stub advances on every write, standing
     * in for the server's digest of the stored bytes. What matters is the
     * property, not the algorithm: it names the version you read and moves when
     * the document does, and a client may only echo it.
     */
    key: doc.key,
    /*
     * §7's advisory *someone is editing this*. Always `false` here: this stub
     * serves one page, and the signal reports a **person's** session to the
     * *agent*, which is not a party any browser spec plays. It is information
     * and never a gate, so no surface branches on it.
     */
    userEditing: false,
    anchors: doc.anchors.map((anchor) => resolveAnchor(doc, anchor)),
    frontmatter: {
      id: doc.id,
      type: doc.type,
      title: doc.title,
      created: SEEDED_AT,
      updated: doc.updated,
      tags: [],
      status: doc.status,
      /*
       * The frontmatter anchors map (SPEC.md §6) — the selectors as the *file*
       * holds them, keyed by anchor id, beside the resolved `anchors` array
       * above. It used to be flatly `{}` on every document, which the type
       * permits (an empty record is a legal record) and no surface reads today,
       * but a document carrying two highlights and an empty anchors map is not a
       * document the server can produce.
       */
      anchors: Object.fromEntries(doc.anchors.map((anchor) => [anchor.anchorId, anchor.selector])),
      due: doc.due,
      reviewed: null,
      evergreen: false,
      origin: null,
      pinned: doc.pinned,
      order: doc.order,
      query: doc.query,
      column: doc.column,
      extra: doc.extra,
    },
  });

  const matches = (doc: StoredDoc, params: URLSearchParams): boolean => {
    const pinned = params.get("pinned");
    if (pinned !== null && String(doc.pinned) !== pinned) return false;
    const type = params.get("type");
    if (type !== null && !type.split(",").includes(doc.type)) return false;
    const parent = params.get("parent");
    if (parent !== null && doc.parent !== parent) return false;
    /*
     * `references=<id>` — the backlinks filter, over the same `[[ref]]` graph the
     * projection's `links` table holds (UI-025). It used to short-circuit to
     * empty on the grounds that nothing in these specs linked documents; a spec
     * that seeds a link now gets the panel the server would give it.
     */
    const references = params.get("references");
    if (references !== null && !refIdsIn(doc.body).includes(references)) return false;
    /*
     * `q` — lexical matching over the title and the body, which is as much as a
     * stub can honestly claim (the server's is FTS5). Shared with `/api/search`
     * so the two surfaces cannot disagree about which documents match.
     */
    const q = params.get("q");
    if (q !== null && q !== "") {
      const needle = q.toLowerCase();
      const haystack = `${doc.title}\n${doc.body}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    const folder = params.get("folder");
    if (folder !== null && !doc.path.includes(`/${folder.replace(/\/+$/, "")}/`)) return false;
    /*
     * `needs=` — the Attention column's filter (SPEC.md §11). `me` is the union
     * of every reason; every other value names one. Derived from the same
     * `attentionOf` the row reports, so a row can never appear in Attention
     * carrying no reason chip, or carry one and be filtered out.
     */
    const needs = params.get("needs");
    if (needs !== null) {
      const reasons = attentionOf(doc);
      if (needs === "me" ? reasons.length === 0 : !reasons.some((reason) => reason === needs)) {
        return false;
      }
    }
    const status = params.get("status");
    if (status !== null) return status.split(",").includes(doc.status);
    return doc.status !== "archived";
  };

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    /*
     * The request, recorded before it is answered — JSON as it always was, and
     * multipart **beside** it rather than instead of it (UI-116).
     *
     * This line used to be `JSON.parse(request.postData())` unconditionally,
     * which throws on a `multipart/form-data` body: the route handler died, the
     * request hung, and so no spec in the suite had ever posted an attachment on
     * any surface. Every composer §11's rider binds now can, so the send path
     * has to be recordable, and the JSON path has to keep behaving exactly as it
     * did — every other spec in this directory reads `body`.
     */
    const multipart = multipartBodyOf(request);
    const raw = multipart === undefined ? request.postData() : null;
    requests.push({
      method,
      path: url.pathname,
      search: url.search,
      body: raw === null ? undefined : (JSON.parse(raw) as unknown),
      ...(multipart === undefined ? {} : { multipart }),
    });

    /**
     * The fields of the request now being answered, whichever way they arrived.
     * The routes the contract declares in **both** encodings read this rather
     * than `requests.at(-1)?.body`, so one branch answers both halves; the
     * JSON-only routes below still read `body` directly, because for them the
     * two are the same thing and the indirection would only hide it.
     */
    const inputOf = (): Record<string, unknown> => {
      const entry = requests.at(-1);
      if (entry === undefined) return {};
      if (entry.multipart !== undefined) return fieldsOf(entry.multipart);
      return (entry.body ?? {}) as Record<string, unknown>;
    };

    /*
     * `GET /api/jobs` — the queue's own rows, filtered the way the server
     * filters them: `status` is the comma-separated set `useOutstandingJobs`
     * sends, `originId` the exact predicate a thread card escalates to, and
     * `recent` the cap that makes an answer possibly short. Answering the whole
     * seed regardless of the query would make the shared-vs-exact distinction
     * `outstandingAgentRequest.ts` is built around untestable here.
     *
     * **`recent` bounds the console list only, and is ignored once `originId`
     * is given** (SPEC.md §9.2, rider signed 2026-08-05) — which is exactly what
     * `listJobRows` does: both filters are a `WHERE`, the `LIMIT ?` is appended
     * only on the unfiltered path (`apps/server/src/jobs/project.ts`). A
     * windowed predicate fails silently and in one direction — a job pushed out
     * of the window is indistinguishable from no job — and §8's pending
     * indicator *is* that predicate. A stub that capped the filtered answer too
     * would let a spec assert a "working…" row the real server would place
     * somewhere else, on the one point the rider exists to protect.
     *
     * Seeded order is taken as the server's order (most recently active first,
     * `ORDER_JOBS`); these specs hand it a list, not timestamps to sort.
     */
    if (url.pathname === "/api/jobs") {
      const wanted = url.searchParams.get("status");
      const origin = url.searchParams.get("originId");
      const matching = jobs
        .filter((job) => wanted === null || wanted.split(",").includes(job.status))
        .filter((job) => origin === null || (job.originId ?? null) === origin);
      const recent = Number(url.searchParams.get("recent") ?? DEFAULT_RECENT_JOBS);
      const answer =
        origin === null
          ? matching.slice(0, Number.isFinite(recent) && recent > 0 ? recent : DEFAULT_RECENT_JOBS)
          : matching;
      return json(route, { jobs: answer.map(asJob) } satisfies JobList);
    }

    /*
     * `GET /api/jobs/{id}/log` — the console row's expanded log (SPEC.md §7).
     *
     * A seeded job carries a `lastLine` and nothing more, so that is the whole
     * log this stub can honestly report: one line where there is one, none where
     * there is not. `nextCursor` is the total line count, as the contract says,
     * and `cursor` is honoured so an incremental refetch answers empty rather
     * than repeating what the caller already holds — a stub that re-sent every
     * line on each poll would make a duplicated log look like correct streaming.
     */
    const jobLog = /^\/api\/jobs\/([^/]+)\/log$/.exec(url.pathname);
    if (jobLog !== null && method === "GET") {
      const eventId = decodeURIComponent(jobLog[1] ?? "");
      const job = jobs.find((row) => row.eventId === eventId);
      if (job === undefined) {
        return json(
          route,
          { code: "not_found", message: `no job ${eventId}` } satisfies NotFoundError,
          404,
        );
      }
      const lines =
        job.lastLine === undefined || job.lastLine === null
          ? []
          : [{ ts: job.updated ?? job.started, line: job.lastLine }];
      const cursor = Number(url.searchParams.get("cursor") ?? "0");
      const from = Number.isFinite(cursor) && cursor > 0 ? cursor : 0;
      return json(route, {
        lines: lines.slice(from),
        nextCursor: lines.length,
      } satisfies JobLog);
    }

    /*
     * `POST /api/jobs/{id}/retry` and `/abandon` — the console row's two acts
     * (SPEC.md §7).
     *
     * They move the seeded job rather than merely acknowledging: retry returns a
     * failed event to `pending`, abandon takes it to `abandoned`, and both answer
     * the job **as it now stands**, which is what the console's cache replaces
     * its row with. A stub that answered the row unchanged would let a spec
     * assert a menu action the queue never performed.
     *
     * Neither is offered on a job the queue does not hold: `JobService.retry`
     * throws `notFound` for an id the queue has no row for, so this answers the
     * same `404` rather than inventing a refusal of its own.
     */
    const jobAct = /^\/api\/jobs\/([^/]+)\/(retry|abandon)$/.exec(url.pathname);
    if (jobAct !== null && method === "POST") {
      const eventId = decodeURIComponent(jobAct[1] ?? "");
      const at = jobs.findIndex((row) => row.eventId === eventId);
      const job = jobs[at];
      if (job === undefined) {
        return json(
          route,
          { code: "not_found", message: `no job ${eventId}` } satisfies NotFoundError,
          404,
        );
      }
      const moved: StubJob = { ...job, status: jobAct[2] === "retry" ? "pending" : "abandoned" };
      jobs[at] = moved;
      return json(route, asJob(moved));
    }

    if (url.pathname === "/api/tree") return json(route, { folders: [] } satisfies FolderTree);
    /*
     * `GET /api/index/status` — the strip's index pill (SPEC.md §11's
     * index-pill rider).
     *
     * Nobody had written a handler, so the `{}` fallback at the bottom of this
     * function answered it, and the pill in **every** stubCorpus spec read
     * `index: undefined · undefined/NaN` — a wider, uglier string than any real
     * one, in a strip several specs measure (UI-133). Nothing validates a JSON
     * response, so it never raised anything.
     *
     * A caught-up index is the honest default for a stub with no worker: there
     * is nothing queued because nothing here queues.
     */
    /*
     * `GET /api/health` — the strip's reachability notice (SPEC.md §2.1).
     *
     * Unhandled for the same reason and with the same result as the index
     * status above: the `{}` fallback answered it, `health.data` was an object
     * rather than `undefined`, and the strip rendered `corpus ` with an empty
     * version in every stubCorpus spec. A stub that answers the rest of the API
     * is a reachable server, so it says so.
     */
    if (url.pathname === "/api/health") {
      return json(route, {
        status: "ok",
        version: "0.0.0-stub",
        uptimeSeconds: 1,
        workspace: "/tmp/stub-workspace",
      } satisfies Health);
    }
    if (url.pathname === "/api/index/status") {
      return json(route, {
        indexed: store.size,
        pending: 0,
        failed: 0,
        identity: "stub/none@0",
        rebuilding: false,
        state: "current",
      } satisfies IndexStatus);
    }
    /*
     * `GET /api/queue/status` — the console strip's counts (SPEC.md §7).
     *
     * It used to answer a shape that was wrong in both directions at once: it
     * omitted `abandoned`, which `QueueStatus` requires, and carried an `agent`
     * key the contract has never had (the agent pill derives its state from the
     * counts — `consoleModel.agentState` — and no such field is on the wire).
     * Neither was visible: the missing count is only read as a number nothing
     * renders yet, and the extra key was silently ignored (UI-102).
     */
    /*
     * `assertRecipientResolvable`, as the server holds it (SPEC.md §7,
     * `apps/server/src/queue/scope.ts`): a `recipient` naming no lane is a `422`
     * and **nothing is written**.
     *
     * Modelled here rather than accepted, because the refusal is the behaviour
     * under test: a pick can go stale between the roster read and the post, and
     * a stub that took one anyway would let a spec assert a routing the server
     * would never have performed (UI-118). `orchestrator` always resolves; an
     * absent field is the ordinary case and needs no lookup.
     *
     * The body comes from `src/testing/serverRefusals.ts` (UI-120), which is the
     * application's single transcription of it — this copy was the correct one
     * of the three, and it is gone for the same reason the wrong two are: three
     * copies is three chances to drift, and only one of them is checked against
     * the server.
     */
    const recipientRefusal = (input: Record<string, unknown>): Promise<void> | undefined => {
      const lane = input["recipient"];
      if (typeof lane !== "string") return undefined;
      if (lane === ORCHESTRATOR_LANE || lanes.some((row) => row.lane === lane)) return undefined;
      return json(route, unknownRecipientBody(lane) satisfies UnknownRecipientError, 422);
    };

    const queueStatus = (): QueueStatus => ({
      // `agent` is required since CONTRACT-045 and it is read by §8's pending
      // row, so it is seeded rather than invented here: the default says
      // nobody is parked, which is true of every spec that does not say
      // otherwise.
      agent: options.agent ?? { live: false, since: null },
      pending: jobs.filter((job) => job.status === "pending").length,
      inProgress: jobs.filter((job) => job.status === "in-progress").length,
      deferred: jobs.filter((job) => job.status === "deferred").length,
      // Fixed at zero, as they have always been: the terminal counts are a
      // separate infidelity from UI-085's, and several specs measure the strip's
      // width against exactly these digits. `halted` is the one value here that
      // now moves, because two routes exist whose only effect is to move it.
      failed: 0,
      processed: 0,
      abandoned: 0,
      halted,
    });

    if (url.pathname === "/api/queue/status") return json(route, queueStatus());

    /*
     * `POST /api/queue/halt` and `/api/queue/resume` — the strip's HALT control
     * (SPEC.md §7).
     *
     * Both answer the **status after the flip**, which is what the client caches
     * in place of a refetch, so a stub that answered the status before it would
     * make the button appear to do nothing. Halting is idempotent here as it is
     * on the server: asking for the state that already holds is a `200`.
     */
    if (url.pathname === "/api/queue/halt" && method === "POST") {
      halted = true;
      return json(route, queueStatus());
    }
    if (url.pathname === "/api/queue/resume" && method === "POST") {
      halted = false;
      return json(route, queueStatus());
    }

    /*
     * `GET /api/agents` — §7's roster (SPEC.md §7, UI-108).
     *
     * The orchestrator's row is unconditional on the wire ("a caller that finds
     * an empty list has found a bug rather than a workspace with no agents"), so
     * it is here rather than seeded, and `options.lanes` adds the designated ones
     * a spec asked for. Its liveness follows `options.agent` for the same reason
     * the contract aggregates the two: `QueueStatus.agent.live` is true exactly
     * when some lane is, and a stub that let them disagree would be teaching the
     * suite a state the server cannot produce.
     */
    /*
     * `GET /api/threads/{id}/scope` — what a lane owns (SPEC.md §7, CONTRACT-068).
     *
     * Derived from the same store the board reads rather than seeded, so a spec
     * that designates a resident and then asks what it owns gets an answer that
     * follows from what it actually created. The root is always first with
     * `via: "self"`, which is the contract's stated order.
     */
    if (/^\/api\/threads\/[^/]+\/scope$/.test(url.pathname) && method === "GET") {
      const rootId = url.pathname.split("/")[3] ?? "";
      if (laneOf(rootId) === undefined) {
        return json(
          route,
          { code: "conflict", message: `${rootId} has no resident, so it has no scope` },
          409,
        );
      }
      const root = store.get(rootId);
      const members = [
        {
          id: rootId,
          kind: "thread" as const,
          title: root?.title ?? rootId,
          status: root?.status ?? "open",
          via: "self" as const,
        },
        ...[...store.values()]
          .filter(
            (doc) => doc.id !== rootId && (doc.parent === rootId || doc.extra["origin"] === rootId),
          )
          .map((doc) => ({
            id: doc.id,
            kind: doc.type === "thread" ? ("thread" as const) : ("doc" as const),
            title: doc.title,
            status: doc.status ?? "open",
            via: doc.parent === rootId ? ("parent" as const) : ("origin" as const),
          })),
      ];
      return json(route, { thread: rootId, members, truncated: false } satisfies ThreadScope);
    }

    if (url.pathname === "/api/agents") {
      const orchestrator: AgentLane = {
        lane: "orchestrator",
        resident: null,
        live: options.agent?.live ?? false,
        since: options.agent?.since ?? null,
        summary: null,
        origin: null,
      };
      return json(route, { agents: [orchestrator, ...lanes] } satisfies AgentRoster);
    }

    if (url.pathname === "/api/docs" && method === "GET") {
      const items = [...store.values()]
        .filter((doc) => matches(doc, url.searchParams))
        .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
        .map(asRow);
      return json(route, {
        items,
        page: { total: items.length, limit: 50, offset: 0 },
      } satisfies DocList);
    }

    if (url.pathname === "/api/docs" && method === "POST") {
      created += 1;
      const input = (requests.at(-1)?.body ?? {}) as Record<string, unknown>;
      const doc = seeded({
        id: `doc_new${String(created)}`,
        type: typeof input["type"] === "string" ? input["type"] : "note",
        title: typeof input["title"] === "string" ? input["title"] : "Untitled",
        path: `data/docs/${typeof input["folder"] === "string" ? input["folder"] : "inbox"}/new${String(created)}.md`,
      });
      store.set(doc.id, doc);
      return json(route, { doc: asDoc(doc), warnings: [] } satisfies DocMutationResponse, 201);
    }

    /**
     * A comment, as `POST /api/threads` makes one: a `type: thread` document
     * plus — when the request carries a selector — a **resolved anchor on its
     * parent**, which is what puts a highlight in the parent's body and keeps it
     * there across refetches. Without this the stub answered `anchors: []`
     * forever, and a spec asserting a highlight was really asserting the
     * optimistic decoration that the first refetch clears.
     */
    if (url.pathname === "/api/threads" && method === "POST") {
      const input = inputOf();
      const refusedRecipient = recipientRefusal(input);
      if (refusedRecipient !== undefined) return refusedRecipient;
      created += 1;
      const parentId = typeof input["parent"] === "string" ? input["parent"] : "";
      const thread = seeded({
        id: `th_new${String(created)}`,
        type: "thread",
        title: "Re: comment",
        path: `data/docs/threads/th_new${String(created)}.md`,
        // A standalone thread — the global composer's *Ask* — has **no** parent,
        // and the wire word for that is `null`, not the empty id.
        parent: parentId === "" ? null : parentId,
      });
      /*
       * The thread's **file**, in §6's turn format — not the bare text of the
       * first turn. The distinction is load-bearing: the turns this thread
       * reports are parsed back out of this body, and a comment on one of *its*
       * turns anchors into these very bytes.
       */
      const firstTurn: StubTurn = {
        author: "user",
        ts: canonicalInstant(thread.updated),
        // `body` on the JSON branch, `text` on the multipart one, and absent on
        // an attachment-only first turn — which SPEC.md §6 allows, and which is
        // why the fallback is the empty string rather than a refusal.
        body: prose(input),
        model: null,
      };
      thread.body = renderTurn(firstTurn);
      thread.agent = input["requestsAgent"] === true ? "requested" : "none";
      store.set(thread.id, thread);

      /*
       * The **request-side** selector, whose context strings are optional
       * (`TextQuoteSelectorRequest`), normalised to the parse-side shape before
       * it is stored. The server defaults both to `""` on the way in, so every
       * selector it reports back carries all three strings; storing the request
       * shape verbatim made an uncontextualised comment produce a resolved
       * anchor missing two fields no server response omits (UI-102).
       *
       * **`null` is the composer's word for "no selection", not `undefined`** —
       * the global *Ask* sends `selector: null`. Read as `undefined` only, a null
       * selector fell past the `=== undefined` guard and the response claimed
       * `anchorId: "anc_newN"` for a thread anchored to nothing (UI-102).
       */
      const asked = input["selector"] as TextQuoteSelectorRequest | null | undefined;
      const selector: TextQuoteSelector | undefined =
        asked === undefined || asked === null
          ? undefined
          : { exact: asked.exact, prefix: asked.prefix ?? "", suffix: asked.suffix ?? "" };
      const parent = store.get(parentId);
      const anchorId = `anc_new${String(created)}`;
      if (parent !== undefined && selector !== undefined) {
        parent.anchors.push({
          anchorId,
          threadId: thread.id,
          selector,
          threadStatus: "open",
        });
      }
      return json(
        route,
        {
          thread: {
            id: thread.id,
            title: thread.title,
            created: SEEDED_AT,
            updated: thread.updated,
            status: "open",
            tags: [],
            parent: thread.parent,
            anchor: selector === undefined ? null : anchorId,
            agent: thread.agent,
            resident: null,
            turns: [firstTurn],
          },
          anchorId: selector === undefined ? null : anchorId,
          /*
           * The enqueue signal (SPEC.md §8), reported the way the contract
           * defines it: an event only when the turn asked for the agent. The
           * stub does not read mentions or skill invocations out of the body, so
           * an *omitted* `requestsAgent` never enqueues here — the case that
           * matters to a board is the explicit one the composer's toggle sends.
           */
          eventId: input["requestsAgent"] === true ? `evt_new${String(created)}` : null,
          warnings: [],
        } satisfies CreateThreadResponse,
        201,
      );
    }

    /*
     * `POST /api/threads/{id}/turns` — the reply box's send (SPEC.md §6, §8).
     *
     * Absent until UI-116, so every reply this suite ever sent fell through to
     * the `{}` fallback at the bottom of this handler. That was survivable on
     * the JSON branch — `unwrap` hands `{}` back and the optimistic turn simply
     * never reconciles — but not on the multipart one: `uploadTurn` **parses**
     * its response with `AppendTurnResponseSchema`, so `{}` is thrown as a
     * failed upload and an attachment send could not be seen to succeed at all.
     *
     * It writes the turn into the thread's body for the reason
     * `commitAnswerTurn` does: the turns a thread reports are parsed back out of
     * these bytes, so a stub that answered `201` and changed nothing would let a
     * spec assert a reply the corpus does not contain.
     */
    const appendTurn = /^\/api\/threads\/([^/]+)\/turns$/.exec(url.pathname);
    if (appendTurn !== null && method === "POST") {
      const id = decodeURIComponent(appendTurn[1] ?? "");
      const doc = store.get(id);
      if (doc === undefined || doc.type !== "thread") {
        return json(route, { code: "not_found", message: id } satisfies NotFoundError, 404);
      }
      const input = inputOf();
      const refused = recipientRefusal(input);
      if (refused !== undefined) return refused;
      const files = requests.at(-1)?.multipart?.files ?? [];
      /*
       * An attachment-only turn is a real turn (SPEC.md §6). The server writes
       * the markdown links to the stored bytes; this stub has no disk, so it
       * writes the filenames — enough that the turn is not silently empty, and
       * visibly not a claim about where anything landed.
       */
      const body =
        prose(input) === ""
          ? files.map((file) => `![${file.filename}](${file.filename})`).join("\n")
          : prose(input);
      stampUpdated(doc);
      const turn: StubTurn = {
        author: "user",
        ts: canonicalInstant(doc.updated),
        body,
        model: null,
      };
      doc.body = `${doc.body.trimEnd()}\n\n${renderTurn(turn)}`;
      const turns = parseThreadTurns(doc.body);
      /*
       * §8's reopen (SHARED-019 Amendment 1), through the parity function rather
       * than inline: a person's turn on a resolved conversation sets it back to
       * `open`, in the same write as the turn. Every turn the page can post is a
       * person's, so the author is `user` here — the rule still takes it, because
       * the half that matters is the half it refuses, and a stub whose reopen was
       * unconditional would be a stub the agent's turn also reopened.
       *
       * The document's `status` moves too, not only the reported thread status:
       * `GET /api/docs` reads it, so a thread that reopened on the wire and stayed
       * `resolved` in the store would light the board's row one way and the
       * conversation the other.
       */
      const status = nextThreadStatus(threadStatusOf(doc), turn.author);
      // Guarded rather than assigned: an *archived* document reports `open` to
      // the thread surfaces (see `threadStatusOf`), so writing the reported
      // status straight back would quietly unarchive it. `resolved → open` is
      // the only transition a turn makes.
      if (doc.status === "resolved" && status === "open") doc.status = "open";
      // §8's tri-state, read exactly as `POST /api/threads` reads it: the stub
      // parses no mentions, so an omitted flag enqueues nothing.
      const requestsAgent = input["requestsAgent"] === true;
      if (requestsAgent) doc.agent = "requested";
      // Its own counter, deliberately: `created` numbers the *documents* this
      // stub invents, and several specs read `th_new1` / `anc_new1` off it. A
      // reply creates no document, so borrowing that counter would renumber
      // every thread created after a reply in the same test.
      appended += 1;
      return json(
        route,
        {
          thread: {
            id,
            title: doc.title,
            status: threadStatusOf(doc),
            parent: doc.parent,
            anchor: null,
            agent: doc.agent,
            resident: null,
            created: SEEDED_AT,
            updated: doc.updated,
            turnCount: turns.length,
            lastAuthor: turn.author,
            lastTs: turn.ts,
          },
          turn,
          eventId: requestsAgent ? `evt_turn${String(appended)}` : null,
          warnings: [],
        } satisfies AppendTurnResponse,
        201,
      );
    }

    /*
     * `DELETE /api/threads/{id}/turns/{ts}` — deleting a turn (SPEC.md §6).
     *
     * It rewrites the thread's body from the turns that remain, for
     * {@link commitAnswerTurn}'s reason: the turns a thread reports are parsed
     * back out of these bytes, so a stub that answered `200` and left the body
     * alone would show the deleted turn on the next read.
     *
     * The cascade is modelled because the response names it: the thread's last
     * turn takes the thread with it, and a thread that goes takes its parent's
     * anchor entry with it. `removedAnchor` is `null` on every other path, never
     * absent.
     */
    const deleteTurn = /^\/api\/threads\/([^/]+)\/turns\/([^/]+)$/.exec(url.pathname);
    if (deleteTurn !== null && method === "DELETE") {
      const id = decodeURIComponent(deleteTurn[1] ?? "");
      const doc = store.get(id);
      if (doc === undefined || doc.type !== "thread") {
        return json(route, { code: "not_found", message: id } satisfies NotFoundError, 404);
      }
      const at = canonicalInstant(decodeURIComponent(deleteTurn[2] ?? ""));
      const turns = parseThreadTurns(doc.body);
      if (!turns.some((turn) => canonicalInstant(turn.ts) === at)) {
        return json(route, { code: "not_found", message: at } satisfies NotFoundError, 404);
      }
      const kept = turns.filter((turn) => canonicalInstant(turn.ts) !== at);
      const parent = doc.parent === null ? undefined : store.get(doc.parent);
      const anchorAt = parent?.anchors.findIndex((entry) => entry.threadId === doc.id) ?? -1;
      const deletedThread = kept.length === 0;
      // Read before the splice, not after it: the entry is gone by then, and a
      // response that reported `null` here would tell the board to keep drawing
      // a highlight the corpus no longer holds.
      const removedAnchor =
        deletedThread && parent !== undefined && anchorAt !== -1
          ? (parent.anchors[anchorAt]?.anchorId ?? null)
          : null;
      if (deletedThread) {
        store.delete(doc.id);
        if (parent !== undefined && anchorAt !== -1) parent.anchors.splice(anchorAt, 1);
      } else {
        doc.body = kept.map(renderTurn).join("\n\n");
        stampUpdated(doc);
      }
      return json(route, {
        deletedTurn: true,
        deletedThread,
        removedAnchor,
        parentId: doc.parent,
        warnings: [],
      } satisfies DeleteTurnResult);
    }

    /*
     * `POST /api/capture` — the global composer's second submit (SPEC.md §11).
     *
     * Multipart-only on the wire, which is why it had no handler here before
     * UI-116: the recorder threw on the body before this branch could have run.
     * One call, two documents — the inbox note and its filing thread — because
     * that is what the route's result names, and a board asserting "it appeared"
     * has to have something to find.
     */
    if (url.pathname === "/api/capture" && method === "POST") {
      const input = inputOf();
      created += 1;
      const text = prose(input);
      const doc = seeded({
        id: `doc_cap${String(created)}`,
        type: "note",
        title: text.split("\n")[0]?.slice(0, 60) ?? "Captured",
        path: `data/docs/inbox/cap${String(created)}.md`,
        body: text,
      });
      store.set(doc.id, doc);
      const filing = seeded({
        id: `th_cap${String(created)}`,
        type: "thread",
        title: `Filing: ${doc.title}`,
        path: `data/docs/threads/th_cap${String(created)}.md`,
        parent: doc.id,
      });
      filing.body = renderTurn({
        author: "user",
        ts: canonicalInstant(filing.updated),
        body: text,
        model: null,
      });
      filing.agent = input["requestsAgent"] === true ? "requested" : "none";
      store.set(filing.id, filing);
      return json(
        route,
        {
          docId: doc.id,
          threadId: filing.id,
          eventId: input["requestsAgent"] === true ? `evt_cap${String(created)}` : null,
          warnings: [],
        } satisfies CaptureResult,
        201,
      );
    }

    /*
     * `GET /api/threads/{id}` — one conversation and its turns (SPEC.md §6).
     *
     * The turns are **parsed out of the thread document's own body**, not stored
     * beside it, because that is the relationship the product depends on: a
     * turn's text is a contiguous slice of the file, so an anchor written into
     * the thread's frontmatter has offsets that fall inside a turn, and that is
     * what places a child card under the right turn and paints the highlight
     * over the right words (UI-051). A stub keeping turns as separate strings
     * could not be wrong about that, and could not be right about it either.
     *
     * Absent before UI-056, which is why a `ThreadCard` never rendered a turn
     * under the stub and turn-level commenting had no Playwright coverage.
     */
    /*
     * `POST /api/threads/{id}/turns/{ts}/form` — answering a form (SPEC.md §6).
     *
     * It **writes the answer turn into the thread's body**, with the contract's
     * own formatter, rather than answering `201` and changing nothing. That is
     * what makes the Attention half of UI-084 assertable here at all: the row
     * carrying "awaiting your answer" is derived from the thread's turns, so a
     * stub that recorded the call without recording the answer would show the
     * row clearing on a fiction. The refusals are the ones §6 names — `404` for
     * a turn carrying no form, `409` for a form already answered, `400` for an
     * answer the form does not fit (the contract's own `validateFormAnswer`),
     * and, for the exact bytes about to be written, the three checks the
     * server's `assertAppendableAnswer` makes in the server's own order: a fence
     * left open, a line that would become a turn heading, and an answer that
     * would not read back as itself.
     *
     * **Every rule is called, not restated** — unlike anchor resolution, which
     * lives in `apps/server` and had to be ported into `serverParity.ts` and
     * pinned by fixture. All three live in `@corpus/contract`
     * (`unterminatedFence` and `turnHeadings` since CONTRACT-044), which this
     * file already imports, so the stub runs the identical functions the server
     * runs and there is no copy that could drift. Only the *sentences* are the
     * stub's, because the server's messages are `apps/server`'s; the verdicts
     * never are. Until UI-091 the first two were simply absent and the stub was
     * more permissive than the server about them, which made a spec asserting
     * that the composer pre-check fires an assertion about nothing.
     */
    const formAnswer = /^\/api\/threads\/([^/]+)\/turns\/([^/]+)\/form$/.exec(url.pathname);
    if (formAnswer !== null && method === "POST") {
      const id = decodeURIComponent(formAnswer[1] ?? "");
      const ts = canonicalInstant(decodeURIComponent(formAnswer[2] ?? ""));
      const doc = store.get(id);
      if (doc === undefined || doc.type !== "thread") {
        return json(route, { code: "not_found", message: id } satisfies NotFoundError, 404);
      }
      const turns = parseThreadTurns(doc.body);
      const target = turns.find((turn) => canonicalInstant(turn.ts) === ts);
      const form = target === undefined ? undefined : formIn(target);
      if (target === undefined || form === undefined) {
        return json(route, { code: "not_found", message: ts } satisfies NotFoundError, 404);
      }
      if (!openForms(turns).some((turn) => canonicalInstant(turn.ts) === ts)) {
        return json(
          route,
          { code: "conflict", message: "form already answered" } satisfies ConflictError,
          409,
        );
      }
      const answer = (requests.at(-1)?.body ?? { answers: [] }) as FormAnswerRequest;
      const invalid = validateFormAnswer(form, answer);
      if (invalid !== undefined) return json(route, invalid, 400);

      const record = formAnswerRecord(form, answer);
      const answerBody = formatFormAnswerBody(record);

      /*
       * `assertAppendableTurnText`'s pair, in its order — the fence first,
       * because an open fence masks everything below it, so a heading under one
       * is invisible to the second check and reporting it would name a fault
       * that cannot be seen until the first is fixed.
       */
      const fence = unterminatedFence(answerBody);
      if (fence !== null) {
        return json(
          route,
          {
            code: "bad_request",
            message:
              `this answer leaves a code fence open: the ${fence.marker} on line ${fence.line} ` +
              "is never closed, so everything after it reads as code and every later turn in the " +
              `thread would become invisible. Close it with a line holding nothing but ${fence.marker}.`,
            issues: [
              {
                path: "body",
                message: `unterminated ${fence.marker} code fence opened on line ${fence.line}`,
              },
            ],
          } satisfies ValidationError,
          400,
        );
      }

      const fabricated = turnHeadings(answerBody)[0];
      if (fabricated !== undefined) {
        return json(
          route,
          {
            code: "bad_request",
            message:
              `this answer contains a line that reads as a turn heading: line ${fabricated.line} ` +
              "is a turn delimiter, so everything below it would be split off into a separate turn " +
              `signed by ${fabricated.author}. Reword that line, or quote it inside a code fence, ` +
              "an inline code span or a block quote, none of which delimit anything.",
            issues: [
              {
                path: "body",
                message: `line ${fabricated.line} reads as a turn heading`,
              },
            ],
          } satisfies ValidationError,
          400,
        );
      }

      const unreadable = unreadableAnswer(form, record);
      if (unreadable !== undefined) {
        return json(
          route,
          {
            code: "bad_request",
            message: unreadable,
            issues: [
              { path: "body", message: "the answer turn would not read back as this answer" },
            ],
          } satisfies ValidationError,
          400,
        );
      }

      // The body is the very string the three refusals above were asked about,
      // so what lands in the thread is what was judged — not a re-render of it.
      const turn = commitAnswerTurn(doc, answerBody);
      return json(
        route,
        {
          thread: {
            id,
            title: doc.title,
            status: threadStatusOf(doc),
            parent: doc.parent,
            anchor: null,
            agent: doc.agent,
            resident: null,
            created: SEEDED_AT,
            updated: doc.updated,
            turnCount: turns.length + 1,
            lastAuthor: "user",
            lastTs: turn.ts,
          },
          turn,
          eventId: "evt_stub",
          warnings: [],
        } satisfies FormAnswerResponse,
        201,
      );
    }

    /*
     * `POST`/`DELETE /api/threads/{id}/resident` — SPEC.md §7's designation.
     *
     * **There was no handler here at all until UI-122**, which meant every
     * designation any spec had ever sent was answered `200 {}` by the fallback
     * at the foot of this function: a shape the client does not validate, a
     * roster that never changed, and a green run proving nothing (the trap
     * UI-116 wrote down). It is modelled rather than acknowledged for the reason
     * `readerFixture` gives: the lane *is* the designation, so a stub that wrote
     * nothing to `lanes` would let a badge test pass against a board that never
     * repainted.
     *
     * The three states of `Resident` are all reachable: a body with no `name`
     * designates a **general** resident (`{name: null, docId: null}`), a name
     * that resolves to a seeded `type: agent-def` document designates a profiled
     * one, and a name that resolves to nothing is the route's own `404` — never
     * degraded to a general resident, which is exactly the "typo that looked
     * like it worked" the contract refuses.
     *
     * **A name resolves against the stem and the title alike, and what is stored
     * is what it resolved to** ({@link resolveAgentDefName}), because that is
     * the one thing about this route a surface can get wrong without noticing: a
     * menu comparing the title `GET /api/docs` carries against the stem the
     * resident is called mis-guards on every agent-def the `profile` skill
     * writes, and a stub that stored the title would agree with the bug (PR #49
     * review).
     *
     * The rule itself is **not written here**. It was, and it drifted: it keyed
     * the caller's name trimmed against `row.title` untrimmed, so a persona
     * titled `"  Padded Persona  "` — a title the projector carries verbatim —
     * 404'd in the browser and resolved against the real server, which keys both
     * sides through one `aliasKey` (PR #50 MINOR 4, one review after NIT 7 fixed
     * exactly that on the server). It now lives in `serverParity.ts`, where
     * `scripts/stub-server-parity.test.ts` runs it and
     * `threads/mentions.ts`'s `resolveMentionTarget` over one seeded workspace
     * and fails when they answer differently.
     */
    const residentRoute = /^\/api\/threads\/([^/]+)\/resident$/.exec(url.pathname);
    if (residentRoute !== null && (method === "POST" || method === "DELETE")) {
      const id = decodeURIComponent(residentRoute[1] ?? "");
      const doc = store.get(id);
      if (doc === undefined || doc.type !== "thread") {
        return json(route, { code: "not_found", message: id } satisfies NotFoundError, 404);
      }
      if (method === "DELETE") {
        dropLane(id);
        return json(route, threadMutation(doc));
      }
      const body = (requests.at(-1)?.body ?? {}) as { name?: unknown; weight?: unknown };
      const name = typeof body.name === "string" ? body.name : undefined;
      // Recorded verbatim, as the server does (CONTRACT-067): the designation's
      // weight is a level key, and `null` says the launcher chose.
      const weight = typeof body.weight === "string" ? body.weight : null;
      let resident: Resident = { name: null, docId: null, weight };
      if (name !== undefined) {
        const agentDefs = [...store.values()].filter((row) => row.type === "agent-def");
        const profile = resolveAgentDefName(agentDefs, name);
        if (profile === null) {
          return json(
            route,
            { code: "not_found", message: `no agent-def named ${name}` } satisfies NotFoundError,
            404,
          );
        }
        // The **resolved** name, never the caller's spelling — and the resolved
        // name of a file under `.claude/agents/` is its stem, not its title.
        resident = { name: profile.name, docId: profile.docId, weight };
      }
      setLane(id, resident);
      return json(route, threadMutation(doc));
    }

    /*
     * `POST /api/threads/{id}/seen` (SPEC.md §7) and the resolve/reopen pair
     * (§6). Both mutate the store rather than answering flatly, because both are
     * what UI-077's rules key on: reading a conversation is what lets the rule
     * fold it next time it is placed, and a status change is what re-asserts the
     * rule and clears a fold the reader made by hand.
     */
    const threadVerb = /^\/api\/threads\/([^/]+)\/(seen|resolve|reopen)$/.exec(url.pathname);
    if (threadVerb !== null && method === "POST") {
      const id = decodeURIComponent(threadVerb[1] ?? "");
      const verb = threadVerb[2];
      const doc = store.get(id);
      if (doc === undefined || doc.type !== "thread") {
        return json(route, { code: "not_found", message: id } satisfies NotFoundError, 404);
      }
      if (verb === "seen") {
        doc.unread = false;
        const turns = parseThreadTurns(doc.body);
        return json(route, {
          threadId: id,
          lastSeenTs: turns.at(-1)?.ts ?? SEEDED_AT,
          unread: false,
        } satisfies MarkSeenResult);
      }
      doc.status = verb === "resolve" ? "resolved" : "open";
      stampUpdated(doc);
      const parent = doc.parent === null ? undefined : store.get(doc.parent);
      const anchor = parent?.anchors.find((entry) => entry.threadId === id);
      if (anchor !== undefined) anchor.threadStatus = doc.status;
      // SPEC.md §7: "a thread that is **resolved** releases its resident with
      // it… and reopening does not bring it back". Modelled, because the badge
      // and the lane going is exactly what a spec on this path asserts.
      if (verb === "resolve") dropLane(id);
      return json(route, threadMutation(doc));
    }

    /*
     * `POST /api/threads/{id}/reattach` (SPEC.md §6; SERVER-072) — the one path
     * on which a selector is rewritten with no diff behind it, because the
     * evidence is a person's choice rather than an edit.
     *
     * Modelled rather than stubbed flat, and every part of the modelling is what
     * a spec needs to assert: the caller's `expectedText` is a **guard** that is
     * never stored, the selector is recomputed off the body over the chosen
     * range (`CONTEXT_WINDOW` either side, as `computeContext` does), and the
     * refusals carry the machine-readable `reason` the UI branches on. A stub
     * that answered `200` unconditionally would let a spec pass while the
     * product misattached.
     */
    const reattach = /^\/api\/threads\/([^/]+)\/reattach$/.exec(url.pathname);
    if (reattach !== null && method === "POST") {
      const id = decodeURIComponent(reattach[1] ?? "");
      const thread = store.get(id);
      if (thread === undefined || thread.type !== "thread") {
        return json(route, { code: "not_found", message: id } satisfies NotFoundError, 404);
      }
      const parent = thread.parent === null ? undefined : store.get(thread.parent);
      const anchor = parent?.anchors.find((entry) => entry.threadId === id);
      if (parent === undefined || anchor === undefined) {
        return json(
          route,
          {
            code: "conflict",
            message: "nothing to repair",
            reason: "not-anchored",
          } satisfies ReattachConflictError,
          409,
        );
      }
      const asked = (raw === null ? {} : JSON.parse(raw)) as {
        range?: { start?: number; end?: number };
        expectedText?: string;
      };
      const start = asked.range?.start ?? 0;
      const end = asked.range?.end ?? 0;
      if (parent.body.slice(start, end) !== asked.expectedText) {
        return json(
          route,
          {
            code: "conflict",
            message: "the range changed",
            reason: "range-changed",
          } satisfies ReattachConflictError,
          409,
        );
      }
      for (const other of parent.anchors) {
        if (other.anchorId === anchor.anchorId) continue;
        const range = resolveAnchorExact(parent.body, other.selector);
        if (range !== null && range.start < end && start < range.end) {
          return json(
            route,
            {
              code: "conflict",
              message: `overlaps ${other.threadId}`,
              reason: "range-overlaps",
            } satisfies ReattachConflictError,
            409,
          );
        }
      }
      anchor.selector = {
        exact: parent.body.slice(start, end),
        prefix: parent.body.slice(Math.max(0, start - 32), start),
        suffix: parent.body.slice(end, Math.min(parent.body.length, end + 32)),
      };
      const turns = parseThreadTurns(thread.body);
      return json(route, {
        thread: {
          id,
          title: thread.title,
          status: threadStatusOf(thread),
          parent: thread.parent,
          anchor: anchor.anchorId,
          agent: thread.agent,
          resident: null,
          created: SEEDED_AT,
          updated: thread.updated,
          turnCount: turns.length,
          lastAuthor: turns.at(-1)?.author ?? "user",
          lastTs: turns.at(-1)?.ts ?? SEEDED_AT,
        },
        anchor: resolveAnchor(parent, anchor),
        warnings: [],
      } satisfies ReattachThreadResponse);
    }

    const threadRead = /^\/api\/threads\/([^/]+)$/.exec(url.pathname);
    if (threadRead !== null && method === "GET") {
      const id = decodeURIComponent(threadRead[1] ?? "");
      const doc = store.get(id);
      if (doc === undefined || doc.type !== "thread") {
        return json(route, { code: "not_found", message: id } satisfies NotFoundError, 404);
      }
      const parent = doc.parent === null ? undefined : store.get(doc.parent);
      return json(route, {
        id: doc.id,
        title: doc.title,
        created: SEEDED_AT,
        updated: doc.updated,
        status: threadStatusOf(doc),
        tags: [],
        parent: doc.parent,
        // The anchor entry lives on the **parent**, and the thread names it.
        anchor: parent?.anchors.find((anchor) => anchor.threadId === id)?.anchorId ?? null,
        agent: doc.agent,
        resident: null,
        // `turnsOf`, not the bare body parser: this is the read every thread
        // surface goes through, and it is where a turn learns which model wrote
        // it (SPEC.md §11).
        turns: [...turnsOf(doc)],
      } satisfies Thread);
    }

    /*
     * `GET /api/search` — ranked retrieval (SPEC.md §9.2), UI-026's endpoint.
     *
     * A hit is an address plus a line: id, title, the heading path of the
     * best-matching passage, one snippet line. The stub's ranking is the store's
     * own order, which is honest — a browser stub has no index and inventing a
     * score would pin a fiction — and its address is the document's first
     * heading, or its title where it has none, exactly as the contract says a
     * passage with no heading above it reports.
     */
    if (url.pathname === "/api/search" && method === "GET") {
      const q = url.searchParams.get("q") ?? "";
      if (q === "") {
        return json(
          route,
          { code: "bad_request", message: "q is required", issues: [] } satisfies ValidationError,
          400,
        );
      }
      const limit = Number(url.searchParams.get("limit") ?? "10");
      const hits = [...store.values()]
        .filter((doc) => matches(doc, url.searchParams))
        .slice(0, Number.isFinite(limit) && limit > 0 ? limit : 10)
        .map((doc) => ({
          id: doc.id,
          title: doc.title,
          headingPath: /^#{1,6} (.+)$/m.exec(doc.body)?.[1] ?? doc.title,
          snippet: (doc.body.split("\n").find((line) => line.trim() !== "") ?? "").slice(0, 120),
        }));
      return json(route, { hits, semanticIndex: "current" } satisfies SearchResults);
    }

    /*
     * `GET /api/docs/{id}/related` — UI-025's endpoint, and it must be matched
     * **before** the `/api/docs/` block below: `rest` would otherwise be
     * `"<id>/related"`, miss the store, and 404.
     */
    const related = /^\/api\/docs\/([^/]+)\/related$/.exec(url.pathname);
    if (related !== null && method === "GET") {
      const subject = store.get(decodeURIComponent(related[1] ?? ""));
      if (subject === undefined) {
        return json(
          route,
          { code: "not_found", message: url.pathname } satisfies NotFoundError,
          404,
        );
      }
      /*
       * Seeded when a spec needs a `similar` or `both` row (no browser stub
       * holds a semantic index); otherwise derived from the `[[ref]]` graph in
       * both directions, which is what Phase A's `linked` set is.
       */
      const rows =
        subject.related ??
        [
          ...new Set([
            ...refIdsIn(subject.body),
            ...[...store.values()]
              .filter((doc) => doc.id !== subject.id && refIdsIn(doc.body).includes(subject.id))
              .map((doc) => doc.id),
          ]),
        ]
          .filter((id) => id !== subject.id)
          .map((id) => ({ id, relation: "linked" }));

      return json(route, {
        related: rows.flatMap((row) => {
          // Never a row the caller cannot then read: the links table stores
          // references to documents that do not exist yet, and the route omits
          // them rather than handing out an unreadable id.
          const doc = store.get(row.id);
          if (doc === undefined || (doc.status === "archived" && !subjectWantsArchived(url))) {
            return [];
          }
          return [
            {
              id: doc.id,
              title: doc.title,
              excerpt: (doc.body.split("\n").find((line) => line.trim() !== "") ?? "").slice(
                0,
                120,
              ),
              relation: row.relation,
            },
          ];
        }),
        semanticIndex: "current",
      } satisfies RelatedDocs);
    }

    /*
     * `POST /api/docs/{id}/edit-session/flush` — the reader closing ends the
     * sitting (SPEC.md §4's edit acknowledgment).
     *
     * Matched **before** the `/api/docs/` block below, which would otherwise read
     * `"<id>/edit-session/flush"` as a document id and answer `404`. That is what
     * it did: the flush every closing reader sends was refused on every stubbed
     * page, and `edit-session-close.spec.ts` counted the requests rather than
     * their answers, so nothing noticed.
     *
     * `204`, because that is what the route returns and because the client reads
     * this one off the response rather than off a body.
     */
    const flush = /^\/api\/docs\/([^/]+)\/edit-session\/flush$/.exec(url.pathname);
    if (flush !== null && method === "POST") {
      const subject = store.get(decodeURIComponent(flush[1] ?? ""));
      if (subject === undefined) {
        return json(
          route,
          { code: "not_found", message: url.pathname } satisfies NotFoundError,
          404,
        );
      }
      // Nothing is written: a flush closes the *session*, which is a queue-side
      // fact this stub holds nothing of. The honest answer is the acknowledgment
      // and no change to the document.
      return noContent(route);
    }

    if (url.pathname.startsWith("/api/docs/")) {
      const rest = url.pathname.slice("/api/docs/".length);
      /*
       * `POST …/archive` and `POST …/unarchive` — the routes that own SPEC.md
       * §7's reversible act. The stub cannot show the half of it that matters
       * most (a skill's folder moving on disk); that is the real-app drill's.
       * What it can pin is that the UI calls the route at all, in both
       * directions, rather than patching `status` through `PUT` (UI-020).
       */
      const [rawDocId = "", verb] = rest.split("/");
      if (verb === "archive" || verb === "unarchive") {
        const subject = store.get(decodeURIComponent(rawDocId));
        if (subject === undefined) {
          return json(route, { code: "not_found", message: rest } satisfies NotFoundError, 404);
        }
        // SPEC.md §5: unarchiving returns a document to `resolved` — the state
        // archiving already implied — not to `open` (SERVER-108). The stub
        // models the server rather than being self-consistent, which is the
        // only way a spec can catch the board disagreeing with it.
        subject.status = verb === "archive" ? "archived" : "resolved";
        stampUpdated(subject);
        return json(route, { doc: asDoc(subject), warnings: [] } satisfies DocMutationResponse);
      }
      const id = decodeURIComponent(rest);
      if (method === "DELETE") {
        store.delete(id);
        return json(route, {
          deletedId: id,
          orphanedThreadIds: [],
          warnings: [],
        } satisfies DeleteDocResult);
      }
      const doc = store.get(id);
      if (doc === undefined) {
        return json(route, { code: "not_found", message: id } satisfies NotFoundError, 404);
      }
      if (method === "PUT") {
        const changes = (requests.at(-1)?.body ?? {}) as Record<string, unknown>;
        /*
         * SPEC.md §7's check, where the server performs it: a write that
         * replaces the **body** presents the key of the version it read, and any
         * other key is refused with the document *as it now stands*, carrying a
         * fresh key — never a bare "no".
         *
         * A write that names its own delta (a title, a status, a tag, a view
         * key) presents no key and is not checked: it merges with whatever else
         * happened rather than overwriting it. That asymmetry is the mechanism's
         * whole shape, so the stub reproduces it rather than checking everything
         * — a stub that demanded a key for a tag write would make the board look
         * correct while it broke §7's keyless half.
         */
        if (typeof changes["body"] === "string" && changes["key"] !== doc.key) {
          return json(
            route,
            {
              code: "stale_key",
              message:
                "the key names a version this document no longer is — reconcile against this " +
                "copy and write again presenting its key",
              doc: asDoc(doc),
            } satisfies StaleKeyError,
            409,
          );
        }
        if (typeof changes["title"] === "string") doc.title = changes["title"];
        // A status the contract does not define is not a status the server would
        // ever store, so an unrecognised one is ignored rather than written
        // through — the same refusal `UpdateDocRequest`'s enum makes (UI-102).
        if (isDocStatus(changes["status"])) doc.status = changes["status"];
        // `due` is cleared with an explicit `null` and left alone by omission —
        // the distinction `UpdateDocRequest` draws and the form relies on, and
        // a stub that stored neither could not tell a deadline that was removed
        // from one that was never sent.
        if (typeof changes["due"] === "string" || changes["due"] === null) {
          doc.due = changes["due"];
        }
        if (typeof changes["body"] === "string") doc.body = changes["body"];
        if (changes["extra"] !== undefined && changes["extra"] !== null) {
          // RFC 7386 shallow merge, exactly as the server applies it.
          doc.extra = { ...doc.extra, ...(changes["extra"] as Record<string, unknown>) };
        }
        // Every save stamps `updated`, as the server's write path does.
        stampUpdated(doc);
        return json(route, {
          doc: asDoc(doc),
          anchors: { remapped: [], orphaned: [] },
          warnings: [],
        } satisfies UpdateDocResponse);
      }
      return json(route, asDoc(doc));
    }

    /*
     * `/api/x/**` — the plugin namespace, and the one place this stub still
     * answers an empty body deliberately (UI-085).
     *
     * A plugin's routes are not in the generated contract, so nothing here can
     * know their shapes and nothing here should invent them: the core stub is a
     * stand-in for the **core** server. Every plugin spec registers its own
     * handler after this one — Playwright matches most-recent-first, so theirs
     * wins — and this is what a plugin surface meets when its spec has not.
     *
     * `{}` rather than the refusal below, and the difference is not politeness:
     * a plugin client **validates** its responses (`plugins/todos` parses with
     * Zod), so the empty body is refused at that boundary and the column draws
     * its error card. The silence UI-085 is about is the silence of a body that
     * *passes* unnoticed, which this one cannot do.
     */
    if (url.pathname.startsWith("/api/x/")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return;
    }

    /*
     * The unhandled-route refusal (UI-085).
     *
     * This used to be `json(route, {} as StubPayload)` — a `200` with an empty
     * body for any route nobody had taught the stub. It made every omission
     * silent and general: the caller failed somewhere downstream reading a field
     * off an empty object, or did not fail at all, and the request that was never
     * handled was nowhere in the report. Four core routes had been living here
     * unnoticed (the queue's halt and resume, a job's retry and abandon), plus a
     * job's log and a turn deletion, and `POST …/turns` before UI-116.
     *
     * So it refuses instead, and says exactly what it refused:
     *
     *   - a `501` carrying the contract's own error shape, whose `message` names
     *     the method and the path — the client throws that sentence, so it
     *     reaches the assertion that provoked it rather than being swallowed;
     *   - a line on the runner's stderr, for the request nothing was awaiting;
     *   - a record in {@link StubCorpus.unhandled}, for a spec that wants to
     *     assert over it.
     *
     * Adding a route to the app therefore means adding a handler here, which is
     * the whole point: a stub that answers a route it does not implement is
     * testing itself.
     */
    const refusal =
      `stubCorpus has no handler for ${method} ${url.pathname} — refused rather than ` +
      `answered, because a stub that invents an empty success lets a spec assert ` +
      `behaviour nobody implemented (UI-085). Add a handler in apps/ui/e2e/stubCorpus.ts.`;
    unhandled.push(`${method} ${url.pathname}`);
    console.error(`[stubCorpus] ${refusal}`);
    return json(route, { code: "internal_error", message: refusal } satisfies InternalError, 501);
  });

  return {
    requests: () => Promise.resolve([...requests]),
    of: (method, path) =>
      Promise.resolve(
        requests.filter(
          (entry) => entry.method === method && (path === undefined || entry.path === path),
        ),
      ),
    unhandled: () => Promise.resolve([...unhandled]),
    doc: (id) => Promise.resolve(store.get(id)),
    ids: () => Promise.resolve([...store.keys()]),
    answerForm: (threadId, ts, answer) => {
      const doc = store.get(threadId);
      if (doc === undefined || doc.type !== "thread") {
        throw new Error(`answerForm: no thread ${threadId}`);
      }
      const at = canonicalInstant(ts);
      const target = parseThreadTurns(doc.body).find((turn) => canonicalInstant(turn.ts) === at);
      const form = target === undefined ? undefined : formIn(target);
      if (form === undefined) throw new Error(`answerForm: no form in turn ${ts} of ${threadId}`);
      // The same verdict the route reaches, from the same contract function: an
      // out-of-band answer that the form does not fit is a broken test, not a
      // state the corpus can be in.
      const invalid = validateFormAnswer(form, answer);
      if (invalid !== undefined) throw new Error(`answerForm: ${invalid.message}`);
      return Promise.resolve(
        commitAnswerTurn(doc, formatFormAnswerBody(formAnswerRecord(form, answer))),
      );
    },
    releaseLane: (lane) => {
      const index = lanes.findIndex((row) => row.lane === lane);
      if (index === -1) throw new Error(`releaseLane: no lane ${lane}`);
      lanes.splice(index, 1);
      const doc = store.get(lane);
      if (doc !== undefined) doc.extra = { ...doc.extra, resident: null };
      return Promise.resolve();
    },
    claimJob: (eventId) => {
      const index = jobs.findIndex((job) => job.eventId === eventId);
      if (index === -1) throw new Error(`claimJob: no event ${eventId}`);
      const job = jobs[index];
      if (job === undefined) throw new Error(`claimJob: no event ${eventId}`);
      if (job.status !== "pending") throw new Error(`claimJob: ${eventId} is ${job.status}`);
      // `started` is deliberately left alone: the server only moves it when the
      // job writes its first log line (`recordJobLine`'s `COALESCE`), and a
      // claim writes none. A stub that advanced it here would hide the very
      // reset `agentWaitSince` exists to prevent.
      jobs[index] = { ...job, status: "in-progress" };
      return Promise.resolve();
    },
    writeAsAgent: (docId, body) => {
      const doc = store.get(docId);
      if (doc === undefined) throw new Error(`writeAsAgent: no ${docId}`);
      doc.body = body;
      stampUpdated(doc);
      return Promise.resolve(doc.key);
    },
  };
}
