// Per-document projection: one markdown file → its rows in every derived table
// (SPEC.md §9.1). Synchronous and transactional, so a write path can project
// inline before responding (read-your-write).
//
// Parsing goes exclusively through `core/` and anchor resolution exclusively
// through `anchors/`; this module maps their output onto columns and owns no
// format knowledge of its own.

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, dirname } from "node:path";
import {
  AnchorIdSchema,
  DocStatusSchema,
  DocumentIdSchema,
  TextQuoteSelectorSchema,
  ThreadAgentSchema,
  type DocStatus,
  type TextQuoteSelector,
} from "@corpus/contract";
import { z } from "zod";
import { resolveAnchorExact } from "../anchors/index.js";
import { DocumentParseError, parseDocument, type ParsedDocument } from "../core/document.js";
import { readThreadForms } from "../core/form.js";
import { readViewFrontmatter, type ViewFrontmatter } from "../core/view-frontmatter.js";
import { referencedIds } from "../core/refs.js";
import { normalizeCalendarDate, normalizeInstant } from "../core/time.js";
import { parseThreadBody, type TurnAuthor } from "../core/turns.js";
import { toIndexableText } from "../docs/fts.js";
import type { ProjectionDb } from "./db.js";
import { classifyPath, workspaceRelativePath, SKILL_FILENAME, type DocumentRoot } from "./roots.js";

/** How much of the body a list row shows (§9.1 `body_excerpt`). */
export const EXCERPT_LENGTH = 280;

export type DocumentCounts = {
  readonly threads: number;
  readonly turns: number;
  readonly anchors: number;
  readonly links: number;
};

export type ProjectionOutcome =
  | {
      readonly kind: "projected";
      readonly path: string;
      readonly id: string;
      readonly counts: DocumentCounts;
    }
  /** The file is gone; its rows were removed. Never an error — deletion races are normal. */
  | { readonly kind: "removed"; readonly path: string }
  /** The file is a document but could not be projected; `reason` is operator-facing. */
  | { readonly kind: "skipped"; readonly path: string; readonly reason: string }
  /** The path is not under a document root — not a document at all. */
  | { readonly kind: "ignored"; readonly path: string };

const TagsSchema = z.array(z.string());

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

const asInstant = (value: unknown): string | null => {
  const text = asString(value);
  return text === null ? null : normalizeInstant(text);
};

const asCalendarDate = (value: unknown): string | null => {
  const text = asString(value);
  return text === null ? null : normalizeCalendarDate(text);
};

/**
 * A stable id for a skill or agent definition that carries none (§7 allows a
 * hand-written `SKILL.md` with only Claude Code's `name`/`description`).
 *
 * Derived from the workspace-relative path so it is identical across rebuilds
 * and across the incremental path. It is **doc-prefixed on purpose**: the issue
 * file's `skill_…` / `agentdef_…` spelling does not satisfy the contract's
 * `DocumentIdSchema` (`^(doc|th)_[A-Za-z0-9]+$`), and a row the contract cannot
 * serialize would fail every collection query that returned it. The readable
 * kind is kept inside the id, and `documents.type` remains the real
 * discriminator. Stamping a genuine id into the file is a write, and therefore
 * SERVER-005's business — never the projection's.
 */
export function syntheticDocumentId(root: DocumentRoot, relativePath: string): string {
  const digest = createHash("sha1").update(relativePath).digest("hex").slice(0, 8);
  return `doc_${root.idPrefix}${digest}`;
}

/** Folder name for `.../<name>/SKILL.md`, filename otherwise — the last-resort title. */
function titleFromPath(root: DocumentRoot, relativePath: string): string {
  const name = basename(relativePath);
  if (root.shape === "skill-tree" && name === SKILL_FILENAME) {
    const folder = basename(dirname(relativePath));
    if (folder !== "" && folder !== ".") return folder;
  }
  return name.replace(/\.md$/, "");
}

