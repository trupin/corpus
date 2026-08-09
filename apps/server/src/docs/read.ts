// Reading one document off disk and shaping it for the wire (SPEC.md §9.2,
// `GET /api/docs/{id}`).
//
// The **file** is the source of truth, so the body and frontmatter come from
// disk on every read — the projection supplies only the id → path mapping and
// the three fields a document root can override (`id`, `type`, `status`: a
// hand-written `SKILL.md` carries none of them, and an archived skill's status
// comes from which folder it sits in, not from its frontmatter). That is also
// what makes read-your-write cheap: the write path projects synchronously, so
// the path lookup is already current when the next request arrives.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AnchorIdSchema,
  TextQuoteSelectorSchema,
  type Doc,
  type DocFrontmatter,
  type DocStatus,
  type ResolvedAnchor,
  type TextQuoteSelector,
  type ThreadStatus,
} from "@corpus/contract";
import { resolveAnchorExact } from "../anchors/index.js";
import {
  DocumentParseError,
  parseDocument,
  readViewFrontmatter,
  type ParsedDocument,
} from "../core/index.js";
import { normalizeCalendarDate, normalizeInstant } from "../core/time.js";
import { internalError, notFound } from "../errors.js";
import type { ProjectionDb } from "../projection/index.js";

export type DocumentRow = {
  readonly id: string;
  readonly type: string;
  readonly path: string;
  readonly status: DocStatus;
  readonly title: string;
};

export type LoadedDocument = {
  readonly row: DocumentRow;
  /** Workspace-relative POSIX path — what git stages and the projection keys on. */
  readonly path: string;
  readonly absPath: string;
  /** The file's bytes as read in *this* request; never a client-supplied copy. */
  readonly text: string;
  readonly parsed: ParsedDocument;
};

export function findDocumentRow(projection: ProjectionDb, id: string): DocumentRow | null {
  const row = projection
    .prepare("SELECT id, type, path, status, title FROM documents WHERE id = ?")
    .get(id) as DocumentRow | undefined;
  return row ?? null;
}

/**
 * The row projected from a workspace-relative path, or `null` when that file is
 * not indexed (it is not under a document root, it failed to parse, or another
 * file won the same id).
 *
 * The by-path direction exists because a **skill's identity is its path**, not
 * its frontmatter: §7 lets a hand-written `SKILL.md` carry no Corpus id at all
 * and the projection derives one from where the file sits. `corpus skill
 * rollback <name>` therefore starts from `.claude/skills/<name>/SKILL.md` and has
 * to arrive at the document id, which is the opposite of every other read.
 * `documents.path` is `TEXT NOT NULL UNIQUE`, so the answer is at most one row.
 */
export function findDocumentRowByPath(projection: ProjectionDb, path: string): DocumentRow | null {
  const row = projection
    .prepare("SELECT id, type, path, status, title FROM documents WHERE path = ?")
    .get(path) as DocumentRow | undefined;
  return row ?? null;
}

/** True when some document already claims this id — the `newId` collision predicate. */
export function isIdTaken(projection: ProjectionDb, id: string): boolean {
  return findDocumentRow(projection, id) !== null;
}

/**
 * The ids of threads the projection records as claiming `<docId>#<anchorId>` —
 * §14's `anchor-unused` seam, the anchor-claim counterpart of {@link isIdTaken}.
 *
 * Every thread counts, resolved ones included: resolving a thread keeps both its
 * `anchor` field and the parent's anchor entry (§6 removes the entry on
 * *delete*), so a resolved thread is still a conversation the highlight points
 * at.
 */
export function anchorClaimantIds(
  projection: ProjectionDb,
  docId: string,
  anchorId: string,
): readonly string[] {
  return projection
    .prepare("SELECT id FROM threads WHERE parent_id = ? AND anchor_id = ?")
    .all(docId, anchorId)
    .map((row) => (row as { id: string }).id);
}

