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
import { DocumentParseError, parseDocument, type ParsedDocument } from "../core/index.js";
import { normalizeCalendarDate, normalizeInstant } from "../core/time.js";
import { internalError, notFound } from "../errors.js";
import type { ProjectionDb } from "../projection/index.js";

/**
 * What `created`/`updated` say when the file carries neither.
 *
 * CONTRACT-005 made the **row**'s timestamps nullable (sprint-005 Open Conflict
 * 11) and `query.ts` now passes `null` straight through. `DocFrontmatter` was
 * deliberately *not* changed with it — its own comment says "only the row is
 * nullable … a document the server writes is always stamped" — so this shape
 * still has to produce a string, and only an epoch sentinel is available.
 *
 * The split is real and visible: a hand-written `SKILL.md` reads as `null` from
 * `GET /api/docs` and as this sentinel from `GET /api/docs/{id}`. Closing it
 * means making `DocFrontmatterSchema.created`/`updated` nullable, which is a
 * contract change and not this issue's to make. ESCALATED — see SERVER-005's
 * E2E log.
 */
const UNDATED_INSTANT = "1970-01-01T00:00:00Z";

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

/** True when some document already claims this id — the `newId` collision predicate. */
export function isIdTaken(projection: ProjectionDb, id: string): boolean {
  return findDocumentRow(projection, id) !== null;
}

/**
 * Read the document `id` names, or throw the contract's 404. A row whose file
 * vanished under it is a 404 as well: the projection is derived state and racing
 * an external `rm` is normal, not a server fault.
 */
export function loadDocument(
  workspaceRoot: string,
  projection: ProjectionDb,
  id: string,
): LoadedDocument {
  const row = findDocumentRow(projection, id);
  if (row === null) throw notFound(`no document with id ${id}`);
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
 * `created`/`updated` fall back to {@link UNDATED_INSTANT} — see that constant
 * for why this shape cannot say `null` the way the collection query now can.
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
    created: (created === null ? null : normalizeInstant(created)) ?? UNDATED_INSTANT,
    updated: (updated === null ? null : normalizeInstant(updated)) ?? UNDATED_INSTANT,
    tags: Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === "string") : [],
    status: row.status,
    anchors: readAnchorsMap(data["anchors"]),
    due: due === null ? null : normalizeCalendarDate(due),
    reviewed: reviewed === null ? null : normalizeInstant(reviewed),
    evergreen: data["evergreen"] === true,
  };
}

type AnchorThreadRow = { readonly anchor_id: string; readonly id: string; readonly status: string };

/**
 * Resolve every anchor of a document against its current body (SPEC.md §6).
 *
 * **Exact rungs only**, matching what the projection stores in `anchors`
 * (sprint-003 Adjudication 1): running fuzzy at render time would re-attach a
 * deleted paragraph's look-alike sibling and put a thread's highlight on text
 * nobody commented on — exactly the misattachment SERVER-002/012/013 were fixed
 * to prevent. Reconciliation already rewrites `exact` on every save, so the
 * fuzzy rung would only ever fire on an out-of-band edit the watcher has not
 * reconciled yet, and it would fire wrong.
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
