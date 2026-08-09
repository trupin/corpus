import {
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
  type Form,
  type FormAnswerRequest,
} from "@corpus/contract";
import type { Page, Route } from "@playwright/test";
import * as YAML from "yaml";
import {
  canonicalInstant,
  parseThreadTurns,
  renderTurn,
  resolveAnchorExact,
  type StubTurn,
} from "./serverParity";

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
 * evidence, exactly as sprint-016 Adjudication 19 says: the disk, git, lock and
 * projection half comes from each issue's real-app drill against a real
 * `corpus` server, and neither half is acceptance on its own.
 */

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
  readonly status?: string;
  readonly pinned?: boolean;
  readonly order?: number | null;
  readonly query?: Readonly<Record<string, unknown>> | null;
  readonly column?: string | null;
  readonly parent?: string | null;
  readonly extra?: Readonly<Record<string, unknown>>;
  readonly stale?: unknown;
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
  readonly relation: string;
}

/** A seeded anchor: the selector, and the thread it belongs to. */
export interface SeedAnchor {
  readonly anchorId: string;
  readonly threadId: string;
  readonly exact: string;
  readonly prefix?: string;
  readonly suffix?: string;
  readonly threadStatus?: string;
}

interface StoredDoc {
  id: string;
  type: string;
  title: string;
  path: string;
  body: string;
  /** The frontmatter record of which model wrote which turn, keyed by `ts`. */
  turnModels: Record<string, string>;
  status: string;
  pinned: boolean;
  order: number | null;
  query: Readonly<Record<string, unknown>> | null;
  column: string | null;
  parent: string | null;
  extra: Record<string, unknown>;
  stale: unknown;
  /**
   * Stamped on every write, exactly as the server stamps it. Kept per document
   * rather than as one frozen constant because a surface may legitimately key
   * on "has this document changed" — the todos column's `(id, updated)`
   * fingerprint is the shipped case (PLUGINS-007) — and a stub that never moves
   * `updated` would make such a query look correct while pinning nothing.
   */
  updated: string;
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
  selector: { readonly exact: string; readonly prefix?: string; readonly suffix?: string };
  threadStatus: string;
}

/** The seeded instant every document starts at, and the clock a write advances. */
const SEEDED_AT = "2026-07-01T09:00:00.000Z";
let writes = 0;

export interface StubRequest {
  readonly method: string;
  readonly path: string;
  readonly search: string;
  readonly body: unknown;
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
  readonly status: string;
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
}

