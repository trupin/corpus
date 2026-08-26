import { z } from "zod";
import { DocumentIdSchema, EventIdSchema } from "./id.js";
import {
  CORE_QUEUE_EVENT_TYPES,
  NON_TERMINAL_QUEUE_EVENT_STATUSES,
  QUEUE_EVENT_STATUSES,
  QueueEventStatusSchema,
  type QueueEventStatus,
} from "./queue.js";
import { IsoDateTimeSchema } from "./time.js";
import { LaneSchema } from "./lane.js";
import { openapi } from "./openapi-metadata.js";

/**
 * Every queue event is a job; the console renders one row per job with its live
 * log stream (SPEC.md §7). Full log lines stay in `.corpus/jobs/<eventId>.jsonl`
 * and are fetched over HTTP — SSE only announces that the log grew.
 *
 * **Three instants, each meaning one thing** (CONTRACT-029). `started` used to
 * mean two: the server published the event's `created` while the job was queued
 * and the first log line's timestamp afterwards (`toJob`'s
 * `row.started ?? row.created`, `apps/server/src/jobs/project.ts`), so a job that
 * waited ten minutes had its elapsed clock **reset** the moment the agent began
 * talking. UI-058 worked around it by bounding the value with the thread's newest
 * turn, which is a heuristic standing in for a field.
 *
 * **The field is redefined, not merely joined by a sibling**, and that is the
 * decision this schema records. Adding `enqueued` alone would have left `started`
 * still meaning two instants, and left every consumer deriving "has it begun?"
 * from `started === enqueued` — a comparison that is wrong for any job whose
 * first line lands in the same second as its enqueue. So `enqueued` is the
 * enqueue instant, always known, and `started` is the first log line alone,
 * **nullable**, null while the job has not spoken. Nothing new is computed for
 * either: `events.created` and `jobs.started` are two existing columns, and
 * `jobs.started` is already NULL for exactly the jobs that read null here.
 *
 * The cost is that `started` is a **breaking** change for a reader rather than
 * only for a constructor — `apps/ui` reads it in two places. That is deliberate:
 * both of those places were reading the overloaded value, so a compile error is
 * the correct way for them to learn the value changed.
 */
