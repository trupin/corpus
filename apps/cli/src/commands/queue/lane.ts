import { ORCHESTRATOR_LANE, ThreadIdSchema } from "@corpus/contract";
import { UsageError } from "../../errors.js";
import type { ParsedFlags } from "../../parse-args.js";
import type { FlagSpec } from "../../registry/types.js";

/**
 * `--thread` — which **lane** a queue verb consumes (SPEC.md §7), for the two
 * verbs that take one: `corpus queue idle` and `corpus queue claim-all`. It is
 * passed through as the wire's `scope` parameter and nothing else about either
 * verb changes.
 *
 * ## Why the flag names a thread rather than a lane
 *
 * A lane is spelled two ways on the wire — `orchestrator`, or a designated root
 * thread's id — and the contract is explicit that **omitting `scope` means the
 * orchestrator's lane**: *"the same lane, not a third behaviour"*. A
 * `--scope <lane>` flag would therefore give the orchestrator's lane a second
 * spelling at the one place a mistake is invisible. `corpus queue idle --scope
 * orchestrator` written where `--scope th_…` was meant parks on the wrong lane,
 * exits 0, prints nothing unusual, and quietly leaves the resident absent — the
 * conversation then gets answered by the orchestrator, which is exactly the
 * degraded mode §7 designed the fallback for and not a state a skill should be
 * able to enter by typo.
 *
 * So the flag admits **only a thread id**, and naming the orchestrator's lane is
 * a usage error that says what to do instead: omit the flag. Two spellings of
 * one lane collapse back into one, and the unscoped call keeps meaning exactly
 * what it meant before lanes existed.
 *
 * ## Why there is no `CORPUS_LANE`
 *
 * `--job` has `CORPUS_JOB` because an agent exports it once per claimed event
 * and every later write is attributed without being remembered — and because a
 * **stale** value is refused: the server answers `422` for an event that does
 * not exist or has settled, so the mistake surfaces immediately.
 *
 * A lane has no check that would catch this. SERVER-118 refuses a `--thread`
 * naming no lane at all, but that guard cannot fire on the mistake an
 * environment variable makes: a `CORPUS_LANE` inherited by a subagent that was
 * meant to run the orchestrator's loop names a lane that is entirely real —
 * somebody else's. It would silently park there, claim that conversation's work,
 * and no server could tell it apart from the resident doing its job. An
 * environment variable is the right mechanism when a stale value is caught and
 * the wrong one when it is silently honoured, so the lane is stated per
 * invocation, where the skill that owns the lane can see it.
 *
 * ## Why the two verbs describe it differently
 *
 * The shared half below is the whole of what the flag *is*; what the two verbs
 * do with a thread that designates nobody is where they part, and SERVER-118
 * made them part deliberately.
 *
 * `idle` refuses it, because parking **is** presence: a park admitted on a
 * thread the roster cannot name would make `corpus agents` report a lane that
 * does not exist, and the falsehood would last as long as the loop kept
 * re-parking. `claim-all` accepts it, because a lane whose resident was just
 * released still has events stamped with it, and those are invisible to the
 * orchestrator's unscoped claim until the lane lapses — refusing there would
 * strand them for a grace window in order to tidy a parameter.
 *
 * So the two descriptions state one rule each, and **each says why the other
 * verb's rule differs**. A reader who meets two rules for one flag and no
 * explanation assumes one of them is stale, which is exactly how the sentence
 * these replaced survived SERVER-118 (CLI-048).
 */

/**
 * What the flag means, identically on both verbs. Everything a caller needs to
 * pick a value is here; what follows it per verb is only what happens when the
 * value names no lane.
 */
const LANE_FLAG_COMMON =
  "Consume the lane of a **designated** root thread rather than the orchestrator's (SPEC.md " +
  "§7). A scoped call sees only its own lane's events; the unscoped call — this flag omitted — " +
  "is the orchestrator's, and never sees a live lane's events, so two agents running at once " +
  "read disjoint sets rather than racing for one event. **Omit it for the orchestrator's " +
  `lane**: \`${ORCHESTRATOR_LANE}\` is not accepted here, because a lane with two spellings is ` +
  "one a caller can address by accident.";

