import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CHARACTER_REFERENCE } from "./escape.js";
import { parseMarkdown } from "./parse.js";
import { MARK, NODE, type PmMark, type PmNode } from "./schema.js";
import { serializeDoc } from "./serialize.js";

/**
 * The round trip, over the repository's own documents — the sweep as a test
 * (UI-104).
 *
 * §10 gives the editor autosave and no save button, so **opening a document and
 * typing one character writes the serializer's opinion of it to disk**. What
 * that opinion changes is therefore not an aesthetic question: §5 makes the
 * file the source of truth and §1 makes it the user's. This file is the guard,
 * and it is a test rather than a script because UI-103 ran the same sweep by
 * hand — which is how it could report "6 fixed-point failures, now 0" while 72
 * documents were still being restructured on the first save, and nobody
 * noticed.
 *
 * `roundtrip.test.ts` covers seventeen fixtures, every one of them written in
 * the shape the serializer emits. This covers ~600 documents nobody wrote for
 * it: hand-written issues, eval reports, specs, agent skills, prettier-wrapped
 * prose, tables with ragged rows, code spans broken across lines. It is the
 * only place a construct nobody thought to write a fixture for can fail — and
 * UI-103 shipped a P0 because the fixture corpus had zero coverage of a list
 * item holding anything but a nested list.
 *
 * ## What is asserted, and why it is not a list of file names
 *
 * A pinned list of changed files would be wrong twice over: it goes stale on
 * every documentation edit, and it says nothing about *what* changed. So the
 * assertion is an **explanation**: {@link explain} walks the two parses in
 * lockstep and every difference it meets must be one of the named, written-down
 * normalisations in {@link CATEGORIES}. A difference none of them describes is
 * reported by file name, with the two spellings that differ.
 *
 * That is the growth guard, and the reason it is character-exact. **PR #41's
 * review found the earlier classifier absolving documents by what they
 * *contained* rather than by what *changed*** — 235 documents held a multi-line
 * code span, so 235 documents were pre-absolved of anything a future printer
 * might do to them, and 52 of the 68 documents that actually change were
 * classified by that predicate alone. The negative control is in this issue's
 * log: replacing the fold's `|` with a space — silently deleting a character
 * from twelve of the user's files — passed all eight of the assertions this
 * file used to make. It fails here now, by name.
 *
 * {@link project} survives as the *readable* form of the same guarantee: a
 * failure of "keeps every word, and the marks over it" says which word moved,
 * where {@link explain} says which two characters disagree. It is redundant by
 * construction — anything it catches is an unexplained difference — and it is
 * kept because the first question a human asks about a serializer regression is
 * whether it changed the text.
 *
 * ## Cost
 *
 * Ten megabytes of markdown, parsed twice and printed twice each: about a
 * minute, and by some distance the slowest file in the suite. That is the price
 * of the only assertion in the repository made against documents that were not
 * written to satisfy it, for a defect class whose entire symptom is a diff
 * nobody reads. It is kept whole rather than sampled for the same reason: the
 * six fixed-point failures UI-103 found were six documents out of 618.
 */

/* ── The corpus ─────────────────────────────────────────────────────── */

/** Directories holding no authored markdown: build output, vendored code, other agents' worktrees. */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  ".git",
  ".vite",
  "coverage",
  "dist",
  "dist-package",
  "node_modules",
  "playwright-report",
  "test-results",
  "worktrees",
]);

function existsIn(directory: string, name: string): boolean {
  try {
    statSync(join(directory, name));
    return true;
  } catch {
    return false;
  }
}

function repositoryRoot(): string {
  let at = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsIn(at, "SPEC.md") && existsIn(at, "issues")) return at;
    const up = dirname(at);
    // Failing loudly beats sweeping zero documents and passing every assertion
    // below in silence.
    if (up === at) throw new Error("could not locate the repository root from this test file");
    at = up;
  }
}

function markdownFiles(directory: string, out: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      markdownFiles(join(directory, entry.name), out);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) out.push(join(directory, entry.name));
  }
  return out;
}

/* ── The projection ─────────────────────────────────────────────────── */

/**
 * Characters the *projection* ignores, and why each one is out.
 *
 * **Whitespace**, because moving it is what several of the accepted
 * normalisations *are*: a space at the inside edge of an emphasis marker is
 * hoisted out of it (`** **` closes nothing) and a line break inside a code
 * span becomes the space CommonMark says a code span renders it as. None of
 * them changes a word.
 *
 * **The pipe**, because whether one is content or a delimiter is exactly the
 * question UI-104 settles: a row the file wrote wider than its header has its
 * surplus folded back behind the `|` it came from, which turns that character
 * from structure into a cell's text.
 *
 * These are blind spots, and they are the projection's alone. {@link explain}
 * compares whitespace and pipes character for character like everything else —
 * it models the fold rather than ignoring it, and it has no whitespace
 * allowance at all. Nothing this list skips is unguarded.
 */