export const JobSchema = openapi(
  z.object({
    eventId: EventIdSchema,
    type: z
      .string()
      .min(1)
      .describe(
        "The type of the queue event this job is running — the same value as `QueueEvent.type`, " +
          `read from the projection rather than re-derived. Core values: ${CORE_QUEUE_EVENT_TYPES.join(", ")}. ` +
          "Open rather than enumerated for the same reason `QueueEvent.type` is: the set on the " +
          "wire is not the set any one build knows (SPEC.md §7). The console's collapsed job row reads " +
          "`<type> · <originTitle>`, so this is what tells the user *what* is running, not just " +
          "what it is running on (SPEC.md §10).",
      ),
    status: QueueEventStatusSchema,
    lane: LaneSchema.describe(
      "**Which lane this job's event was stamped with** (SPEC.md §7), read from the projection " +
        "rather than re-derived. It is the stamp made once at enqueue time and never rewritten, " +
        "so it is a fact about the event and not a computation over the corpus as it now stands.\n\n" +
        "**A client cannot work this out, which is why it is here** (CONTRACT-056). Walking the " +
        "scope from the payload's thread gets the right answer for the ordinary event and the " +
        "wrong one for exactly the two cases §7 carves out: a `resident.designated`, which takes " +
        "the **orchestrator's** lane whoever is designated — a resident does not announce itself " +
        "to itself — and a message that **named a recipient**, which takes that recipient's lane " +
        "and is not recoverable from the scope at all. The second is the decisive one: the walk " +
        "cannot be made right, it can only be replaced.\n\n" +
        "**It is display material, never routing.** The server stamps the lane and claims on it; " +
        "nothing a client decides changes where an event goes. What this fixes is a surface " +
        "saying *waiting for researcher* about work the orchestrator is holding, which is a wrong " +
        "sentence rather than a misdelivered event. An event written before lanes existed reads " +
        "as the orchestrator's, the same way the claim path reads it — one interpretation of a " +
        "missing stamp, not two.",
    ),
    enqueued: IsoDateTimeSchema.describe(
      "**When this event entered the queue** (SPEC.md §7) — the `created` instant of the queue " +
        "event that is this job. Written once and never moved, whatever the job goes on to do. " +
        "This is what an elapsed-time display counts from: a job that sat `pending` for ten " +
        "minutes and then began talking has been waited on for ten minutes, and nothing here " +
        "resets when it starts.",
    ),
    started: IsoDateTimeSchema.nullable().describe(
      "**When the job first wrote a log line**, and null until it writes one — a job that is " +
        "`pending`, and one that has been claimed but is still silent, both read null. Written " +
        "once and never moved: later lines advance `updated`, not this. It is deliberately not " +
        "the enqueue instant with another name (`enqueued` is that, and it is always known), " +
        "because a field that means *enqueued* while queued and *first spoke* afterwards silently " +
        "changes meaning partway through a job's life — which is what CONTRACT-029 was filed " +
        "about. Null is the honest answer for work that has not been observed yet.",
    ),
    updated: IsoDateTimeSchema.describe(
      "**The most recent log line's instant**, falling back to `enqueued` for a job that has " +
        "written none. This is what `GET /api/jobs` orders by, most recent first. A `deferred` " +
        "job stops advancing it while it waits (SPEC.md §7), which is how one falls out of a " +
        "windowed list — see that route's `recent`.",
    ),
    lastLine: z
      .string()
      .nullable()
      .describe("Most recent log line, for the collapsed console row."),
    originId: DocumentIdSchema.nullable().describe(
      "Document or thread the job originated from, so the console can link through.",
    ),
    originTitle: z
      .string()
      .nullable()
      .describe(
        "**The current title of whatever `originId` names, or null.** Null exactly when `originId` " +
          "is null, or when the document it names no longer exists. It rides along so the console " +
          "can label a job row without a second fetch per row; it is a denormalised copy read at " +
          "response time, never a stored field, so a renamed document shows its new title on the " +
          "next read.",
      ),
    blockedOn: DocumentIdSchema.nullable().describe(
      "**The document being edited that this job is waiting on**, or null — non-null exactly when " +
        "`status` is `deferred` (SPEC.md §7, CONTRACT-021). It is the document supplied at defer " +
        "time, and the one whose edit session ending returns the job to `pending` " +
        "automatically. The console needs it to say what a waiting row is waiting *for*: a " +
        "deferred job that names no document is indistinguishable from a stuck one.",
    ),
    blockedOnTitle: z
      .string()
      .nullable()
      .describe(
        "**The current title of whatever `blockedOn` names, or null** — the same denormalised " +
          "copy `originTitle` is, read at response time rather than stored, so a renamed document " +
          "shows its new title on the next read. Null exactly when `blockedOn` is null, or when " +
          "the document it names no longer exists.",
      ),
  }),
  "Job",
);

export const JobLogLineSchema = openapi(
  z.object({ ts: IsoDateTimeSchema, line: z.string() }),
  "JobLogLine",
  {
    description:
      "One line of `.corpus/jobs/<eventId>.jsonl`. Always rendered as plain text, never interpreted.",
  },
);

export const DEFAULT_RECENT_JOBS = 50;
export const MAX_RECENT_JOBS = 200;

/**
 * Splits the comma-separated status set, the same spelling `GET /api/docs` uses
 * for its multi-valued `type` filter. Validated here rather than server-side so
 * a typo is a `400` naming the legal values, not a filter that silently matches
 * nothing — a jobs query that quietly returns `[]` reads exactly like "no work
 * outstanding", which is the one answer this parameter exists to get right.
 */
const StatusSetSchema = z
  .string()
  .min(1)
  .transform((value, ctx): readonly QueueEventStatus[] => {
    const parts = value
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (parts.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "status must name at least one value" });
      return z.NEVER;
    }
    const parsed: QueueEventStatus[] = [];
    for (const part of parts) {
      const result = QueueEventStatusSchema.safeParse(part);
      if (!result.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `unknown job status "${part}"; expected one of ${QUEUE_EVENT_STATUSES.join(", ")}`,
        });
        return z.NEVER;
      }
      parsed.push(result.data);
    }
    return parsed;
  });

