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
  type Actor,
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
import { documentTitle } from "../core/title.js";
import {
  readBoardFrontmatter,
  readStage,
  type BoardFrontmatter,
} from "../core/board-frontmatter.js";
import { referencedIds } from "../core/refs.js";
import { normalizeCalendarDate, normalizeInstant } from "../core/time.js";
import { turnModelsOf } from "../core/turn-model.js";
import { parseThreadBody, type TurnAuthor } from "../core/turns.js";
import { toIndexableText } from "../docs/fts.js";
import {
  deleteDocumentChunks,
  insertChunkRows,
  turnHeadingFor,
  turnRef,
  type ChunkablePassage,
} from "../semantic/index.js";
import type { ProjectionDb } from "./db.js";
import { classifyPath, workspaceRelativePath, SKILL_FILENAME, type DocumentRoot } from "./roots.js";
import { originOrNull } from "../core/provenance.js";
import { DEFAULT_LAST_ACTOR } from "./last-actor.js";
import { storedResident } from "../core/resident.js";

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
  /** SPEC.md §7 scope / §9.2 provenance: the thread this document came from, or null. */
  readonly origin: string | null;
  readonly anchors: Record<string, TextQuoteSelector>;
  /** SPEC.md §5's workflow position, or null (rider 5, 2026-08-22). */
  readonly stage: string | null;
  /**
   * The §10 view and board keys, plus every frontmatter key the core does not
   * define, read by the same functions `docs/read.ts` uses — so a row and a
   * single-document read can never describe one file's frontmatter differently
   * (CONTRACT-011, CONTRACT-074).
   */
  readonly board: BoardFrontmatter;
};

/**
 * Read the frontmatter field by field rather than through
 * `validateFrontmatter`: §7's skill and agent-definition roots legitimately
 * carry files with no Corpus fields at all, and one invalid optional must never
 * cost a document its row. Validation *reporting* is `doc check`'s job (§11) —
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
  const type = resolveDocumentType(root, data);
  const board = readBoardFrontmatter(data);

  return {
    id,
    type,
    title: documentTitle(data, titleFromPath(root, relativePath)),
    status: resolveDocumentStatus(root, data),
    tags: tags.success ? tags.data : [],
    created: asInstant(data["created"]),
    updated: asInstant(data["updated"]),
    due: asCalendarDate(data["due"]),
    reviewed: asInstant(data["reviewed"]),
    evergreen: data["evergreen"] === true,
    origin: originOrNull(data["origin"]),
    anchors: readAnchors(data["anchors"]),
    stage: readStage(data),
    board,
  };
}

/**
 * A document's `type`: the one its root fixes (§7's threads, skills and
 * personas), else the one its frontmatter states, else `note`. The frontmatter's
 * answer is taken verbatim and never checked against a list — §5 leaves `type`
 * an open string, so a workspace may hold a value this build has never heard of.
 */
function resolveDocumentType(root: DocumentRoot, data: Readonly<Record<string, unknown>>): string {
  return root.type ?? asString(data["type"]) ?? "note";
}

/**
 * §5's `status`: the one its root fixes (§7), else the one its frontmatter
 * states, else `open`.
 *
 * The root outranks the file because a `SKILL.md` under
 * `.claude/skills-archived/` is archived because of where it sits, whatever its
 * frontmatter says. The projection is where this belongs — `docs/read.ts` takes
 * the row's status for the wire document, so a single-document read, a
 * collection query, a saved view and the board all get this one answer and
 * cannot differ.
 */
function resolveDocumentStatus(
  root: DocumentRoot,
  data: Readonly<Record<string, unknown>>,
): DocStatus {
  if (root.status !== null) return root.status;
  const parsed = DocStatusSchema.safeParse(data["status"]);
  return parsed.success ? parsed.data : "open";
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
 * for the row's second line (SPEC.md §10) and must do it by the same rule —
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
    // Chunk rows go the same way — but `chunk_embeddings` deliberately does
    // not: it is keyed by content-addressed chunk id, so an edit that leaves a
    // section's bytes alone leaves its embedding attached (§9.1).
    deleteDocumentChunks(db, existing.id);
  }
  db.prepare("DELETE FROM documents WHERE path = ?").run(path);
  db.prepare("DELETE FROM file_hashes WHERE path = ?").run(path);
}

/**
 * The three board keys as the one JSON object `documents.board_json` holds, or
 * `null` for a document carrying none of them — which is nearly every document.
 *
 * NULL rather than `{}` so the column costs an ordinary note nothing, and so the
 * arbitration's `json_extract(board_json, '$.defaultOpen') = 1` reads a row that
 * genuinely carries board state. The keys are spelled the **wire** way, because
 * this object is what `docs/query.ts` puts on the row unchanged.
 */
export function boardJsonOf(board: BoardFrontmatter): string | null {
  if (board.columns === null && board.kanban === null && !board.defaultOpen) return null;
  return JSON.stringify({
    columns: board.columns,
    kanban: board.kanban,
    defaultOpen: board.defaultOpen,
  });
}

