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
 * through {@link setFrontmatterFields}, which re-emits only the lines of the
 * keys it actually changed and copies every other key's lines from the source,
 * so untouched keys keep their original formatting *byte for byte*: not merely
 * their comments and key order, but flow-collection spacing, indentation width,
 * and padding around colons, none of which a YAML serializer reproduces.
 */

const OPEN_FENCE = /^(-{3,})([ \t]*)(\r?\n|$)/;
const CLOSE_FENCE = /^(-{3,})[ \t]*$/;
/** U+FEFF, escaped rather than literal so the character stays visible in review. */
const BOM = "\uFEFF";
/**
 * Duplicate keys are tolerated at the parser level so the corpus checker can
 * report them as the specific rule they violate (SPEC.md §14) instead of
 * collapsing every structural problem into "unparseable".
 */
const PARSE_OPTIONS = { uniqueKeys: false } as const;
/**
 * `lineWidth: 0` disables line folding: re-wrapping a long scalar would show up
 * as a spurious diff next to the field that actually changed.
 */
const STRINGIFY_OPTIONS = { lineWidth: 0 } as const;

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
  /**
   * The YAML source between the fences as it currently stands, including its
   * final line ending: the file's own bytes until a mutation, the spliced text
   * afterwards. Once {@link DocumentSource.frontmatterRewritten} is set it is
   * LF-normalized, and {@link serializeDocument} restores the file's own line
   * endings.
   */
  readonly frontmatterText: string;
  /** The closing fence line *without* its line ending, e.g. `"---"`. */
  readonly closeFence: string;
  /** The line ending that terminated the closing fence; `""` at end of file. */
  readonly closeFenceEol: string;
  /** Dominant line ending, used when a mutation has to emit new text. */
  readonly eol: "\n" | "\r\n";
  /** True once a mutation replaced {@link DocumentSource.frontmatterText}. */
  readonly frontmatterRewritten: boolean;
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
  /** YAML AST of {@link DocumentSource.frontmatterText}, for structural queries. */
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

  const yamlDoc = YAML.parseDocument(frontmatterText, PARSE_OPTIONS);
  if (yamlDoc.errors.length > 0) {
    const error = yamlDoc.errors[0];
    throw new DocumentParseError(
      `invalid YAML frontmatter: ${error?.message ?? "unknown error"}`,
      path,
      lineNumberAt(text, openFence.length + (error?.pos[0] ?? 0)),
    );
  }

  return {
    data: toPlainMapping(yamlDoc, { path, line: lineNumberAt(text, openFence.length) }),
    body: text.slice(cursor),
    yaml: yamlDoc,
    source: {
      bom,
      openFence,
      frontmatterText,
      closeFence,
      closeFenceEol,
      eol,
      frontmatterRewritten: false,
    },
  };
};

/**
 * The frontmatter YAML source, LF-normalized. Mutations work in LF and
 * {@link serializeDocument} restores the file's own line endings, so a CRLF
 * file never grows a mixed-ending frontmatter block.
 */
const currentFrontmatterText = (parsed: ParsedDocument): string =>
  parsed.source.frontmatterText.replaceAll("\r\n", "\n");

/**
 * Serialize back to file bytes. On an untouched parse this returns the original
 * string exactly, because every part is the recorded source text.
 */
export const serializeDocument = (parsed: ParsedDocument): string => {
  const { bom, openFence, frontmatterText, closeFence, closeFenceEol, eol, frontmatterRewritten } =
    parsed.source;
  const frontmatter =
    frontmatterRewritten && eol === "\r\n"
      ? frontmatterText.replaceAll("\n", "\r\n")
      : frontmatterText;
  return `${bom}${openFence}${frontmatter}${closeFence}${closeFenceEol}${parsed.body}`;
};

/** A top-level key paired with the exact source lines it occupies. */
type KeySegment = { readonly key: string; readonly text: string };

