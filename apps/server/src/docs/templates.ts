// Template pre-fill on create (SPEC.md §11 — "templates are documents").
//
// "A template IS a document (`type: template`) with a `for: <doc-type>` field.
// Creating a document of that type with no body starts from the template."
// There is no template registry and no template syntax: the corpus describes
// itself, so a template is discovered by querying the projection like anything
// else.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DocumentParseError, parseDocument } from "../core/index.js";
import type { ProjectionDb } from "../projection/index.js";

/**
 * Frontmatter keys a template can never contribute. The first five are the
 * server's own identity and lifecycle fields — a document that inherited its
 * template's `id` would collide with it on the next projection. `for` is the
 * template's *selector*, meaningless (and misleading) on the document it
 * produced.
 */
export const TEMPLATE_RESERVED_KEYS: ReadonlySet<string> = new Set([
  "id",
  "type",
  "title",
  "created",
  "updated",
  "anchors",
  "for",
]);

export type TemplatePrefill = {
  readonly path: string;
  readonly body: string;
  /** Frontmatter the template defines beyond the reserved set, in file order. */
  readonly frontmatter: Readonly<Record<string, unknown>>;
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

    const frontmatter: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed.data)) {
      if (TEMPLATE_RESERVED_KEYS.has(key)) continue;
      frontmatter[key] = value;
    }
    return { path: row.path, body: parsed.body, frontmatter };
  }
  return null;
}
