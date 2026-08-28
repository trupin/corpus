import { codeRanges, overlapsRange, splitLines, type TextRange } from "./code.js";

/**
 * Corpus markdown's styling forms, and the one transform that removes them
 * (SPEC.md §5, rider signed 2026-08-12).
 *
 * §5 admits three styling forms beyond CommonMark/GFM — `<u>underline</u>`,
 * `==highlight==` and Pandoc-style attribute markers, inline (`[phrase]{…}`) and
 * block (`::: {…}` … `:::`) — with a **closed** attribute vocabulary: `color`,
 * `highlight`, `align`, `indent`.
 *
 * **Why the contract owns it.** Three consumers need the same answer about what
 * a marker is. The editor parses and prints them (`apps/ui`), the reader renders
 * them (`packages/kit`), and the server strips them out of everything
 * passage-shaped (`apps/server`). `apps/server` may not import `packages/kit`,
 * so with the grammar in the kit the only way for the server to strip would be a
 * second copy of it — and two copies of a format rule that happen to agree today
 * are a silent corruption tomorrow. This is `headings.ts`'s reasoning
 * (CONTRACT-070) applied to a second format rule.
 *
 * **This is not a markdown parser and must not become one.** It recognises four
 * constructs by name and is blind to every other one: emphasis, headings, links,
 * lists and tables are text to it. sprint-019 Adjudication 5 — "`apps/server`
 * has no markdown parser and is not getting one" — still holds, and the reason
 * it gave holds with it: a heuristic that ate `**` would also eat a document
 * that is *about* asterisks. Nothing here eats anything §5 did not name.
 *
 * **A marker that is not admissible is ordinary text**, never an error and never
 * a marker with an ignored attribute. §5 says so directly: "A marker carrying
 * any other attribute is not an error — it is ordinary text — and never invents
 * behaviour." So an unknown attribute name, a value outside its set, an
 * attribute used in a position it has no meaning in, and an unterminated marker
 * all leave the characters exactly as the author typed them.
 */

/**
 * The colour roles a body may name, and the only ones (SPEC.md §5): "Colours are
 * **named roles from the style map**, never raw hex in the body."
 *
 * A closed set is what makes a document re-themable without editing it — a body
 * that says `color="warning"` renders correctly in light and dark because the
 * role, not the colour, is what was written down.
 */
export const STYLE_ROLES = ["accent", "warning", "positive", "muted"] as const;

/**
 * Block alignment values.
 *
 * §5 closes the attribute *vocabulary* and leaves these value sets to the
 * implementation (SHARED-035's sign-off: "`align` and `indent` values are left
 * unenumerated in the spec"). These four are CSS's own, and a body that names a
 * fifth is text.
 */
export const ALIGN_VALUES = ["left", "center", "right", "justify"] as const;

/**
 * Indent levels. Three, because an indent is a step in a rendered document and
 * not a measurement — a body that could say `indent="17"` would be carrying
 * layout, which §5 puts in the style rather than the text.
 */
export const INDENT_LEVELS = [1, 2, 3] as const;

export type StyleRole = (typeof STYLE_ROLES)[number];
export type StyleAlign = (typeof ALIGN_VALUES)[number];
export type StyleIndent = (typeof INDENT_LEVELS)[number];

/** Where an attribute may be written. */
export type StylePosition = "inline" | "block";

/**
 * The attributes one marker carries. Every field is optional and at least one is
 * present — a marker with no attributes is not a marker.
 */
export interface StyleAttributes {
  readonly color?: StyleRole;
  readonly highlight?: StyleRole;
  readonly align?: StyleAlign;
  readonly indent?: StyleIndent;
}

/**
 * Which attributes are admissible where, and why the partition exists.
 *
 * `color` and `highlight` paint a phrase; `align` and `indent` lay out a block.
 * Writing an alignment on a phrase inside a paragraph has no rendering in any
 * target, so a marker that carried one would "do nothing at all while appearing
 * to work" — the exact failure §5's rider forbids. An attribute in the wrong
 * position therefore makes its marker ordinary text, on the same footing as an
 * attribute name §5 never declared.
 */