/**
 * `corpus queue idle`'s `--thread`: the verb that **refuses** a thread holding
 * no resident (SERVER-118), because its park is what presence is made of.
 *
 * The three ways on are the server's own — `errors.ts`'s `unknownLaneScope`
 * names exactly these — restated in this CLI's vocabulary rather than invented
 * here, so the help cannot say less than the error a caller is about to read.
 */
export const IDLE_LANE_FLAG: FlagSpec = {
  name: "thread",
  type: "string",
  valueName: "th_…",
  description:
    LANE_FLAG_COMMON +
    " **A thread that holds no resident is not a lane, and parking on one is refused** — exit 5, " +
    "the server's `422` — raised before the park is admitted and therefore before it can be " +
    "observed. That follows from parking _being_ presence: a park the roster cannot name would " +
    "leave `corpus agents` reporting a lane that does not exist. Nothing was parked and no work " +
    "was claimed, and there are three ways on: omit the flag to take the orchestrator's lane, " +
    "designate a resident on that thread first, or pick a lane from `corpus agents`. A resident " +
    "released _while its listener is parked_ keeps that park to the end of its window — what is " +
    "refused is a value that was never a lane, not one that has stopped being one. " +
    "`corpus queue claim-all` accepts what this refuses, deliberately; its own `--thread` says why.",
};

/**
 * `corpus queue claim-all`'s `--thread`: the verb SERVER-118 deliberately left
 * **unguarded**, and the description has to carry that reason — the same flag
 * documented two ways with no explanation reads as one description gone stale.
 */
export const CLAIM_ALL_LANE_FLAG: FlagSpec = {
  name: "thread",
  type: "string",
  valueName: "th_…",
  description:
    LANE_FLAG_COMMON +
    " **Here the thread need not still hold a resident**, which is a deliberate difference from " +
    "`corpus queue idle` — that verb refuses a `--thread` naming no lane, and this one does not. " +
    "Draining the events already stamped with a lane whose resident has just been released is " +
    "the departing listener's job, and until the lane lapses those events are invisible to the " +
    "orchestrator's unscoped claim, so refusing here would strand them for a whole grace window " +
    "in order to tidy a parameter. This verb therefore claims on whatever lane it is given; a " +
    "thread that designates nobody simply yields an empty batch, which is not a failure. " +
    "`corpus agents` is where to check that a lane is real.",
};

/**
 * `--thread` resolved into the `scope` a queue verb sends, or into its absence.
 *
 * Shape only, client-side, exactly as `--job` is: whether the thread exists, and
 * whether anything is designated on it, are the server's to know. What is
 * refused here is only what cannot be a lane at all — and the orchestrator's
 * name, which is a lane but not one this flag spells.
 */
export function resolveLaneScope(flags: ParsedFlags): string | undefined {
  const value = flags.string("thread");
  if (value === undefined || value === "") return undefined;

  if (value === ORCHESTRATOR_LANE) {
    throw new UsageError(
      `\`--thread ${ORCHESTRATOR_LANE}\` is not how the orchestrator's lane is named.`,
      {
        hint:
          "The unscoped call *is* the orchestrator's lane — drop the flag entirely. `--thread` " +
          "names a designated root thread, and the two spellings are kept apart so a lane cannot " +
          "be addressed by accident.",
      },
    );
  }

  if (!ThreadIdSchema.safeParse(value).success) {
    throw new UsageError(
      `a lane is named by a thread id, which looks like \`th_…\` — got "${value}".`,
      {
        hint:
          "Pass the id of the designated root thread whose lane you own. `corpus agents` lists " +
          "every lane and the id to use.",
      },
    );
  }

  return value;
}
