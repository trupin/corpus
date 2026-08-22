import type { Doc } from "@corpus/contract";
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
 *   field that was never the person's to set", which is not an edit mode. On a
 *   `derived` lock (UI-092) it stops rendering a control at all and states the
 *   value, and it asks one **additional** question first — see
 *   {@link formStatusLock}, which narrows this answer and never replaces it.
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
  /**
   * **Which of the two reasons this is**, so a caller can act on the kind rather
   * than on the wording of {@link FieldLock.reason}.
   *
   * The two are not the same shape of fact and UI-092 draws them differently. A
   * `derived` value was computed from the document and is a **statement**; an
   * `archived` one was decided by a person and is a control whose act lives on
   * another route. A surface that told them apart by matching the reason text
   * would break the first time the wording changed.
   */
  readonly kind: FieldLockKind;
  readonly reason: string;
}

/** See {@link FieldLock.kind}. */
export type FieldLockKind = "archived" | "derived";

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
  kind: "archived",
  reason: "archived — Unarchive in the ⋯ menu brings it back",
};

/**
 * The same boundary, on a document whose type would otherwise derive its status.
 *
 * §12's rider is explicit that these two facts do not blend: *"`archived` is not
 * derived, because it is not a claim about what is left to do. It says where a
 * document is kept (§5), which no checkbox can imply, so an archived todo
 * document reads `archived` whatever its items say."* The plain archived reason
 * would be true here but would leave the reader to guess which of the two rules
 * put the word there, on the one document where both could have — so this one
 * says which, and says the derivation is only suspended rather than gone
 * (unarchiving returns the document to whichever value its content states).
 */
const ARCHIVED_OVER_DERIVED_LOCK: FieldLock = {
  kind: "archived",
  reason:
    "archived — where this document is kept, not a reading of its content. " +
    "Unarchive in the ⋯ menu brings it back",
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
  kind: "derived",
  reason: "derived from this document’s own content, so it is nobody’s to set",
};

/** Whether any loaded plugin declares this type's status derived (PLUGINS-016). */
function declaresDerivedStatus(type: string, registry: PluginRegistry): boolean {
  return registry.docTypes.get(type)?.docType.deriveStatus !== undefined;
}

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
  const derives = declaresDerivedStatus(subject.type, registry);
  if (subject.status === ARCHIVED) return derives ? ARCHIVED_OVER_DERIVED_LOCK : ARCHIVED_LOCK;
  if (derives) return DERIVED_LOCK;
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

/**
 * The derived value this document's type states, or `null` when the derivation
 * **declines** — the document is archived, or its content cannot be read
 * (`PluginDocType.deriveStatus` rule 2).
 *
 * Contained the way the server contains the same call
 * (`apps/server/src/plugins/derived-fields.ts`): a derivation is plugin code on
 * a render path, and a throw here would blank the reader over a document the
 * user can otherwise edit. A throw is therefore read as *declining*, which lands
 * on the side that leaves the field the person's.
 */
function derivedStatus(doc: Doc, registry: PluginRegistry): string | null {
  const derive = registry.docTypes.get(doc.frontmatter.type)?.docType.deriveStatus;
  if (derive === undefined) return null;
  try {
    return derive(doc);
  } catch {
    return null;
  }
}

/**
 * {@link statusLock}, **plus the one question a form may ask and a menu may
 * not** — does this type's derivation actually have something to say about
 * *this* document?
 *
 * This is not a second predicate and it cannot become one. It calls
 * {@link statusLock} for the answer and may only ever **narrow** it: it never
 * locks a field the shared predicate left open, and it never touches an
 * `archived` lock. All it can do is release the one case §12 says was never
 * derived in the first place — a document whose content the derivation cannot
 * read, where "the stored value stands" and so the stored value is once again
 * the person's to set (PLUGINS-016 rule 2, SHARED-036's *unreadable items* edge
 * case).
 *
 * **Why the two surfaces are allowed to differ here** (orchestrator decision,
 * 2026-08-21). Answering this needs the document's **body**, and
 * {@link StatusSubject} carries `type` and `status` because that is all a row
 * has — the keyboard path reads its subject back off a painted element. So the
 * menu stays at the declaration's altitude and omits Resolve for the whole type,
 * which errs toward not offering an act that would be refused. The form holds
 * the `Doc` already, so it can be exact. The two answers differ for exactly one
 * document: a **legacy, unmigrated** todo whose items are still in
 * `extra.items`, where the menu offers no Resolve and the form offers an
 * ordinary status control. That is rare, it is in the safe direction, and the
 * person can still resolve such a document — from the form.
 *
 * The alternative was a third field on {@link StatusSubject} carrying the
 * derived value, which would have made every row's menu depend on a fetch, and
 * it was rejected for that.
 */
export function formStatusLock(doc: Doc, registry: PluginRegistry): FieldLock | null {
  const lock = statusLock(doc.frontmatter, registry);
  if (lock === null || lock.kind !== "derived") return lock;
  return derivedStatus(doc, registry) === null ? null : lock;
}

/** {@link formStatusLock} against the live registry — see {@link useStatusLock}. */
export function useFormStatusLock(doc: Doc): FieldLock | null {
  return formStatusLock(doc, usePluginRegistry());
}