/**
 * The console's list, and — since CONTRACT-030 — a **predicate about one
 * document**.
 *
 * Those are different questions and the difference is the whole point.
 * `GET /api/jobs` was only ever the first: "the N most recently-touched jobs".
 * Two callers want the second — "does the agent still owe *this* thread an
 * answer?" (SPEC.md §8's pending row, and the board row's dot) — and answered it
 * by fetching the console list and scanning it, which put the answer inside a
 * 50-row window ordered by recency. A deferred job waits indefinitely (SPEC.md
 * §7) so its `updated` stops advancing; after enough churn elsewhere it fell out
 * of the window and the "working…" row vanished **while the reply was still
 * coming**. Raising `recent` moves that boundary without removing it.
 */
export const JobsQuerySchema = z.object({
  recent: openapi(
    z.coerce.number().int().min(1).max(MAX_RECENT_JOBS).default(DEFAULT_RECENT_JOBS),
    {
      param: { name: "recent", in: "query", required: false },
      type: "integer",
      minimum: 1,
      maximum: MAX_RECENT_JOBS,
      default: DEFAULT_RECENT_JOBS,
      description:
        `How many of the most recent jobs to return (1–${MAX_RECENT_JOBS}). ` +
        "**Bounds the console list only, and is ignored once `originId` is given.** A window is " +
        'the right shape for "what has the queue been doing", which is unbounded, and the ' +
        'wrong shape for "is anything outstanding here", which must be answered completely or ' +
        "not at all: a windowed predicate is wrong less often than an unwindowed one and still " +
        "wrong, and its failure is the silent direction — a job that fell out of the window is " +
        "indistinguishable from no job. One document's jobs are bounded by that document's own " +
        "history, so there is nothing here a window needs to protect the caller from.",
    },
  ),
  originId: openapi(DocumentIdSchema.optional(), {
    param: { name: "originId", in: "query", required: false },
    description:
      "**Restrict to jobs originating from this document or thread** — the `Job.originId` value, " +
      "matched by the same rule the response field is derived by (first of `threadId`, " +
      "`parentId`, `docId` in the event payload that names a document the corpus still holds). " +
      "This is a predicate about one document, not a narrowing of the console list: it exists so " +
      "a caller can ask *is anything still outstanding here?* and get a **complete** answer — " +
      "every matching job, in the same order, with `recent` no longer applied. Omitted, the " +
      "query is the console's list and is unchanged, window and all.",
  }),
  status: openapi(StatusSetSchema.optional(), {
    param: { name: "status", in: "query", required: false },
    type: "string",
    description:
      `Comma-separated job statuses; values OR together. Legal values: ${QUEUE_EVENT_STATUSES.join(", ")}. ` +
      "Deliberately a general set rather than a named `outstanding` shorthand: which statuses " +
      "count as unsettled is a reading of SPEC.md §7's state machine, and baking one caller's " +
      "reading into the wire would make every other caller live with it. The two callers that " +
      `ask the outstanding question pass \`${NON_TERMINAL_QUEUE_EVENT_STATUSES.join(",")}\` — the three non-terminal ` +
      "states, `deferred` included, since a job waiting on somebody's editing is still owed.",
  }),
});

/**
 * The jobs a query matched, and **whether that is all of them** (CONTRACT-035).
 *
 * `JobList` used to carry `jobs` alone, which made it the only truncating
 * surface on this wire that cut silently — `InProgressSet` reports `total` and
 * `truncated`, `DocDiff` reports `totalChars` and `truncated`, and both of them
 * point *here* as the route that puts the complete set within reach. It windows
 * too: `recent` defaults to 50 and caps at {@link MAX_RECENT_JOBS}, and the
 * status filter is a `WHERE` applied before the `LIMIT`, so a status-only query
 * is bounded at 200 rather than unbounded. Reach went from 20 to 200, not to
 * everything, and nothing on the response said so.
 *
 * **Option 1 of the issue's two, deliberately.** The alternative was to extend
 * CONTRACT-030's window-dropping from `originId` to `status`, on the argument
 * that a predicate must be answered completely or not at all. It is the wrong
 * one for a *terminal* status: `?status=processed` over a long-lived corpus is
 * every job that ever finished, which is precisely what the window exists to
 * protect the caller from, and no caller asks that question as a predicate. A
 * field that says "there is more" costs one count and makes every caller of the
 * route better off, including the unfiltered console.
 *
 * **The vocabulary is `total` + `truncated` and not a third spelling.** Three
 * surfaces truncate on this wire and a caller that learns the pair once should
 * not have to learn it again — which is the whole reason `DocDiff` spells its
 * count `totalChars` rather than inventing a second flag name.
 */