/**
 * Anchors, entry by entry rather than as a whole map: one malformed selector in
 * a hand-edited file must not detach every other thread on the document.
 */
function readAnchors(value: unknown): Record<string, TextQuoteSelector> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const anchors: Record<string, TextQuoteSelector> = {};
  for (const [key, selector] of Object.entries(value)) {
    if (!AnchorIdSchema.safeParse(key).success) continue;
    const parsed = TextQuoteSelectorSchema.safeParse(selector);
    if (parsed.success) anchors[key] = parsed.data;
  }
  return anchors;
}

type DocumentFields = {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly status: DocStatus;
  readonly tags: readonly string[];
  readonly created: string | null;
  readonly updated: string | null;
  readonly due: string | null;
  readonly reviewed: string | null;
  readonly evergreen: boolean;
  readonly anchors: Record<string, TextQuoteSelector>;
  /**
   * §11's view keys and §12's plugin keys, read by the same functions
   * `docs/read.ts` uses — so a row and a single-document read can never
   * describe one file's frontmatter differently (CONTRACT-011).
   */
  readonly view: ViewFrontmatter;
};

/**
 * Read the frontmatter field by field rather than through
 * `validateFrontmatter`: §7's skill and agent-definition roots legitimately
 * carry files with no Corpus fields at all, and one invalid optional must never
 * cost a document its row. Validation *reporting* is `doc check`'s job (§14) —
 * the projection's job is to index what is there.
 */
function readDocumentFields(
  root: DocumentRoot,
  relativePath: string,
  parsed: ParsedDocument,
): DocumentFields | null {
  const data = parsed.data;
  const declaredId = asString(data["id"]);
  const id =
    declaredId !== null && DocumentIdSchema.safeParse(declaredId).success
      ? declaredId
      : root.synthesizeId
        ? syntheticDocumentId(root, relativePath)
        : null;
  if (id === null) return null;

  const tags = TagsSchema.safeParse(data["tags"]);
  const status = DocStatusSchema.safeParse(data["status"]);

  return {
    id,
    type: root.type ?? asString(data["type"]) ?? "note",
    title: asString(data["title"]) ?? asString(data["name"]) ?? titleFromPath(root, relativePath),
    status: root.status ?? (status.success ? status.data : "open"),
    tags: tags.success ? tags.data : [],
    created: asInstant(data["created"]),
    updated: asInstant(data["updated"]),
    due: asCalendarDate(data["due"]),
    reviewed: asInstant(data["reviewed"]),
    evergreen: data["evergreen"] === true,
    anchors: readAnchors(data["anchors"]),
    view: readViewFrontmatter(data),
  };
}

/**
 * What id a file *would* be projected under, without projecting it. `doctor`
 * asks this about files that produced no row, to tell an unparseable document
 * from a duplicate id from a genuinely missing row. It goes through the same
 * {@link readDocumentFields} the projector uses, so the two can never disagree
 * about which file owns an id.
 */
export type DocumentIdentity =
  | { readonly kind: "id"; readonly id: string }
  | { readonly kind: "unparseable"; readonly reason: string }
  | { readonly kind: "no-id"; readonly reason: string };

export function readDocumentIdentity(
  root: DocumentRoot,
  relativePath: string,
  content: string,
): DocumentIdentity {
  let parsed: ParsedDocument;
  try {
    parsed = parseDocument(content, relativePath);
  } catch (error) {
    if (error instanceof DocumentParseError) return { kind: "unparseable", reason: error.message };
    throw error;
  }
  const fields = readDocumentFields(root, relativePath, parsed);
  return fields === null
    ? { kind: "no-id", reason: noIdReason(relativePath) }
    : { kind: "id", id: fields.id };
}

const noIdReason = (relativePath: string): string =>
  `${relativePath}: frontmatter carries no valid \`id\` (expected doc_… or th_…)`;

