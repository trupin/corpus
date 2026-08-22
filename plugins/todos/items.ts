import { z } from "zod";

/**
 * **The one module that knows what a todo item is.**
 *
 * SPEC.md §12 (as amended 2026-07-30) settles the format: items are **checkbox
 * lines in the document body** — standard GFM task-list items (`- [ ] text` /
 * `- [x] text`), in body order, each optionally carrying `(due: YYYY-MM-DD)` at
 * the **end** of its line. This module is that format's parser and serializer;
 * every other file in the plugin goes through it and none of them knows what a
 * line looks like.
 *
 * **Why the body and not frontmatter** (PLUGINS-003, Candidate 3): an item's
 * text has to *be* body text for a comment on it to be an ordinary §6
 * text-quote anchor. Nothing else about anchoring changes — there is simply
 * nothing special about an item any more. PLUGINS-002's `extra.items` array is
 * therefore reversed, and {@link planWrite} is the transition (see
 * {@link LEGACY_ITEMS_KEY}).
 *
 * **The plugin now shares the body with the user, so this module edits lines,
 * never documents.** A serializer that rewrote the body from a parsed model
 * would reformat prose, re-wrap paragraphs and eat fenced code the first time
 * anyone checked a box. Every mutation here therefore rebuilds exactly the one
 * line it owns and splices it back: a toggle leaves the rest of the file
 * byte-identical, including indentation, bullet character, inner spacing and
 * the final newline. Content is only re-rendered when the item's own text or
 * due date actually changed.
 *
 * **What is not an item**: a line inside a fenced code block (a fence is
 * tracked, so a `- [ ]` in an example is example text), a line inside an
 * *indented* code block (four columns of indent with no list open above it), a
 * checkbox with no content, and anything that is not a list bullet followed by
 * `[ ]`/`[x]`. `*` and `+` bullets are *read* as items because GFM writes them;
 * the plugin only ever *writes* `- `, which is also what the core editor's
 * serializer emits, so a round trip through the editor does not rewrite these
 * lines.
 *
 * **Nested task lists are read flat**, in body order. A child item is an item
 * like any other: it is the third line in the document, so it is item 3 to
 * `corpus todos check`, and the aggregate column counts it once. Nothing
 * re-nests it either — every mutation rewrites exactly the one line it owns, so
 * the indentation that made it a child survives a check, a rename and a delete
 * untouched. The plugin has no model of a subtask and deliberately does not
 * invent one (SPEC.md §12 describes a list of items, not a tree).
 *
 * Nothing in here touches the filesystem, the network or React — it is data,
 * in and out. Per-item `ts` is gone (SHARED-005 A1(c)): body order is the
 * order, and a toggle cannot move it because a toggle edits one character.
 */

/**
 * The frontmatter key items lived in before PLUGINS-005.
 *
 * Read, never written: a document that still carries it is *unmigrated*, and
 * the first write through this plugin (or `corpus todos migrate`) folds its
 * items into the body and removes the key — a document with items in two
 * places is a document where the two can disagree.
 */
export const LEGACY_ITEMS_KEY = "items";

/** An ISO calendar date, `YYYY-MM-DD` — the only shape `due` may take. */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const TodoItemSchema = z.object({
  text: z.string().min(1, "must be a non-empty string"),
  done: z.boolean(),
  /** Optional deadline; the only optional field in v1. */
  due: z.string().regex(ISO_DATE_PATTERN, "must be an ISO calendar date (YYYY-MM-DD)").optional(),
});

export type TodoItem = z.infer<typeof TodoItemSchema>;

/**
 * The legacy frontmatter array. `ts` is accepted and **dropped** — Zod objects
 * strip unknown keys, and a pre-PLUGINS-005 document carries one on every item.
 */
export const TodoItemsSchema = z.array(TodoItemSchema);

/** What {@link readItems} answers: the items, or why they could not be read. */
export type ItemsRead =
  | { readonly ok: true; readonly items: readonly TodoItem[] }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * Where this module reads items from: the body, plus the legacy frontmatter a
 * not-yet-migrated document may still carry.
 *
 * A list row satisfies it structurally through `extra` alone — which is exactly
 * why the row surfaces cannot see body items and are re-sourced in PLUGINS-007.
 */
export interface ItemsSource {
  readonly body?: string | undefined;
  readonly extra?: Readonly<Record<string, unknown>> | undefined;
}

