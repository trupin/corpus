import { ORCHESTRATOR_LANE, ThreadIdSchema } from "@corpus/contract";
import { UsageError } from "../../errors.js";
import type { ParsedFlags } from "../../parse-args.js";
import type { FlagSpec } from "../../registry/types.js";

/**
 * `--thread` — which **lane** a queue verb consumes (SPEC.md §7), declared once
 * for the two verbs that take one: `corpus queue idle` and
 * `corpus queue claim-all`. It is passed through as the wire's `scope`
 * parameter and nothing else about either verb changes.
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
 * A lane has no such check. A `CORPUS_LANE` inherited by a subagent that was
 * meant to run the orchestrator's loop would silently park it on somebody
 * else's lane, where it would claim that conversation's work and no server could
 * tell it apart from the resident doing its job. An environment variable is the
 * right mechanism when a stale value is caught and the wrong one when it is
 * silently honoured, so the lane is stated per invocation, where the skill that
 * owns the lane can see it.
 */
export const LANE_FLAG: FlagSpec = {
  name: "thread",
  type: "string",
  valueName: "th_…",
  description:
    "Consume the lane of a **designated** root thread rather than the orchestrator's (SPEC.md " +
    "§7). A scoped call sees only its own lane's events; the unscoped call — this flag omitted — " +
    "is the orchestrator's, and never sees a live lane's events, so two agents running at once " +
    "read disjoint sets rather than racing for one event. **Omit it for the orchestrator's " +
    `lane**: \`${ORCHESTRATOR_LANE}\` is not accepted here, because a lane with two spellings is ` +
    "one a caller can address by accident. The thread need not already be designated — the " +
    "server accepts the call on whatever lane it is given, since a lane may be designated a " +
    "moment later; `corpus agents` is where to check that the lane is real.",
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