/**
 * The leading `EXCERPT_LENGTH` characters of a body, from its first non-blank
 * character. Exported because the collection query excerpts a thread's last turn
 * for the row's second line (SPEC.md §11) and must do it by the same rule —
 * a row's document preview and its turn preview trim and truncate alike.
 */
export function bodyExcerpt(body: string): string {
  const start = body.search(/\S/);
  return start < 0 ? "" : body.slice(start, start + EXCERPT_LENGTH);
}

/** Removes every row derived from the document currently projected at `path`. */
function deleteRowsAtPath(db: ProjectionDb, path: string): void {
  const existing = db.prepare("SELECT id FROM documents WHERE path = ?").get(path) as
    { id: string } | undefined;
  if (existing !== undefined) {
    for (const sql of [
      "DELETE FROM threads WHERE id = ?",
      "DELETE FROM turns WHERE thread_id = ?",
      "DELETE FROM anchors WHERE doc_id = ?",
      "DELETE FROM links WHERE from_id = ?",
      "DELETE FROM search WHERE doc_id = ?",
    ]) {
      db.prepare(sql).run(existing.id);
    }
  }
  db.prepare("DELETE FROM documents WHERE path = ?").run(path);
  db.prepare("DELETE FROM file_hashes WHERE path = ?").run(path);
}