const IGNORED_CHARACTERS = /[\s|]/;

function attributeKey(node: PmNode): string {
  return JSON.stringify(node.attrs ?? {});
}

function markKey(node: PmNode): string {
  return (node.marks ?? [])
    .map((mark) => `${mark.type}${JSON.stringify(mark.attrs ?? {})}`)
    .sort()
    .join("+");
}

/** Every significant character of a text node, paired with the marks it carries. */
function projectText(node: PmNode): string {
  const marks = markKey(node);
  let out = "";
  for (const character of node.text ?? "") {
    if (!IGNORED_CHARACTERS.test(character)) out += `${character}${marks};`;
  }
  return out;
}

/**
 * A table cell's content, with its paragraph wrappers dropped.
 *
 * A cell is `block+` in ProseMirror and phrasing in markdown, so the serializer
 * flattens it either way; the block boundaries inside a cell are not something
 * a file can say.
 */
function projectInline(nodes: readonly PmNode[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === NODE.text) out += projectText(node);
    else if (node.type === NODE.paragraph) out += projectInline(node.content ?? []);
    else out += `<${node.type} ${attributeKey(node)}>${projectInline(node.content ?? [])}/>`;
  }
  return out;
}

/**
 * A row's cells, with anything past the table's last column folded into it —
 * exactly as the serializer folds it, so a document whose file wrote a ragged
 * row projects the same before and after.
 */
function projectRow(row: PmNode, columns: number): string {
  const cells = row.content ?? [];
  const kept = columns > 0 ? cells.slice(0, columns) : [...cells];
  const surplus = columns > 0 ? cells.slice(columns) : [];
  const projected = kept.map(
    (cell) => `<${cell.type} ${attributeKey(cell)}>${projectInline(cell.content ?? [])}`,
  );
  const last = projected.length - 1;
  if (last >= 0) {
    projected[last] =
      `${projected[last] ?? ""}${surplus.map((cell) => projectInline(cell.content ?? [])).join("")}`;
  }
  return `<tableRow>${projected.map((cell) => `${cell}/>`).join("")}</tableRow>`;
}

/**
 * A document reduced to what no normalisation may change: its block structure,
 * its attributes, and every significant character paired with the marks over it.
 *
 * Mark *order* is out — they are sorted — because ProseMirror holds marks as a
 * set, so nesting order is the printer's choice and not the document's. Text
 * node *boundaries* are out — characters are projected one at a time — because
 * ProseMirror splits a run wherever an edit landed and markdown cannot spell
 * the split. What stays in is what a reader would see: which words exist, which
 * are bold, which block holds them, and how deep it is nested.
 */
function project(node: PmNode): string {
  if (node.type === NODE.text) return projectText(node);
  const children = node.content ?? [];
  if (node.type === NODE.table) {
    // The table's own width, so a row is compared against its header rather
    // than against the widest row in the table.
    const columns = children[0]?.content?.length ?? 0;
    return `<table ${attributeKey(node)}>${children.map((row) => projectRow(row, columns)).join("")}</table>`;
  }
  return `<${node.type} ${attributeKey(node)}>${children.map(project).join("")}</${node.type}>`;
}

/* ── The named normalisations ───────────────────────────────────────── */

/**
 * Every way a document is allowed to differ from its own round trip, each with
 * the reason it is a normalisation rather than a rewrite.
 *
 * Measured over the 598 documents present when this was written: 556 change
 * byte-for-byte on the first save, 68 of them structurally. The counts below
 * are recorded for the reader and deliberately not asserted — they move
 * whenever a document is edited, and they overlap, because a document may hit
 * more than one. What must not move is the *set of names*: a difference none of
 * them describes fails {@link explain}, by file name.
 *
 * Two further normalisations are invisible here and belong in the same list:
 * **a loose list is tightened**, and **an item's blocks are separated by a
 * blank line, which makes its list loose** (UI-103). Neither shows up in a
 * parse comparison at all, because ProseMirror does not model list looseness —
 * tight and loose produce the identical document — which is precisely the
 * reason both are accepted.
 */
