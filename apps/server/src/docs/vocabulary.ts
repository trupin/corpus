// SPEC.md §9.2's `GET /api/vocabulary`: what this workspace actually uses.
//
// SPEC.md §5's **Structured fields** makes an invented frontmatter field a
// filter "the moment it is written". Becoming a filter is not the same as being
// findable — an invented field appears in no list anywhere — and the same was
// already true of tags, which is the defect CONTRACT-026 filed against the
// search overlay's `tag:` chip in 2026-08 and which one endpoint answers for
// both.
//
// Two statements, both derived on demand. Nothing is cached: this describes the
// corpus, so a cache would be a second copy of the corpus with its own
// invalidation rules, and the aggregate is one `GROUP BY` over a table the
// projection already keeps in memory-mapped form.
//
// **Skills and agent definitions are excluded** (`rankableSql`, the list the §7
// rider signed 2026-08-24 established). Measured on a real workspace that
// `corpus init` had just created plus two hand-written notes: the two most-used
// "invented" keys were `name` and `description`, on five documents each, and the
// most-used tag was `core` on four — every one of them from the skills the tool
// installed. A person's own `assignee` sat under them. Those keys are Claude
// Code's frontmatter (SPEC.md §7: the two sets coexist in one YAML block), not a
// convention this workspace invented, and §5's rider is explicit about whose
// conventions this is for. The bar `rankableSql` already sets is the right one
// and is already signed: the tool wrote it, not the user.
//
// They stay filterable. `extra.name=comment` runs, and `doc list --type skill`
// is untouched — this excludes documents from a *menu*, never from the index.

import type { WorkspaceVocabulary } from "@corpus/contract";
import type { ProjectionDb } from "../projection/index.js";
import { notArchivedSql, rankableSql } from "./filters.js";

/**
 * `count(DISTINCT d.id)` rather than `count(*)`: `json_each` yields one row per
 * element, so a document carrying a tag twice — which nothing forbids in a
 * hand-written file — would otherwise count as two.
 *
 * The archived exclusion is {@link notArchivedSql}, spliced rather than
 * restated, because this list feeds a menu whose picks go to `GET /api/docs`.
 * A tag offered here that the collection query's default set cannot return is a
 * menu entry that answers with nothing.
 */
const TAGS_SQL = `SELECT lower(tg.value) AS value, count(DISTINCT d.id) AS count
    FROM documents d, json_each(d.tags_json) tg
   WHERE ${notArchivedSql("d")} AND ${rankableSql("d")}
   GROUP BY 1
   ORDER BY count DESC, value ASC`;

/**
 * **Not lowercased**, unlike the tags above, and the asymmetry is the point.
 * The `tag` filter matches case-insensitively, so offering both `Finance` and
 * `finance` would be two menu entries for one filter. An extra key reaches SQL
 * as a JSON path and `json_extract` is case-sensitive, so `Owner` and `owner`
 * are genuinely two fields and collapsing them would offer a key that finds the
 * wrong documents.
 */
const KEYS_SQL = `SELECT ex.key AS key, count(DISTINCT d.id) AS count
    FROM documents d, json_each(d.extra_json) ex
   WHERE ${notArchivedSql("d")} AND ${rankableSql("d")}
   GROUP BY 1
   ORDER BY count DESC, key ASC`;

export function workspaceVocabulary(db: ProjectionDb): WorkspaceVocabulary {
  const tags = db.prepare(TAGS_SQL).all() as { value: string; count: number }[];
  const extraKeys = db.prepare(KEYS_SQL).all() as { key: string; count: number }[];
  return { tags, extraKeys };
}
