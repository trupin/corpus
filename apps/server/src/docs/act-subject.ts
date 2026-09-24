/**
 * **The subject line of a one-document commit** — one derivation, for every
 * route that can change a document's standing (SPEC.md §4).
 *
 * §4 says the commit that closes a window on an act "names the act", and its
 * rider signed 2026-09-09 says an archive or a restore does so "wherever they
 * happen": "§4's list names what happened to the document and not which verb was
 * used". So the subject a `PUT` writes when it archives a document has to be the
 * subject `POST /api/docs/{id}/archive` writes — otherwise a reader grepping
 * `git log` for `doc archive:` finds half the archives, and which half depends on
 * a door the history does not record (SERVER-106, PR #79's review).
 *
 * The shape itself — `<verb>: <title> (<id>) by <actor>` — lives here once, and
 * so does the choice of verb for a status move, so the archive verb, the thread
 * status verbs and the save route cannot drift apart. The *title* stays each
 * caller's: the save route passes {@link documentTitle}'s name for the document
 * as it will be left (SERVER-100), and the verbs pass the name they already
 * read. That keeps SERVER-100's single title derivation where it is rather than
 * forking a second one here.
 *
 * A bulk Save names a *set* and has its own shape (`bulk.ts`'s
 * `commitSubject`); this module is for one document.
 */

import type { Actor, DocStatus, ThreadStatus } from "@corpus/contract";

/** Every verb a one-document commit subject from these routes can carry. */
export type DocumentSubjectVerb =
  | "doc edit"
  | "doc archive"
  | "doc unarchive"
  | "doc resolve"
  | "doc reopen"
  | "thread resolve"
  | "thread reopen";

export function documentSubject(
  verb: DocumentSubjectVerb,
  title: string,
  id: string,
  actor: Actor,
): string {
  return `${verb}: ${title} (${id}) by ${actor}`;
}

/** The archive and unarchive verbs' own names — `docs/archive.ts`. */
export const archiveSubjectVerb = (archived: boolean): "doc archive" | "doc unarchive" =>
  archived ? "doc archive" : "doc unarchive";

/** The resolve and reopen verbs' own names — `threads/status.ts`. */
export const threadStatusSubjectVerb = (
  status: ThreadStatus,
): "thread resolve" | "thread reopen" =>
  status === "resolved" ? "thread resolve" : "thread reopen";

/**
 * The verb for a document whose `status` moved from `from` to `to` through a
 * route that is not one of the dedicated verbs — `PUT /api/docs/{id}`, by a
 * caller-written `status` or by §5's stage coupling.
 *
 * Each answer is the subject the dedicated verb for the same change writes:
 *
 * - **reaching `archived`** is what `POST /archive` does, from whichever status;
 * - **leaving `archived`** is what `POST /unarchive` does. The coupling may land
 *   the document on `resolved` rather than `open`, but §4's word for leaving the
 *   archive is "restored" whatever it lands on, and the archive is the larger
 *   change of the two;
 * - **`open` ↔ `resolved` on a thread** is what `POST /api/threads/{id}/resolve`
 *   and `/reopen` do;
 * - **`open` ↔ `resolved` on any other document** has no dedicated verb — the
 *   thread verbs refuse a non-thread — so it takes the same two words under the
 *   `doc` prefix, exactly as `docs/delete.ts` writes `doc delete` beside
 *   `thread delete`.
 *
 * Callers pass a real move (`from !== to`); a non-move is a plain edit and is
 * answered as one, so a caller that gets that wrong still writes an honest line.
 */
export function statusMoveSubjectVerb(
  type: string,
  from: DocStatus,
  to: DocStatus,
): DocumentSubjectVerb {
  if (from === to) return "doc edit";
  if (to === "archived") return archiveSubjectVerb(true);
  if (from === "archived") return archiveSubjectVerb(false);
  if (type === "thread") return threadStatusSubjectVerb(to);
  return to === "resolved" ? "doc resolve" : "doc reopen";
}
