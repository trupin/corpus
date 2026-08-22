import type { Doc } from "@corpus/contract";
import { usePluginRegistry, type PluginRegistry } from "../plugins/registry";

/**
 * **May this document's `<field>` be set, and if not why** — asked once per
 * field, for every surface that has to answer it.
 *
 * There is one member per core field a plugin may derive (`@corpus/kit`'s
 * `PluginDocType`: `deriveStatus`, `deriveDue`), and every member is the **same
 * two-function shape** — a declaration-level predicate over the two fields a row
 * carries, plus a `form…` one that holds the whole `Doc` and may only *narrow*
 * it. That shape is the point: the alternative is one surface deciding a field
 * is settable while another decides it is not.
 *
 * **The members share their shape and their vocabulary, never their answers.**
 * {@link statusLock} and {@link dueLock} disagree about the archived case, on
 * purpose and for a reason each states — so this file holds two named predicates
 * rather than one parameterised by field name, which would be the same `if` with
 * the reasoning deleted. What is genuinely common lives in one place:
 * {@link FieldLock}, {@link DERIVED_LOCK}, and the rule that a derivation which
 * declines hands the field back.
 *
 * **Do not carry any other symmetry across.** `deriveStatus` has two answers and
 * `deriveDue` has three (`{due: null}` — *applies, no deadline* — is the middle
 * one), so the way a value is composed differs per field and is not this file's
 * business at all: nothing here composes a derived value with a stored one. Both
 * `form…` predicates call a derivation only to ask **whether it applies**, and
 * every surface shows what the server sent.
 *
 * The status question has two askers and they do different things with the
 * answer, which is exactly why it is not asked twice:
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
 * The whole of what deciding any of these questions takes: **two fields**, and
 * both a `DocRow` and a `Doc`'s frontmatter carry them.
 *
 * One subject for every member, because both fields' answers turn on the same
 * two facts — which type owns the document, and whether the document is archived
 * — even though they turn on them differently ({@link statusLock} versus
 * {@link dueLock}). Nothing here reads the document's body or its id, and a
 * third field would mean these predicates had started answering some other
 * question too.
 */
