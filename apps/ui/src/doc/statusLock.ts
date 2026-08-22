/**
 * **May this document's `status` be set, and if not why** — asked once, for
 * every surface that has to answer it.
 *
 * There is one such reason left, and it is the archive boundary (UI-020).
 * Archiving and unarchiving are their own routes — only they move a
 * `type: skill` document's folder — so the status field never crosses it: `PUT`
 * with a non-archived `status` on an archived document is refused outright
 * (SERVER-039). A surface that offered the act anyway would be promising a
 * refusal.
 *
 * **This file was `doc/fieldLock.ts` and answered for two fields.** `due` had a
 * lock too, and `status` had a second reason — a plugin could declare either
 * field *derived* from the document's own content, in which case it was nobody's
 * to set. The plugin system is gone (SHARED-064), no type derives anything, and
 * both went with it: `due` is an ordinary date on every document, and `status`
 * is the person's everywhere except across the archive door. What survives is
 * the one rule that never depended on a plugin, kept at the altitude it was
 * written at.
 *
 * The question has two askers and they do different things with the answer,
 * which is why it is asked here and not twice:
 *
 * - The frontmatter form renders the control *populated and uneditable*, with
 *   the reason as its hint — SHARED-030's "a field that was never the person's
 *   to set", which is not an edit mode.
 * - A document's action menu (UI-094) **omits** Resolve/Reopen instead. SPEC.md
 *   §10's context menu lists "exactly that item's existing actions", and an item
 *   nothing the user does could arm is not an action — it is a caption.
 *
 * Living here rather than in `reader/FrontmatterForm.tsx` is what makes that
 * true: the menu is drawn from a **row**, which has an id, a title, a type and a
 * status and no `Doc` at all — the keyboard path reads it back off the painted
 * element's `data-` attributes. A `Doc`-taking predicate would have cost a fetch
 * and a flicker to draw a right-click menu, and the alternative — a second
 * predicate deciding the same thing — is how two surfaces that agreed on the day
 * they were written stop agreeing.
 */

/**
 * The whole of what deciding this takes: **two fields**, and both a `DocRow` and
 * a `Doc`'s frontmatter carry them.
 *
 * `type` is still read even though nothing turns on it today, because it is what
 * a row identifies its subject by and `subjectFromRow` builds one of these from
 * a row it already holds. Nothing here reads the document's body or its id.
 */
export interface FieldSubject {
  readonly type: string;
  readonly status: string;
}

/** The status that is a place rather than a claim about what is left to do. */
const ARCHIVED = "archived";

/**
 * Why an archived document's status is not this person's to set.
 *
 * It names where the act lives rather than only refusing, because there *is* an
 * act here — it is on another route, and a person looking at a locked control
 * with no next step is being told less than the surface knows.
 */
const ARCHIVED_REASON = "archived — Unarchive in the ⋯ menu brings it back";

/**
 * Why this document's status is not this person's to set, or `null` when it is.
 *
 * The reason is returned rather than a boolean: the form renders it as the
 * field's hint, and a caller that only wants the yes/no compares against `null`.
 */
export function statusLock(subject: FieldSubject): string | null {
  return subject.status === ARCHIVED ? ARCHIVED_REASON : null;
}
