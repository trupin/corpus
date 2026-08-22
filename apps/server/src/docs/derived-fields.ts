// **The file never disagrees with what is shown** (SPEC.md §12, `status` rider
// signed 2026-08-12; SERVER-085 for `status`, SERVER-134 for `due`).
//
// A doc type may answer for its own core fields — a todo list's status is its
// items, and its deadline is its earliest open item's — and the rider's closing
// sentence asks for one more thing than a correct board: "the derived value is
// written into the document's frontmatter whenever the server writes the
// document, so reading the file, querying the projection and looking at the
// board all give one answer." This module is that write-back, for every derived
// field at once, in the one write the caller was already making.
//
// It is not the rejected design. SHARED-036 turned down *an auto-flipped stored
// field* — a value something else keeps in sync, and can therefore fall out of
// sync — and chose derived-and-read-only. What is written here is a **shadow**
// of the derivation, never an input to it: nothing reads it back for a document
// whose type derives it, because {@link resolveDocumentStatus} and {@link
// resolveDocumentDue} ask the derivation first and only fall through to the file
// for types that own their own field. Deleting the plugin restores the stored
// values to authority, which is exactly §12 M6's subtractive check.

import type { UpdateDocRequest } from "@corpus/contract";
import {
  parseDocument,
  readExtraFrontmatter,
  serializeDocument,
  setFrontmatterFields,
  type ParsedDocument,
} from "../core/index.js";
import type { DerivedFieldsRegistry } from "../plugins/derived-fields.js";
import {
  classifyPath,
  resolveDocumentDue,
  resolveDocumentStatus,
  resolveDocumentType,
  type DocumentFieldInput,
} from "../projection/index.js";

/**
 * The document `parsed` will be once §12's derived fields are converged into it
 * — the same object when the frontmatter already states every derived value, or
 * the document's type derives none, or every derivation declines (an archived
 * document, unreadable items).
 *
 * `path` is workspace-relative: the root decides the type for §7's threads,
 * skills and personas, and decides the status outright for an archived skill,
 * whose location is its status whatever its frontmatter says.
 *
 * The answers come from {@link resolveDocumentStatus} and {@link
 * resolveDocumentDue} — the projection's own functions, over the same document —
 * so the values written into the file and the values written into the row cannot
 * be two answers. `setFrontmatterFields` drops the keys whose value is already
 * right and returns its input untouched when none is left, so identity is the
 * honest test for "these bytes need rewriting", and a caller can use it as one.
 *
 * **Every derived field converges in one patch**, which is what keeps §4's "one
 * action, one commit" true of a save that moves both: a document whose last
 * dated item is checked has its status resolve and its deadline clear in the
 * same write, the same commit and the same `updated` stamp.
 */
export function convergeDocumentFields(
  path: string,
  parsed: ParsedDocument,
  derivedFields: DerivedFieldsRegistry,
): ParsedDocument {
  const root = classifyPath(path);
  // A root that fixes a status fixes a type nothing derives (§7's skills), so
  // this dismissal costs the derived types nothing and keeps an archived skill's
  // frontmatter out of a write it has no part in.
  if (root === null || root.status !== null) return parsed;

  const type = resolveDocumentType(root, parsed.data);
  if (!derivedFields.derives(type)) return parsed;

  const input: DocumentFieldInput = {
    root,
    type,
    data: parsed.data,
    body: parsed.body,
    extra: readExtraFrontmatter(parsed.data),
    derivedFields,
  };

  const patch: Record<string, unknown> = {};
  if (derivedFields.status.derives(type)) patch["status"] = resolveDocumentStatus(input);
  // `null` is written, not the key removed: core's own empty spelling for an
  // absent deadline is `due: null` (SPEC.md §5's frontmatter example, and what
  // `docs/create.ts` writes), so a list whose last dated item was just checked
  // ends up spelling "no deadline" the way every other document does — and the
  // projection reads it as SQL NULL either way.
  if (derivedFields.due.derives(type)) patch["due"] = resolveDocumentDue(input);

  return setFrontmatterFields(parsed, patch);
}

