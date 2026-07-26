import * as YAML from "yaml";

/**
 * Markdown + YAML frontmatter round-tripping (SPEC.md §5). This module is the
 * only place in the system that knows the on-disk container format.
 *
 * The hard guarantee is **byte stability**: parsing a document and serializing
 * it back without touching anything reproduces the original bytes exactly —
 * line endings, trailing newline, BOM, key order, comments, quoting style, and
 * plugin keys the core knows nothing about. That is what lets the server be the
 * sole writer without churning files it merely read, and what keeps `git diff`
 * an honest record of what a mutation actually changed.
 *
 * It is achieved structurally rather than by comparison: a parse records the
 * exact source of each part, and serialization concatenates those parts back.
 * Only a part that was explicitly replaced is re-emitted. Frontmatter edits go
 * through {@link setFrontmatterFields}, which mutates the retained YAML AST, so
 * untouched nodes keep their original formatting.
 */

const OPEN_FENCE = /^(-{3,})([ \t]*)(\r?\n|$)/;
const CLOSE_FENCE = /^(-{3,})[ \t]*$/;
/** U+FEFF, escaped rather than literal so the character stays visible in review. */
const BOM = "\uFEFF";

export class DocumentParseError extends Error {
  override readonly name = "DocumentParseError";
  constructor(
    message: string,
    readonly path: string | undefined,
    readonly line: number,
  ) {
    super(`${path ?? "<document>"}:${line}: ${message}`);
  }
}

/** Exact source of every part of the file, in concatenation order. */
type DocumentSource = {
  /** `\uFEFF` when the file carried a UTF-8 BOM, else `""`. */
  readonly bom: string;
  /** The opening fence line including its line ending, e.g. `"---\n"`. */
  readonly openFence: string;
  /** Exact YAML source between the fences, including its final line ending. */
  readonly frontmatterText: string;
  /** The closing fence line *without* its line ending, e.g. `"---"`. */
  readonly closeFence: string;
  /** The line ending that terminated the closing fence; `""` at end of file. */
  readonly closeFenceEol: string;
  /** Dominant line ending, used when a mutation has to emit new text. */
  readonly eol: "\n" | "\r\n";
  /** True once the YAML AST has been mutated and must be re-emitted. */
  readonly frontmatterDirty: boolean;
};

export type ParsedDocument = {
  /**
   * The frontmatter mapping exactly as written — no defaults, no coercion.
   * Validation and defaulting live in `frontmatter.ts` and stay out of the
   * parse so that "what the file says" and "what the system assumes" never get
   * confused (SPEC.md §5; a read must not materialize defaults onto disk).
   */
  readonly data: Record<string, unknown>;
  /** Markdown body, verbatim, without the frontmatter block. */
  readonly body: string;
  /** Retained YAML AST — the source of round-trip fidelity across mutations. */
  readonly yaml: YAML.Document.Parsed;
  readonly source: DocumentSource;
};

// `\n` wins ties: a file with no line ending at all is written LF.
const detectEol = (raw: string): "\n" | "\r\n" => {
  const firstLf = raw.indexOf("\n");
  return firstLf > 0 && raw[firstLf - 1] === "\r" ? "\r\n" : "\n";
};

const lineNumberAt = (raw: string, offset: number): number =>
  raw.slice(0, offset).split("\n").length;

/**
 * Split a document into its parts. Throws {@link DocumentParseError} when the
 * leading fence is missing or unterminated — a document with no frontmatter is
 * a defect, never an empty mapping.
 */
export const parseDocument = (raw: string, path?: string): ParsedDocument => {
  const bom = raw.startsWith(BOM) ? BOM : "";
  const text = raw.slice(bom.length);
  const eol = detectEol(text);

  const opening = OPEN_FENCE.exec(text);
  if (opening === null) {
    throw new DocumentParseError(
      "missing YAML frontmatter fence (expected a leading `---`)",
      path,
      1,
    );
  }
  const openFence = opening[0];
  let cursor = openFence.length;
  let frontmatterText = "";
  let closeFence: string | null = null;
  let closeFenceEol = "";

  while (cursor <= text.length) {
    const newline = text.indexOf("\n", cursor);
    const lineEnd = newline === -1 ? text.length : newline;
    const withoutCr = lineEnd > cursor && text[lineEnd - 1] === "\r" ? lineEnd - 1 : lineEnd;
    const line = text.slice(cursor, withoutCr);
    if (CLOSE_FENCE.test(line)) {
      closeFence = line;
      closeFenceEol = text.slice(withoutCr, newline === -1 ? text.length : newline + 1);
      cursor = newline === -1 ? text.length : newline + 1;
      break;
    }
    if (newline === -1) {
      cursor = text.length;
      frontmatterText += line;
      break;
    }
    frontmatterText += text.slice(cursor, newline + 1);
    cursor = newline + 1;
  }

  if (closeFence === null) {
    throw new DocumentParseError(
      "unterminated YAML frontmatter fence (no closing `---`)",
      path,
      lineNumberAt(text, text.length),
    );
  }

  // Duplicate keys are tolerated at the parser level so the corpus checker can
  // report them as the specific rule they violate (§14) instead of collapsing
  // every structural problem into "unparseable".
  const yamlDoc = YAML.parseDocument(frontmatterText, { uniqueKeys: false });
  if (yamlDoc.errors.length > 0) {
    const error = yamlDoc.errors[0];
    throw new DocumentParseError(
      `invalid YAML frontmatter: ${error?.message ?? "unknown error"}`,
      path,
      lineNumberAt(text, openFence.length + (error?.pos[0] ?? 0)),
    );
  }

  const parsed: unknown = yamlDoc.toJS({ maxAliasCount: -1 });
  const data =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};

  return {
    data,
    body: text.slice(cursor),
    yaml: yamlDoc,
    source: {
      bom,
      openFence,
      frontmatterText,
      closeFence,
      closeFenceEol,
      eol,
      frontmatterDirty: false,
    },
  };
};