export interface FieldSubject {
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
 * A **derived** field (SPEC.md §12, rider signed 2026-08-12): the type reads it
 * off the document's own content instead of anyone setting it.
 *
 * Deliberately in core's own words and not the plugin's. §10 forbids core from
 * knowing a plugin's name, and "the items" is the todos plugin's vocabulary —
 * the type that owns the document is the one that gets to say it that way, on
 * the control UI-092 renders.
 *
 * One sentence for every derived field, and it names no field: the reader is
 * looking at the field's own label already, and a per-field wording would be two
 * ways of saying the one thing §11 says once.
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
 * {@link FieldSubject} deliberately does not carry.
 *
 * A registry that has not loaded yet, or a plugin that failed to load, locks
 * nothing. That is the safe direction: a control that is momentarily editable
 * corrects itself when discovery settles, where one that is permanently
 * uneditable because a manifest could not be read has no way back (UI-092).
 */
export function statusLock(subject: FieldSubject, registry: PluginRegistry): FieldLock | null {
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
export function useStatusLock(subject: FieldSubject): FieldLock | null {
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
 * {@link FieldSubject} carries `type` and `status` because that is all a row
 * has — the keyboard path reads its subject back off a painted element. So the
 * menu stays at the declaration's altitude and omits Resolve for the whole type,
 * which errs toward not offering an act that would be refused. The form holds
 * the `Doc` already, so it can be exact. The two answers differ for exactly one
 * document: a **legacy, unmigrated** todo whose items are still in
 * `extra.items`, where the menu offers no Resolve and the form offers an
 * ordinary status control. That is rare, it is in the safe direction, and the
 * person can still resolve such a document — from the form.
 *
 * The alternative was a third field on {@link FieldSubject} carrying the
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

/** Whether any loaded plugin declares this type's `due` derived (PLUGINS-018). */
function declaresDerivedDue(type: string, registry: PluginRegistry): boolean {
  return registry.docTypes.get(type)?.docType.deriveDue !== undefined;
}

/**
 * Why this document's `due` is not this person's to set, or `null` when it is —
 * {@link statusLock}'s shape, one field over (PLUGINS-018, SERVER-134).
 *
 * The field this locks is **core's own** `due` (SPEC.md §5), not a plugin's, and
 * that is why it needs locking at all: the server converges a derived `due` on
 * every write it makes, so an editable date control here offers a change the
 * write path undoes in the same request. PR #55's review measured exactly that —
 * pick a date, `PUT {"due":"2030-01-01"}`, `200`, and the file still reads
 * `2026-08-04` while the control snaps back with no error and no explanation.
 * §11 (SHARED-030) says a derived field is *editable by nobody*, and kit's
 * `PluginDocType` says a surface that would offer such an edit renders it locked.
 *
 * **The archived case is where this parts company with {@link statusLock}, and
 * the difference is the point.** Archiving is a fact about `status` — it *is* a
 * status, set on another route, so the status field stays locked and says so. It
 * is nothing at all about `due`: `PluginDocType` rule 2 makes an archived
 * document one of the two states in which every derivation declines, and where a
 * derivation declines "the stored value stands", which leaves the deadline the
 * person's to set exactly as it is on a note. So this returns `null` there, and
 * an archived todo keeps an ordinary date control.
 *
 * A registry that has not loaded yet locks nothing, for {@link statusLock}'s
 * reason: a momentarily editable control corrects itself when discovery settles,
 * and a permanently uneditable one has no way back.
 *
 * There is deliberately no `useDueLock` beside {@link useStatusLock}: the row
 * menu offers Resolve and Reopen and no act on `due` at all, so nothing asks this
 * of a row today. It is exported because it is the **declaration** half that
 * {@link formDueLock} narrows and that `fieldLock.test.ts` pins the pair against
 * — the second surface, if one ever comes, asks this one rather than writing the
 * same `if` again.
 */
export function dueLock(subject: FieldSubject, registry: PluginRegistry): FieldLock | null {
  if (subject.status === ARCHIVED) return null;
  return declaresDerivedDue(subject.type, registry) ? DERIVED_LOCK : null;
}

/**
 * Whether a `deriveDue` answer means **the derivation applies**.
 *
 * `deriveDue` is three-valued where `deriveStatus` is two-valued, and this is the
 * one place that distinction has to be got right (`DerivedDocDue` in
 * `@corpus/kit/plugin`):
 *
 * - `{due: "YYYY-MM-DD"}` — applies, and that is the deadline.
 * - `{due: null}` — **applies**, and the answer is *no deadline*. Locked, and it
 *   says so. Reading this one as "does not apply" is the collapse the wrapper
 *   type exists to prevent, and here it would hand the control back on precisely
 *   the document whose deadline the server is about to clear.
 * - `null` — does not apply, the stored value stands, the field is the person's.
 *
 * The shape is checked rather than trusted, because a manifest is untrusted input
 * at this seam (`plugins/validate.ts` establishes that a `deriveDue` *is* a
 * function, and can establish nothing about what it returns). An answer that is
 * neither of the two legal objects is read as *declining*, which is where a throw
 * lands too — the direction that leaves the field editable.
 */
function derivationApplies(answer: unknown): boolean {
  if (typeof answer !== "object" || answer === null || !("due" in answer)) return false;
  const { due } = answer as { readonly due: unknown };
  return due === null || typeof due === "string";
}

/**
 * {@link dueLock}, **plus the one question a form may ask** — does this type's
 * derivation actually have something to say about *this* document?
 *
 * The same narrowing {@link formStatusLock} performs, for the same reason and
 * under the same rule: it calls the shared predicate for its answer and may only
 * release a lock, never add one. `PluginDocType` rule 2's second not-applicable
 * state is content the derivation cannot read — a legacy `extra.items` key that
 * no longer parses — and there "the stored value stands", so the stored deadline
 * is the person's again.
 *
 * **This asks whether the derivation applies and never what it answered.** The
 * value shown is always the server's (`doc.frontmatter.due`), because two
 * derivations are two chances to disagree — the same rule the status statement
 * follows. That is also what keeps `DerivedDocDue`'s `??` trap out of this file:
 * nothing here composes a derived value with a stored one.
 */
export function formDueLock(doc: Doc, registry: PluginRegistry): FieldLock | null {
  const lock = dueLock(doc.frontmatter, registry);
  if (lock === null) return null;
  const derive = registry.docTypes.get(doc.frontmatter.type)?.docType.deriveDue;
  try {
    // Contained the way the server contains the same call
    // (`apps/server/src/plugins/derived-fields.ts`): plugin code on a render
    // path, where a throw would blank a reader over a document the user can
    // otherwise edit. A missing `derive` cannot happen behind a non-null lock —
    // the same registry answered both — and it lands on `false` rather than on a
    // branch no test could ever reach.
    return derivationApplies(derive?.(doc)) ? lock : null;
  } catch {
    return null;
  }
}

/** {@link formDueLock} against the live registry — see {@link useStatusLock}. */
export function useFormDueLock(doc: Doc): FieldLock | null {
  return formDueLock(doc, usePluginRegistry());
}
