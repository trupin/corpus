import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CHARACTER_REFERENCE } from "./escape.js";
import { parseMarkdown } from "./parse.js";
import { NODE, type PmNode } from "./schema.js";
import { serializeDoc } from "./serialize.js";

/**
 * The round trip, over the repository's own documents — the sweep as a test
 * (UI-104).
 *
 * §11 gives the editor autosave and no save button, so **opening a document and
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
 * assertion is a **projection** — {@link project} reduces a document to
 * everything no normalisation may touch — and the invariant is that the
 * projection survives the round trip for every document. Anything a
 * normalisation is allowed to change is outside the projection by construction;
 * anything else fails, naming the file.
 *
 * That is also the growth guard. A new *defect* fails the projection. A new
 * *accepted* normalisation fails {@link CATEGORIES}, because every document
 * whose parse changes must classify into a named category and the set of names
 * is pinned. A category nobody classified is how this gets closed with a file
 * still moving.
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
 * Characters the projection ignores, and why each one is out.
 *
 * **Whitespace**, because moving it is what several of the accepted
 * normalisations *are*: a space at the inside edge of an emphasis marker is
 * hoisted out of it (`** **` closes nothing), a space at a line edge is dropped
 * because markdown drops it, and a line break inside a code span becomes the
 * space CommonMark says a code span renders it as. None of them changes a word.
 *
 * **The pipe**, because whether one is content or a delimiter is exactly the
 * question this issue settles: a row the file wrote wider than its header has
 * its surplus folded back behind the `|` it came from, which turns that
 * character from structure into a cell's text. Outside a table a pipe is
 * ordinary text and nothing here touches it.
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
    if (!IGNORED_CHARACTERS.test(character)) out += `${character}${marks};`;
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

/* ── Classification ─────────────────────────────────────────────────── */

/**
 * Every way a repository document is allowed to change on its first save, each
 * with the reason it is a normalisation rather than a rewrite.
 *
 * Measured over the 596 documents present when this was written: 554 change
 * byte-for-byte on the first save, 67 of them structurally. The counts below
 * are recorded for the reader and deliberately not asserted — they move
 * whenever a document is edited, and they overlap, because a document may hit
 * more than one. What must not move is the *set of names*.
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
   * 58 documents. `` `corpus init\n--port 8791` `` → `` `corpus init --port 8791` ``.
   *
   * CommonMark §6.1 makes a code span's line endings spaces, so this is already
   * what every reader shows: `MarkdownView`'s inline `code` inherits
   * `white-space: normal`, and the rendered page is character-for-character the
   * same before and after. Preserving the break would mean hand-rolling
   * `inlineCode`, which then owns backtick-fence widening, space padding, GFM's
   * table-cell escaping *and* a proof, for every line following a break, that
   * it cannot be read as a block — a `- `, `> `, `# `, `---` or blank line
   * there ends the paragraph and destroys the span. That is the proof
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
   * the author never wrote and every row in the table shifted. The residual
   * cost is that the padding around the fold is gone — GFM trims a cell's
   * edges, so no writer working from the parsed document can know whether the
   * author wrote `a | b` or `a|b`.
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
   * 15 documents. `**Stale **and** unread**` → `**Stale and unread**`, plus any
   * run an edit split across two nodes.
   *
   * The issue that raised this suspected the healing of malformed emphasis of
   * **extending the bold run**. It does not, and that is the finding rather
   * than an assumption: over the whole corpus and over the hand-built spellings
   * in `serialize.test.ts`, the characters carrying each mark are identical
   * before and after — which is what the projection asserts. Redundant markers
   * are dropped and adjacent runs merge into one node; no word changes weight.
   */
  inlineRunsMerged: "adjacent text carrying the same marks becomes one run",
} as const;

type Category = keyof typeof CATEGORIES;

function collect(node: PmNode, into: PmNode[] = []): PmNode[] {
  into.push(node);
  for (const child of node.content ?? []) collect(child, into);
  return into;
}

/**
 * Every significant character's marks **in the order the tree nests them**.
 *
 * Per character rather than per node so that it says nothing about where the
 * runs were split — merging two nodes leaves each character's mark list exactly
 * as it was, and only a re-nesting changes one.
 */
