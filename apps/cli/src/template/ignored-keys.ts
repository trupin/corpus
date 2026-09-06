import { PRESENTATION_FRONTMATTER_KEYS, SERVER_STAMPED_FRONTMATTER_KEYS } from "@corpus/contract";
import { sha256 } from "./manifest.js";

/**
 * Frontmatter keys the template comparison ignores (CLI-083, UI-189).
 *
 * A template document installed by `corpus init` starts accumulating deltas the
 * moment the workspace runs: the server re-stamps `updated:` on every content
 * edit it makes on the user's behalf, and dragging a board column writes
 * `width:` into the view's own document. Neither is a person editing the file,
 * yet both used to make the three-way compare read "modified here" — which
 * widened every upgrade report and turned a resized view into a permanent
 * conflict with every future template change (the 0.32.0 → 0.33.0 upgrade of a
 * real workspace is the reporting incident for both).
 *
 * The two key classes are declared once, in `@corpus/contract`
 * (`frontmatter-keys.ts`, CONTRACT-098), and **unioned here at the call site**
 * — the contract deliberately exports the classes and not the union, so that a
 * reader can always tell which list a key is on and why, and so no third
 * declaration exists to drift.
 *
 * Ignoring a key creates one obligation this module also carries
 * (sprint-024 P5): the `update` verdict's write must *preserve* the workspace's
 * ignored keys, because the very first upgrade the comparison change enables
 * would otherwise overwrite `width: 686` with template bytes carrying no
 * `width` at all — and would move `updated` backwards to the template's fixed
 * seed date, which §5's staleness ramp and §9.2's ordering both read. That is
 * {@link preserveUpgradeIgnoredKeys}, used by `workspace upgrade` beside
 * {@link normalizedSha256}, so the comparison and the write cannot disagree
 * about which keys are ignored.
 *
 * Everything here is **line-based, not YAML-based**, on purpose. Parsing and
 * re-serializing frontmatter would erase comments and formatting, making two
 * genuinely different files normalize equal; dropping whole key lines erases
 * exactly the delta being ignored and nothing else. The keys involved are
 * single-line scalars the server writes (`updated: 2026-…`, `width: 686`), and
 * an indented continuation after a matched key line belongs to that key's value
 * in YAML, so it travels with it.
 */

/**
 * The union the upgrade comparison ignores — every server-stamped key and every
 * presentation key, in one derived expression (sprint-024 S1).
 */
export const UPGRADE_IGNORED_KEYS: ReadonlySet<string> = new Set([
  ...SERVER_STAMPED_FRONTMATTER_KEYS,
  ...PRESENTATION_FRONTMATTER_KEYS,
]);

/**
 * A top-level frontmatter line that sets an ignored key: the key at column 0,
 * a colon, then whitespace or end of line. Built from the contract's own lists,
 * so a key added there is ignored here without this module changing.
 */
const IGNORED_KEY_LINE = new RegExp(`^(${[...UPGRADE_IGNORED_KEYS].join("|")}):(?=[ \\t\\r]|$)`);

/** A UTF-8 byte-order mark, as its escape so it is visible in this source. */
const BOM = "\uFEFF";

/**
 * The sha of a file with its ignored frontmatter keys removed — the identity
 * the comparison uses where "differs only in ignored keys" must read as "does
 * not differ". A file with no frontmatter block normalizes to itself.
 */
export function normalizedSha256(contents: Buffer): string {
  return sha256(Buffer.from(normalizeIgnoredKeys(contents.toString("utf8")), "utf8"));
}

/**
 * `text` with every top-level ignored-key line (and its indented continuation
 * lines) removed from the frontmatter block. Every other byte — body, comments,
 * formatting, the fences themselves — is untouched, so two normalized copies
 * are equal exactly when the originals differ only in ignored keys.
 */
export function normalizeIgnoredKeys(text: string): string {
  const block = frontmatterBlock(text);
  if (block === null) return text;

  const { lines, close } = block;
  const drop = new Set<number>();
  for (const span of ignoredKeySpans(lines, close)) {
    for (let index = span.start; index < span.end; index += 1) drop.add(index);
  }
  if (drop.size === 0) return text;
  return lines.filter((_, index) => !drop.has(index)).join("\n");
}

/**
 * The frontmatter keys in which two copies differ, in the contract's declared
 * order — the vocabulary `corpus workspace diff` prints when that difference is
 * the whole difference. Empty when every ignored key reads the same in both.
 */
