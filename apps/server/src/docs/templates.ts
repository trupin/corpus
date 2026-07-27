// Template pre-fill on create (SPEC.md §9.2, §11 — "templates are documents").
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
 * The template for `type`, or `null` when the type has none — which SPEC.md §11
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
      // reports it (§14) and a create must not fail because of it.
      if (error instanceof DocumentParseError) continue;
      throw error;
    }
    if (parsed.data["for"] !== type) continue;
    return { path: row.path, body: parsed.body };
  }
  return null;
}