/**
 * The frontmatter YAML source as it stands: the recorded source text while
 * untouched, the re-emitted AST once mutated. Always LF, always ending in a
 * newline — {@link serializeDocument} restores the file's own line endings.
 *
 * `lineWidth: 0` disables line folding: re-wrapping an untouched long scalar
 * would show up as a spurious diff next to the field that actually changed.
 */
const currentFrontmatterText = (parsed: ParsedDocument): string =>
  parsed.source.frontmatterDirty
    ? parsed.yaml.toString({ lineWidth: 0 })
    : parsed.source.frontmatterText.replaceAll("\r\n", "\n");

/**
 * Serialize back to file bytes. On an untouched parse this returns the original
 * string exactly, because every part is the recorded source text.
 */
export const serializeDocument = (parsed: ParsedDocument): string => {
  const { bom, openFence, frontmatterText, closeFence, closeFenceEol, eol, frontmatterDirty } =
    parsed.source;
  const emitted = currentFrontmatterText(parsed);
  const frontmatter = !frontmatterDirty
    ? frontmatterText
    : eol === "\r\n"
      ? emitted.replaceAll("\n", "\r\n")
      : emitted;
  return `${bom}${openFence}${frontmatter}${closeFence}${closeFenceEol}${parsed.body}`;
};

/**
 * The only supported frontmatter mutation path. A key set to `undefined` is
 * removed; every other value is written through the AST so untouched keys keep
 * their comments, order and quoting.
 */
export const setFrontmatterFields = (
  parsed: ParsedDocument,
  patch: Readonly<Record<string, unknown>>,
): ParsedDocument => {
  const entries = Object.entries(patch);
  if (entries.length === 0) return parsed;
  // Re-parse rather than mutate in place: the AST is mutable, and patching the
  // caller's copy would retroactively change what serializing *it* emits.
  // Round-tripping YAML source through the parser is lossless, so the fresh AST
  // carries the same comments, order and quoting as the one it replaces.
  const yamlDoc = YAML.parseDocument(currentFrontmatterText(parsed), { uniqueKeys: false });
  for (const [key, value] of entries) {
    if (value === undefined) yamlDoc.delete(key);
    else yamlDoc.set(key, value);
  }
  const next: unknown = yamlDoc.toJS({ maxAliasCount: -1 });
  return {
    data: next !== null && typeof next === "object" ? (next as Record<string, unknown>) : {},
    body: parsed.body,
    yaml: yamlDoc,
    source: { ...parsed.source, frontmatterDirty: true },
  };
};

/** Replace the body, leaving frontmatter source untouched. */
export const setBody = (parsed: ParsedDocument, body: string): ParsedDocument =>
  body === parsed.body ? parsed : { ...parsed, body };

/**
 * Keys written more than once at `path` in the frontmatter mapping. YAML allows
 * it (the last wins) but Corpus does not: duplicate anchor ids are a hard
 * validation failure (§14), and reporting them needs the AST, since the plain
 * object has already collapsed them.
 */
export const duplicateKeysAt = (parsed: ParsedDocument, path: readonly string[]): string[] => {
  const node: unknown = path.length === 0 ? parsed.yaml.contents : parsed.yaml.getIn(path, true);
  if (!YAML.isMap(node)) return [];
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of node.items) {
    const key = YAML.isScalar(item.key) ? String(item.key.value) : String(item.key);
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return [...duplicates];
};

/** True when the file wrote this frontmatter key at all — `due: null` is not the same as no `due`. */
export const hasFrontmatterKey = (parsed: ParsedDocument, key: string): boolean =>
  Object.hasOwn(parsed.data, key);
