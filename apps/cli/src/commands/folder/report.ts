import type { Warning } from "@corpus/contract";
import { plural, warningSuffix } from "../../input.js";
import type { WorkspaceCommandContext } from "../../registry/types.js";
import { renderColumns } from "../columns.js";

/**
 * How every folder act reports itself: **one line per document, then one line
 * saying what happened** (SPEC.md §9.2, rider 7 signed 2026-08-22).
 *
 * A folder act is a bulk act, and §9.2 makes each one name every document it
 * changed — including documents the request never named, since a thread inherits
 * its parent's folder (§6). That list is the point of the response, so it is the
 * point of the output: a caller that has to re-list the folder to find out what
 * moved has been given a number instead of an answer.
 *
 * The shape is `doc list`'s, deliberately. An agent reads these rows
 * positionally and already knows how: id first, the field that changed second,
 * columns padded, last column ragged. The tally line follows the rows for the
 * same reason it does there — the rows are the answer and the count is the
 * footnote.
 *
 * **What the rows say is "the state after the act", not "what changed"** — the
 * server's own rule, and it matters for reading the output: an archive lists
 * documents that were already archived, because the act applied to them, and a
 * rename lists a thread at its unchanged `data/threads/<id>.md` path, because
 * what moved is which folder the thread belongs to and not which file holds it.
 */

export interface FolderActReport {
  /** One row per document, already in the order the server listed them. */
  readonly rows: readonly (readonly string[])[];
  /** The headline, e.g. `renamed inbox → triage`. The count is appended here. */
  readonly summary: string;
  readonly warnings: readonly Warning[];
}

export function reportFolderAct(context: WorkspaceCommandContext, report: FolderActReport): void {
  for (const line of renderColumns(report.rows)) context.out.line(line);

  const count = report.rows.length === 0 ? "no documents" : plural(report.rows.length, "document");
  context.out.line(`${report.summary} — ${count}${warningSuffix(report.warnings)}`);
}
