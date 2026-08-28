import {
  formatStyleAttributes,
  scanInlineStyles,
  type InlineStyleKind,
  type StyleAttributes,
} from "@corpus/contract";

/**
 * SPEC.md §5's styling forms, as mdast nodes — the one place markdown becomes
 * styled content, for the reader and the editor alike.
 *
 * The **grammar** is not here. `@corpus/contract`'s `styled.ts` owns what a
 * marker is, because `apps/server` needs the same answer to strip markers out of
 * every passage and may not import this package. What is here is the part that
 * is genuinely the tree's: finding the markers across a *parsed* inline run, and
 * rebuilding that run with the styled content nested inside it.
 *
 * **Why this cannot be a text-node split** (which is all `remarkCorpusRefs`
 * needs). A `[[ref]]` is a leaf and always lies inside one text node. A styling
 * marker **wraps**, and what it wraps is frequently not text: `==a **b** c==`
 * reaches this plugin as three siblings — `text("==a ")`, `strong`,
 * `text(" c==")` — with the opening delimiter at the end of the first and the
 * closing one at the end of the third. A scanner that only looked inside single
 * text nodes would not see that marker at all, and the editor would then print a
 * highlight it could not read back. So the run is flattened, scanned once, and
 * rebuilt.
 *
 * **`<u>` is not a raw-HTML path.** remark parses `<u>` and `</u>` as two
 * `html` nodes with the content as their siblings; this plugin pairs exactly
 * those two tokens and produces an element for them. Every other tag stays the
 * inert text `MarkdownView` already makes of it — `rehype-raw` is still absent,
 * and there is still no sanitizer to get wrong.
 */

/** The mdast node type a recognised marker becomes. */
export const STYLE_NODE_TYPE = "corpusStyle";

/** Which of §5's three inline forms a node came from. */
export const STYLE_KIND_ATTRIBUTE = "data-corpus-style";
export const STYLE_COLOR_ATTRIBUTE = "data-corpus-color";
export const STYLE_HIGHLIGHT_ATTRIBUTE = "data-corpus-highlight";

/**
 * Structural view of the mdast nodes this transform touches — the same reasoning
 * `refs.ts` gives for its own: a remark upgrade must not become a kit release.
 */
export interface StyledMdast {
  type: string;
  value?: string;
  children?: StyledMdast[];
  data?: Record<string, unknown>;
  position?: { start?: { offset?: number }; end?: { offset?: number } } | undefined;
}

/** What a styled node carries, read back out of it. */
export interface StyleInfo {
  readonly kind: InlineStyleKind;
  readonly attrs: StyleAttributes;
}

const UNDERLINE_OPEN = "<u>";
const UNDERLINE_CLOSE = "</u>";

/**
 * The character standing in for anything the scanner must not read as a
 * delimiter: a node it cannot see inside, and a character the author escaped.
 *
 * U+FFFF is a permanent non-character — no markdown document contains one, and
 * CommonMark replaces U+0000 rather than passing it through, so neither can
 * reach a text node's value and be mistaken for this.
 */
const OPAQUE = "￿";

