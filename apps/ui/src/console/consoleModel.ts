import type { IndexStatus, Job, QueueEventStatus, QueueStatus } from "@corpus/contract";

/**
 * Everything the console derives rather than fetches, as pure functions.
 *
 * They live apart from the components because each one is a *decision* the
 * sprint contract asks to see written down — the five-to-four status mapping,
 * the counts format, what a job row is called when the wire carries no title —
 * and a decision embedded in JSX is one nobody can test or find again.
 */

/**
 * The prototype's four dot treatments, the neutral base for `abandoned`, and
 * `deferred`'s own class (styled as pending until SERVER-030 restyles it).
 */
export type JobDotClass = "running" | "pending" | "deferred" | "done" | "failed" | "";

/**
 * Wire status → prototype dot, the whole mapping in one table.
 *
 * `QueueEventStatus` has six members and `design/index.html` drew four dots, so
 * two are named rather than defaulted:
 *
 * - **`abandoned` gets the neutral dot** (sprint-010 adjudication 8). The
 *   prototype has no colour for it, and the three it does have are each already
 *   a meaning — `--signal` is "needs you", `--accent` is agent activity,
 *   `--good` is done — so borrowing one would say something untrue.
 * - **`deferred` gets a class of its own** (CONTRACT-021). The prototype has no
 *   parked/waiting affordance either, but the state *is* waiting-to-run, so it
 *   takes pending's `--sepia` treatment under a distinct name — the honest
 *   reading today, and one selector for SERVER-030's polish to restyle without
 *   touching this mapping. Never `failed`: a deferred job is not broken.
 */