export const JobListSchema = openapi(
  z.object({
    jobs: z.array(JobSchema).describe("Console rows, most recent first."),
    total: z
      .number()
      .int()
      .min(0)
      .describe(
        "**How many jobs matched this query in total**, before `recent` bounded the page — equal " +
          "to `jobs.length` whenever `truncated` is false. Counted over the same filters the " +
          "array was selected with, so it answers *how much did I not see* and never *how many " +
          "jobs exist*. It is the `showing N of M` a windowed list owes its reader, spelled as " +
          "`InProgressSet.total` spells it.",
      ),
    truncated: z
      .boolean()
      .describe(
        "True when `recent` cut the list — `total` is then greater than `jobs.length`. Stated " +
          "rather than left to be derived (the rule `DocDiff.truncated` sets and " +
          "`InProgressSet.truncated` follows): a windowed answer reads exactly like a complete " +
          "one, and the direction it fails in is silent — a job past the cut is " +
          "indistinguishable from no job, which reads as *nothing outstanding*. **Always false " +
          "when `originId` is given**, because that query drops the window and is answered " +
          "completely (CONTRACT-030; see `recent`).",
      ),
  }),
  "JobList",
);

/**
 * The console fetches log content over HTTP and refetches on SSE invalidation
 * (SPEC.md §7) — the stream announces that the log grew, never its contents. The
 * cursor makes that refetch incremental instead of re-reading the whole file.
 */
export const JobLogQuerySchema = z.object({
  cursor: openapi(z.coerce.number().int().min(0).default(0), {
    param: { name: "cursor", in: "query", required: false },
    type: "integer",
    minimum: 0,
    default: 0,
    description: "Lines already held by the caller; pass back `nextCursor` to fetch only new ones.",
  }),
});

export const JobLogSchema = openapi(
  z.object({
    lines: z.array(JobLogLineSchema).describe("Log lines from `cursor` onwards, oldest first."),
    nextCursor: z
      .number()
      .int()
      .min(0)
      .describe("Cursor to pass on the next fetch; equals the total line count."),
  }),
  "JobLog",
);

export const AppendLogRequestSchema = openapi(
  z.strictObject({
    line: z
      .string()
      .min(1)
      .describe(
        "One progress line. Rendered as plain text and never interpreted; the server caps its " +
          "length (SPEC.md §7).",
      ),
  }),
  "AppendLogRequest",
);

/**
 * `appended` is a genuine boolean rather than `literal(true)`, because the
 * server has a real way to answer no: a job log is capped at a maximum file
 * size, and once a log reaches it every further line is dropped. That refusal
 * still answers `201` — the request was well formed and the cap is a property
 * of the log rather than of the call — so the status code cannot carry it, and
 * a literal `true` would have the response assert that a dropped line was
 * written. The one field that can be honest here is this one.
 */
export const AppendLogResultSchema = openapi(
  z.object({
    eventId: EventIdSchema,
    appended: z
      .boolean()
      .describe(
        "True when the line reached the log file. **False when the log is at its size cap** and " +
          "the line was dropped (SPEC.md §7): the call still succeeds with `201`, because the " +
          "request was well formed and nothing about it can be retried differently — but the line " +
          "is not there. A caller that reports progress from this endpoint reports the flag, not " +
          "the status code.",
      ),
  }),
  "AppendLogResult",
);

export type Job = z.infer<typeof JobSchema>;
export type JobLogLine = z.infer<typeof JobLogLineSchema>;
export type JobsQuery = z.infer<typeof JobsQuerySchema>;
export type JobList = z.infer<typeof JobListSchema>;
export type JobLogQuery = z.infer<typeof JobLogQuerySchema>;
export type JobLog = z.infer<typeof JobLogSchema>;
export type AppendLogRequest = z.infer<typeof AppendLogRequestSchema>;
export type AppendLogResult = z.infer<typeof AppendLogResultSchema>;
