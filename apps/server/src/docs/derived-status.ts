// **The file never disagrees with what is shown** (SPEC.md §12, rider signed
// 2026-08-12; SERVER-085).
//
// A doc type may answer for its own `status` — a todo list's status is its items
// — and the rider's closing sentence asks for one more thing than a correct
// board: "the derived value is written into the document's frontmatter whenever
// the server writes the document, so reading the file, querying the projection
// and looking at the board all give one answer." This module is that write-back.
//
// It is not the rejected design. SHARED-036 turned down *an auto-flipped stored
// field* — a value something else keeps in sync, and can therefore fall out of
// sync — and chose derived-and-read-only. What is written here is a **shadow**
// of the derivation, never an input to it: nothing reads it back for a
// derived-status document, because {@link resolveDocumentStatus} asks the
// derivation first and only falls through to the file for types that own their
// own field. Deleting the plugin restores the stored value to authority, which
// is exactly §15 M6's subtractive check.

import {
  parseDocument,
  readExtraFrontmatter,
  serializeDocument,
  setFrontmatterFields,
  type ParsedDocument,
} from "../core/index.js";
import type { DerivedStatusRegistry } from "../plugins/derived-status.js";
import { classifyPath, resolveDocumentStatus, resolveDocumentType } from "../projection/index.js";

/**
 * The document `parsed` will be once §12's derived status is converged into it —
 * the same object when the frontmatter already states the derived value, or the
 * document's type does not derive one, or the derivation declines (an archived
 * document, unreadable items).
 *
 * `path` is workspace-relative: the root decides the type for §7's threads,
 * skills and personas, and decides the status outright for an archived skill,
 * whose location is its status whatever its frontmatter says.
 *
 * The answer comes from {@link resolveDocumentStatus} — the projection's own
 * function, over the same document — so the value written into the file and the
 * value written into the row cannot be two answers. `setFrontmatterFields`
 * returns its input untouched when nothing changed, so identity is the honest
 * test for "these bytes need rewriting", and a caller can use it as one.
 */
export function convergeDocumentStatus(
  path: string,
  parsed: ParsedDocument,
  derivedStatus: DerivedStatusRegistry,
): ParsedDocument {
  const root = classifyPath(path);
  if (root === null || root.status !== null) return parsed;

  const type = resolveDocumentType(root, parsed.data);
  if (!derivedStatus.derives(type)) return parsed;

  const resolved = resolveDocumentStatus({
    root,
    type,
    data: parsed.data,
    body: parsed.body,
    extra: readExtraFrontmatter(parsed.data),
    derivedStatus,
  });
  if (resolved === parsed.data["status"]) return parsed;
  return setFrontmatterFields(parsed, { status: resolved });
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
  derivedStatus: DerivedStatusRegistry,
): string | null {
  if (derivedStatus.types.size === 0) return null;
  const root = classifyPath(path);
  if (root === null || root.status !== null) return null;
  if (root.type !== null && !derivedStatus.derives(root.type)) return null;

  let parsed: ParsedDocument;
  try {
    parsed = parseDocument(content, path);
  } catch {
    // Not this module's text to fix. A document the parser refuses is `doc
    // check`'s business (§14), and the write path has already had its say about
    // whether these bytes may land.
    return null;
  }

  const converged = convergeDocumentStatus(path, parsed, derivedStatus);
  return converged === parsed ? null : serializeDocument(converged);
}