/** The shape of a `Doc` this module needs — stated structurally, never imported. */
export interface TodoDocLike {
  readonly body: string;
  readonly frontmatter: { readonly extra?: Readonly<Record<string, unknown>> | undefined };
}

/** A whole document, as an {@link ItemsSource}: its body and its legacy key. */
export function docSource(doc: TodoDocLike): ItemsSource {
  return { body: doc.body, extra: doc.frontmatter.extra };
}

// ---------------------------------------------------------------------------
// The line format
// ---------------------------------------------------------------------------

/**
 * `- [ ] text` at any indent. `[^\n]` rather than `.` so a CRLF document's
 * trailing `\r` is captured as trailing whitespace instead of failing to match.
 */
const TASK_LINE = /^([ \t]*)([-*+])([ \t]+)\[([ xX])\]([ \t]+)([^\n]*)$/;

/** An opening or closing code fence — everything between two of them is text. */
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})([^\n]*)$/;

/**
 * Any list marker — a bullet or an ordered number. What *opens a list context*,
 * which is the difference between an indented item and indented code.
 */
const LIST_LINE = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;

/** A line's leading whitespace, measured by {@link indentWidth}. */
const LEADING_SPACE = /^[ \t]*/;

/** CommonMark's indented-code threshold, in columns. */
const CODE_INDENT = 4;

/** `(due: 2026-08-01)` at the very end of an item's text, after real content. */
const DUE_MARKER = /^([^\n]*\S)[ \t]+\(due:[ \t]*(\d{4}-\d{2}-\d{2})\)$/;

/** Trailing spaces, tabs and a CR — preserved verbatim across every edit. */
const TRAILING_SPACE = /[ \t\r]*$/;

/** The canonical bullet the plugin writes. Reads accept `*` and `+` too. */
const BULLET = "- ";

/** One parsed task line: the item, and the bytes needed to rewrite just it. */
interface ItemLine {
  /** Index into the body's `\n`-split lines. */
  readonly at: number;
  readonly indent: string;
  readonly bullet: string;
  readonly afterBullet: string;
  readonly mark: string;
  readonly afterMark: string;
  /** The item's text and due marker exactly as written, trailing space removed. */
  readonly content: string;
  readonly trailing: string;
  readonly item: TodoItem;
}

/** The item text a line should carry — the inline due marker lives here. */
function contentFor(item: TodoItem): string {
  return item.due === undefined ? item.text : `${item.text} (due: ${item.due})`;
}

/**
 * Rewrites one line for a new item value.
 *
 * The mark is only replaced when `done` changed and the content only when the
 * text or the date changed, so a check leaves every other byte of the line —
 * including odd inner spacing a user typed — exactly where it was.
 */
function renderLine(line: ItemLine, next: TodoItem): string {
  const mark = next.done === line.item.done ? line.mark : next.done ? "x" : " ";
  const content =
    next.text === line.item.text && next.due === line.item.due ? line.content : contentFor(next);
  return `${line.indent}${line.bullet}${line.afterBullet}[${mark}]${line.afterMark}${content}${line.trailing}`;
}

/** A brand-new line, always canonical: `- [ ] text (due: …)`. */
function newLine(item: TodoItem): string {
  return `${BULLET}[${item.done ? "x" : " "}] ${contentFor(item)}`;
}

/**
 * Splits an item's content into its text and its inline due date.
 *
 * Tolerant in both directions, per SPEC.md §12: the marker is recognised only
 * at the very end of the line and only as a real ISO date, and anything that
 * fails either test is ordinary item text — never an error, never rewritten.
 */
function parseContent(content: string): { readonly text: string; readonly due?: string } {
  const marker = DUE_MARKER.exec(content);
  if (marker === null) return { text: content };
  return { text: String(marker[1]), due: String(marker[2]) };
}

/** A line's indent in columns; a tab advances to the next multiple of four. */
function indentWidth(raw: string): number {
  let width = 0;
  for (const char of String(LEADING_SPACE.exec(raw)?.[0] ?? "")) {
    width = char === "\t" ? width + CODE_INDENT - (width % CODE_INDENT) : width + 1;
  }
  return width;
}

/**
 * The index of the line that closes the fence opened at `open`, or `null` when
 * nothing in the rest of the document does.
 *
 * Looked **ahead** rather than tracked as state, because the answer changes what
 * the opening line meant: a fence that never closes is a typo, and treating it
 * as a code block would silently swallow every item below it for the rest of the
 * document (FIX 7 — the editor still shows the checkboxes, and the panel says
 * `0 open`). Bounded to its own line instead, the typo costs one line.
 */