export const JOB_DOT_CLASSES: Readonly<Record<QueueEventStatus, JobDotClass>> = {
  pending: "pending",
  "in-progress": "running",
  deferred: "deferred",
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
 * What a deferred job is waiting for, or `null` when there is nothing true to
 * say (SERVER-030 eval FAIL-1).
 *
 * The contract states the requirement on the field itself: *"a deferred job
 * that names no document is indistinguishable from a stuck one"*. So the
 * console names the blocking document, and the shape carries the id separately
 * from the name because the two surfaces want different amounts of it — the row
 * has 380 px, the detail pane can afford the id.
 *
 * Three honest readings, in the order the wire can produce them:
 *
 * - a title → that is the name, with the id alongside it;
 * - a `blockedOn` with a null title → the document was deleted or is otherwise
 *   unreadable (the contract's own rule for the denormalised copy), so the id
 *   *is* the only true name and stands in as one;
 * - no `blockedOn` at all → the contract says this cannot happen while
 *   `status` is `deferred`, but a UI that renders `blocked on ` when it does is
 *   worse than one that says so. It is never silently dropped.
 */
export interface BlockedOn {
  /** The blocking document's title, or the id when the title is gone. */
  readonly name: string;
  /** Non-null only when it adds something the name does not already say. */
  readonly id: string | null;
}

const UNNAMED_BLOCKER = "an unnamed document";

export function blockedOn(
  job: Pick<Job, "status" | "blockedOn" | "blockedOnTitle">,
): BlockedOn | null {
  if (job.status !== "deferred") return null;
  if (job.blockedOn === null) return { name: UNNAMED_BLOCKER, id: null };
  if (job.blockedOnTitle === null) return { name: job.blockedOn, id: null };
  return { name: job.blockedOnTitle, id: job.blockedOn };
}

/** `blocked on 401k rollover` — the row's compact hint. */
export function blockedOnLabel(blocker: BlockedOn): string {
  return `blocked on ${blocker.name}`;
}

/**
 * `blocked on 401k rollover · doc_401k` — the detail pane's line, which has the
 * room the row does not and follows the meta line's `· `-joined convention.
 */
export function blockedOnDetailLabel(blocker: BlockedOn): string {
  return blocker.id === null
    ? blockedOnLabel(blocker)
    : `${blockedOnLabel(blocker)} · ${blocker.id}`;
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
 * The index pill's dot, in the agent pill's own vocabulary (SPEC.md §11's
 * index-pill rider: "the semantic index's state dot").
 *
 * Two of the four states map straight onto a dot the strip already draws, and
 * two are named rather than borrowed:
 *
 * - **`current` keeps the base dot** — `--good`, exactly what an idle agent
 *   wears. Caught up is caught up.
 * - **`indexing` takes `busy`** — `--accent` and the pulse, the strip's one
 *   symbol for work actually in flight. Nothing else pulses, which is why the
 *   pulse means something.
 * - **`stale` takes a dot of its own**, `--sepia`, borrowed from the console's
 *   own `pending` job dot rather than from `halted`'s `--signal`: a backlog
 *   nobody is draining is *waiting*, not broken, and red is the strip's word for
 *   "needs you". A `failed` count is what earns attention, and it has its own
 *   line in the expanded view.
 * - **`disabled` takes the neutral dot**, `--ink-3`, for the reason the
 *   `abandoned` job dot takes it: the three hues are each already a meaning, and
 *   "there is no semantic index here" is not one of them.
 */
export type IndexDotClass = "dot" | "dot busy" | "dot stale" | "dot off";

const INDEX_DOT_CLASSES: Readonly<Record<IndexStatus["state"], IndexDotClass>> = {
  current: "dot",
  indexing: "dot busy",
  stale: "dot stale",
  disabled: "dot off",
};

export function indexDotClass(status: Pick<IndexStatus, "state">): IndexDotClass {
  return INDEX_DOT_CLASSES[status.state];
}

/**
 * `index: current · 273 indexed`, `index: indexing · 41/68`,
 * `index: stale · 41/68`, `index: disabled`.
 *
 * Two count shapes, because the two questions are different. Caught up, the only
 * interesting number is how much is searchable, so the pill says it plainly.
 * With a backlog — `indexing` *or* `stale`, which differ in whether anything is
 * currently draining it and not in what the numbers mean — the interesting
 * number is the fraction: `indexed` over `indexed + pending`, the corpus minus
 * whatever has permanently failed. That total is computed here rather than read
 * off the wire because the contract deliberately publishes no total (a fourth
 * number that must equal the sum of three others is a number that can be wrong).
 *
 * `failed` never enters the pill. It does not drain on its own, so it is not
 * progress; it is a fact that wants a sentence, and the expanded row is where it
 * gets one.
 *
 * `disabled` carries no count at all: with no usable vectors there is nothing to
 * be a fraction of, and `0/0` would read like a stalled backlog. What a disabled
 * index has to say instead is the server's `detail` sentence — a model still
 * downloading and a workspace that will never have one are the same word here,
 * and only that sentence tells them apart.
 */
export function indexPillText(status: IndexStatus): string {
  if (status.state === "disabled") return "index: disabled";
  if (status.state === "current") return `index: current · ${String(status.indexed)} indexed`;
  const total = status.indexed + status.pending;
  return `index: ${status.state} · ${String(status.indexed)}/${String(total)}`;
}

/**
 * The strip's counts, split so the failed one can carry its own span.
 *
 * `N running[· N queued][· N deferred] · N done · N failed` — the queued and
 * deferred segments are omitted when zero, exactly as the prototype's template
 * omits the queued one.
 *
 * `deferred` sits beside `queued` rather than being folded into it or into
 * `failed`: it is work that has not run and is not broken, and hiding it in
 * either neighbour would be the strip telling the user something untrue
 * (CONTRACT-021). It stays inside `lead` — one plain segment — because nothing
 * about it is red; SERVER-030 owns whatever affordance it eventually earns.
 */
export interface ConsoleCounts {
  /** Everything before the failed count, already joined with ` · `. */
  readonly lead: string;
  readonly failed: number;
}

export function consoleCounts(status: QueueStatus): ConsoleCounts {
  const segments = [`${String(status.inProgress)} running`];
  if (status.pending > 0) segments.push(`${String(status.pending)} queued`);
  if (status.deferred > 0) segments.push(`${String(status.deferred)} deferred`);
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
  deferred: 0,
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