/**
 * The §12 core fields a caller can name on `PUT /api/docs/{id}` and a plugin can
 * derive — the intersection of `UPDATABLE_FRONTMATTER_KEYS` and
 * {@link DerivedFieldsRegistry}'s members. A third derived field joins this list
 * and {@link convergeDocumentFields} together, and {@link overwrittenDerivedFields}
 * needs nothing else.
 */
export const DERIVED_CORE_FIELDS = [
  "status",
  "due",
] as const satisfies readonly (keyof UpdateDocRequest & keyof DerivedFieldsRegistry)[];

/**
 * Which of the fields a write **asked for** the convergence would take back —
 * the honesty guard on the save path (PR #55 review, MINOR).
 *
 * A `PUT` that sets `status` or `due` on a derived type used to answer `200`
 * while changing nothing: `changedFields` accepted the patch (the stored value
 * really did differ from the requested one), the write was planned, and then
 * {@link convergeDocumentFields} put the derived value back before the bytes
 * landed — leaving a commit whose whole diff was the `updated` stamp, a caller
 * told it had succeeded, and §5's staleness clock reset for nothing.
 *
 * **The question is asked of the convergence itself, over the document the patch
 * would produce.** That is the only formulation that separates *asking to change
 * the field* from *echoing it back*, and it separates several other pairs for
 * free, with no rule restated here:
 *
 * - The board publishes whole documents, so a save re-sending the value the
 *   reader was shown is the common case. Almost always `changedFields` has
 *   already dropped it — every server write converges the file, so the shown
 *   value *is* the stored one. When the file is stale (a body edited out of band,
 *   a plugin installed after the fact) the echo survives that far, the
 *   convergence answers the same value the caller sent, and the save proceeds
 *   and heals the file. Nothing the caller asked for is refused, because nothing
 *   it asked for is being ignored.
 * - `status: archived` stays writable, as SERVER-039 requires. Archiving says
 *   where a document is kept, which is §12's own carve-out: handed a stored
 *   `archived`, every derivation declines and the requested value stands.
 * - So does any field on a document the derivation declines for at all — an
 *   archived list's `due`, a list whose items cannot be read. The convergence
 *   leaves those alone, so this leaves them alone.
 *
 * Returns the field names in {@link DERIVED_CORE_FIELDS} order. Empty is the
 * answer for every document no plugin derives, and the caller reaches this only
 * for a patch that names one of the fields at all — an autosave of a body pays
 * nothing.
 */
export function overwrittenDerivedFields(
  path: string,
  next: ParsedDocument,
  requested: Readonly<Record<string, unknown>>,
  derivedFields: DerivedFieldsRegistry,
): readonly string[] {
  const named = DERIVED_CORE_FIELDS.filter((key) => Object.hasOwn(requested, key));
  if (named.length === 0) return [];
  const converged = convergeDocumentFields(path, next, derivedFields);
  // Identity is `setFrontmatterFields`' own answer for "every derived value is
  // already what this document states" — so the requested values, which are in
  // `next` by construction, are the derived ones.
  if (converged === next) return [];
  return named.filter((key) => converged.data[key] !== requested[key]);
}

/**
 * The same convergence over the **text** of a write, or `null` when the bytes
 * are already right and the caller should keep the ones it has.
 *
 * Two dismissals before anything is parsed, because this sits on the path of
 * every write in the system: a path under no document root, and a root whose
 * type is fixed to something no plugin derives — which is the turn path, the
 * busiest write there is, dismissed on one map lookup.
 */
export function convergeDocumentText(
  path: string,
  content: string,
  derivedFields: DerivedFieldsRegistry,
): string | null {
  if (derivedFields.types.size === 0) return null;
  const root = classifyPath(path);
  if (root === null || root.status !== null) return null;
  if (root.type !== null && !derivedFields.derives(root.type)) return null;

  let parsed: ParsedDocument;
  try {
    parsed = parseDocument(content, path);
  } catch {
    // Not this module's text to fix. A document the parser refuses is `doc
    // check`'s business (§11), and the write path has already had its say about
    // whether these bytes may land.
    return null;
  }

  const converged = convergeDocumentFields(path, parsed, derivedFields);
  return converged === parsed ? null : serializeDocument(converged);
}