/**
 * The frontmatter's source split at top-level key boundaries: a `head` holding
 * anything before the first key (leading comments, directives), then one
 * segment per key running from the start of its own line to the start of the
 * next key's line. Nested block values, blank lines and trailing comments
 * therefore travel inside the segment of the key they belong to.
 *
 * Returns `null` for any shape a line-oriented split cannot describe honestly —
 * a non-mapping or empty frontmatter, flow style (`{a: 1, b: 2}`), explicit
 * `? key` entries, two keys sharing a line. Callers fall back to a full re-emit
 * there; correctness never depends on the split succeeding.
 */
const segmentTopLevelKeys = (
  src: string,
  doc: YAML.Document.Parsed,
): { readonly head: string; readonly segments: readonly KeySegment[] } | null => {
  const contents: unknown = doc.contents;
  if (!YAML.isMap(contents) || contents.flow === true) return null;
  const starts: { key: string; lineStart: number }[] = [];
  for (const item of contents.items) {
    const keyNode: unknown = item.key;
    if (!YAML.isScalar(keyNode)) return null;
    const keyStart = keyNode.range?.[0];
    if (keyStart === undefined) return null;
    const lineStart = src.lastIndexOf("\n", keyStart - 1) + 1;
    if (src.slice(lineStart, keyStart).trim() !== "") return null;
    const previous = starts.at(-1);
    if (previous !== undefined && lineStart <= previous.lineStart) return null;
    starts.push({ key: String(keyNode.value), lineStart });
  }
  const first = starts[0];
  if (first === undefined) return null;
  return {
    head: src.slice(0, first.lineStart),
    segments: starts.map(({ key, lineStart }, index) => ({
      key,
      text: src.slice(lineStart, starts[index + 1]?.lineStart ?? src.length),
    })),
  };
};

const withTrailingNewline = (text: string): string =>
  text === "" || text.endsWith("\n") ? text : `${text}\n`;

/**
 * Rebuild `emitted` so that every key the patch did not touch contributes its
 * original bytes instead of the serializer's rendering of them. Untouched keys
 * are matched by name in order, so duplicate keys (§14 reports them; the parser
 * tolerates them) each keep their own lines.
 *
 * Returns `null` when either side cannot be split by key, leaving the caller
 * with the fully re-emitted text.
 */
const spliceUntouchedKeys = (
  original: { readonly src: string; readonly doc: YAML.Document.Parsed },
  rewritten: { readonly src: string; readonly doc: YAML.Document.Parsed },
  touched: ReadonlySet<string>,
): string | null => {
  const from = segmentTopLevelKeys(original.src, original.doc);
  const to = segmentTopLevelKeys(rewritten.src, rewritten.doc);
  if (from === null || to === null) return null;
  const reusable = new Map<string, string[]>();
  for (const segment of from.segments) {
    const queue = reusable.get(segment.key);
    if (queue === undefined) reusable.set(segment.key, [segment.text]);
    else queue.push(segment.text);
  }
  const parts = [withTrailingNewline(from.head)];
  for (const segment of to.segments) {
    const reuse = touched.has(segment.key) ? undefined : reusable.get(segment.key)?.shift();
    parts.push(withTrailingNewline(reuse ?? segment.text));
  }
  return parts.join("");
};

/** Bounded so a YAML anchor that refers to its own ancestor cannot spin forever. */
const MAX_COMPARE_DEPTH = 32;

const deepEquals = (a: unknown, b: unknown, depth = 0): boolean => {
  if (Object.is(a, b)) return true;
  if (depth >= MAX_COMPARE_DEPTH) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEquals(item, b[index], depth + 1));
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every(
    (key) => Object.hasOwn(right, key) && deepEquals(left[key], right[key], depth + 1),
  );
};

/**
 * The `yaml` package's alias-amplification guard, kept at the library default.
 * Materializing a YAML mapping expands every `*alias`, so nested aliases
 * multiply: the classic "billion laughs" document is a few hundred bytes on
 * disk and unbounded memory in `toJS`. The server is the sole writer and parses
 * whatever a workspace's files contain, so this cap is a real defence, not
 * ceremony. No legitimate Corpus frontmatter comes near it — anchors and turns
 * are written literally.
 */