const CATEGORIES = {
  /**
   * 54 documents. `` `49419de [SHARED-003] Ledger PR\n#14 review findings` ``
   * → the break becomes a space.
   *
   * It is **not** every line break in a code span, which is what UI-104 first
   * recorded: 235 documents hold one and 54 change. `mdast-util-to-markdown`'s
   * `inlineCode` handler walks the printer's `atBreak` unsafe patterns and
   * replaces the line ending only where the next line would otherwise be read
   * as a block — a `#`, `-`, `>`, `---` or a blank line there ends the
   * paragraph and destroys the span. A break followed by an ordinary word is
   * left exactly where the author put it.
   *
   * Accepted because CommonMark §6.1 makes a code span's line endings spaces,
   * so this is already what every reader shows: `MarkdownView`'s inline `code`
   * inherits `white-space: normal`, and the rendered page is
   * character-for-character the same before and after. Preserving the break
   * would mean hand-rolling `inlineCode`, which then owns backtick-fence
   * widening, space padding, GFM's table-cell escaping *and* the very
   * block-interruption proof the printer is discharging here. That is the proof
   * obligation UI-103 was, taken on for no rendered difference.
   */
  inlineCodeLineBreak: "a line break inside a code span becomes the space it renders as",
  /**
   * 12 documents. A file that wrote a row wider than its header — a bare `|`
   * inside `` `jq '.events|length'` ``, `string | null`, `2 failed | 8 passed`.
   *
   * The surplus is folded back into the last column behind an escaped pipe.
   * This is the *fix*, not the defect: before it, the printer laid the table
   * out as a matrix as wide as its widest row, so the header gained a column
   * the author never wrote and every row in the table shifted.
   *
   * Two residual costs, both on the record. The padding around the fold is
   * gone — GFM trims a cell's edges, so no writer working from the parsed
   * document can know whether the author wrote `a | b` or `a|b`. And the fold
   * is *visible*: `| 1 | 2 | 3 |` under a two-column header renders in GFM as
   * `1 | 2`, because the surplus is ignored, and after the first save it
   * renders as `1 | 2|3`. Text the reader could not see becomes text it can.
   * That is the point — the alternative is deleting it — but it is a rendered
   * change and not only a byte one.
   */
  tableSurplusFolded: "a row wider than its header is folded back into the last column",
  /**
   * 2 documents. `**[link](u)**` → `[**link**](u)`.
   *
   * ProseMirror holds marks as a set on each text node, so nesting order is not
   * information the document carries. `MARK_ORDER` picks one, and the same
   * characters come out bold either way.
   */
  markNestingOrder: "marks are re-nested into the canonical order",
  /**
   * 2 documents. Two adjacent text nodes carrying the same marks come back as
   * one — `**Stale **and** unread**` parses as three nodes under one nested
   * strong and prints as `**Stale and unread**`.
   *
   * Detected as what it is: a text-node boundary that fell *between two
   * characters carrying identical marks*, present before and gone after.
   * Markdown cannot spell such a boundary, so nothing in the file changed;
   * ProseMirror splits a run wherever an edit landed and re-merges on the way
   * out.
   *
   * The issue that raised this suspected the healing of malformed emphasis of
   * **extending the bold run**. It does not, and that is the finding rather
   * than an assumption: the characters carrying each mark are compared one at a
   * time, and a boundary that merges a run of *different* marks is not this
   * category — it is an unexplained difference.
   */
  inlineRunsMerged: "adjacent text carrying the same marks becomes one run",
  /**
   * 1 document. `**DEFERRED → CONTRACT-005** — CLEARED` written as
   * `**DEFERRED → CONTRACT-005**` + `** — CLEARED**`: the space at the inside
   * edge of the second run is hoisted out of the emphasis.
   *
   * A markdown emphasis marker cannot flank whitespace — `** **` opens nothing
   * and closes nothing — so an emphasised space is not a document a file can
   * spell. The printer moves the space outside the markers, which is the only
   * output that reads back as the same emphasis. The character stays, in the
   * same place, in the same order; it loses a mark that no reader was rendering
   * (there is nothing to embolden in a space).
   *
   * Narrow on purpose: it applies to a **whitespace** character, it may only
   * *lose* emphasis (`bold`, `italic`, `strike`), and every other mark on it —
   * `code`, `link` — must be untouched. A space that gains emphasis, or a
   * non-space that loses it, is not this.
   *
   * **Position-agnostic, deliberately, and the name is the narrower of the
   * two** (PR #41 re-review). The rule does not check that the space sits at a
   * marker's inside edge; it accepts any whitespace character anywhere losing
   * emphasis. That is wider than the name, and it is left wide because the
   * argument above does not depend on position: a space carries no visible
   * weight wherever it is, so a printer that stopped emboldening an *interior*
   * space — `**a b c**` → `**a** b **c**` — loses a mark no reader was
   * rendering, exactly as the edge case does, and it settles. Narrowing the
   * rule to the edge would leave that change `unexplained` and fail the sweep
   * for a normalisation this category already justifies. Read the name as the
   * instance that occurs in this corpus, not as the bound.
   */
  emphasisEdgeSpace: "whitespace loses emphasis it was carrying; the character stays",
} as const;

