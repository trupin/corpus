import type { Job, QueueEventStatus, QueueStatus } from "@corpus/contract";

/**
 * Everything the console derives rather than fetches, as pure functions.
 *
 * They live apart from the components because each one is a *decision* the
 * sprint contract asks to see written down — the five-to-four status mapping,
 * the counts format, what a job row is called when the wire carries no title —
 * and a decision embedded in JSX is one nobody can test or find again.
 */

/** The prototype's four dot treatments, plus the neutral base for the fifth. */
export type JobDotClass = "running" | "pending" | "done" | "failed" | "";

/**
 * Wire status → prototype dot, the whole mapping in one table.
 *
 * `QueueEventStatus` has five members and `design/index.html` drew four dots, so
 * this is a five-to-four mapping and the odd one out is named rather than
 * defaulted: **`abandoned` gets the neutral dot** (sprint-010 adjudication 8).
 * The prototype has no colour for it, and the three it does have are each
 * already a meaning — `--signal` is "needs you", `--accent` is agent activity,
 * `--good` is done — so borrowing one would say something untrue.
 */
export const JOB_DOT_CLASSES: Readonly<Record<QueueEventStatus, JobDotClass>> = {
  pending: "pending",
  "in-progress": "running",
  processed: "done",
  failed: "failed",
  abandoned: "",
};

export function jobDotClass(status: QueueEventStatus): JobDotClass {
  return JOB_DOT_CLASSES[status];
}

/**
 * The job row's label: `<event type> · <origin title>` (SPEC.md §11).
 *
 * `originTitle` is null exactly when the job has no origin, or when the document
 * it named no longer exists — the contract's own rule — so the separator is
 * dropped with it. The type alone is still a true statement about the job;
 * `comment.created · undefined` would not be.
 */
export function jobLabel(job: Pick<Job, "type" | "originTitle">): string {
  return job.originTitle === null ? job.type : `${job.type} · ${job.originTitle}`;
}

/**
 * The clock in the detail header's meta line. Local wall time, to the minute,
 * as `design/index.html` shows it (`started 09:12`) — a console is read in the
 * session it is describing, so the date would be noise.
 */
export function jobStartedLabel(started: string): string {
  const at = new Date(started);
  if (Number.isNaN(at.getTime())) return started;
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/** The agent-status pill's three states (SPEC.md §11). */
export type AgentState = "working" | "idle" | "halted";

/**
 * Derived from the queue, never from a second endpoint.
 *
 * Halted outranks working: while the sentinel is set nothing new is claimed, and
 * an in-flight job finishing does not make the agent "working" again. Both facts
 * come from the one `GET /api/queue/status` the counts already read.
 */
export function agentState(status: QueueStatus): AgentState {
  if (status.halted) return "halted";
  return status.inProgress > 0 ? "working" : "idle";
}

/** `agent: working · queue 2` — the pill's text, halted included. */
export function agentPillText(status: QueueStatus): string {
  return `agent: ${agentState(status)} · queue ${String(status.pending)}`;
}

/**
 * The strip's counts, split so the failed one can carry its own span.
 *
 * `N running[· N queued] · N done · N failed` — the queued segment is omitted
 * when zero, exactly as the prototype's template omits it.
 */
export interface ConsoleCounts {
  /** Everything before the failed count, already joined with ` · `. */
  readonly lead: string;
  readonly failed: number;
}

export function consoleCounts(status: QueueStatus): ConsoleCounts {
  const segments = [`${String(status.inProgress)} running`];
  if (status.pending > 0) segments.push(`${String(status.pending)} queued`);
  segments.push(`${String(status.processed)} done`);
  return { lead: segments.join(" · "), failed: status.failed };
}

/**
 * What the strip shows before the server has answered — including when it never
 * will. Zeroes rather than blanks: the strip is one line and always renders, and
 * the reachability verdict is already in the strip beside it.
 */
export const UNKNOWN_QUEUE_STATUS: QueueStatus = {
  halted: false,
  pending: 0,
  inProgress: 0,
  processed: 0,
  failed: 0,
  abandoned: 0,
};

/**
 * The prototype's rule, unchanged: a line *containing* `ERR` is an error line.
 *
 * Applied at render time and never stored, because it is a display convention
 * over free text the agent wrote — the server has no error flag on a log line
 * and inventing one client-side would freeze this heuristic into the data.
 */
export function isErrorLine(line: string): boolean {
  return line.includes("ERR");
}

/**
 * Which job the detail pane shows.
 *
 * `chosen` is the id the user clicked, or `null` for "follow the newest".
 * The list arrives newest-first, so the policy is two lines: an explicit choice
 * survives every refresh that still contains it — a newer job arriving must not
 * steal the pane out from under someone reading — and falls back to the newest
 * the moment it does not.
 */
export function resolveSelectedJob(
  jobs: readonly Pick<Job, "eventId">[],
  chosen: string | null,
): string | null {
  if (chosen !== null && jobs.some((job) => job.eventId === chosen)) return chosen;
  return jobs[0]?.eventId ?? null;
}