const MAX_ALIAS_COUNT = 100;

/** Where a mapping failure should be reported; the parse path knows both, mutations know neither. */
type SourceLocation = { readonly path?: string | undefined; readonly line: number };

const toPlainMapping = (
  doc: YAML.Document.Parsed,
  at: SourceLocation = { line: 1 },
): Record<string, unknown> => {
  let value: unknown;
  try {
    value = doc.toJS({ maxAliasCount: MAX_ALIAS_COUNT });
  } catch (error) {
    // The `yaml` package signals the cap with a plain `ReferenceError`. Re-throw
    // it as this module's own error so a hostile document fails the same typed,
    // path-and-line way as any other unreadable frontmatter instead of escaping
    // the parse boundary as something no caller is looking for.
    throw new DocumentParseError(
      `frontmatter aliases expand past the safe limit (${MAX_ALIAS_COUNT}): ${String(error)}`,
      at.path,
      at.line,
    );
  }
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
};

/**
 * The only supported frontmatter mutation path. A key set to `undefined` is
 * removed; a key whose value already equals the patch's is left alone, source
 * and all, so a read-modify-write that changes nothing writes nothing.
 *
 * The result re-emits only the lines of the keys that actually changed: every
 * other key contributes its original bytes. That is stronger than what a YAML
 * serializer can promise (it normalizes flow-collection spacing, indentation
 * width and padding after a colon), and it is what keeps an auto-commit's diff
 * (SPEC.md §4) limited to the fields the mutation touched. The splice is
 * checked against the fully re-emitted document before it is accepted, so a
 * shape it cannot describe degrades to a re-emit rather than to corruption.
 */
export const setFrontmatterFields = (
  parsed: ParsedDocument,
  patch: Readonly<Record<string, unknown>>,
): ParsedDocument => {
  // An absent key reads as `undefined`, which no defined patch value equals, so
  // adding a key always registers as a change.
  const changes = Object.entries(patch).filter(([key, value]) =>
    value === undefined ? Object.hasOwn(parsed.data, key) : !deepEquals(parsed.data[key], value),
  );
  if (changes.length === 0) return parsed;

  const src = currentFrontmatterText(parsed);
  // Parse twice rather than mutate in place: the AST is mutable, and patching
  // the caller's copy would retroactively change what serializing *it* emits.
  // The untouched copy keeps source ranges that still index into `src`.
  const originalDoc = YAML.parseDocument(src, PARSE_OPTIONS);
  const patchedDoc = YAML.parseDocument(src, PARSE_OPTIONS);
  for (const [key, value] of changes) {
    if (value === undefined) patchedDoc.delete(key);
    else patchedDoc.set(key, value);
  }

  const emitted = patchedDoc.toString(STRINGIFY_OPTIONS);
  const emittedDoc = YAML.parseDocument(emitted, PARSE_OPTIONS);
  const spliced = spliceUntouchedKeys(
    { src, doc: originalDoc },
    { src: emitted, doc: emittedDoc },
    new Set(changes.map(([key]) => key)),
  );

  let text = emitted;
  let doc = emittedDoc;
  if (spliced !== null && spliced !== emitted) {
    const splicedDoc = YAML.parseDocument(spliced, PARSE_OPTIONS);
    // Reusing source lines must not change what the frontmatter *means*; if it
    // somehow did, the re-emitted text is the trustworthy answer.
    if (
      splicedDoc.errors.length === 0 &&
      deepEquals(toPlainMapping(splicedDoc), toPlainMapping(emittedDoc))
    ) {
      text = spliced;
      doc = splicedDoc;
    }
  }

  return {
    data: toPlainMapping(doc),
    body: parsed.body,
    yaml: doc,
    source: { ...parsed.source, frontmatterText: text, frontmatterRewritten: true },
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