function insertDocumentRow(
  db: ProjectionDb,
  path: string,
  fields: DocumentFields,
  body: string,
): void {
  db.prepare(
    `INSERT INTO documents
       (id, type, title, path, status, tags_json, created, updated, due, reviewed, evergreen,
        body_excerpt, pinned, sort_order, query_json, column_ref, extra_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    fields.id,
    fields.type,
    fields.title,
    path,
    fields.status,
    JSON.stringify(fields.tags),
    fields.created,
    fields.updated,
    fields.due,
    fields.reviewed,
    fields.evergreen ? 1 : 0,
    bodyExcerpt(body),
    fields.view.pinned ? 1 : 0,
    fields.view.order,
    fields.view.query === null ? null : JSON.stringify(fields.view.query),
    fields.view.column,
    // Always a JSON object, `{}` for a file with only core keys — the wire says
    // the field is present on every response, so the column is NOT NULL.
    JSON.stringify(fields.view.extra),
  );
}

type ThreadProjection = {
  readonly turns: readonly { author: TurnAuthor; ts: string; body: string }[];
  /** Text of the thread file that is not inside a turn — indexed as the thread's own body. */
  readonly preamble: string;
};

function projectThread(
  db: ProjectionDb,
  fields: DocumentFields,
  data: Readonly<Record<string, unknown>>,
  body: string,
): ThreadProjection {
  const { preamble, turns } = parseThreadBody(body);
  const parent = asString(data["parent"]);
  const anchor = asString(data["anchor"]);
  const agent = ThreadAgentSchema.safeParse(data["agent"]);
  const last = turns.at(-1);

  db.prepare(
    `INSERT INTO threads
       (id, parent_id, status, agent, anchor_id, title, created, updated, turn_count, last_author, last_ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    fields.id,
    parent !== null && DocumentIdSchema.safeParse(parent).success ? parent : null,
    fields.status,
    agent.success ? agent.data : "none",
    anchor !== null && AnchorIdSchema.safeParse(anchor).success ? anchor : null,
    fields.title,
    fields.created,
    fields.updated,
    turns.length,
    last?.author ?? null,
    last?.ts ?? null,
  );

  // `OR IGNORE`: the primary key is (thread_id, ts) because a turn's timestamp
  // is its identity (§6). A file with two turns at one instant is a §14 hard
  // failure that `doc check` reports; the projection keeps the first and does
  // not abort the document over it.
  const insertTurn = db.prepare(
    `INSERT OR IGNORE INTO turns (thread_id, idx, author, ts, body_md, has_form, form_answered)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  // §6's form grammar, decided here rather than in the `needs=form` SQL: the
  // fence is a regex over the info string and its contents must parse as a form,
  // and a SQL approximation of that is what SERVER-029 fixed. Which of those
  // forms is still *unanswered* is the same kind of question — pairing an answer
  // turn with a form means matching the option it names against that form's
  // options — so it is decided here too, in one pass over the thread
  // (SERVER-032). One reader, `core/form.ts`, answers here and on the answer
  // route.
  const forms = readThreadForms(turns);
  turns.forEach((turn, index) => {
    const state = forms[index];
    // `answered` is already `boolean | null` — `null` for every turn that is not
    // an agent turn carrying a form — so the column is that value in SQLite's
    // vocabulary, and a missing state (impossible: one per turn, by
    // construction) reads as the same "nothing to answer here".
    const answered = state?.answered ?? null;
    insertTurn.run(
      fields.id,
      index,
      turn.author,
      turn.ts,
      turn.body,
      state?.hasForm === true ? 1 : 0,
      answered === null ? null : Number(answered),
    );
  });

  return { turns, preamble };
}

function insertLinks(db: ProjectionDb, fromId: string, texts: readonly string[]): number {
  const targets = new Set<string>();
  for (const text of texts) {
    for (const id of referencedIds(text)) targets.add(id);
  }
  const insert = db.prepare("INSERT OR IGNORE INTO links (from_id, to_id) VALUES (?, ?)");
  for (const target of [...targets].sort()) insert.run(fromId, target);
  return targets.size;
}

function insertAnchors(
  db: ProjectionDb,
  docId: string,
  fields: DocumentFields,
  body: string,
): number {
  const insert = db.prepare(
    `INSERT INTO anchors (doc_id, anchor_id, exact_text, prefix, suffix, resolved_offset)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const ids = Object.keys(fields.anchors).sort();
  for (const anchorId of ids) {
    const selector = fields.anchors[anchorId];
    if (selector === undefined) continue;
    // Sprint-003 Adjudication 1: **exact-only**, never the full ladder. Fuzzy is
    // the rung that finds a deleted bullet's look-alike sibling, and re-running
    // it here would reintroduce at render time exactly the misattachment the
    // reconciler was fixed to prevent (SERVER-002 rounds 2–3). NULL when the
    // selector no longer resolves verbatim — the §9.1 orphan state.
    const range = resolveAnchorExact(body, selector);
    insert.run(
      docId,
      anchorId,
      selector.exact,
      selector.prefix,
      selector.suffix,
      range?.start ?? null,
    );
  }
  return ids.length;
}

function insertSearchRows(
  db: ProjectionDb,
  fields: DocumentFields,
  body: string,
  thread: ThreadProjection | null,
): void {
  const insert = db.prepare(
    "INSERT INTO search (ref, kind, doc_id, title, body) VALUES (?, ?, ?, ?, ?)",
  );
  // A thread's document row indexes only its preamble: its turns are indexed as
  // their own rows, and indexing the whole file as well would return two hits
  // for one occurrence of a word (§9.1 lists titles, bodies and turn bodies as
  // three sources, not four).
  //
  // Every indexed column goes through `toIndexableText`: the snippet delimiters
  // are the FTS layer's own markup, and text that carries them would come back
  // from `snippet()` marked as a hit the query never produced (SERVER-022
  // finding 11). The file itself keeps its bytes.
  insert.run(
    fields.id,
    "doc",
    fields.id,
    toIndexableText(fields.title),
    toIndexableText(thread === null ? body : thread.preamble),
  );
  for (const turn of thread?.turns ?? []) {
    insert.run(`${fields.id}#${turn.ts}`, "turn", fields.id, "", toIndexableText(turn.body));
  }
}

function recordFileHash(
  db: ProjectionDb,
  path: string,
  content: Buffer,
  size: number,
  mtimeMs: number,
): void {
  db.prepare(
    "INSERT OR REPLACE INTO file_hashes (path, hash, size, mtime_ms) VALUES (?, ?, ?, ?)",
  ).run(path, hashContent(content), size, mtimeMs);
}

/** The content hash `doctor` compares against — SHA-1 over the file's bytes. */
export function hashContent(content: Buffer): string {
  return createHash("sha1").update(content).digest("hex");
}

/**
 * Project one document file, replacing every row derived from it.
 *
 * Delete-then-insert rather than a diff: a document's rows span six tables and
 * an id may change under a stable path, so a diffing engine would be a second
 * implementation of the same mapping with twice the ways to go stale.
 */
export function projectDocument(db: ProjectionDb, absPath: string): ProjectionOutcome {
  const relativePath = workspaceRelativePath(db.config.workspaceRoot, absPath);
  if (relativePath === null) return { kind: "ignored", path: absPath };
  const root = classifyPath(relativePath);
  if (root === null) return { kind: "ignored", path: relativePath };

  let content: Buffer;
  let size: number;
  let mtimeMs: number;
  try {
    const stats = statSync(absPath);
    size = stats.size;
    mtimeMs = Math.trunc(stats.mtimeMs);
    content = readFileSync(absPath);
  } catch (error) {
    // A file that vanished between enumeration and read is a removal, not a
    // failure — the watcher and the rebuild both race real editors.
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      removeDocument(db, absPath);
      return { kind: "removed", path: relativePath };
    }
    throw error;
  }

  let parsed: ParsedDocument;
  try {
    parsed = parseDocument(content.toString("utf8"), relativePath);
  } catch (error) {
    if (error instanceof DocumentParseError) {
      return { kind: "skipped", path: relativePath, reason: error.message };
    }
    throw error;
  }

  const fields = readDocumentFields(root, relativePath, parsed);
  if (fields === null) {
    return { kind: "skipped", path: relativePath, reason: noIdReason(relativePath) };
  }

  const holder = db.prepare("SELECT path FROM documents WHERE id = ?").get(fields.id) as
    { path: string } | undefined;
  if (holder !== undefined && holder.path !== relativePath) {
    // Duplicate ids resolve by path order, identically on the incremental path
    // and in a rebuild (which projects in sorted order, so this branch is the
    // incremental path converging on the same answer).
    if (holder.path < relativePath) {
      return {
        kind: "skipped",
        path: relativePath,
        reason: `duplicate id ${fields.id}, already projected from ${holder.path}`,
      };
    }
    deleteRowsAtPath(db, holder.path);
  }

  const run = db.transaction(() => {
    deleteRowsAtPath(db, relativePath);
    insertDocumentRow(db, relativePath, fields, parsed.body);
    const thread =
      fields.type === "thread" ? projectThread(db, fields, parsed.data, parsed.body) : null;
    const anchors = insertAnchors(db, fields.id, fields, parsed.body);
    const links = insertLinks(db, fields.id, [
      parsed.body,
      ...(thread?.turns ?? []).map((turn) => turn.body),
    ]);
    insertSearchRows(db, fields, parsed.body, thread);
    recordFileHash(db, relativePath, content, size, mtimeMs);
    return {
      threads: thread === null ? 0 : 1,
      turns: thread?.turns.length ?? 0,
      anchors,
      links,
    } satisfies DocumentCounts;
  });

  return { kind: "projected", path: relativePath, id: fields.id, counts: run() };
}

/** Removes every row derived from the document at `absPath`. Idempotent. */
export function removeDocument(db: ProjectionDb, absPath: string): ProjectionOutcome {
  const relativePath = workspaceRelativePath(db.config.workspaceRoot, absPath);
  if (relativePath === null) return { kind: "ignored", path: absPath };
  db.transaction(() => {
    deleteRowsAtPath(db, relativePath);
  })();
  return { kind: "removed", path: relativePath };
}
