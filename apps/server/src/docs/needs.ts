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
 * An unanswered form is an agent turn carrying a fenced ```form block that is
 * still the thread's last turn (SPEC.md §6) — `last_author = 'agent'` is what
 * says no user turn followed it, so no "is there a later turn" subquery is
 * needed.
 */
const UNANSWERED_FORM_SQL = `(t.id IS NOT NULL AND t.last_author = 'agent' AND EXISTS (
  SELECT 1 FROM turns tu
   WHERE tu.thread_id = t.id AND tu.ts = t.last_ts AND tu.author = 'agent'
     AND tu.body_md LIKE '%\`\`\`form%'
))`;

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
  form: UNANSWERED_FORM_SQL,
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
