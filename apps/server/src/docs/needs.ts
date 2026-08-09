// Attention (SPEC.md §11): the five reasons a row asks for the user, expressed
// as SQL over the same joins the collection query already makes.
//
// They are SQL rather than a post-pass in TypeScript for one reason: `needs=`
// filters on them *and* every row carries them, so a JavaScript implementation
// would have to load the whole corpus to answer `?needs=me&limit=50`. Written
// once here, each fragment appears in the WHERE clause and in the SELECT list of
// the same statement, which is also what guarantees the filter and the reason
// chip can never disagree.

import { NEEDS_REASONS, type NeedsReason } from "@corpus/contract";
import type { ProjectionDb } from "../projection/index.js";
import { atOrBeyondSql } from "./staleness.js";

/**
 * "Still unread" — a thread whose last turn is newer than the mark it is
 * compared against — with the mark left to the caller: the collection query
 * joins `seen`, {@link isThreadUnread} binds the mark it is about to report.
 * Written once so a badge and the response that clears it cannot disagree.
 */
const unreadSql = (mark: string): string =>
  `(t.id IS NOT NULL AND t.last_ts IS NOT NULL AND t.last_ts > COALESCE(${mark}, ''))`;

/**
 * Row aliases every fragment assumes: `d` documents, `t` threads (LEFT JOINed,
 * so `t.id IS NULL` means "not a thread"), `s` seen.
 */
export const UNREAD_SQL = unreadSql("s.last_seen_ts");

/**
 * Whether `threadId` still has a turn newer than `mark` — what `POST
 * /api/threads/{id}/seen` answers with (SPEC.md §7, CONTRACT-010). It is the
 * *same* test `GET /api/docs` puts in every row, so a partial mark reports
 * `unread: true` and the next collection query agrees.
 *
 * A thread with no row is not unread: the caller reached this through
 * `loadThread`, which resolves the id against this projection, so the row is
 * there whenever the mark was recordable at all.
 */
export function isThreadUnread(db: ProjectionDb, threadId: string, mark: string): boolean {
  const row = db
    .prepare(`SELECT ${unreadSql("@mark")} AS unread FROM threads t WHERE t.id = @id`)
    .get({ id: threadId, mark }) as { readonly unread: number } | undefined;
  return row !== undefined && row.unread !== 0;
}

/**
 * The pending-agent affordance (SPEC.md §8, §11): the agent has been drawn into
 * an open thread and the last turn is not yet its reply.
 *
 * It lives beside {@link UNREAD_SQL} rather than in the row builder because it
 * is written as the conjunction of exactly the columns `agent=` and `author=`
 * filter on (`t.agent`, `t.last_author`) — the indicator and those chips read
 * one vocabulary, so `?agent=engaged&author=user` and the badge cannot disagree.
 * A thread with no turns has `last_author IS NULL` and is therefore not awaiting
 * anything: the agent is drawn in *by* a turn.
 */
export const AWAITING_AGENT_SQL =
  "(t.id IS NOT NULL AND t.agent <> 'none' AND t.status = 'open' AND t.last_author = 'user')";