export interface StubCorpus {
  /** Every `/api` request the page made, in order. */
  readonly requests: () => Promise<readonly StubRequest[]>;
  readonly of: (method: string, path?: string) => Promise<readonly StubRequest[]>;
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
    pinned: row.pinned ?? false,
    order: row.order ?? null,
    query: row.query ?? null,
    column: row.column ?? null,
    parent: row.parent ?? null,
    extra: { ...(row.extra ?? {}) },
    stale: row.stale ?? null,
    updated: SEEDED_AT,
    agent: "none",
    related: row.related ?? null,
    unread: row.unread ?? false,
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
function resolveAnchor(doc: StoredDoc, anchor: StoredAnchor): unknown {
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
 * The row's attention reasons (SPEC.md §11), derived rather than seeded.
 *
 * Two of the five, which are the two UI-084's asymmetry is about: an unanswered
 * form (which survives being read) and an unread agent reply (which does not).
 * Both are computed from the thread's own state, so `POST …/seen` clears one and
 * only answering clears the other — exactly the difference the spec asserts.
 */
function attentionOf(doc: StoredDoc): readonly string[] {
  if (doc.type !== "thread" || doc.status !== "open") return [];
  const turns = parseThreadTurns(doc.body);
  const reasons: string[] = [];
  if (doc.unread && turns.at(-1)?.author === "agent") reasons.push("unread-reply");
  if (openForms(turns).length > 0) reasons.push("form");
  return reasons;
}

/** The instant a write stamps: monotonic, so two saves never collide. */
function stampUpdated(doc: StoredDoc): void {
  writes += 1;
  doc.updated = new Date(Date.parse(SEEDED_AT) + writes * 1000).toISOString();
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
  const jobs = options.jobs ?? [];
  const requests: StubRequest[] = [];
  let created = 0;

  const json = async (route: Route, payload: unknown, status = 200): Promise<void> => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
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

  const asRow = (doc: StoredDoc): unknown => {
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
      due: null,
      reviewed: null,
      evergreen: false,
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
      unreadThreads: 0,
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
  const asJob = (job: StubJob): unknown => ({
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

  const asDoc = (doc: StoredDoc): unknown => ({
    body: doc.body,
    path: doc.path,
    anchors: doc.anchors.map((anchor) => resolveAnchor(doc, anchor)),
    frontmatter: {
      id: doc.id,
      type: doc.type,
      title: doc.title,
      created: SEEDED_AT,
      updated: doc.updated,
      tags: [],
      status: doc.status,
      anchors: {},
      due: null,
      reviewed: null,
      evergreen: false,
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
      if (needs === "me" ? reasons.length === 0 : !reasons.includes(needs)) return false;
    }
    const status = params.get("status");
    if (status !== null) return status.split(",").includes(doc.status);
    return doc.status !== "archived";
  };

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const raw = request.postData();
    requests.push({
      method,
      path: url.pathname,
      search: url.search,
      body: raw === null ? undefined : (JSON.parse(raw) as unknown),
    });

    if (url.pathname === "/api/locks") return json(route, { locks: [] });
    /*
     * `GET /api/jobs` — the queue's own rows, filtered the way the server
     * filters them: `status` is the comma-separated set `useOutstandingJobs`
     * sends, `originId` the exact predicate a thread card escalates to, and
     * `recent` the cap that makes an answer possibly short. Answering the whole
     * seed regardless of the query would make the shared-vs-exact distinction
     * `outstandingAgentRequest.ts` is built around untestable here.
     */
    if (url.pathname === "/api/jobs") {
      const wanted = url.searchParams.get("status");
      const origin = url.searchParams.get("originId");
      const recent = Number(url.searchParams.get("recent") ?? "50");
      const matching = jobs
        .filter((job) => wanted === null || wanted.split(",").includes(job.status))
        .filter((job) => origin === null || (job.originId ?? null) === origin)
        .slice(0, Number.isFinite(recent) ? recent : undefined)
        .map(asJob);
      return json(route, { jobs: matching });
    }
    if (url.pathname === "/api/tree") return json(route, { folders: [] });
    if (url.pathname === "/api/queue/status") {
      return json(route, {
        pending: 0,
        inProgress: 0,
        deferred: 0,
        failed: 0,
        processed: 0,
        halted: false,
        agent: "idle",
      });
    }

    if (url.pathname === "/api/docs" && method === "GET") {
      const items = [...store.values()]
        .filter((doc) => matches(doc, url.searchParams))
        .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
        .map(asRow);
      return json(route, { items, page: { total: items.length, limit: 50, offset: 0 } });
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
      return json(route, { doc: asDoc(doc), warnings: [] }, 201);
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
      created += 1;
      const input = (requests.at(-1)?.body ?? {}) as Record<string, unknown>;
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
        body: typeof input["body"] === "string" ? input["body"] : "",
        model: null,
      };
      thread.body = renderTurn(firstTurn);
      thread.agent = input["requestsAgent"] === true ? "requested" : "none";
      store.set(thread.id, thread);

      const selector = input["selector"] as StoredAnchor["selector"] | undefined;
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
        },
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
        return json(route, { code: "not_found", message: id }, 404);
      }
      const turns = parseThreadTurns(doc.body);
      const target = turns.find((turn) => canonicalInstant(turn.ts) === ts);
      const form = target === undefined ? undefined : formIn(target);
      if (target === undefined || form === undefined) {
        return json(route, { code: "not_found", message: ts }, 404);
      }
      if (!openForms(turns).some((turn) => canonicalInstant(turn.ts) === ts)) {
        return json(route, { code: "conflict", message: "form already answered" }, 409);
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
          },
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
          },
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
          },
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
            status: doc.status,
            parent: doc.parent,
            anchor: null,
            agent: doc.agent,
            created: SEEDED_AT,
            updated: doc.updated,
            turnCount: turns.length + 1,
            lastAuthor: "user",
            lastTs: turn.ts,
          },
          turn,
          eventId: "evt_stub",
          warnings: [],
        },
        201,
      );
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
        return json(route, { code: "not_found", message: id }, 404);
      }
      if (verb === "seen") {
        doc.unread = false;
        const turns = parseThreadTurns(doc.body);
        return json(route, {
          threadId: id,
          lastSeenTs: turns.at(-1)?.ts ?? SEEDED_AT,
          unread: false,
        });
      }
      doc.status = verb === "resolve" ? "resolved" : "open";
      stampUpdated(doc);
      const parent = doc.parent === null ? undefined : store.get(doc.parent);
      const anchor = parent?.anchors.find((entry) => entry.threadId === id);
      if (anchor !== undefined) anchor.threadStatus = doc.status;
      const turns = parseThreadTurns(doc.body);
      return json(route, {
        thread: {
          id,
          title: doc.title,
          status: doc.status,
          parent: doc.parent,
          anchor: anchor?.anchorId ?? null,
          agent: doc.agent,
          created: SEEDED_AT,
          updated: doc.updated,
          turnCount: turns.length,
          lastAuthor: turns.at(-1)?.author ?? "user",
          lastTs: turns.at(-1)?.ts ?? SEEDED_AT,
        },
        warnings: [],
      });
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
        return json(route, { code: "not_found", message: id }, 404);
      }
      const parent = thread.parent === null ? undefined : store.get(thread.parent);
      const anchor = parent?.anchors.find((entry) => entry.threadId === id);
      if (parent === undefined || anchor === undefined) {
        return json(
          route,
          { code: "conflict", message: "nothing to repair", reason: "not-anchored" },
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
          { code: "conflict", message: "the range changed", reason: "range-changed" },
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
            },
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
          status: thread.status,
          parent: thread.parent,
          anchor: anchor.anchorId,
          agent: thread.agent,
          created: SEEDED_AT,
          updated: thread.updated,
          turnCount: turns.length,
          lastAuthor: turns.at(-1)?.author ?? "user",
          lastTs: turns.at(-1)?.ts ?? SEEDED_AT,
        },
        anchor: resolveAnchor(parent, anchor),
        warnings: [],
      });
    }

    const threadRead = /^\/api\/threads\/([^/]+)$/.exec(url.pathname);
    if (threadRead !== null && method === "GET") {
      const id = decodeURIComponent(threadRead[1] ?? "");
      const doc = store.get(id);
      if (doc === undefined || doc.type !== "thread") {
        return json(route, { code: "not_found", message: id }, 404);
      }
      const parent = doc.parent === null ? undefined : store.get(doc.parent);
      return json(route, {
        id: doc.id,
        title: doc.title,
        created: SEEDED_AT,
        updated: doc.updated,
        status: doc.status === "resolved" ? "resolved" : "open",
        tags: [],
        parent: doc.parent,
        // The anchor entry lives on the **parent**, and the thread names it.
        anchor: parent?.anchors.find((anchor) => anchor.threadId === id)?.anchorId ?? null,
        agent: doc.agent,
        // `turnsOf`, not the bare body parser: this is the read every thread
        // surface goes through, and it is where a turn learns which model wrote
        // it (SPEC.md §11).
        turns: turnsOf(doc),
      });
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
        return json(route, { code: "bad_request", message: "q is required", issues: [] }, 400);
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
      return json(route, { hits, semanticIndex: "current" });
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
        return json(route, { code: "not_found", message: url.pathname }, 404);
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
      });
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
        if (subject === undefined) return json(route, { code: "not_found", message: rest }, 404);
        subject.status = verb === "archive" ? "archived" : "open";
        stampUpdated(subject);
        return json(route, { doc: asDoc(subject), warnings: [] });
      }
      const id = decodeURIComponent(rest);
      if (method === "DELETE") {
        store.delete(id);
        return json(route, { deletedId: id, orphanedThreadIds: [], warnings: [] });
      }
      const doc = store.get(id);
      if (doc === undefined) return json(route, { code: "not_found", message: id }, 404);
      if (method === "PUT") {
        const changes = (requests.at(-1)?.body ?? {}) as Record<string, unknown>;
        if (typeof changes["title"] === "string") doc.title = changes["title"];
        if (typeof changes["status"] === "string") doc.status = changes["status"];
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
        });
      }
      return json(route, asDoc(doc));
    }

    return json(route, {});
  });

  return {
    requests: () => Promise.resolve([...requests]),
    of: (method, path) =>
      Promise.resolve(
        requests.filter(
          (entry) => entry.method === method && (path === undefined || entry.path === path),
        ),
      ),
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
  };
}