function fenceEnd(lines: readonly string[], open: number, marker: string): number | null {
  for (let at = open + 1; at < lines.length; at += 1) {
    const fenced = FENCE.exec(String(lines[at]));
    if (fenced === null) continue;
    const closer = String(fenced[1]);
    // A closing run is the same character, at least as long, and carries no
    // info string — which is what makes ```` ``` ```` inside ```` ```` ```` text.
    if (
      closer.startsWith(marker.slice(0, 1)) &&
      closer.length >= marker.length &&
      String(fenced[2]).trim() === ""
    ) {
      return at;
    }
  }
  return null;
}

/** One task line, or `null` for a line that is not one. */
function parseTaskLine(raw: string, at: number): ItemLine | null {
  const match = TASK_LINE.exec(raw);
  if (match === null) return null;
  const rest = String(match[6]);
  const trailing = String(TRAILING_SPACE.exec(rest)?.[0] ?? "");
  const content = rest.slice(0, rest.length - trailing.length);
  // `- [ ]` with nothing after it is a checkbox the user is still typing, not
  // an item: it has no text to name, to comment on, or to check off.
  if (content === "") return null;
  const mark = String(match[4]);
  const parsed = parseContent(content);
  return {
    at,
    indent: String(match[1]),
    bullet: String(match[2]),
    afterBullet: String(match[3]),
    mark,
    afterMark: String(match[5]),
    content,
    trailing,
    // Field order is `text, done, due` everywhere — the same shape the CLI's
    // `--json` prints, so a route response and a verb's output read alike.
    item: {
      text: parsed.text,
      done: mark !== " ",
      ...(parsed.due === undefined ? {} : { due: parsed.due }),
    },
  };
}

/**
 * Every task line in a body, in body order, skipping both kinds of code block.
 *
 * **Fenced code** is CommonMark-shaped: a run of three or more backticks or
 * tildes opens, and a run of the same character at least as long with nothing
 * after it closes. That is what separates “an item” from “an example of an
 * item” (TEST-477), and a regex without it would check off a line inside a code
 * block. A fence that is never closed is bounded to its own line — see
 * {@link fenceEnd}.
 *
 * **Indented code** needs the one piece of block context this parser keeps: a
 * line indented four columns or more is a code line *unless a list is open
 * above it*, in which case it is that list's nested item. Without the
 * distinction, four-space-indented prose in a code block parses as an item
 * (FIX 8) and four-space-nested subtasks stop being items — the tracked list
 * indent is what lets both be right. A blank line does not close a list (a
 * loose list is still a list); prose at or left of the list's own indent does.
 */
function taskLines(body: string): readonly ItemLine[] {
  const lines = body.split("\n");
  const found: ItemLine[] = [];
  /** The indent of the shallowest open list, in columns; `null` outside one. */
  let list: number | null = null;

  for (let at = 0; at < lines.length; at += 1) {
    const raw = String(lines[at]);

    const fenced = FENCE.exec(raw);
    if (fenced !== null) {
      const end = fenceEnd(lines, at, String(fenced[1]));
      if (end !== null) at = end;
      continue;
    }

    if (raw.trim() === "") continue;

    const indent = indentWidth(raw);
    if (!LIST_LINE.test(raw)) {
      if (list !== null && indent <= list) list = null;
      continue;
    }
    if (list === null && indent >= CODE_INDENT) continue;
    list = list === null ? indent : Math.min(list, indent);

    const line = parseTaskLine(raw, at);
    if (line !== null) found.push(line);
  }
  return found;
}

/** The items a body carries, in body order. */
export function parseBodyItems(body: string): readonly TodoItem[] {
  return taskLines(body).map((line) => line.item);
}

/** Half-open character offsets into a body. */
export interface TextRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Where an item's **text** sits in the body, in characters — the span a person
 * selects when they select the item in the reader.
 *
 * It deliberately excludes everything that is not the item's words: the indent,
 * the bullet, the `[ ]` box and its spacing on the left, and the `(due: …)`
 * marker and any trailing whitespace on the right. That is what makes a
 * selector built from this range the *same* selector the reader's own
 * Comment-on-selection produces for the same item (SPEC.md §6, §12) — quoting
 * `- [ ] call the bank` instead of `call the bank` would anchor a thread to text
 * that changes the moment the box is checked.
 *
 * `null` when the body has no such item — a not-yet-migrated document whose
 * items are still in the legacy frontmatter key, or an index the list no longer
 * has.
 */