/**
 * An unanswered form is an agent turn of an **open** thread carrying an
 * answerable ```form block that nobody has answered yet (SPEC.md §6, §11).
 *
 * **The reason is form-scoped, not thread-scoped** (SERVER-032). §6: a form "is
 * identified by the timestamp of the turn carrying it, so a turn carries at most
 * one form, and answering a form addresses the turn that carries it." A thread
 * can therefore hold several independently answerable forms — which is what the
 * answer route's `:ts` already encodes and what the renderer already draws. This
 * fragment used to ask a thread-level question instead: *is the last turn an
 * agent turn carrying a form?* (`t.last_author = 'agent' AND tu.ts = t.last_ts`).
 * Answering any one form appends a user turn, so `last_author` moved and the
 * whole predicate went false while other forms sat unanswered above it — the
 * board stopped mentioning a question the app was still waiting on, and the
 * renderer, correctly, kept offering it. The count of unanswered forms is the
 * question; who spoke last was only ever a proxy for it in the one-form case.
 *
 * Resolving the thread is one of §11's ways of handling the reason: a resolved
 * conversation is not waiting for an answer, and without the status guard it sat
 * in Attention with no remaining action that could clear it (SERVER-022
 * finding 3).
 *
 * **Both halves are columns, not patterns written here** (SERVER-029,
 * SERVER-032). §6's fence grammar is an anchored regex over the info string plus
 * a YAML parse plus `FormSchema`, and pairing an answer with the form it answers
 * needs that same parse to know which options a form offered; SQLite can express
 * none of it. The substring search that once stood in for the first half
 * disagreed with the answer route in both directions at once: an unterminated
 * fence sat in Attention forever while `POST …/form` `404`ed it, and a fence with
 * a trailing space in its info string was answerable but never surfaced, so
 * nobody was told to answer it. `tu.has_form` and `tu.form_answered` carry what
 * `core/form.ts` decided about those bytes at projection time, so this fragment,
 * the route and the renderer cannot hold different opinions about one turn.
 *
 * `form_answered = 0` already implies `has_form = 1` and an agent author — it is
 * `NULL` for every other turn — but both conjuncts are spelled out because the
 * reason is exactly "an open thread has an agent form nobody answered", and a
 * predicate that reads as its own definition is one nobody has to reconstruct.
 *
 * **The two flag conjuncts are also an index condition** (wave-3 audit FIX 12).
 * `turns_unanswered_form` is a partial index on `thread_id WHERE has_form = 1
 * AND form_answered = 0` — `schema.ts` explains why it has to be partial — and
 * SQLite uses a partial index only where the query's own terms provably imply
 * its condition. So these two comparisons are load-bearing beyond readability:
 * loosening either (`form_answered <> 1`, `has_form != 0`, moving a flag into a
 * join) silently returns this fragment to fetching every turn row of every open
 * thread. `docs/performance.test.ts` asserts the plan, which is the check that
 * notices.
 *
 * **It counts rather than existence-tests, because the row reports the number**
 * (SERVER-084). §11's Attention clause ends "a thread holding more than one
 * unanswered form says how many are still open", so `DocRow.unansweredForms`
 * carries the count — and CONTRACT-040 publishes the invariant with its
 * direction: `unansweredForms > 0` **iff** `attention` contains `form`. Two
 * independent derivations of one fact is exactly how an `iff` stops being true,
 * so there is only this fragment: {@link NEEDS_REASON_SQL}`.form` is literally
 * `(<this> > 0)`, spliced, and the row column is this same expression selected.
 * Neither can move without the other, and the guards are shared rather than
 * merely alike — `t.id IS NOT NULL` gives a document row `0` *and* no reason,
 * and `t.status = 'open'` makes resolving clear the count *and* the reason.
 *
 * `CASE`, not `COALESCE` or a bare correlated `COUNT(*)`: a scalar subquery over
 * no rows returns `0` rather than `NULL` (COUNT always counts), so a bare one
 * would report `0` for a *resolved* thread's still-open forms only by accident
 * of the join, and would report the count of a non-thread row's turns if the
 * aliases ever changed. Spelling the guard as the `CASE`'s condition also keeps
 * SQLite's short-circuit: the subquery is evaluated only for open threads,
 * exactly as the `AND` chain it replaces evaluated its `EXISTS`.
 */
export const UNANSWERED_FORM_COUNT_SQL = `(CASE WHEN t.id IS NOT NULL AND t.status = 'open' THEN (
  SELECT COUNT(*) FROM turns tu
   WHERE tu.thread_id = t.id AND tu.author = 'agent'
     AND tu.has_form = 1 AND tu.form_answered = 0
) ELSE 0 END)`;

/**
 * Any failed queue event whose payload *names* this row. Matching every
 * top-level payload value rather than a fixed key list (`threadId`,
 * `parentId`, …) keeps plugin event types working without a server change —
 * payload shapes belong to whoever defines the event type (SPEC.md §7, §10).
 */
const FAILED_JOB_SQL = `(EXISTS (
  SELECT 1 FROM events e, json_each(e.payload_json) je
   WHERE e.status = 'failed' AND je.value = d.id
))`;

export const NEEDS_REASON_SQL: Readonly<Record<NeedsReason, string>> = {
  "unread-reply": `(${UNREAD_SQL} AND t.last_author = 'agent')`,
  // Read off the count, never re-derived: `> 0` over the one expression is what
  // makes CONTRACT-040's `iff` hold in both directions by construction.
  form: `(${UNANSWERED_FORM_COUNT_SQL} > 0)`,
  due: "(d.due IS NOT NULL AND d.due <= @today)",
  stale: atOrBeyondSql("stale"),
  "failed-job": FAILED_JOB_SQL,
};

/** `needs=me`: the union of every reason (SPEC.md §9.2). */
export const ANY_REASON_SQL = `(${NEEDS_REASONS.map((reason) => NEEDS_REASON_SQL[reason]).join(" OR ")})`;

/** Column alias carrying one reason's truth value in the result row. */
export const reasonColumn = (reason: NeedsReason): string => `reason_${reason.replace(/-/g, "_")}`;

/** The reasons a result row matched, in the contract's declared order. */
export function rowAttention(row: Readonly<Record<string, unknown>>): NeedsReason[] {
  return NEEDS_REASONS.filter((reason) => row[reasonColumn(reason)] === 1);
}