/** ASCII punctuation, the set a backslash may escape (CommonMark §2.4). */
const ESCAPABLE = /[!-/:-@[-`{-~]/;

/**
 * One piece of a flattened inline run: where it sits in the flat string, and
 * what it came from.
 */
interface Segment {
  readonly kind: "text" | "atom" | "tag";
  readonly node: StyledMdast;
  readonly start: number;
  readonly end: number;
}

interface Flattened {
  /** The run's characters, for rebuilding text out of a range. */
  readonly text: string;
  /**
   * The same string with every character the scanner must not read as a
   * delimiter replaced by {@link OPAQUE}. Offsets are identical, so a match
   * found here addresses {@link text}.
   */
  readonly scan: string;
  readonly segments: readonly Segment[];
}

/**
 * Which characters of a text node's value the author wrote with a backslash.
 *
 * The value alone cannot say: `\=\=x\=\=` and `==x==` are the same six
 * characters by the time remark is done, and one of them is a highlight while
 * the other is the literal text somebody escaped to stop it being one. The
 * source is what tells them apart, so the node's own position is walked against
 * it.
 *
 * **The one case this does not cover, on the record.** A character reference
 * (`&amp;`) is also resolved into the value, and it is not `\X`, so the walk
 * desynchronises at the first one and returns what it found before it. A text
 * node holding *both* a character reference and an escaped delimiter would
 * therefore read that delimiter as a marker — one silent rewrite, converging,
 * and unreachable from anything this repository writes: `serialize.ts`
 * guarantees it never emits a character reference and `escape.test.ts` asserts
 * it. The alternative is a second entity decoder living in the kit, which is a
 * proof obligation this module declines for one hand-written corner.
 */
function escapedIndices(source: string, node: StyledMdast): ReadonlySet<number> {
  const value = node.value ?? "";
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number") return EMPTY_SET;
  const src = source.slice(start, end);
  if (src === value) return EMPTY_SET;

  const marks = new Set<number>();
  let from = 0;
  let to = 0;
  while (from < src.length && to < value.length) {
    if (src[from] === "\\" && src[from + 1] === value[to] && ESCAPABLE.test(value[to] ?? "")) {
      marks.add(to);
      from += 2;
      to += 1;
      continue;
    }
    if (src[from] !== value[to]) return marks;
    from += 1;
    to += 1;
  }
  return marks;
}

const EMPTY_SET: ReadonlySet<number> = new Set<number>();

/** Whether an `html` node is one of the two tokens underline is spelled with. */
function underlineTag(node: StyledMdast): boolean {
  if (node.type !== "html") return false;
  return node.value === UNDERLINE_OPEN || node.value === UNDERLINE_CLOSE;
}

/**
 * An inline run as one string plus the map back.
 *
 * A node the scanner cannot see inside becomes a single opaque character, so a
 * marker either contains it whole or not at all — a delimiter can never land
 * halfway through a `strong` or a `[[ref]]`.
 */
function flatten(children: readonly StyledMdast[], source: string): Flattened {
  let text = "";
  let scan = "";
  const segments: Segment[] = [];

  for (const child of children) {
    const start = text.length;
    if (child.type === "text" && typeof child.value === "string") {
      const escaped = escapedIndices(source, child);
      let masked = "";
      for (let index = 0; index < child.value.length; index += 1) {
        const character = child.value[index] ?? "";
        // `<` is masked unconditionally: an underline's delimiters come from
        // `html` nodes, so a `<u>` sitting in a *text* node is text somebody
        // escaped and must never pair with anything.
        masked += escaped.has(index) || character === "<" ? OPAQUE : character;
      }
      text += child.value;
      scan += masked;
      segments.push({ kind: "text", node: child, start, end: text.length });
      continue;
    }
    if (underlineTag(child)) {
      const value = child.value ?? "";
      text += value;
      scan += value;
      segments.push({ kind: "tag", node: child, start, end: text.length });
      continue;
    }
    text += OPAQUE;
    scan += OPAQUE;
    segments.push({ kind: "atom", node: child, start, end: text.length });
  }

  return { text, scan, segments };
}

/** Whether a range covers exactly one `tag` segment — how an underline is verified. */
function isTagRange(flat: Flattened, start: number, end: number): boolean {
  return flat.segments.some(
    (segment) => segment.kind === "tag" && segment.start === start && segment.end === end,
  );
}

/** The nodes a flat range describes, with boundary text nodes cut to fit. */
function rebuild(flat: Flattened, from: number, to: number): StyledMdast[] {
  const out: StyledMdast[] = [];
  for (const segment of flat.segments) {
    if (segment.end <= from || segment.start >= to) continue;
    if (segment.kind === "text" || segment.kind === "tag") {
      const slice = flat.text.slice(Math.max(segment.start, from), Math.min(segment.end, to));
      if (slice === "") continue;
      // A `tag` segment that survives here was never paired, so it stays the
      // `html` node it was and renders inert, exactly as before.
      if (segment.kind === "tag" && slice === (segment.node.value ?? "")) {
        out.push(segment.node);
        continue;
      }
      out.push({ type: "text", value: slice });
      continue;
    }
    if (segment.start >= from && segment.end <= to) out.push(segment.node);
  }
  return out;
}

/** The rendering a styled node gets, and the data the editor reads back. */
function styleNode(info: StyleInfo, children: StyledMdast[]): StyledMdast {
  const properties: Record<string, string> = { [STYLE_KIND_ATTRIBUTE]: info.kind };
  const classes = ["md-style", `md-style-${info.kind}`];
  if (info.attrs.color !== undefined) {
    properties[STYLE_COLOR_ATTRIBUTE] = info.attrs.color;
    classes.push(`md-style-color-${info.attrs.color}`);
  }
  if (info.attrs.highlight !== undefined) {
    properties[STYLE_HIGHLIGHT_ATTRIBUTE] = info.attrs.highlight;
    classes.push(`md-style-highlight-${info.attrs.highlight}`);
  }
  const hName = info.kind === "underline" ? "u" : info.kind === "highlight" ? "mark" : "span";
  return {
    type: STYLE_NODE_TYPE,
    data: { hName, hProperties: { ...properties, className: classes.join(" ") } },
    children,
  };
}

/** What a styled node carries, or `null` when the node is not one. */
export function styleOf(node: StyledMdast): StyleInfo | null {
  if (node.type !== STYLE_NODE_TYPE) return null;
  const properties = node.data?.["hProperties"];
  if (typeof properties !== "object" || properties === null) return null;
  const record = properties as Record<string, unknown>;
  const kind = record[STYLE_KIND_ATTRIBUTE];
  if (kind !== "underline" && kind !== "highlight" && kind !== "span") return null;
  const attrs: { color?: string; highlight?: string } = {};
  const color = record[STYLE_COLOR_ATTRIBUTE];
  if (typeof color === "string") attrs.color = color;
  const highlight = record[STYLE_HIGHLIGHT_ATTRIBUTE];
  if (typeof highlight === "string") attrs.highlight = highlight;
  return { kind, attrs: attrs as StyleAttributes };
}

/** The markdown a styled node is written as — the serializer's delimiters. */
export function styleDelimiters(info: StyleInfo): { open: string; close: string } {
  switch (info.kind) {
    case "underline":
      return { open: UNDERLINE_OPEN, close: UNDERLINE_CLOSE };
    case "highlight":
      return { open: "==", close: "==" };
    case "span":
      return { open: "[", close: `]{${formatStyleAttributes(info.attrs)}}` };
  }
}

/**
 * One inline run, with every marker in it nested.
 *
 * Recursive on the inner run rather than on the whole tree: the scanner reports
 * outermost matches, so `==a <u>b</u> c==` produces the highlight here and the
 * underline when the highlight's own children come back through.
 */
function transformRun(children: readonly StyledMdast[], source: string): StyledMdast[] | null {
  const flat = flatten(children, source);
  const matches = scanInlineStyles(flat.scan).filter((match) => {
    if (match.kind !== "underline") return true;
    // Both delimiters must be whole `html` nodes; text that merely spells `<u>`
    // was escaped by its author and pairs with nothing.
    return (
      isTagRange(flat, match.start, match.innerStart) && isTagRange(flat, match.innerEnd, match.end)
    );
  });
  if (matches.length === 0) return null;

  const out: StyledMdast[] = [];
  let cursor = 0;
  for (const match of matches) {
    out.push(...rebuild(flat, cursor, match.start));
    const inner = rebuild(flat, match.innerStart, match.innerEnd);
    out.push(
      styleNode({ kind: match.kind, attrs: match.attrs }, transformRun(inner, source) ?? inner),
    );
    cursor = match.end;
  }
  out.push(...rebuild(flat, cursor, flat.text.length));
  return out;
}

/**
 * Every parent whose children are an inline run, transformed.
 *
 * `code` and `inlineCode` hold no children, so a marker written inside either is
 * never seen — which is what keeps a document *about* the syntax rendering the
 * syntax.
 */
function walk(node: StyledMdast, source: string): void {
  const children = node.children;
  if (children === undefined) return;
  const replaced = transformRun(children, source);
  const next = replaced ?? children;
  for (const child of next) walk(child, source);
  if (replaced !== null) node.children = replaced;
}

/**
 * The remark plugin.
 *
 * **Order matters**: this must run before any plugin that splits text nodes,
 * because it reads each node's position against the source to tell an escaped
 * delimiter from a written one, and a split node has no position. In both
 * pipelines it therefore sits ahead of `remarkCorpusRefs` — which still finds
 * every ref, because it recurses into whatever children this leaves behind.
 */
export function remarkCorpusStyling(): (tree: unknown, file: unknown) => void {
  return (tree: unknown, file: unknown): void => {
    if (typeof tree !== "object" || tree === null) return;
    const value = (file as { value?: unknown } | null)?.value;
    // `VFile.value` is a string or a Buffer; anything else is not a source and
    // is treated as none, which only costs escape awareness.
    const source = typeof value === "string" ? value : "";
    walk(tree as StyledMdast, source);
  };
}