type Category = keyof typeof CATEGORIES;

/* ── Explaining a difference ────────────────────────────────────────── */

/** What one document's round trip changed, and anything it could not account for. */
interface Explanation {
  readonly categories: readonly Category[];
  /** One line per difference no category describes; empty is the passing state. */
  readonly unexplained: readonly string[];
}

interface Ledger {
  readonly categories: Set<Category>;
  readonly unexplained: string[];
}

function cellInline(cell: PmNode): PmNode[] {
  const out: PmNode[] = [];
  for (const child of cell.content ?? []) {
    if (child.type === NODE.paragraph) out.push(...(child.content ?? []));
    else out.push(child);
  }
  return out;
}

/**
 * One row, with anything past the last column folded into it — the serializer's
 * `foldSurplusCells`, re-stated over the parsed document.
 *
 * Modelled rather than ignored. The fold is the one accepted normalisation that
 * *moves characters*, so the comparison below can only be character-exact if it
 * knows where they went: the surplus cells' content lands at the end of the
 * last column with a literal `|` in front of each, which is what the file will
 * say once the printer has escaped it. A fold that lost the pipe, or dropped a
 * cell, or joined them in the wrong order then fails as an ordinary content
 * difference — which is exactly what PR #41's negative control does.
 */
function foldRow(row: PmNode, columns: number, ledger: Ledger): PmNode {
  const cells = row.content ?? [];
  if (columns <= 0 || cells.length <= columns) return row;
  const last = cells[columns - 1];
  if (last === undefined) return row;
  ledger.categories.add("tableSurplusFolded");
  const inline = [...cellInline(last)];
  for (const surplus of cells.slice(columns)) {
    inline.push({ type: NODE.text, text: "|" }, ...cellInline(surplus));
  }
  const kept = [
    ...cells.slice(0, columns - 1),
    { ...last, content: [{ type: NODE.paragraph, content: mergeAdjacentText(inline) }] },
  ];
  return { ...row, content: kept };
}

/**
 * Text nodes the fold made adjacent, joined where their marks agree.
 *
 * The fold writes one cell, and a cell is one run of markdown: two nodes
 * carrying the same marks are two nodes only until the printer emits them, and
 * they come back as one. Leaving them split would make every folded document
 * also report {@link CATEGORIES.inlineRunsMerged}, which would be this test
 * describing its own bookkeeping rather than the printer's behaviour.
 */
function mergeAdjacentText(nodes: readonly PmNode[]): PmNode[] {
  const out: PmNode[] = [];
  for (const node of nodes) {
    const previous = out[out.length - 1];
    if (
      previous !== undefined &&
      previous.type === NODE.text &&
      node.type === NODE.text &&
      sameOrder(markNames(previous.marks), markNames(node.marks))
    ) {
      out[out.length - 1] = { ...previous, text: `${previous.text ?? ""}${node.text ?? ""}` };
      continue;
    }
    out.push(node);
  }
  return out;
}

function foldSurplus(node: PmNode, ledger: Ledger): PmNode {
  const children = node.content;
  if (children === undefined) return node;
  if (node.type === NODE.table) {
    const columns = children[0]?.content?.length ?? 0;
    return { ...node, content: children.map((row) => foldRow(row, columns, ledger)) };
  }
  return { ...node, content: children.map((child) => foldSurplus(child, ledger)) };
}

/**
 * One position in a block's inline content: a character with the marks over it,
 * or a leaf node that has no characters of its own.
 *
 * Per character rather than per node because a text node's *boundaries* are not
 * something markdown can spell — see {@link CATEGORIES.inlineRunsMerged} — and
 * because the comparison has to line the two documents up position by position
 * to say which two characters disagree.
 */
interface Position {
  readonly character: string | undefined;
  /** A leaf's identity — its type and attributes — for the nodes that carry no text. */
  readonly leaf: string | undefined;
  /** Mark types **in the order the tree nests them**; order is a category of its own. */
  readonly marks: readonly string[];
  /** This position begins a text node whose predecessor carried identical marks. */
  readonly redundantBoundary: boolean;
}

const INLINE_LEAVES: ReadonlySet<string> = new Set([
  NODE.text,
  NODE.docRef,
  NODE.rawInline,
  NODE.image,
  NODE.hardBreak,
]);

