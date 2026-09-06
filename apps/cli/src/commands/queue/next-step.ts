/**
 * The one line each pass-ending verb prints to say what the loop does next
 * (CLI-078, SPEC.md §7).
 *
 * ## Why a tool's output says this at all
 *
 * A listener stays alive only because it decides to park again. A Claude Code
 * Task subagent lives exactly as long as it keeps calling tools, and no runtime
 * loops it, so a resident survives one more pass only if the model chooses on
 * that pass to call `corpus queue idle` once more. What it read immediately
 * before making that choice was `event evt_7c1d9a is complete.` — the most
 * terminal string this CLI prints, arriving exactly at the decision point, and
 * saying nothing about what comes next. The instruction that should override it
 * sits some 13K tokens back in a skill read once at the start.
 *
 * The decision point is the only place the reminder can land. A skill is read
 * once, the tool's output is read every pass, and nothing else in the system
 * occupies that position. It costs about fifteen tokens a pass.
 *
 * ## The three rules these strings live under
 *
 * - **One short line, and it never grows a second sentence.** The verb reports
 *   an outcome and names the next step. It does not restate the loop.
 * - **Never on stdout.** The agent loop parses stdout, so the line goes to
 *   stderr in human mode (`out.note`) and to an additive `nextStep` field under
 *   `--json`, exactly as the in-progress report already does.
 * - **It states the loop's next step, not an instruction to the caller.** These
 *   verbs are also run by a person at a prompt and by scripts, and neither is
 *   in a loop. `next step in the loop:` is doing that work and is not
 *   decoration.
 *
 * ## Why one line serves both the scoped and the unscoped loop (decision)
 *
 * A listener's next park is `corpus queue idle --thread <id>` and the
 * orchestrator's is `corpus queue idle`. The settling verbs take an event id and
 * no lane, so at the moment of settling the verb cannot see which loop it is in.
 * Three ways out were available: word the line so it is true of both, read the
 * lane out of the response, or take a flag.
 *
 * The wording is what shipped. It names the verb without the flag and says *the
 * lane you claimed from*, which is true of both loops and cannot be wrong.
 * Reading the lane from the response was rejected as more machinery for a
 * fifteen-token reminder, and it would still have to be worded for the
 * orchestrator's unscoped case. A flag was rejected outright: a reminder that
 * depends on the caller already remembering is not a reminder.
 *
 * The `--wait 0` probe gets **no** line at all (decision). It is a single
 * non-blocking question a script asks, not a park, and its caller is not in the
 * loop these lines describe. A reminder printed there would be prose the one
 * caller that cannot use it pays for on every poll.
 */

/** No line may exceed this. One line, read at a glance, at the decision point. */
export const MAX_NEXT_STEP_LENGTH = 120;

/**
 * After `complete`, `fail` or `defer` — the three verbs that end a pass by
 * settling what was claimed. One string for all three: what follows a settle is
 * the same park whichever way the work ended, and three wordings of one step is
 * how three call sites drift.
 */
export const SETTLED_NEXT_STEP =
  "next step in the loop: park for the next event with `corpus queue idle`, on the lane you claimed from.";

/** After an idle window that expired with nothing pending. A timeout is not an error. */
export const IDLE_TIMEOUT_NEXT_STEP =
  "next step in the loop: nothing arrived, so park again with `corpus queue idle` — a timeout is not an error.";

/** After an idle window spent while the queue was halted. Parking is still the step. */
export const IDLE_HALTED_NEXT_STEP =
  "next step in the loop: the queue is halted and consumption is stopped, so park again with `corpus queue idle`.";

/**
 * After an idle window that returned work.
 *
 * This one carries a fact the other four do not, and it is the fact this verb
 * is most often misread on: **idle observes and never claims**. The events it
 * just listed are still in `pending/`, and a pass that acts on them without
 * `claim-all` has settled work it never held.
 */
export const IDLE_EVENTS_NEXT_STEP =
  "next step in the loop: these are pending, not claimed — `corpus queue claim-all`, work, settle, then park.";

/** Every line, for the tests that hold them to one line and to the length cap. */
export const NEXT_STEP_LINES = [
  SETTLED_NEXT_STEP,
  IDLE_TIMEOUT_NEXT_STEP,
  IDLE_HALTED_NEXT_STEP,
  IDLE_EVENTS_NEXT_STEP,
] as const;
