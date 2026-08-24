/**
 * `corpus db doctor`'s designation half (SPEC.md §11, §7 — SERVER-132).
 *
 * §7 lets a standalone thread name the agent resident in it. `core/resident.ts`
 * parses that block **as a whole**, and an ill-shaped part of it — `weight: 3`
 * from a hand edit, two lines where one belongs — fails the parse and takes the
 * whole block with it. That parse rule is right and is unchanged here: you
 * cannot honour half a designation, and dropping just the bad key would
 * substitute *"none chosen"* for a choice somebody made.
 *
 * What was wrong is that **nothing said so**. The designation disappeared from
 * the roster, the resident's next park was refused, work rerouted to the
 * orchestrator, and no surface anywhere named the file. This pass is that
 * surface.
 *
 * **A report-only warning, not drift**, and §11 says why in the sentence it
 * carves the family out with: *"`corpus db doctor` may also carry report-only
 * warnings — findings worth a person's attention that are not drift. They never
 * affect its verdict or its exit code."* The projection here is **correct**: the
 * thread genuinely has no readable designation, every reader agrees, and no
 * rebuild changes a byte. Failing the verdict would fail a routine check on a
 * workspace whose projection is exactly right, which is `unindexable_file`'s
 * argument word for word.
 *
 * **Why the fact is a column and not a walk.** `semantic-integrity.ts` states
 * the constraint this pass inherits: a doctor pass is SQL over the projection
 * and nothing else, because `stats.hashed` is doctor's published promise that a
 * warm workspace re-reads nothing. Reading every standalone thread's frontmatter
 * to re-ask the question would break that promise on every run. The projector
 * already parses the block, so it records why it failed
 * (`threads.resident_problem`, schema v23) and this pass is one SELECT.
 *
 * **Why `corpus doc check` is not the surface**, though it is where a
 * frontmatter fault naturally belongs. Its vocabulary is a closed enum in
 * `packages/contract` (`CHECK_CODES`), whose every member outside the two
 * §11 warning codes is an error, and whose errors are write-blocking unless a
 * server-side set says otherwise. Reporting there means either a new code —
 * a contract change — or riding `frontmatter-invalid`, which would refuse every
 * later write to the thread: its owner's reply, its resolution, and the
 * designation that would repair it. That is SERVER-123's regression exactly, and
 * `docs/write.ts` already names it. If a later contract release adds a
 * `resident-malformed` code, moving this finding is a small change and this pass
 * is what it moves.
 */

import type { ProjectionDb } from "./db.js";
import type { DoctorWarning } from "./doctor.js";

/**
 * The kinds this pass produces. A server-only kind, which the wire deliberately
 * allows: `DoctorWarning.kind` is an open token, so a consumer that does not
 * recognise it still renders the `detail` and loses nothing.
 */
export const RESIDENT_WARNING_KINDS = ["resident_unreadable"] as const;

export type ResidentWarningKind = (typeof RESIDENT_WARNING_KINDS)[number];

type ProblemRow = {
  readonly id: string;
  readonly path: string;
  readonly problem: string;
};

/**
 * The threads whose `resident:` block is there and did not parse, ordered by
 * path so one workspace reports the same list twice running.
 *
 * Joined to `documents` for the path, because a finding that names only a thread
 * id leaves a person to find the file themselves — and the file is what they
 * have to edit, the block having no repair through any verb.
 */
const PROBLEM_SQL = `SELECT t.id AS id, d.path AS path, t.resident_problem AS problem
     FROM threads t
     JOIN documents d ON d.id = t.id
    WHERE t.resident_problem IS NOT NULL
    ORDER BY d.path`;

export function checkResidentBlocks(db: ProjectionDb): readonly DoctorWarning[] {
  const rows = db.prepare(PROBLEM_SQL).all() as ProblemRow[];
  return rows.map((row) => ({
    kind: "resident_unreadable" satisfies ResidentWarningKind,
    path: row.path,
    detail:
      `${row.path} designates a resident that cannot be read: ${row.problem}. ` +
      "The whole `resident:` block is refused rather than half-honoured, so this thread " +
      "reads as undesignated — it is absent from the roster, and a listener that parks " +
      "against it is refused. Repair the block in the file, or designate the thread again " +
      `with \`corpus thread designate ${row.id}\`, which rewrites it.`,
  }));
}
