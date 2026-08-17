import type {
  AgentActivity,
  IndexStatus,
  Job,
  QueueEventStatus,
  QueueStatus,
} from "@corpus/contract";
import { agentActivity } from "@corpus/contract";

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

/**
 * What the agent pill can say — SPEC.md §11's four states, plus the one the
 * server never reports.
 *
 * The four are the contract's own {@link AgentActivity} (CONTRACT-045), used
 * rather than re-derived: `halted`, `disconnected`, `working`, `idle`, in that
 * precedence. The fifth is not a state of the agent at all. **`unknown` is the
 * absence of an answer**, which the strip has to render because it is one line
 * and always draws — and it exists because each of the other four is a claim
 * about somebody. §11 makes `idle` "a claim that requires evidence"; UI-098's
 * whole subject is that the console used to make it by elimination. Asserting
 * `disconnected` from a response that never arrived would be the identical
 * mistake pointed the other way, so the pill says neither.
 */
export type AgentState = AgentActivity | "unknown";

/**
 * The pill's state — **the contract's verdict, never a second derivation of it**.
 *
 * `agentActivity` already encodes §11's four states and the precedence between
 * them, including the one decision this surface must not re-open:
 * `disconnected` outranks `working`, because `inProgress > 0` is a fact about
 * events and not about anybody holding them. Two surfaces read the same
 * presence — this pill and §8's pending row — and a rule about honesty that each
 * derives for itself is a rule that holds in one of them. So there is no ladder
 * here, only the call.
 *
 * The window the verdict expires against is the contract's
 * `AGENT_PRESENCE_WINDOW_SECONDS`, itself derived from the idle timeout — which
 * is why no duration is written down in this file.
 *
 * `now` is a parameter because the verdict *expires*: `isAgentPresent` withdraws
 * a `live: true` whose evidence has aged past that window, so the pill must be
 * re-evaluated on a clock and not only when data arrives. {@link AgentPill}
 * supplies the clock; keeping this function pure is what makes the boundary
 * testable.
 *
 * **`undefined` is not absence, and that distinction is the whole point of this
 * signature.** A status that has not arrived is not a status reporting that
 * nobody is there — {@link UNKNOWN_QUEUE_STATUS} carries `live: false` as a
 * pre-answer placeholder, and feeding that to `agentActivity` would turn a
 * placeholder into an assertion. The placeholder therefore never reaches the
 * pill: `ConsoleStrip` hands this the query's own `undefined`, and hands the
 * counts the placeholder.
 */
export function agentState(status: QueueStatus | undefined, now: Date = new Date()): AgentState {
  if (status === undefined) return "unknown";
  if (!carriesPresence(status)) return "unknown";
  return agentActivity(status, now);
}

/**
 * Did this response actually carry a presence?
 *
 * `agent` is **required** on the wire (CONTRACT-045), so by the types this can
 * only be false — and it is written anyway, for the reason `apiClient`'s token
 * reader gives: this value comes off the network into a strip that is one line
 * and always renders, and a `TypeError` here does not degrade the pill, it takes
 * the whole shell down. A server built before the field existed, a proxy that
 * trimmed it, or a stub that answered `{}` all arrive here.
 *
 * The answer is `unknown` rather than `disconnected` because that is the same
 * distinction the rest of this file turns on: **a status that did not tell us is
 * not a status telling us nobody is there.** Reading a missing field as absence
 * would be the placeholder mistake again, arriving by a different road.
 */
function carriesPresence(status: QueueStatus): boolean {
  const presence: unknown = status.agent;
  return typeof presence === "object" && presence !== null && "live" in presence;
}

/**
 * `agent: working · queue 2` — the pill's text.
 *
 * The queue depth stays beside the state in all four reported states, and
 * matters most in `disconnected`: "nobody is listening and three requests are
 * waiting" is the sentence a person is trying to read when nothing is happening.
 *
 * It is dropped from `unknown` alone, because there is no depth either — the
 * placeholder's zero is a stand-in for the counts, not a number the server sent,
 * and `agent: unknown · queue 0` would smuggle a claim back in beside the one
 * this state exists to withhold. The condition is the **state**, not the
 * argument: `unknown` is reached both when nothing arrived and when what arrived
 * did not carry what it promised, and a body missing one required field is not a
 * body whose other numbers have earned more trust.
 */
export function agentPillText(status: QueueStatus | undefined, now: Date = new Date()): string {
  const state = agentState(status, now);
  if (status === undefined || state === "unknown") return `agent: ${state}`;
  return `agent: ${state} · queue ${String(status.pending)}`;
}

/**
 * The pill's dot, one table for all five states.
 *
 * - **`working` pulses** (`--accent`) and nothing else does, which is why the
 *   pulse means something.
 * - **`halted` is `--signal`** — red, because the strip's red means needs-you
 *   and a halted queue is a thing somebody switched off.
 * - **`disconnected` takes the neutral dot**, `--ink-3`, borrowed from the
 *   `abandoned` job dot and the disabled index dot for exactly their reason: §11
 *   says disconnected "is not an error state and is not styled as a failure",
 *   the three hues are each already a meaning, and "no agent is running here" is
 *   not one of them. It does not pulse and it is not `idle`'s green.
 * - **`unknown` is the hollow dot** — a `--ink-3` ring around nothing. It has to
 *   be distinguishable from `disconnected`, since the two say different things
 *   (nobody is there / nobody has said), and a ring is the one treatment in this
 *   strip that reads as *no reading taken* rather than as a colour with a
 *   meaning.
 *
 * `idle` keeps the base dot, `--good`, unchanged.
 */
export type AgentDotClass = "dot" | "dot busy" | "dot halted" | "dot away" | "dot unknown";

const AGENT_DOT_CLASSES: Readonly<Record<AgentState, AgentDotClass>> = {
  working: "dot busy",
  halted: "dot halted",
  disconnected: "dot away",
  unknown: "dot unknown",
  idle: "dot",
};

export function agentDotClass(state: AgentState): AgentDotClass {
  return AGENT_DOT_CLASSES[state];
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
 * What the strip's **counts** show before the server has answered — including
 * when it never will. Zeroes rather than blanks: the strip is one line and
 * always renders, and the reachability verdict is already in the strip beside
 * it.
 *
 * **It is not a status, and it must never reach the agent pill** (UI-098).
 * "0 running" is true of a server that is not there, which is what lets the
 * counts stand in; every value of `agent` is instead a claim about a person's
 * machine, and there is no value of it that is true of an unanswered read. So
 * the pill takes `QueueStatus | undefined` and is handed the query's own
 * `undefined` — see {@link agentState}. Nothing here is a fallback for it.
 */
export const UNKNOWN_QUEUE_STATUS: QueueStatus = {
  /*
   * A required field with nothing to put in it (CONTRACT-045). `live: false` is
   * the placeholder that cannot be mistaken for evidence *of presence* — but it
   * is not evidence of absence either, and reading it as one would say "no agent
   * is connected" about a server that has simply not replied yet. {@link
   * agentState} refuses this object rather than interpreting it.
   */
  agent: { live: false, since: null },
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