/**
 * Read the document `id` names, or throw the contract's 404. A row whose file
 * vanished under it is a 404 as well: the projection is derived state and racing
 * an external `rm` is normal, not a server fault.
 *
 * `relocated` maps a workspace-relative path this **caller has already moved**
 * to where it moved it. Only the bulk act passes one, and it has to: the act is
 * one commit and therefore one re-projection, so between two documents of the
 * same act the rows are a write behind by construction. Archiving a skill
 * relocates every `SKILL.md` under its folder (§7), so a nested skill named
 * later in the same act has a row pointing at a file the act itself moved —
 * and, without this, would be refused `not-found` while its file sat in the
 * commit. The row is returned with the path corrected, because a `row.path`
 * nobody can read is a trap for everything downstream (SERVER-078).
 */
export function loadDocument(
  workspaceRoot: string,
  projection: ProjectionDb,
  id: string,
  relocated?: ReadonlyMap<string, string>,
): LoadedDocument {
  const found = findDocumentRow(projection, id);
  if (found === null) throw notFound(`no document with id ${id}`);
  const moved = relocated?.get(found.path);
  const row = moved === undefined ? found : { ...found, path: moved };
  const absPath = resolve(workspaceRoot, row.path);
  let text: string;
  try {
    text = readFileSync(absPath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw notFound(`no document with id ${id}`);
    }
    throw error;
  }
  let parsed: ParsedDocument;
  try {
    parsed = parseDocument(text, row.path);
  } catch (error) {
    if (error instanceof DocumentParseError) {
      // The file exists and is addressable but cannot be read as a document.
      // Never a 400 — the *request* was fine — and never a silent empty
      // document, which would invite a save that overwrites the real content.
      throw internalError(`document ${id} could not be parsed: ${error.message}`);
    }
    throw error;
  }
  return { row, path: row.path, absPath, text, parsed };
}

const asText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

/**
 * The `anchors` map as the wire declares it, entry by entry. A single malformed
 * selector in a hand-edited file must not detach every other thread on the
 * document, so unreadable entries are dropped rather than failing the read —
 * `doc check` is what reports them (SPEC.md §14).
 */
export function readAnchorsMap(value: unknown): Record<string, TextQuoteSelector> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const anchors: Record<string, TextQuoteSelector> = {};
  for (const [key, selector] of Object.entries(value)) {
    if (!AnchorIdSchema.safeParse(key).success) continue;
    const parsed = TextQuoteSelectorSchema.safeParse(selector);
    if (parsed.success) anchors[key] = parsed.data;
  }
  return anchors;
}

/**
 * The contract's post-defaults frontmatter shape. The server owns every default
 * (CONTRACT-003 handoff): `tags ?? []`, `status ?? "open"`, `due ?? null`,
 * `reviewed ?? null`, `evergreen ?? false`. A file that omits a field is not a
 * broken file — §5's canonical block is what a *Corpus-created* document has,
 * while §7's hand-written skills carry almost none of it.
 *
 * `created`/`updated` pass `null` straight through when the file carries no such
 * timestamp — a hand-written skill legitimately has none, and the contract's
 * `DocFrontmatter` says `null` for exactly that case (CONTRACT-005, extended by
 * the SERVER-005 escalation). No epoch sentinel: substituting `1970-01-01` made
 * one file read two different ages through `GET /api/docs` and
 * `GET /api/docs/{id}`.
 */
export function wireFrontmatter(row: DocumentRow, parsed: ParsedDocument): DocFrontmatter {
  const data = parsed.data;
  const created = asText(data["created"]);
  const updated = asText(data["updated"]);
  const due = asText(data["due"]);
  const reviewed = asText(data["reviewed"]);
  const tags: unknown = data["tags"];
  return {
    // Identity, type and status come from the row: a document root can override
    // all three (§7's skills), and the row is what every list already agrees on.
    id: row.id,
    type: row.type,
    title: asText(data["title"]) ?? asText(data["name"]) ?? row.title,
    created: created === null ? null : normalizeInstant(created),
    updated: updated === null ? null : normalizeInstant(updated),
    tags: Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === "string") : [],
    status: row.status,
    anchors: readAnchorsMap(data["anchors"]),
    due: due === null ? null : normalizeCalendarDate(due),
    reviewed: reviewed === null ? null : normalizeInstant(reviewed),
    evergreen: data["evergreen"] === true,
    // §11's view keys and §12's plugin keys, read by the same functions the
    // projection uses for the list row (CONTRACT-011). Shared rather than
    // restated for the reason the nullable timestamps above document: one file
    // read through two routes must not answer two different things.
    ...readViewFrontmatter(data),
  };
}