export function ignoredKeyDelta(one: string, other: string): readonly string[] {
  const here = ignoredKeyText(one);
  const there = ignoredKeyText(other);
  return [...UPGRADE_IGNORED_KEYS].filter((key) => here.get(key) !== there.get(key));
}

/**
 * The template's bytes with the workspace copy's ignored keys carried over —
 * what an `update` verdict writes (sprint-024 P5, TEST-1094, TEST-1099).
 *
 * The rule: an ignored key **present in the workspace copy** survives the
 * write. A key the template carries at a position the workspace also carries is
 * replaced in place; a key the template does not carry (`width`, which no
 * template ships) is appended just before the closing fence. A key the
 * workspace copy does not carry keeps the template's value — preserving is not
 * deleting. When either side has no frontmatter block there is nothing to carry
 * or nowhere to put it, and the template's bytes are returned unchanged.
 */
export function preserveUpgradeIgnoredKeys(template: string, workspace: string): string {
  const carried = workspaceKeyLines(workspace);
  if (carried.size === 0) return template;

  const block = frontmatterBlock(template);
  if (block === null) return template;

  const { lines, close } = block;
  const spans = ignoredKeySpans(lines, close);
  const replaced = new Set<string>();

  const output: string[] = [];
  let index = 0;
  while (index < lines.length) {
    if (index === close) {
      // Keys the template does not carry land at the end of its block, in the
      // contract's declared order so two upgrades write the same bytes.
      for (const key of UPGRADE_IGNORED_KEYS) {
        const kept = carried.get(key);
        if (kept !== undefined && !replaced.has(key)) output.push(...kept);
      }
    }
    const span = spans.find((candidate) => candidate.start === index);
    const kept = span === undefined ? undefined : carried.get(span.key);
    if (span !== undefined && kept !== undefined) {
      output.push(...kept);
      replaced.add(span.key);
      index = span.end;
      continue;
    }
    output.push(lines[index] ?? "");
    index += 1;
  }
  return output.join("\n");
}

interface KeySpan {
  readonly key: string;
  /** Index of the key's own line. */
  readonly start: number;
  /** One past the last continuation line. */
  readonly end: number;
}

interface FrontmatterLines {
  /** The whole text, split on `\n`, `\r` and all. */
  readonly lines: readonly string[];
  /** Index of the closing fence line. */
  readonly close: number;
}

/** The block between the fences, or `null` when the text does not open with one. */
function frontmatterBlock(text: string): FrontmatterLines | null {
  const lines = text.split("\n");
  if (!isFence(lines[0])) return null;
  for (let index = 1; index < lines.length; index += 1) {
    if (isFence(lines[index])) return { lines, close: index };
  }
  // Unterminated: not a document this reader will rewrite or normalize.
  return null;
}

function isFence(line: string | undefined): boolean {
  if (line === undefined) return false;
  const bare = line.startsWith(BOM) ? line.slice(BOM.length) : line;
  return bare === "---" || bare === "---\r";
}

/** Every top-level ignored-key span inside the block, in line order. */
function ignoredKeySpans(lines: readonly string[], close: number): readonly KeySpan[] {
  const spans: KeySpan[] = [];
  let index = 1;
  while (index < close) {
    const match = IGNORED_KEY_LINE.exec(lines[index] ?? "");
    if (match === null) {
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < close && /^[ \t]/.test(lines[end] ?? "")) end += 1;
    spans.push({ key: match[1] ?? "", start: index, end });
    index = end;
  }
  return spans;
}

/** Each ignored key's lines in `text`, first occurrence per key. */
function workspaceKeyLines(text: string): ReadonlyMap<string, readonly string[]> {
  const block = frontmatterBlock(text);
  if (block === null) return new Map();
  const carried = new Map<string, readonly string[]>();
  for (const span of ignoredKeySpans(block.lines, block.close)) {
    if (!carried.has(span.key)) carried.set(span.key, block.lines.slice(span.start, span.end));
  }
  return carried;
}

/** Each ignored key's lines as one string, for {@link ignoredKeyDelta}. */
function ignoredKeyText(text: string): ReadonlyMap<string, string> {
  const joined = new Map<string, string>();
  for (const [key, lines] of workspaceKeyLines(text)) joined.set(key, lines.join("\n"));
  return joined;
}
