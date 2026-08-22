// Template pre-fill on create (SPEC.md §9.2, §10 — "templates are documents").
//
// "A template IS a document (`type: template`) with a `for: <doc-type>` field.
// Creating a document of that type with no body starts from the template."
// There is no template registry and no template syntax: the corpus describes
// itself, so a template is discovered by querying the projection like anything
// else.
//
// **A template contributes its BODY and nothing else.** SPEC.md §9.2 is the
// operative sentence — "body pre-filled from the type's `template` document
// when one exists and no body is given" — and `CreateDocRequest` documents the
// server default for every frontmatter field the request may omit (`tags` → no
// tags, `status` → `open`, `due` → `null`, `evergreen` → `false`). A template's
// own frontmatter is the *template document's* housekeeping, not an instance
// default: the seeded note template carries `evergreen: true` because seed
// documents never go stale, and copying that onto every note created from it
// silently opted the whole corpus out of §5's staleness ramp.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DocumentParseError, parseDocument } from "../core/index.js";
import type { ProjectionDb } from "../projection/index.js";

export type TemplatePrefill = {
  readonly path: string;
  /** The only thing a template contributes to the document it produces. */
  readonly body: string;
};

type TemplateRow = { readonly path: string };

/**
 * The file named by a projection row is gone (or its directory is): the same
 * race `DocumentParseError` already covers, arriving as an errno instead.
 *
 * The projection is a *derived* view, so any row can outlive its file by the
 * width of the watcher's debounce — a template deleted or renamed out of band is
 * the ordinary case, and it must not turn the next `POST /api/docs` into a 500
 * (SERVER-022 finding 6). Other errnos are left to throw: a permission problem
 * is a workspace fault an operator has to see, not a candidate to skip past.
 */
const isMissingFile = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error.code === "ENOENT" || error.code === "ENOTDIR");

/**
 * The template for `type`, or `null` when the type has none — which SPEC.md §10
 * makes an ordinary outcome ("none → empty"), never an error.
 *
 * Selection is deterministic: candidates are ordered by path and the first
 * match wins, so a corpus with two templates for one type pre-fills from the
 * same one on every create. Archived templates are excluded (archiving is how
 * a template is retired, §7), and a `template` is never pre-filled from a
 * `for: template` document — that self-referential loop is the one shape the
 * mechanism must refuse rather than follow.
 */
export function findTemplate(
  workspaceRoot: string,
  projection: ProjectionDb,
  type: string,
): TemplatePrefill | null {
  if (type === "template") return null;

  const rows = projection
    .prepare(
      "SELECT path FROM documents WHERE type = 'template' AND status <> 'archived' ORDER BY path",
    )
    .all() as TemplateRow[];

  for (const row of rows) {
    let parsed;
    try {
      parsed = parseDocument(readFileSync(resolve(workspaceRoot, row.path), "utf8"), row.path);
    } catch (error) {
      // A template that cannot be read is simply not a candidate; `doc check`
      // reports it (§11) and a create must not fail because of it. That is as
      // true of a file that has vanished as of one that no longer parses.
      if (error instanceof DocumentParseError || isMissingFile(error)) continue;
      throw error;
    }
    if (parsed.data["for"] !== type) continue;
    return { path: row.path, body: parsed.body };
  }
  return null;
}