function markNames(marks: readonly PmMark[] | undefined): string[] {
  return (marks ?? []).map((mark) => `${mark.type}${JSON.stringify(mark.attrs ?? {})}`);
}

function positions(nodes: readonly PmNode[]): Position[] {
  const out: Position[] = [];
  for (const node of nodes) {
    const marks = markNames(node.marks);
    if (node.type !== NODE.text) {
      out.push({
        character: undefined,
        leaf: `${node.type} ${JSON.stringify(node.attrs ?? {})}`,
        marks,
        redundantBoundary: false,
      });
      continue;
    }
    let first = true;
    for (const character of node.text ?? "") {
      const previous = out[out.length - 1];
      out.push({
        character,
        leaf: undefined,
        marks,
        redundantBoundary:
          first && previous?.character !== undefined && sameOrder(previous.marks, marks),
      });
      first = false;
    }
  }
  return out;
}

const EMPHASIS: ReadonlySet<string> = new Set(["bold", "italic", "strike"]);

function isEmphasis(mark: string): boolean {
  return EMPHASIS.has(mark.replace(/\{.*$/, ""));
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((mark, index) => mark === right[index]);
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return sameOrder([...left].sort(), [...right].sort());
}

/** A few positions either side, so a failure reads as text rather than as an index. */
function excerpt(stream: readonly Position[], at: number): string {
  return stream
    .slice(Math.max(0, at - 30), at + 30)
    .map((position) => position.character ?? `<${position.leaf ?? ""}>`)
    .join("");
}

/**
 * Two blocks' inline content, position by position.
 *
 * Every transition below consumes one position from each side, so the two
 * streams stay index-aligned and a difference in *length* is itself a
 * difference in content. There is deliberately no whitespace allowance: over
 * the whole corpus nothing is inserted or deleted, so a printer that started
 * dropping a space would be a new normalisation somebody has to name.
 */
function compareInline(
  before: readonly Position[],
  after: readonly Position[],
  path: string,
  ledger: Ledger,
): void {
  const shared = Math.min(before.length, after.length);
  for (let at = 0; at < shared; at += 1) {
    const left = before[at];
    const right = after[at];
    if (left === undefined || right === undefined) continue;
    if (left.redundantBoundary && !right.redundantBoundary)
      ledger.categories.add("inlineRunsMerged");
    if (left.character !== undefined && left.character === right.character) {
      if (sameOrder(left.marks, right.marks)) continue;
      if (sameSet(left.marks, right.marks)) {
        ledger.categories.add("markNestingOrder");
        continue;
      }
      const lost = left.marks.filter((mark) => !right.marks.includes(mark));
      if (
        /\s/.test(left.character) &&
        lost.every(isEmphasis) &&
        sameSet(
          left.marks.filter((mark) => !isEmphasis(mark)),
          right.marks.filter((mark) => !isEmphasis(mark)),
        ) &&
        right.marks.every((mark) => left.marks.includes(mark))
      ) {
        ledger.categories.add("emphasisEdgeSpace");
        continue;
      }
      ledger.unexplained.push(
        `${path}: ${JSON.stringify(left.character)} carried ${left.marks.join("+") || "no marks"} and now carries ${right.marks.join("+") || "no marks"}`,
      );
      return;
    }
    if (
      left.character !== undefined &&
      /\r?\n/.test(left.character) &&
      right.character === " " &&
      sameOrder(left.marks, right.marks) &&
      left.marks.some((mark) => mark.startsWith(MARK.code))
    ) {
      ledger.categories.add("inlineCodeLineBreak");
      continue;
    }
    if (left.leaf !== undefined && left.leaf === right.leaf) {
      if (sameSet(left.marks, right.marks)) {
        if (!sameOrder(left.marks, right.marks)) ledger.categories.add("markNestingOrder");
        continue;
      }
    }
    ledger.unexplained.push(`${path}: "…${excerpt(before, at)}…" became "…${excerpt(after, at)}…"`);
    return;
  }
  if (before.length !== after.length) {
    ledger.unexplained.push(
      `${path}: "…${excerpt(before, shared)}" became "…${excerpt(after, shared)}"`,
    );
  }
}

function isInline(children: readonly PmNode[]): boolean {
  return children.some((child) => INLINE_LEAVES.has(child.type));
}

function compareNode(before: PmNode, after: PmNode, path: string, ledger: Ledger): void {
  if (ledger.unexplained.length > 0) return;
  if (before.type !== after.type) {
    ledger.unexplained.push(`${path}: a ${before.type} became a ${after.type}`);
    return;
  }
  const at = `${path}/${before.type}`;
  if (JSON.stringify(before.attrs ?? {}) !== JSON.stringify(after.attrs ?? {})) {
    ledger.unexplained.push(
      `${at}: attributes ${JSON.stringify(before.attrs)} became ${JSON.stringify(after.attrs)}`,
    );
    return;
  }
  const left = before.content ?? [];
  const right = after.content ?? [];
  if (isInline(left) || isInline(right)) {
    compareInline(positions(left), positions(right), at, ledger);
    return;
  }
  if (left.length !== right.length) {
    ledger.unexplained.push(
      `${at}: [${left.map((child) => child.type).join(", ")}] became [${right.map((child) => child.type).join(", ")}]`,
    );
    return;
  }
  for (let index = 0; index < left.length; index += 1) {
    const x = left[index];
    const y = right[index];
    if (x !== undefined && y !== undefined) compareNode(x, y, `${at}[${index}]`, ledger);
  }
}

/**
 * Why one document's parse changed — read off the difference between the two
 * trees, never off the features of either one.
 *
 * The distinction is the whole point (PR #41, MAJOR 1). "This document contains
 * a multi-line code span" absolves it of everything a future printer might do
 * to it; "this document's fourth paragraph now says a space where it said a
 * line break, inside a code span" absolves exactly that. The first is what this
 * file used to do, and 235 of ~597 documents were pre-absolved by it.
 */
function explain(before: PmNode, after: PmNode): Explanation {
  const ledger: Ledger = { categories: new Set(), unexplained: [] };
  compareNode(foldSurplus(before, ledger), after, "", ledger);
  return { categories: [...ledger.categories].sort(), unexplained: ledger.unexplained };
}

/* ── The sweep ──────────────────────────────────────────────────────── */

interface Result {
  readonly name: string;
  readonly settles: boolean;
  readonly projectionHeld: boolean;
  readonly rowWidths: string | null;
  readonly newEntity: boolean;
  readonly changed: boolean;
  readonly explanation: Explanation;
}

/**
 * Whether every table kept its shape, and how it did not.
 *
 * The header's width is the headline case — a table that gains a column is a
 * table the author did not write — but reading only the header was PR #41's
 * MINOR 1: **a body row splitting is invisible to it**, and a body row
 * splitting is the exact defect UI-104 exists to fix. So every row is compared
 * against its own width, with one asymmetry: a row may *lose* cells, because
 * that is the fold putting a ragged row back inside its header, and it may
 * never gain one, because nothing in the round trip is allowed to split a row.
 */
function rowWidths(before: PmNode, after: PmNode): string | null {
  const tablesBefore = collect(before).filter((node) => node.type === NODE.table);
  const tablesAfter = collect(after).filter((node) => node.type === NODE.table);
  if (tablesBefore.length !== tablesAfter.length)
    return `${tablesBefore.length} tables became ${tablesAfter.length}`;
  for (const [index, table] of tablesBefore.entries()) {
    const other = tablesAfter[index];
    if (other === undefined) continue;
    const rows = table.content ?? [];
    const otherRows = other.content ?? [];
    if (rows.length !== otherRows.length)
      return `table ${index}: ${rows.length} rows became ${otherRows.length}`;
    const header = rows[0]?.content?.length ?? 0;
    const otherHeader = otherRows[0]?.content?.length ?? 0;
    if (header !== otherHeader) return `table ${index}: ${header} columns became ${otherHeader}`;
    for (const [row, cells] of rows.entries()) {
      const width = cells.content?.length ?? 0;
      const otherWidth = otherRows[row]?.content?.length ?? 0;
      if (otherWidth > width)
        return `table ${index} row ${row}: ${width} cells became ${otherWidth}`;
    }
  }
  return null;
}

function collect(node: PmNode, into: PmNode[] = []): PmNode[] {
  into.push(node);
  for (const child of node.content ?? []) collect(child, into);
  return into;
}

/** The same pattern as {@link CHARACTER_REFERENCE}, counting rather than testing. */
const EVERY_CHARACTER_REFERENCE = new RegExp(CHARACTER_REFERENCE.source, "gi");

function entityCount(text: string): number {
  return text.match(EVERY_CHARACTER_REFERENCE)?.length ?? 0;
}

const NOTHING_CHANGED: Explanation = { categories: [], unexplained: [] };

function sweep(): Result[] {
  const root = repositoryRoot();
  return markdownFiles(root).map((path) => {
    const source = readFileSync(path, "utf8");
    // Spelled out rather than through `canonicalizeMarkdown` so the trees it
    // parses on the way are the ones asserted over, instead of being thrown
    // away and re-derived — the corpus is ten megabytes.
    const before = parseMarkdown(source);
    const once = serializeDoc(before);
    const after = parseMarkdown(once);
    const changed = JSON.stringify(before) !== JSON.stringify(after);
    return {
      name: relative(root, path),
      settles: serializeDoc(after) === once,
      projectionHeld: project(before) === project(after),
      rowWidths: rowWidths(before, after),
      // Only an entity the source did not already have: several documents are
      // *about* character references and quote them verbatim.
      newEntity: entityCount(once) > entityCount(source),
      changed,
      // Only where something moved: the walk is per character, and 68 documents
      // of ~600 are worth walking.
      explanation: changed ? explain(before, after) : NOTHING_CHANGED,
    };
  });
}

const RESULTS = sweep();
const failures = (predicate: (result: Result) => boolean): string[] =>
  RESULTS.filter(predicate).map((result) => result.name);

describe("the repository's own documents", () => {
  it("sweeps a real corpus, not a handful of files", () => {
    // Stated so that a walk broken by a rename fails here rather than passing
    // every assertion below over an empty list.
    expect(RESULTS.length).toBeGreaterThan(400);
  });

  it("settles on the first printing", () => {
    // Printing the printer's own output must not choose differently, or every
    // save rewrites the file again (UI-103).
    expect(failures((result) => !result.settles)).toEqual([]);
  });

  /**
   * The one that is not a judgment call — UI-104's first acceptance criterion.
   *
   * A table that gains a column is a table the author did not write: the
   * delimiter row grows, every row after it shifts, and the surplus lands under
   * a header that does not exist. Fourteen documents were being rewritten that
   * way, from one unescaped pipe apiece.
   */
  it("never splits a row or changes a table's column count", () => {
    expect(
      RESULTS.filter((result) => result.rowWidths !== null).map(
        (result) => `${result.name}: ${result.rowWidths ?? ""}`,
      ),
    ).toEqual([]);
  });

  it("keeps every word, and the marks over it", () => {
    expect(failures((result) => !result.projectionHeld)).toEqual([]);
  });

  it("writes no character reference a document did not already carry", () => {
    // SPEC.md §6: the body is markdown. An entity, once written, survives every
    // later round trip and shows up in every later diff.
    expect(failures((result) => result.newEntity)).toEqual([]);
  });

  /**
   * The rule this issue exists to enforce: **a change nobody wrote down is how
   * it gets closed while a file still moves.** Every difference between a
   * document and its round trip must be one of the named normalisations, and
   * one that is not fails here — by file name, and with the two spellings.
   */
  it("explains every difference between a document and its round trip", () => {
    expect(
      RESULTS.flatMap((result) =>
        result.explanation.unexplained.map((line) => `${result.name} ${line}`),
      ),
    ).toEqual([]);
  });

  it("leaves most documents structurally untouched", () => {
    // A blunt bound rather than a pinned count, which would go stale on every
    // documentation edit: the accepted normalisations reached 68 of 596
    // documents when this was written, and a change that suddenly touched a
    // third of the corpus would be a rewrite whatever it classified as.
    const changed = RESULTS.filter((result) => result.changed).length;
    expect(changed / RESULTS.length).toBeLessThan(0.2);
  });
});

/* ── The guard's own tests ──────────────────────────────────────────── */

/**
 * The classifier, tested like anything else.
 *
 * A guard whose only exercise is the corpus is a guard nobody has seen fail,
 * and PR #41's finding was precisely that: six assertions, all green, over a
 * classifier that could not distinguish a document containing a pipe from a
 * document whose pipe had been deleted. So each named category has a case that
 * **provokes it through the real printer** — which is also what makes the set
 * of names honest in the direction the corpus cannot check: a category the
 * serializer stopped needing fails here rather than quietly describing nothing.
 * And each blind spot the earlier version had has a case that must *not* be
 * explained.
 */
describe("the guard itself", () => {
  function roundTrip(source: string): Explanation {
    const before = parseMarkdown(source);
    return explain(before, parseMarkdown(serializeDoc(before)));
  }

  const cases: Readonly<Record<Category, string>> = {
    // A break in front of a `#`, which the printer will not write at a line
    // start whether or not this one would have been read as a heading.
    inlineCodeLineBreak: "a `one\n#two` three\n",
    tableSurplusFolded: "| a | b |\n| - | - |\n| x | y | z |\n",
    markNestingOrder: "**[link](https://e.test/)**\n",
    inlineRunsMerged: "**Stale **and** unread**\n",
    // `strike` nests outside `bold`, so the two runs cannot share one `**`, and
    // the space that starts the second one cannot sit inside a marker.
    emphasisEdgeSpace: "**~~one~~ two**\n",
  };

  for (const [category, source] of Object.entries(cases)) {
    it(`names the ${category} normalisation`, () => {
      const explanation = roundTrip(source);
      expect(explanation.unexplained).toEqual([]);
      expect(explanation.categories).toContain(category);
    });
  }

  /**
   * The staleness half of the guard, and the one direction it can fail in.
   *
   * Its predecessor — "uses no category that is not written down", over the
   * corpus — could not fail as its name claimed (PR #41, MINOR 2): `Category`
   * is `keyof typeof CATEGORIES`, so the subset relation held by construction
   * and only the reverse was ever in question. Over the *corpus* that reverse
   * is worse than useless: `emphasisEdgeSpace` fires on one document, so the
   * assertion would go red the day somebody edits it.
   *
   * Driven from the printer instead, the reverse is exactly the check worth
   * making: **every name written down is still something this serializer
   * does.** A category the printer stopped needing — because the behaviour was
   * fixed, or moved, or narrowed — fails here, where the fix is to delete the
   * entry rather than to leave a paragraph in {@link CATEGORIES} describing
   * nothing. What can *not* fail here, and is not claimed to, is a category
   * nobody wrote down: {@link explain} can only add the five literals, and the
   * document-level guard against a *sixth* kind of change is
   * `unexplained`, which names the file.
   */
  it("still needs every category that is written down", () => {
    const named = new Set(Object.values(cases).flatMap((source) => roundTrip(source).categories));
    expect([...named].sort()).toEqual(Object.keys(CATEGORIES).sort());
  });

  /* The blind spots, as documents the classifier must refuse to explain. */

  const cell = (text: string): PmNode => ({
    type: NODE.tableCell,
    attrs: { colspan: 1, rowspan: 1, colwidth: null },
    content: [{ type: NODE.paragraph, content: [{ type: NODE.text, text }] }],
  });

  const row = (...cells: readonly PmNode[]): PmNode => ({ type: NODE.tableRow, content: cells });

  const tableOf = (...rows: readonly PmNode[]): PmNode => ({
    type: NODE.doc,
    content: [{ type: NODE.table, attrs: { align: [null, null] }, content: rows }],
  });

  /**
   * The negative control from PR #41's review, as a unit test: the fold joining
   * the surplus with a space instead of the `|` it came from silently deletes a
   * character from the user's file, and every assertion in the earlier version
   * of this file passed while it did.
   */
  it("refuses a fold that loses the pipe it folded on", () => {
    const before = tableOf(row(cell("a"), cell("b")), row(cell("x"), cell("y"), cell("z")));
    const lost = tableOf(row(cell("a"), cell("b")), row(cell("x"), cell("y z")));

    expect(explain(before, lost).unexplained).not.toEqual([]);
    expect(
      explain(before, tableOf(row(cell("a"), cell("b")), row(cell("x"), cell("y|z")))),
    ).toEqual({ categories: ["tableSurplusFolded"], unexplained: [] });
  });

  it("refuses a row that gained a cell, whatever the header did", () => {
    const before = tableOf(row(cell("a"), cell("b")), row(cell("x"), cell("y|z")));
    const split = tableOf(row(cell("a"), cell("b")), row(cell("x"), cell("y"), cell("z")));

    expect(explain(before, split).unexplained).not.toEqual([]);
    expect(rowWidths(before, split)).toBe("table 0 row 1: 2 cells became 3");
    expect(rowWidths(before, before)).toBeNull();
  });

  it("refuses a word that changed weight", () => {
    const text = (value: string, marks?: readonly PmMark[]): PmNode => ({
      type: NODE.text,
      text: value,
      ...(marks === undefined ? {} : { marks }),
    });
    const paragraph = (...content: readonly PmNode[]): PmNode => ({
      type: NODE.doc,
      content: [{ type: NODE.paragraph, content }],
    });

    expect(
      explain(paragraph(text("one "), text("two", [{ type: "bold" }])), paragraph(text("one two")))
        .unexplained,
    ).not.toEqual([]);
  });

  /**
   * Whitespace is the projection's blind spot and must not be the classifier's:
   * a trailing space dropped from a cell is a byte the file no longer has, and
   * nothing in {@link CATEGORIES} says a printer may drop one.
   */
  it("refuses whitespace that went missing", () => {
    const before = tableOf(row(cell("a"), cell("b")), row(cell("x "), cell("y")));
    const trimmed = tableOf(row(cell("a"), cell("b")), row(cell("x"), cell("y")));

    expect(explain(before, trimmed).unexplained).not.toEqual([]);
  });
});