export function itemTextRange(body: string, index: number): TextRange | null {
  const line = taskLines(body)[index];
  if (line === undefined) return null;
  const lines = body.split("\n");
  let start = 0;
  // `+ 1` per line for the `\n` that `split` consumed.
  for (let at = 0; at < line.at; at += 1) start += String(lines[at]).length + 1;
  start += `${line.indent}${line.bullet}${line.afterBullet}[${line.mark}]${line.afterMark}`.length;
  return { start, end: start + line.item.text.length };
}

// ---------------------------------------------------------------------------
// Reading — body first, legacy frontmatter while a workspace is mid-transition
// ---------------------------------------------------------------------------

/** `items[2].done: expected boolean` — a message that names the offending field. */
function describeLegacyIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path
    .map((segment) =>
      typeof segment === "number" ? `[${String(segment)}]` : `.${String(segment)}`,
    )
    .join("");
  return `${LEGACY_ITEMS_KEY}${path}: ${issue.message}`;
}

/** `item.text: must be a non-empty string` — the same, for a single item. */
function describeItemIssue(issue: z.core.$ZodIssue): string {
  return `item.${issue.path.join(".")}: ${issue.message}`;
}

/** True when the document still carries the pre-PLUGINS-005 frontmatter key. */
export function hasLegacyItems(extra: Readonly<Record<string, unknown>> | undefined): boolean {
  return extra !== undefined && Object.hasOwn(extra, LEGACY_ITEMS_KEY);
}

/**
 * The legacy array, or `null` when the document never carried the key.
 *
 * `null` and `[]` are both an empty legacy list — the key is present, so it
 * still has to be cleared, but there is nothing to fold into the body.
 */
export function readLegacyItems(
  extra: Readonly<Record<string, unknown>> | undefined,
): ItemsRead | null {
  if (!hasLegacyItems(extra)) return null;
  const raw = extra?.[LEGACY_ITEMS_KEY];
  if (raw === null || raw === undefined) return { ok: true, items: [] };
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      problems: [`${LEGACY_ITEMS_KEY}: must be a list of items; found ${typeof raw}`],
    };
  }
  const parsed = TodoItemsSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, problems: parsed.error.issues.map(describeLegacyIssue) };
  }
  return { ok: true, items: parsed.data };
}

/**
 * The document's items, or why they could not be read.
 *
 * Precedence, stated once and relied on everywhere: a legacy key that cannot be
 * **parsed** is a problem regardless of the body — it is a hand-edit the user
 * has to fix, and hiding it behind a well-formed body would let a write refuse
 * for a reason nothing on screen explains. Otherwise the **body wins** whenever
 * it carries task lines, and the legacy key answers only for a document that
 * has not been migrated yet.
 */
export function readItems(source: ItemsSource | undefined): ItemsRead {
  const legacy = readLegacyItems(source?.extra);
  if (legacy !== null && !legacy.ok) return legacy;
  const items = parseBodyItems(source?.body ?? "");
  if (items.length > 0) return { ok: true, items };
  if (legacy !== null) return legacy;
  return { ok: true, items: [] };
}

/**
 * The items, or `[]` for a document whose items cannot be read.
 *
 * The list-row surfaces render across many documents at once, where one
 * malformed document must degrade to "no items" rather than to a notice in
 * someone else's row.
 */
export function itemsOrEmpty(source: ItemsSource | undefined): readonly TodoItem[] {
  const read = readItems(source);
  return read.ok ? read.items : [];
}

/**
 * The one clause the validator and the write refusal both say about a document
 * storing its items in two places, so the two can never drift apart.
 */
const DUAL_STORAGE = `carries items in its body *and* in its \`${LEGACY_ITEMS_KEY}\` frontmatter`;

/** True when items are in the body *and* in a legacy key — nothing can write it. */
function isDualStorage(source: ItemsSource | undefined): boolean {
  const legacy = readLegacyItems(source?.extra);
  if (legacy === null || !legacy.ok || legacy.items.length === 0) return false;
  return parseBodyItems(source?.body ?? "").length > 0;
}