const ADMISSIBLE: Readonly<Record<StylePosition, readonly string[]>> = {
  inline: ["color", "highlight"],
  block: ["align", "indent"],
};

/** The canonical order attributes are written in, so output is byte-stable. */
const ATTRIBUTE_ORDER = ["color", "highlight", "align", "indent"] as const;

const ROLE_SET: ReadonlySet<string> = new Set(STYLE_ROLES);

/** `name="value"`, and nothing else — a bare name or a single-quoted value is not one. */
const ATTRIBUTE_PAIR = /^([a-z]+)="([^"}]*)"/;

function roleValue(raw: string): StyleRole | null {
  return ROLE_SET.has(raw) ? (raw as StyleRole) : null;
}

/**
 * The attributes a `{…}` list holds, or `null` when the list is not admissible
 * in `position` — which makes the marker around it ordinary text.
 *
 * `source` is the text **between** the braces. The whole of it must be pairs:
 * trailing rubbish is what tells `[a]{color="accent"} b}` from a marker.
 */
export function parseStyleAttributes(
  source: string,
  position: StylePosition,
): StyleAttributes | null {
  const admissible = ADMISSIBLE[position];
  const out: {
    color?: StyleRole;
    highlight?: StyleRole;
    align?: StyleAlign;
    indent?: StyleIndent;
  } = {};
  const seen = new Set<string>();
  let rest = source.trim();
  if (rest === "") return null;

  while (rest !== "") {
    const match = ATTRIBUTE_PAIR.exec(rest);
    if (match === null) return null;
    const [whole, name = "", raw = ""] = match;
    if (!admissible.includes(name) || seen.has(name)) return null;
    seen.add(name);

    switch (name) {
      case "color":
      case "highlight": {
        const role = roleValue(raw);
        if (role === null) return null;
        out[name] = role;
        break;
      }
      case "align": {
        const align = ALIGN_VALUES.find((candidate) => candidate === raw);
        if (align === undefined) return null;
        out.align = align;
        break;
      }
      case "indent": {
        const level = INDENT_LEVELS.find((candidate) => candidate === Number(raw));
        if (level === undefined) return null;
        out.indent = level;
        break;
      }
      default:
        return null;
    }

    const remainder = rest.slice(whole.length);
    // Pairs are separated by blanks; two pairs run together are not a list.
    if (remainder !== "" && !/^\s/.test(remainder)) return null;
    rest = remainder.trimStart();
  }

  return out;
}

/**
 * An attribute set as the file spells it — fixed order, double quotes, single
 * spaces. The serializer prints through this so a document that is parsed and
 * printed unchanged comes back byte-identical.
 */
export function formatStyleAttributes(attrs: StyleAttributes): string {
  const parts: string[] = [];
  for (const name of ATTRIBUTE_ORDER) {
    const value = attrs[name];
    if (value === undefined) continue;
    parts.push(`${name}="${String(value)}"`);
  }
  return parts.join(" ");
}

/** Whether an attribute set says anything at all. */
export function hasStyleAttributes(attrs: StyleAttributes): boolean {
  return ATTRIBUTE_ORDER.some((name) => attrs[name] !== undefined);
}

export type InlineStyleKind = "underline" | "highlight" | "span";

/** One recognised inline marker, with the marker's range and its inner text's. */
export interface InlineStyleMatch {
  readonly kind: InlineStyleKind;
  /** Half-open range of the whole marker, delimiters included. */
  readonly start: number;
  readonly end: number;
  /** Half-open range of the text between the delimiters. */
  readonly innerStart: number;
  readonly innerEnd: number;
  /** Attributes, for a `span`; empty for the other two kinds. */
  readonly attrs: StyleAttributes;
}

const UNDERLINE_OPEN = "<u>";
const UNDERLINE_CLOSE = "</u>";
const HIGHLIGHT = "==";

const isBlank = (character: string | undefined): boolean =>
  character === undefined || /\s/.test(character);

