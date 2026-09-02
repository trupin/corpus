import type { Job, JobLogLine } from "@corpus/contract";

/**
 * **What a listener launch went out at**, read off the designation's own job log
 * (SPEC.md §7's *"a dispatch says what weight it went out at, and where that
 * weight came from"*; AGENT-059, shipped v0.31.0).
 *
 * ## Why this has to be read rather than derived
 *
 * A designation may state no level, and `Resident.weight` then reads `null` —
 * which is the contract reporting *the launcher chose*, and is deliberately not
 * a level (CONTRACT-067). The level it actually chose exists in exactly one
 * place a client can reach: the line AGENT-059 makes the orchestrator log on the
 * designation's own event.
 *
 * Nothing else can answer it. The roster carries no launch field, `AGENT-063`
 * makes the launcher's pick a **judgment** rather than a rule, and §10's signed
 * non-goal keeps model names out of the UI's own vocabulary — so a surface that
 * computed an answer here would be inventing one. §10's standing rule settles
 * what to do instead: *"a turn written before this was recorded shows nothing
 * rather than a guess: an unknown that says so is worth more than a plausible
 * attribution nobody can check."*
 *
 * ## It reports the clause and never re-words it
 *
 * The launch line is the agent's own prose, and the only thing this module knows
 * about it is the **shape AGENT-059 declares**: a parenthesised clause carrying
 * one of two provenance words, `stated at designation` or `judged` —
 * `(Opus 5 — stated at designation: heavy)` against `(Haiku — judged: no weight
 * chosen, the lane is for quick factual lookups)`.
 *
 * **`defaulted` is read too, and only for reading.** AGENT-059 shipped that word
 * in v0.31.0 and AGENT-063 replaced it with `judged` one release later, after
 * the user reversed the fixed default. A workspace installed from v0.31.0 still
 * has `defaulted` lines on its queue, and refusing to parse them would report a
 * record that is plainly there as absent. The skill no longer teaches the word —
 * `scripts/workspace-template.test.ts` pins it out — so nothing new writes it,
 * and this reads it as the judged case it was.
 *
 * So this finds the clause and hands it back **verbatim**, with the provenance
 * word it matched on. It does not split the model out of it, does not map it to
 * a level, and does not rewrite it — the same discipline `LaneScope` follows for
 * a scope: label what arrived, derive nothing. A second reading of the agent's
 * sentence is a second thing that can drift from it.
 *
 * A workspace whose guidance no longer logs in that shape therefore reads as
 * **nothing recorded**, which is the honest outcome and not a fault: the surface
 * says the record is not there rather than showing half of one.
 *
 * ## Why it is here and not in `@corpus/kit`
 *
 * The grammar belongs to the workspace's orchestrate skill, and the console's
 * Residents tab is the only surface that reads it. Kit holds what more than one
 * surface needs (`weightLevels.ts` is the vocabulary, and it is shared by five);
 * this is one tab's reading of one log, colocated with it.
 */

/**
 * Which of the launch grammar's two words was logged.
 *
 * `judged` is AGENT-063's word. `defaulted` was AGENT-059's for the same half of
 * the distinction and is still on queues written by v0.31.0, so it parses to
 * `judged` rather than to a third state: what the reader needs to know is
 * whether the person named the level or the launcher picked it, and both words
 * say the launcher picked it.
 */
export type LaunchProvenance = "stated" | "judged";

export interface LaunchRecord {
  /**
   * `stated` where the designation named the level, `judged` where it named
   * none and the launcher picked — kept apart because *"those are different
   * facts"*.
   */
  readonly provenance: LaunchProvenance;
  /**
   * The parenthesised clause exactly as the launch logged it, without its
   * parentheses. Shown as it stands; never parsed further.
   */
  readonly clause: string;
}

/** The queue event a designation announces itself on (SPEC.md §7). */
export const DESIGNATION_EVENT_TYPE = "resident.designated";

/**
 * The clause AGENT-059 declares: parentheses around text carrying one of the two
 * provenance words.
 *
 * `[^()]*` on both sides, so a clause is bounded by its own parentheses and a
 * line carrying two of them yields two candidates rather than one run-on match.
 */
const LAUNCH_CLAUSE = /\(([^()]*\b(stated at designation|judged|defaulted)\b[^()]*)\)/g;

/**
 * The designation's own job, or `null` when this lane has none the queue still
 * holds.
 *
 * The **most recent** one, because a re-designation writes a new event and the
 * question is what the resident in force went out at. `GET /api/jobs` orders
 * most recently active first and an `originId` answer is complete rather than
 * windowed (SPEC.md §9.2's rider), so the first match is that one.
 *
 * `null` covers two states that read alike from here and are both *no record*: a
 * lane designated before AGENT-059, and a lane whose designation event has been
 * reaped. Neither is distinguishable without an event the queue no longer holds,
 * and neither licenses a guess.
 */
export function designationJob(jobs: readonly Job[] | undefined, lane: string): Job | null {
  if (jobs === undefined) return null;
  return jobs.find((job) => job.type === DESIGNATION_EVENT_TYPE && job.originId === lane) ?? null;
}

/**
 * The launch this job's log recorded, or `null` when it recorded none.
 *
 * The **last** clause in the log, not the first: a launch that could not meet a
 * stated weight logs the deviation on the same event (§7), and a lane relaunched
 * on this event logs again — so the newest line is the one describing what is
 * running.
 */
export function readLaunchRecord(lines: readonly JobLogLine[]): LaunchRecord | null {
  let found: LaunchRecord | null = null;
  for (const entry of lines) {
    for (const match of entry.line.matchAll(LAUNCH_CLAUSE)) {
      const clause = match[1];
      const word = match[2];
      if (clause === undefined || word === undefined) continue;
      found = {
        // `judged` and the retired `defaulted` both mean the launcher picked.
        provenance: word === "stated at designation" ? "stated" : "judged",
        clause: clause.trim(),
      };
    }
  }
  return found;
}