/**
 * The manifest's `validate` answer: what is wrong with this document's items,
 * empty when nothing is (SPEC.md §10 — a plugin validates its own document).
 *
 * Under body storage there is nothing a *body* can say that is malformed — a
 * line either is a task item or is prose — so what is left is the two states a
 * not-yet-migrated document can be in that {@link planWrite} refuses to write:
 * a legacy key that cannot be parsed, and items in **both** places. Both are
 * reported, because a document every write refuses and every surface calls
 * valid is a document whose refusals nothing on screen explains (FIX 6).
 */
export function itemProblems(source: ItemsSource | undefined): readonly string[] {
  const read = readItems(source);
  if (!read.ok) return read.problems;
  if (!isDualStorage(source)) return [];
  return [
    `this document ${DUAL_STORAGE} — remove whichever list is stale; ` +
      "until then nothing can be written to it",
  ];
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

/**
 * A refusal to mutate, carrying the status a route should answer with.
 *
 * `409` is reserved for the one case that is not the caller's fault: the item
 * at that index is no longer the one the caller was looking at.
 */
export class TodoItemError extends Error {
  constructor(
    readonly status: 400 | 409,
    message: string,
  ) {
    super(message);
    this.name = "TodoItemError";
  }
}

function requireLine(lines: readonly ItemLine[], index: number): ItemLine {
  if (!Number.isInteger(index) || index < 0 || index >= lines.length) {
    throw new TodoItemError(
      400,
      `item index ${String(index)} is out of range — this list has ${String(lines.length)} item${
        lines.length === 1 ? "" : "s"
      }`,
    );
  }
  // Bounds are checked immediately above, so the element is present.
  return lines[index] as ItemLine;
}

/**
 * The optimistic-concurrency guard. Index addressing is cheap and stable for
 * the life of a render, but a concurrent `check` or `delete` shifts it — so
 * every write may carry the text it believes is at that index, and a mismatch
 * is refused rather than applied to whatever moved into place. Body storage
 * does not change that: a line number is no more an identity than an array
 * index was.
 */
function requireMatch(item: TodoItem, index: number, expectedText: string | undefined): void {
  if (expectedText === undefined || expectedText === item.text) return;
  throw new TodoItemError(
    409,
    `item ${String(index)} is now “${item.text}”, not “${expectedText}” — it changed under you; ` +
      "nothing was written",
  );
}

/** A validated item, or the 400 that says which field is wrong. */
function checked(candidate: { text: string; done: boolean; due?: string | undefined }): TodoItem {
  const parsed = TodoItemSchema.safeParse({
    text: candidate.text,
    done: candidate.done,
    ...(candidate.due === undefined ? {} : { due: candidate.due }),
  });
  if (!parsed.success) {
    throw new TodoItemError(400, parsed.error.issues.map(describeItemIssue).join("; "));
  }
  // An item is one line by definition: text carrying a newline would silently
  // become two items — or one item plus a line of prose — on the next read.
  if (/[\r\n]/.test(parsed.data.text)) {
    throw new TodoItemError(400, "item.text: must be a single line");
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Writing — every mutation returns a new body
// ---------------------------------------------------------------------------

/**
 * The carriage return this document's lines already end with, or `""`.
 *
 * Bodies are split and rejoined on `\n` throughout, so a CRLF document's `\r`
 * simply rides along at the end of every existing line — every mutation of an
 * *existing* line therefore preserves it for free. A line the plugin **adds**
 * has to be given one, or a CRLF document acquires mixed endings on its first
 * append and every line the plugin ever wrote shows up as changed in a diff
 * (FIX 14). The dominant ending wins, so a document already mixed is not made
 * more so.
 */
function dominantReturn(body: string): string {
  const crlf = (body.match(/\r\n/g) ?? []).length;
  const lf = (body.match(/(?<!\r)\n/g) ?? []).length;
  return crlf > lf ? "\r" : "";
}

/**
 * Splices new lines into a body, in the body's own line ending.
 *
 * New items join the end of the **existing list** when there is one, so a
 * document whose items sit between a heading and its notes keeps them there.
 * With no list yet, they go after the body's last non-empty line with a blank
 * line between, which is where a list may start without interrupting whatever
 * precedes it.
 */
function insertLines(body: string, added: readonly string[]): string {
  const cr = dominantReturn(body);
  const written = added.map((line) => `${line}${cr}`);
  const lines = body.split("\n");
  const last = taskLines(body).at(-1);
  if (last !== undefined) {
    lines.splice(last.at + 1, 0, ...written);
    return lines.join("\n");
  }
  let lastContent = -1;
  for (const [at, raw] of lines.entries()) if (raw.trim() !== "") lastContent = at;
  if (lastContent === -1) return `${written.join("\n")}${cr}\n`;
  lines.splice(lastContent + 1, 0, cr, ...written);
  return lines.join("\n");
}

export interface AppendInput {
  readonly text: string;
  readonly due?: string | undefined;
}

/** Appends one open item to the body's list. New items are always open. */
export function appendItemToBody(body: string, input: AppendInput): string {
  const item = checked({ text: input.text, done: false, due: input.due });
  return insertLines(body, [newLine(item)]);
}

export interface UpdateInput {
  /** Absent leaves `done` alone; present sets it. */
  readonly done?: boolean | undefined;
  /** Absent leaves the label alone; present renames the item. */
  readonly text?: string | undefined;
  /** `null` clears the deadline; a date sets it; absent leaves it alone. */
  readonly due?: string | null | undefined;
  /** The text the caller believes is at `index`; a mismatch is a 409. */
  readonly expectedText?: string | undefined;
}

/**
 * Updates one item in place, rewriting exactly its line.
 *
 * Order is body order and this cannot move it — which is the guarantee the
 * dropped per-item `ts` used to buy, now a property of editing a line rather
 * than rebuilding a list.
 */
export function updateItemInBody(body: string, index: number, input: UpdateInput): string {
  const line = requireLine(taskLines(body), index);
  requireMatch(line.item, index, input.expectedText);
  const next = checked({
    text: input.text ?? line.item.text,
    done: input.done ?? line.item.done,
    due: input.due === undefined ? line.item.due : (input.due ?? undefined),
  });
  const lines = body.split("\n");
  lines[line.at] = renderLine(line, next);
  return lines.join("\n");
}

/** Removes exactly one item's line; every other byte of the body survives. */
export function removeItemFromBody(body: string, index: number, expectedText?: string): string {
  const line = requireLine(taskLines(body), index);
  requireMatch(line.item, index, expectedText);
  const lines = body.split("\n");
  lines.splice(line.at, 1);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/** What a write must do about a document that may not be migrated yet. */
export interface WritePlan {
  /** The body the write starts from — legacy items folded in when needed. */
  readonly body: string;
  /** True when the write must also clear the legacy `items` frontmatter key. */
  readonly clearLegacy: boolean;
}

/**
 * Decides how a write should treat a document's storage state, and refuses the
 * two states nobody can act on safely.
 *
 * A document that never carried the key is already body-backed and this is a
 * no-op. One carrying an empty or absent-valued key just loses it. One carrying
 * real legacy items and **no** body items is migrated in the same patch as the
 * write that triggered it — one commit, never a half state.
 *
 * The refusals: a legacy key that cannot be parsed (writing a well-formed list
 * over frontmatter we could not read would silently discard a hand-edit), and a
 * document carrying items in **both** places, which nothing can merge without
 * guessing which list the user meant. Both name what to do next.
 */
export function planWrite(source: ItemsSource, label: string): WritePlan {
  const body = source.body ?? "";
  const legacy = readLegacyItems(source.extra);
  if (legacy === null) return { body, clearLegacy: false };
  if (!legacy.ok) {
    throw new TodoItemError(
      400,
      `${label} has malformed ${LEGACY_ITEMS_KEY} and was not written — ${legacy.problems.join("; ")}`,
    );
  }
  if (legacy.items.length === 0) return { body, clearLegacy: true };
  if (parseBodyItems(body).length > 0) {
    throw new TodoItemError(
      400,
      `${label} ${DUAL_STORAGE}, and was not written — remove whichever list is stale before ` +
        "writing to it",
    );
  }
  return { body: migrateBody(body, legacy.items), clearLegacy: true };
}

/**
 * Appends legacy frontmatter items to a body as task lines, in their order.
 *
 * Every item goes through {@link checked} on the way, so the *one* gate on what
 * may become a line is the same one every other write uses. A legacy key is
 * hand-editable YAML: an item whose text carries a newline would otherwise
 * arrive here unvalidated and be written as one item plus a line of prose —
 * silent corruption in the middle of a migration. Refused instead, it becomes
 * that document's migration conflict, with the same message a `text` containing
 * a newline gets at any other boundary.
 */
export function migrateBody(body: string, items: readonly TodoItem[]): string {
  return insertLines(
    body,
    items.map((item) => newLine(checked(item))),
  );
}

// ---------------------------------------------------------------------------
// Derivations — unchanged by the storage move
// ---------------------------------------------------------------------------

/**
 * Resolves an index-or-text selector against a list — what `corpus todos check`
 * accepts so the agent can say "the passport one" instead of counting rows.
 *
 * A numeric selector is **1-based** at the CLI boundary (the same numbering
 * `corpus todos list` prints) and returns a 0-based index. Text matching is
 * case-insensitive and exact; ambiguity is refused with the candidates named,
 * because guessing which duplicate the user meant is how the wrong thing gets
 * checked off.
 */
export function resolveSelector(items: readonly TodoItem[], selector: string): number {
  const trimmed = selector.trim();
  if (/^\d+$/.test(trimmed)) {
    const oneBased = Number.parseInt(trimmed, 10);
    if (oneBased < 1 || oneBased > items.length) {
      throw new TodoItemError(
        400,
        `no item ${trimmed} — this list has ${String(items.length)} item${
          items.length === 1 ? "" : "s"
        }`,
      );
    }
    return oneBased - 1;
  }

  const needle = trimmed.toLowerCase();
  const matches = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.text.toLowerCase() === needle);
  if (matches.length === 1) return matches[0]?.index ?? 0;
  if (matches.length === 0) {
    throw new TodoItemError(400, `no item matches “${trimmed}”`);
  }
  throw new TodoItemError(
    400,
    `“${trimmed}” matches ${String(matches.length)} items (${matches
      .map(({ index }) => String(index + 1))
      .join(", ")}) — pass the number instead`,
  );
}

/** Items still to do. The aggregate column and the panel are built on this. */
export function openItems(items: readonly TodoItem[]): readonly TodoItem[] {
  return items.filter((item) => !item.done);
}

/** What {@link deriveStatus} may choose between — never `archived` (SPEC.md §12). */
export type DerivedTodoStatus = "open" | "resolved";

/**
 * **A todo document's status is its items** (SPEC.md §12, rider signed
 * 2026-08-12; PLUGINS-016): at least one item and no open items reads
 * `resolved`; every other list reads `open`, including an empty one, which has
 * completed nothing.
 *
 * `null` means the derivation does not apply and the **stored** value stands,
 * in exactly two states, both owned here so no caller can apply them
 * differently:
 *
 * - `stored === "archived"` — archiving says where a document is kept, which
 *   no checkbox can imply; an archived list reads `archived` whatever its
 *   items say, and unarchiving returns it to whichever of the two its items
 *   say at that moment (which this function then answers).
 * - Items that cannot be read — a malformed legacy `extra.items` key. The
 *   DocPanel renders no stats over that state because a number over a broken
 *   list is a quiet claim about a broken state, and a derived status is the
 *   same claim in one word, so it follows the same rule: derive nothing.
 *
 * Everything else derives from **the same {@link readItems} the stats panel
 * counts** — a not-yet-migrated document derives from its legacy frontmatter
 * items, a dual-storage document from its body — which is what makes the
 * rider's "the two can therefore never disagree" true by construction rather
 * than by coincidence. This is also why the derivation is the plugin's and not
 * a core task-list read: `readItems` and core's own parse (remark-gfm, the
 * editor's) demonstrably diverge on blockquoted task lines, unclosed fences
 * and ordered-list task items, and none of the legacy-frontmatter states is
 * visible to any body parse at all (PLUGINS-016's recorded evidence).
 *
 * Callers compose the fallback themselves: `deriveStatus(...) ?? stored`.
 */
export function deriveStatus(
  source: ItemsSource | undefined,
  stored: string,
): DerivedTodoStatus | null {
  if (stored === "archived") return null;
  const read = readItems(source);
  if (!read.ok) return null;
  return read.items.length > 0 && read.items.every((item) => item.done) ? "resolved" : "open";
}

/** How many open items carry a deadline — the design's `2 due` row badge. */
export function dueCount(items: readonly TodoItem[]): number {
  return openItems(items).filter((item) => item.due !== undefined).length;
}

/** An open item whose deadline has passed — the design's overdue treatment. */
export function isOverdue(item: TodoItem, today: Date): boolean {
  if (item.done || item.due === undefined) return false;
  return item.due < today.toISOString().slice(0, 10);
}