/**
 * The underline marker at `index`, or `null`.
 *
 * Exactly `<u>` and `</u>`, lowercase, no whitespace and no attributes. `<U>`,
 * `<u >` and `<u class="x">` are raw HTML and stay inert, which is what keeps
 * this a named-construct rule rather than an HTML path.
 */
function matchUnderline(text: string, index: number): InlineStyleMatch | null {
  if (!text.startsWith(UNDERLINE_OPEN, index)) return null;
  const innerStart = index + UNDERLINE_OPEN.length;
  const close = text.indexOf(UNDERLINE_CLOSE, innerStart);
  if (close === -1 || close === innerStart) return null;
  return {
    kind: "underline",
    start: index,
    end: close + UNDERLINE_CLOSE.length,
    innerStart,
    innerEnd: close,
    attrs: {},
  };
}

/**
 * The highlight marker at `index`, or `null`.
 *
 * Emphasis's flanking rule, for emphasis's reason: `a == b` is arithmetic and
 * `x ==y== z` is a highlight, by the same test `**` is read with. A run of three
 * or more `=` is not a delimiter at all — it would leave a stray `=` on one side
 * whichever way it were split.
 */
function matchHighlight(text: string, index: number): InlineStyleMatch | null {
  if (!text.startsWith(HIGHLIGHT, index)) return null;
  if (text[index - 1] === "=" || text[index + 2] === "=") return null;
  const innerStart = index + HIGHLIGHT.length;
  if (isBlank(text[innerStart])) return null;

  let cursor = innerStart + 1;
  while (cursor < text.length) {
    const found = text.indexOf(HIGHLIGHT, cursor);
    if (found === -1) return null;
    const before = text[found - 1];
    const after = text[found + 2];
    if (!isBlank(before) && before !== "=" && after !== "=") {
      return {
        kind: "highlight",
        start: index,
        end: found + HIGHLIGHT.length,
        innerStart,
        innerEnd: found,
        attrs: {},
      };
    }
    cursor = found + 1;
  }
  return null;
}

/**
 * The attribute span at `index`, or `null`.
 *
 * Closed by the two characters `]{` together, not by a bare `]`: that is what
 * lets a span hold a construct with brackets of its own —
 * `[[[doc_a1b2c3]]]{color="accent"}` styles a reference — without this needing
 * to know what any of them are.
 */
function matchSpan(text: string, index: number): InlineStyleMatch | null {
  if (text[index] !== "[") return null;
  const innerStart = index + 1;
  const close = text.indexOf("]{", innerStart);
  if (close === -1 || close === innerStart) return null;
  const braceEnd = text.indexOf("}", close + 2);
  if (braceEnd === -1) return null;
  const attrs = parseStyleAttributes(text.slice(close + 2, braceEnd), "inline");
  if (attrs === null) return null;
  return {
    kind: "span",
    start: index,
    end: braceEnd + 1,
    innerStart,
    innerEnd: close,
    attrs,
  };
}

/**
 * Every inline marker in `text`, outermost first and never overlapping.
 *
 * A marker's *inner* text is not scanned — `==a <u>b</u> c==` reports the
 * highlight, and the caller scans the inner run when it wants the underline
 * inside it. Recursing here would make one call return overlapping ranges, and
 * every caller wants the outer one first anyway.
 *
 * `skip` masks ranges nothing may be recognised in. Callers holding a whole body
 * pass `codeRanges(body)`; a caller holding one already-parsed text node passes
 * nothing, because remark has excluded code for it.
 */
export function scanInlineStyles(
  text: string,
  skip: readonly TextRange[] = [],
): readonly InlineStyleMatch[] {
  const out: InlineStyleMatch[] = [];
  let index = 0;
  while (index < text.length) {
    if (skip.length > 0 && overlapsRange(skip, index, index + 1)) {
      index += 1;
      continue;
    }
    const match =
      matchUnderline(text, index) ?? matchHighlight(text, index) ?? matchSpan(text, index);
    // A marker may not straddle a code span: `==a `b== c`` closes nowhere real.
    if (match === null || (skip.length > 0 && overlapsRange(skip, match.start, match.end))) {
      index += 1;
      continue;
    }
    out.push(match);
    index = match.end;
  }
  return out;
}