function insertDocumentRow(
  db: ProjectionDb,
  path: string,
  fields: DocumentFields,
  body: string,
  lastActor: Actor,
): void {
  db.prepare(
    `INSERT INTO documents
       (id, type, title, path, status, stage, last_actor, tags_json, created, updated, due,
        reviewed, evergreen, origin, body_excerpt, sort_order, query_json, board_json, extra_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    fields.id,
    fields.type,
    fields.title,
    path,
    fields.status,
    fields.stage,
    lastActor,
    JSON.stringify(fields.tags),
    fields.created,
    fields.updated,
    fields.due,
    fields.reviewed,
    fields.evergreen ? 1 : 0,
    fields.origin,
    bodyExcerpt(body),
    fields.board.order,
    fields.board.query === null ? null : JSON.stringify(fields.board.query),
    boardJsonOf(fields.board),
    // Always a JSON object, `{}` for a file with only core keys — the wire says
    // the field is present on every response, so the column is NOT NULL.
    JSON.stringify(fields.board.extra),
  );
}

/** The savepoint {@link withSpeculativeDocumentRow} opens; never nested. */
const SPECULATION_SAVEPOINT = "corpus_speculate";

/**
 * Runs `read` with the `documents` row this **not-yet-written** document would
 * have, and then throws that row away (SERVER-138).
 *
 * §5's coupling rule asks whether a document is "in a kanban", and §5 answers it
 * with the board's own scope query — a `GET /api/docs` filter set, compiled to
 * SQL over `documents`. A create has no row yet, and a save's row still holds
 * the *old* stage, so both would be asking the question about a document that
 * does not exist or has already moved on. The honest input is the document as
 * the write will leave it, and the honest way to ask a SQL question about it is
 * to let SQL see it.
 *
 * **This is what makes the coupling reuse the query compiler instead of
 * reimplementing the filter grammar.** The alternative — deciding scope
 * membership in TypeScript against the pending frontmatter — is a second
 * implementation of `docs/filters.ts` that would drift the first time somebody
 * adds a filter, and would answer a *different* question from the one
 * `GET /api/docs` answers for the very same board.
 *
 * A savepoint rather than a transaction, and rolled back in a `finally`: the row
 * must not survive a throw from `read`, and no caller is inside a transaction
 * when it asks (a write path speculates *before* `runMutation` opens one). Only
 * the `documents` row is written — no search rows, no chunks, no anchors — since
 * the filter builder reads `documents`, `threads` and `seen` and this document's
 * thread and read-state rows, where it has any, are already correct.
 *
 * A file with no projectable id runs `read` with the projection untouched, which
 * is the same answer that document gets from every other read path.
 */
export function withSpeculativeDocumentRow<T>(
  db: ProjectionDb,
  relativePath: string,
  parsed: ParsedDocument,
  read: () => T,
): T {
  const root = classifyPath(relativePath);
  const fields = root === null ? null : readDocumentFields(root, relativePath, parsed);
  if (fields === null) return read();

  db.sqlite.exec(`SAVEPOINT ${SPECULATION_SAVEPOINT}`);
  try {
    // Both, because either can collide: the row this path already has (a save),
    // and a row some other path holds under the same id (never, in practice, but
    // the PRIMARY KEY would refuse it rather than answer the question).
    db.prepare("DELETE FROM documents WHERE path = ? OR id = ?").run(relativePath, fields.id);
    insertDocumentRow(db, relativePath, fields, parsed.body, DEFAULT_LAST_ACTOR);
    return read();
  } finally {
    db.sqlite.exec(`ROLLBACK TO ${SPECULATION_SAVEPOINT}`);
    db.sqlite.exec(`RELEASE ${SPECULATION_SAVEPOINT}`);
  }
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
  const parentId = parent !== null && DocumentIdSchema.safeParse(parent).success ? parent : null;
  // §7's resident (SHARED-043, SERVER-109), through the one reader every path
  // asks — which also applies §7's standalone rule, so a `resident:` key on a
  // parented thread projects as nothing, exactly as it reads as nothing on the
  // wire. Stored verbatim: the id is re-resolved from the name at *read* time
  // (`threads/read.ts`), and a projection that pre-resolved it would answer a
  // different thing from the thread route about one file.
  //
  // **The row's designated flag is `resident !== null`, and the name is only the
  // profile** (SHARED-048, SERVER-121). Since a designation may name none, a
  // general residency reads back as `{name: null, docId: null}` — an object,
  // which is what makes this thread a lane — while a thread nobody designated
  // reads as `null`. The two are one `!== null` apart here and nowhere else, so
  // the flag and the profile can never disagree about one file.
  const resident = storedResident(data["resident"], parentId);

  db.prepare(
    `INSERT INTO threads
       (id, parent_id, status, agent, anchor_id, title, created, updated, turn_count, last_author,
        last_ts, resident_designated, resident_name, resident_doc_id, resident_weight)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    fields.id,
    parentId,
    fields.status,
    agent.success ? agent.data : "none",
    anchor !== null && AnchorIdSchema.safeParse(anchor).success ? anchor : null,
    fields.title,
    fields.created,
    fields.updated,
    turns.length,
    last?.author ?? null,
    last?.ts ?? null,
    resident === null ? 0 : 1,
    resident?.name ?? null,
    resident?.docId ?? null,
    // Verbatim (SERVER-129). NULL is "no level was chosen", which is both what a
    // designation written before §7's weight rider says and what one that chose
    // none says — there is one spelling of it on disk and one here.
    resident?.weight ?? null,
  );

  // `OR IGNORE`: the primary key is (thread_id, ts) because a turn's timestamp
  // is its identity (§6). A file with two turns at one instant is a §11 hard
  // failure that `doc check` reports; the projection keeps the first and does
  // not abort the document over it.
  const insertTurn = db.prepare(
    `INSERT OR IGNORE INTO turns (thread_id, idx, author, ts, body_md, has_form, form_answered, model)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // Which model wrote each turn (§6, §10, CONTRACT-043). The record is in the
  // thread's own frontmatter keyed by turn timestamp, so the join happens here
  // once and the board never reparses a file to draw it. `null` for a turn with
  // no entry — a person's, and one written before the record existed — which is
  // §10's nothing rather than a guess, and there is no branch here that could
  // produce anything else.
  const models = turnModelsOf(data);
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
      models[turn.ts] ?? null,
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
    // The §6 exactness tier, exactly as `docs/read.ts` runs it. This column is
    // what `corpus thread context` calls a thread anchored or orphaned; the
    // wire `Doc.anchors` is what the board draws. One definition of "resolves",
    // or the agent is told a thread is detached while the reader highlights it
    // — so this call and the reader's must stay the same call. NULL is the
    // §9.1 orphan state. Rung 3 belongs to reconciliation alone: it scores
    // similarity, and a reader has no diff to turn similarity into evidence of
    // survival (`anchors/resolve.ts`).
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

/**
 * The passages a document contributes to the two search structures: its own
 * body — a thread's is only its preamble — followed by one per turn.
 *
 * Derived once and handed to both writers, because `search` and `chunks` must
 * agree about what a passage *is*. They share the `ref` key, and a hit chosen
 * by the first is addressed by the second (`semantic/address.ts`): a passage
 * one of them split differently would be a hit nothing could name.
 */
function indexablePassages(
  fields: DocumentFields,
  body: string,
  thread: ThreadProjection | null,
): ChunkablePassage[] {
  return [
    { ref: fields.id, kind: "doc", body: thread === null ? body : thread.preamble },
    ...(thread?.turns ?? []).map((turn): ChunkablePassage => ({
      ref: turnRef(fields.id, turn.ts),
      kind: "turn",
      body: turn.body,
      rootHeading: turnHeadingFor(turn.author, turn.ts),
    })),
  ];
}

function insertSearchRows(
  db: ProjectionDb,
  fields: DocumentFields,
  passages: readonly ChunkablePassage[],
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
  for (const passage of passages) {
    insert.run(
      passage.ref,
      passage.kind,
      fields.id,
      passage.kind === "doc" ? toIndexableText(fields.title) : "",
      toIndexableText(passage.body),
    );
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
export function projectDocument(
  db: ProjectionDb,
  absPath: string,
  /**
   * SPEC.md §4's acting party for the write this projection is of — what lands
   * in `documents.last_actor` (§9.1).
   *
   * Every caller knows it, and each knows a different thing. A write path passes
   * the actor its mutation carried. The watcher passes `user`, because a change
   * that arrived from outside the server was made by a person editing a file
   * (§4). A rebuild passes what git recorded (`./last-actor.ts`). The default is
   * `user` for the same reason those three converge on it: a change nobody
   * attributed to the agent is a person's.
   */
  lastActor: Actor = DEFAULT_LAST_ACTOR,
): ProjectionOutcome {
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
    // Every other way the filesystem can refuse — EACCES, EIO, a file too large
    // to read — is thrown, and that is deliberate: this function is called from
    // a write path (`docs/write.ts` projects inline before responding) where a
    // save that cannot read its own file back must fail loudly rather than
    // answer `200` over a row nobody derived. Whether a *boot* may survive the
    // same failure is a different question with a different answer, and it is
    // `populateFromFiles`'s to make (SERVER-064) — the store stays honest, the
    // reader decides the policy. Nothing is removed here: the rows this file
    // last produced still describe a file that exists.
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
    insertDocumentRow(db, relativePath, fields, parsed.body, lastActor);
    const thread =
      fields.type === "thread" ? projectThread(db, fields, parsed.data, parsed.body) : null;
    const anchors = insertAnchors(db, fields.id, fields, parsed.body);
    const links = insertLinks(db, fields.id, [
      parsed.body,
      ...(thread?.turns ?? []).map((turn) => turn.body),
    ]);
    const passages = indexablePassages(fields, parsed.body, thread);
    insertSearchRows(db, fields, passages);
    insertChunkRows(db, fields.id, fields.title, passages);
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
