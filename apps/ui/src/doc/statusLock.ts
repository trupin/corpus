import { usePluginRegistry, type PluginRegistry } from "../plugins/registry";

/**
 * **May this document's status be set, and if not why** — asked once, for every
 * surface that has to answer it.
 *
 * There are two of them and they do different things with the answer, which is
 * exactly why the question is not asked twice:
 *
 * - The frontmatter form (UI-093) renders the status control *populated and
 *   uneditable*, with {@link FieldLock.reason} as its hint — SHARED-030's "a
 *   field that was never the person's to set", which is not an edit mode.
 * - A document's action menu (UI-094) **omits** Resolve/Reopen instead. SPEC.md
 *   §11's context menu lists "exactly that item's existing actions", and an item
 *   nothing the user does could arm is not an action — it is a caption. The
 *   reason is unused there, and stays on the shape regardless, because the form
 *   half needs it.
 *
 * Living here rather than in `reader/FrontmatterForm.tsx` is what makes that
 * true: the menu is drawn from a **row**, which has an id, a title, a type and a
 * status and no `Doc` at all — the keyboard path reads it back off the painted
 * element's `data-` attributes. A `Doc`-taking predicate would have cost a fetch
 * and a flicker to draw a right-click menu, and the alternative — a second
 * predicate deciding the same thing — is how two surfaces that agreed on the day
 * they were written stop agreeing.
 */
export interface FieldLock {
  readonly reason: string;
}

/**
 * The whole of what deciding the question takes: **two fields**, and both a
 * `DocRow` and a `Doc`'s frontmatter carry them.
 *
 * Nothing here reads the document's body or its id, and a third field would mean
 * this predicate had started answering some other question too.
 */
export interface StatusSubject {
  readonly type: string;
  readonly status: string;
}

/** The status that is a place rather than a claim about what is left to do. */
const ARCHIVED = "archived";

/**
 * The archive boundary (UI-020). Archiving and unarchiving are their own routes
 * — only they move a `type: skill` document's folder — so the status field never
 * crosses it: `PUT` with a non-archived `status` on an archived document is
 * refused outright (SERVER-039).
 */
const ARCHIVED_LOCK: FieldLock = {
  reason: "archived — Unarchive in the ⋯ menu brings it back",
};

/**
 * A **derived** status (SPEC.md §12, rider signed 2026-08-12): the type reads it
 * off the document's own content instead of anyone setting it.
 *
 * Deliberately in core's own words and not the plugin's. §10 forbids core from
 * knowing a plugin's name, and "the items" is the todos plugin's vocabulary —
 * the type that owns the document is the one that gets to say it that way, on
 * the control UI-092 renders.
 */
const DERIVED_LOCK: FieldLock = {
  reason: "derived from this document’s own content, so it is nobody’s to set",
};

/**
 * Why this document's status is not this person's to set, or `null` when it is.
 *
 * The **declaration** is what locks a derived type, not the value it would
 * derive: `deriveStatus`'s presence on the doc type IS the declaration
 * (PLUGINS-016), and SHARED-031 part 2 reads at the same altitude — "a type
 * whose status is derived rather than set". Calling the derivation would need
 * the document's body, which a row does not have and which
 * {@link StatusSubject} deliberately does not carry.
 *
 * A registry that has not loaded yet, or a plugin that failed to load, locks
 * nothing. That is the safe direction: a control that is momentarily editable
 * corrects itself when discovery settles, where one that is permanently
 * uneditable because a manifest could not be read has no way back (UI-092).
 */
export function statusLock(subject: StatusSubject, registry: PluginRegistry): FieldLock | null {
  if (subject.status === ARCHIVED) return ARCHIVED_LOCK;
  if (registry.docTypes.get(subject.type)?.docType.deriveStatus !== undefined) return DERIVED_LOCK;
  return null;
}

/**
 * {@link statusLock} against the live registry.
 *
 * Through the store rather than `pluginRegistry()` so both surfaces re-render
 * when discovery settles — a menu opened during the first two seconds of a cold
 * load would otherwise keep whatever answer it was given.
 */
export function useStatusLock(subject: StatusSubject): FieldLock | null {
  return statusLock(subject, usePluginRegistry());
}