function markOrderPerCharacter(nodes: readonly PmNode[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.type !== NODE.text) continue;
    const order = (node.marks ?? []).map((mark) => mark.type).join("+");
    for (const character of node.text ?? "") {
      if (!IGNORED_CHARACTERS.test(character)) out += `${order};`;
    }
  }
  return out;
}

function textNodeCount(nodes: readonly PmNode[]): number {
  return nodes.filter((node) => node.type === NODE.text).length;
}

/** Why one document's parse changed, read off the features of the two trees. */
function classify(before: readonly PmNode[], after: readonly PmNode[]): Category[] {
  const found: Category[] = [];
  const codeRuns = before.filter(
    (node) => node.type === NODE.text && (node.marks ?? []).some((mark) => mark.type === "code"),
  );
  if (codeRuns.some((node) => /\r?\n/.test(node.text ?? ""))) found.push("inlineCodeLineBreak");
  const ragged = before
    .filter((node) => node.type === NODE.table)
    .some((table) => {
      const columns = table.content?.[0]?.content?.length ?? 0;
      return (table.content ?? []).some((row) => (row.content ?? []).length > columns);
    });
  if (ragged) found.push("tableSurplusFolded");
  if (markOrderPerCharacter(before) !== markOrderPerCharacter(after))
    found.push("markNestingOrder");
  if (textNodeCount(before) !== textNodeCount(after)) found.push("inlineRunsMerged");
  return found;
}

/* ── The sweep ──────────────────────────────────────────────────────── */

interface Result {
  readonly name: string;
  readonly settles: boolean;
  readonly projectionHeld: boolean;
  readonly columnCountHeld: boolean;
  readonly newEntity: boolean;
  readonly changed: boolean;
  readonly categories: readonly Category[];
}

/** Every table's column count, in document order — its header row's width. */
function columnCounts(nodes: readonly PmNode[]): string {
  return nodes
    .filter((node) => node.type === NODE.table)
    .map((table) => (table.content?.[0]?.content ?? []).length)
    .join(",");
}

/** The same pattern as {@link CHARACTER_REFERENCE}, counting rather than testing. */
const EVERY_CHARACTER_REFERENCE = new RegExp(CHARACTER_REFERENCE.source, "gi");

function entityCount(text: string): number {
  return text.match(EVERY_CHARACTER_REFERENCE)?.length ?? 0;
}

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
    const beforeNodes = collect(before);
    const afterNodes = collect(after);
    return {
      name: relative(root, path),
      settles: serializeDoc(after) === once,
      projectionHeld: project(before) === project(after),
      columnCountHeld: columnCounts(beforeNodes) === columnCounts(afterNodes),
      // Only an entity the source did not already have: several documents are
      // *about* character references and quote them verbatim.
      newEntity: entityCount(once) > entityCount(source),
      changed: JSON.stringify(before) !== JSON.stringify(after),
      categories: classify(beforeNodes, afterNodes),
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
  it("never changes a table's column count", () => {
    expect(failures((result) => !result.columnCountHeld)).toEqual([]);
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
   * The rule this issue exists to enforce: **a category nobody classified is
   * how it gets closed while a file still moves.** Every document whose parse
   * changes must be explained by a named entry in {@link CATEGORIES}, and one
   * that changes for a reason none of them covers fails here, by name.
   */
  it("classifies every document whose parse changes", () => {
    expect(failures((result) => result.changed && result.categories.length === 0)).toEqual([]);
  });

  it("uses no category that is not written down", () => {
    const seen = new Set(RESULTS.flatMap((result) => result.categories));
    expect([...seen].sort()).toEqual(Object.keys(CATEGORIES).sort());
  });

  it("leaves most documents structurally untouched", () => {
    // A blunt bound rather than a pinned count, which would go stale on every
    // documentation edit: the accepted normalisations reached 67 of 596
    // documents when this was written, and a change that suddenly touched a
    // third of the corpus would be a rewrite whatever it classified as.
    const changed = RESULTS.filter((result) => result.changed).length;
    expect(changed / RESULTS.length).toBeLessThan(0.2);
  });
});