type AnchorThreadRow = { readonly anchor_id: string; readonly id: string; readonly status: string };

/**
 * Resolve every anchor of a document against its current body — the exactness
 * tier of the §6 ladder, rungs 1–2, and deliberately not rung 3
 * (sprint-003 Adjudication 1; SERVER-055 wired the fuzzy rung in here and was
 * reverted, see `anchors/resolve.ts`).
 *
 * A reader holds one body. It cannot see what an edit did, and rung 3's
 * similarity score is evidence of survival only for a caller that can: in a
 * list, a table or a boilerplate template the passage most similar to a deleted
 * item is its surviving sibling, with near-identical neighbours to match, so
 * neither the quote nor its declared context separates "edited in place" from
 * "deleted, and this is what is left". Wired in, the rung landed threads on the
 * neighbouring bullet, the next table row and the parallel paragraph — the
 * silent misattachment §6 forbids, and worse than the detachment it was meant
 * to spare the reader. `resolveAnchorExact` reports orphaned instead, which is
 * §6's stated answer whenever survival cannot be proved.
 *
 * The cost is real and known: an anchor whose quote was edited under it reads
 * detached until the next save's reconciliation — which *does* hold a diff —
 * rewrites the selector to the bytes on the page, after which rung 1 carries it
 * (see the round trip in `read.test.ts`). Three states never get that save: a
 * selector that never byte-matched (UI-068), an out-of-band edit inside the
 * watcher's debounce, and a thread document whose turns changed. They read
 * orphaned, visibly, with the selector intact.
 *
 * An anchor entry no thread claims is omitted rather than reported with a
 * fabricated thread id: `ResolvedAnchor` requires one. §14 already reports the
 * dangling entry as a hard `anchor-unused` failure.
 */
export function resolveDocumentAnchors(
  projection: ProjectionDb,
  docId: string,
  parsed: ParsedDocument,
): ResolvedAnchor[] {
  const anchors = readAnchorsMap(parsed.data["anchors"]);
  const ids = Object.keys(anchors).sort();
  if (ids.length === 0) return [];

  const threads = projection
    .prepare(
      "SELECT anchor_id, id, status FROM threads WHERE parent_id = ? AND anchor_id IS NOT NULL",
    )
    .all(docId) as AnchorThreadRow[];
  const byAnchor = new Map(threads.map((thread) => [thread.anchor_id, thread]));

  const resolved: ResolvedAnchor[] = [];
  for (const anchorId of ids) {
    const selector = anchors[anchorId];
    const thread = byAnchor.get(anchorId);
    if (selector === undefined || thread === undefined) continue;
    const range = resolveAnchorExact(parsed.body, selector);
    resolved.push({
      anchorId,
      selector,
      threadId: thread.id,
      // The `threads` row carries the document status, whose third value
      // (`archived`) is not a thread state; an archived thread is still an
      // unresolved conversation.
      threadStatus: (thread.status === "resolved" ? "resolved" : "open") satisfies ThreadStatus,
      range,
      orphaned: range === null,
    });
  }
  return resolved;
}

/** The `Doc` body of every read and every mutation response. */
export function toWireDoc(projection: ProjectionDb, loaded: LoadedDocument): Doc {
  return {
    frontmatter: wireFrontmatter(loaded.row, loaded.parsed),
    body: loaded.parsed.body,
    path: loaded.path,
    anchors: resolveDocumentAnchors(projection, loaded.row.id, loaded.parsed),
  };
}