/** `::: {…}` at up to three spaces of indent, and nothing else on the line. */
const BLOCK_OPEN = /^ {0,3}::: *\{([^}]*)\} *$/;
/** `:::` alone, closing one. */
const BLOCK_CLOSE = /^ {0,3}::: *$/;

/**
 * The attributes a styled block opens with, or `null` when the line is prose.
 *
 * The fence stands on its own line. `::: {align="center"}` glued to the text
 * below it is one paragraph to every markdown parser, and treating it as a fence
 * would mean re-deciding where a paragraph ends — which is the markdown parser
 * this module is not.
 */
export function blockFenceAttributes(line: string): StyleAttributes | null {
  const match = BLOCK_OPEN.exec(line);
  if (match === null) return null;
  return parseStyleAttributes(match[1] ?? "", "block");
}

/** Whether a line closes a styled block. */
export function isBlockFenceClose(line: string): boolean {
  return BLOCK_CLOSE.test(line);
}

/**
 * SPEC.md §5's one defined transform: "drop the wrapper, keep the inner text;
 * `<u>` and `==` marks likewise".
 *
 * What it yields is the document's content, unchanged in wording, headings and
 * structure — which is what every passage-shaped answer serves. The file keeps
 * its bytes; only the projection reads this.
 *
 * A body carrying no marker is returned **identically**, not merely equivalently
 * — the same string, including its line endings. That is asserted rather than
 * assumed: this runs over every body in the corpus at projection time, and a
 * transform that normalised a CRLF would rewrite what search returns for every
 * document a Windows editor ever touched.
 */
export function stripStyling(markdown: string): string {
  const withoutFences = stripBlockFences(markdown);
  return stripInline(withoutFences, codeRanges(withoutFences));
}

/**
 * Fence lines removed, with the terminator each occupies. The blocks between
 * them stay: a styled block's contents are ordinary prose, and §5 strips the
 * wrapper rather than what it wraps.
 *
 * A fence line inside a fenced code block is a code sample and is left alone.
 * An *unclosed* opening fence is prose — nothing was wrapped, so nothing is
 * dropped, and a document that merely mentions `::: {align="center"}` keeps the
 * line it wrote.
 */
function stripBlockFences(markdown: string): string {
  if (!markdown.includes(":::")) return markdown;
  const skip = codeRanges(markdown);
  const lines = splitLines(markdown);

  const dropped = new Set<number>();
  const open: number[] = [];
  lines.forEach((line, index) => {
    if (overlapsRange(skip, line.start, Math.max(line.contentEnd, line.start + 1))) return;
    if (blockFenceAttributes(line.text) !== null) {
      open.push(index);
      return;
    }
    if (!isBlockFenceClose(line.text)) return;
    const opener = open.pop();
    if (opener === undefined) return;
    dropped.add(opener);
    dropped.add(index);
  });

  if (dropped.size === 0) return markdown;
  return lines
    .filter((_line, index) => !dropped.has(index))
    .map((line) => markdown.slice(line.start, line.end))
    .join("");
}

/**
 * Inline markers removed, innermost included: the inner run of every marker is
 * stripped in turn, so `==a <u>b</u>==` yields `a b`.
 *
 * The inner run gets its own code scan. A code span inside a marker is still
 * code — `==the `==` operator==` keeps its backticked operator.
 */
function stripInline(text: string, skip: readonly TextRange[]): string {
  const matches = scanInlineStyles(text, skip);
  if (matches.length === 0) return text;
  let out = "";
  let at = 0;
  for (const match of matches) {
    out += text.slice(at, match.start);
    const inner = text.slice(match.innerStart, match.innerEnd);
    out += stripInline(inner, codeRanges(inner));
    at = match.end;
  }
  return out + text.slice(at);
}
