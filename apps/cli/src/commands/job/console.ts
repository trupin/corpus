import { QUEUE_EVENT_STATUSES } from "@corpus/contract";
import type { paths } from "@corpus/contract/client";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";

/**
 * The console's read path and its two failed-job actions (SPEC.md §7, §11),
 * available from the terminal as well as the drawer: every queue event is a
 * job, so these are the same rows the UI renders, addressed by event id.
 */

/**
 * The route's own query type, so a parameter the contract renames or retypes
 * stops this verb compiling instead of silently going nowhere on the wire —
 * `doc list`'s pattern.
 */
type JobsQuery = NonNullable<paths["/api/jobs"]["get"]["parameters"]["query"]>;

/**
 * The wire query, built only from the flags actually passed.
 *
 * **`--status` is passed through, never parsed here** (CLI-031). The contract
 * validates this parameter at its own boundary and says why in as many words: a
 * typo must be "a `400` naming the legal values, not a filter that silently
 * matches nothing". Re-implementing it would put a second copy of both the
 * vocabulary *and* the set grammar — splitting, trimming, dropping empties, the
 * "at least one value" rule — in the CLI, and the day the contract gains a
 * seventh status the CLI would start refusing a value the server accepts. That
 * is the drift boundary validation exists to prevent, so `commands/filters.ts`'s
 * `oneOf` precedent stops at single-valued enums and this set is sent verbatim.
 * The legal values still appear in `--help`, interpolated from the contract's own
 * `QUEUE_EVENT_STATUSES` — the same source, not a copy.
 */
function collectJobsQuery(context: WorkspaceCommandContext): JobsQuery {
  const { flags } = context;

  const recent = flags.number("recent");
  const status = flags.string("status");
  const originId = flags.string("origin");

  // Conditional spreads rather than assignment: under
  // `exactOptionalPropertyTypes` an explicit `undefined` is not an absent key,
  // and an absent key is exactly what "no such filter" means on the wire.
  return {
    ...(recent === undefined ? {} : { recent }),
    ...(status === undefined ? {} : { status }),
    ...(originId === undefined ? {} : { originId }),
  };
}

export async function runJobList(context: WorkspaceCommandContext): Promise<void> {
  const query = collectJobsQuery(context);
  const filtered = query.status !== undefined || query.originId !== undefined;

  const result = await context.client.request((api) =>
    api.GET("/api/jobs", Object.keys(query).length === 0 ? {} : { params: { query } }),
  );
  context.out.emit(result);
  if (result.jobs.length === 0) {
    // "no jobs yet" is a claim about the queue, and it is false when a filter
    // is what emptied the list: an agent checking whether it still owes work
    // must not read "nothing matched `--status in-progress`" as "the queue has
    // never run".
    context.out.line(filtered ? "no jobs match." : "no jobs yet.");
    return;
  }
  for (const job of result.jobs) {
    context.out.line(`${job.eventId} ${job.status} ${job.lastLine ?? ""}`.trimEnd());
  }
}

export async function runJobRetry(context: WorkspaceCommandContext): Promise<void> {
  const id = context.args.get("event-id");
  const job = await context.client.request((api) =>
    api.POST("/api/jobs/{id}/retry", { params: { path: { id } } }),
  );
  context.out.emit(job);
  context.out.line(`job ${job.eventId} is ${job.status}.`);
}

export async function runJobAbandon(context: WorkspaceCommandContext): Promise<void> {
  const id = context.args.get("event-id");
  const job = await context.client.request((api) =>
    api.POST("/api/jobs/{id}/abandon", { params: { path: { id } } }),
  );
  context.out.emit(job);
  context.out.line(`job ${job.eventId} is ${job.status}.`);
}

const EVENT_ID_ARG = {
  name: "event-id",
  required: true,
  description: "The job's event id.",
} as const;

export const listCommand: WorkspaceCommandSpec = {
  name: "list",
  summary: "Show recent jobs and their last log line.",
  description:
    "The console's master list from the terminal: one row per queue event with its status and " +
    "most recent log line, most recent first.\n\n" +
    "The two filters are what make the rest of the queue surface reachable from here. " +
    "`corpus queue claim-all` reports what the server still holds `in-progress` and caps that " +
    "report at twenty rows, ending in `… and N more held, not shown`; `--status in-progress` is " +
    "how that number is expanded. `--origin` answers the other question — _is anything still " +
    "outstanding on this document?_ — and the server answers **that** one completely.\n\n" +
    "**The list is windowed unless `--origin` is given.** `--recent` bounds it, the server " +
    "applies its own default, and a `--status` filter narrows within that window rather than " +
    "lifting it. `--origin` is the exception, and the only one: one document's jobs are bounded " +
    "by that document's own history, so the server drops the window instead of applying it.",
  args: [],
  flags: [
    {
      name: "status",
      type: "string",
      valueName: "a,b",
      description:
        `Comma-separated job statuses; values OR together. Legal values: ${QUEUE_EVENT_STATUSES.join(", ")}. ` +
        "Sent to the server unchanged, so a misspelled value comes back as an error naming the " +
        "legal set rather than as an empty list. The window still applies: this returns the " +
        "`--recent` most recent jobs **with these statuses**, not every one that ever had them.",
    },
    {
      name: "origin",
      type: "string",
      valueName: "doc-id",
      description:
        "Only jobs originating from this document or thread — the `originId` the console links " +
        "through. A predicate about one document rather than a narrowing of the list, so it is " +
        "answered **completely**: `--recent` is not applied.",
    },
    {
      name: "recent",
      type: "number",
      valueName: "count",
      description:
        "How many of the most recent jobs to show. The server applies its own default. Bounds " +
        "this list only, and is **ignored once `--origin` is given**.",
    },
  ],
  examples: [
    { command: "corpus job list", description: "What has the agent been doing?" },
    {
      command: "corpus job list --status in-progress",
      description:
        "Everything the server still thinks is running — the whole set behind `corpus queue " +
        "claim-all`'s capped `… and N more held` line (SPEC.md §7).",
    },
    {
      command: "corpus job list --origin th_5f1c2a",
      description:
        "Every job that thread has produced, unwindowed — _does the agent still owe this thread " +
        "an answer?_",
    },
    {
      command: "corpus job list --recent 5 --json",
      description: 'One JSON value: `{"jobs":[{"eventId":"evt_9f2a","status":"processed",…}]}`.',
    },
  ],
  handler: (context) => runJobList(context),
};

export const retryCommand: WorkspaceCommandSpec = {
  name: "retry",
  summary: "Put a failed job back in the queue.",
  description:
    "Returns the event to `pending/` so the agent picks it up again — the terminal form of the " +
    "console's retry action. A job that is not in a retryable state answers `409` (exit 5).",
  args: [EVENT_ID_ARG],
  flags: [],
  examples: [{ command: "corpus job retry evt_9f2a", description: "Try a failed job once more." }],
  handler: (context) => runJobRetry(context),
};

export const abandonCommand: WorkspaceCommandSpec = {
  name: "abandon",
  summary: "Give up on a failed job.",
  description:
    "Moves the job's event to `abandoned/` — the other half of the console's failed-job actions. " +
    "Nothing is deleted; the event file and its log stay where the audit trail can see them.",
  args: [EVENT_ID_ARG],
  flags: [],
  examples: [
    {
      command: "corpus job abandon evt_9f2a",
      description: "Stop retrying a job that cannot work.",
    },
  ],
  handler: (context) => runJobAbandon(context),
};
