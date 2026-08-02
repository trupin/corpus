import { REF_ALIAS_ATTRIBUTE, REF_ID_ATTRIBUTE } from "@corpus/kit";
import {
  DOMSerializer,
  type DOMOutputSpec,
  type Node as PmModelNode,
  type Schema,
  type Slice,
} from "@tiptap/pm/model";
import { optionalStringAttr, stringAttr } from "./markdown/attrs.js";
import { NODE, type PmNode } from "./markdown/schema.js";
import { serializeDoc } from "./markdown/serialize.js";

/**
 * What the clipboard carries, in both directions (SPEC.md §11 clipboard
 * fidelity rider, signed 2026-08-02).
 *
 * **Copying is two flavors, not one.** ProseMirror already writes `text/html`
 * from the schema's `toDOM`, and that half was never the bug: the reproduction
 * for UI-042 found real `<h1>`/`<strong>`/`<ul>` on the clipboard. What was
 * missing is the other half. The default `text/plain` is
 * `Fragment.textBetween(…, "\n\n")` — every block boundary at every nesting
 * depth contributes its own blank line, so a two-item list arrives as four
 * paragraphs separated by five blank lines, with no `#`, no `-` and no `**`
 * anywhere. The rider says the plain flavor holds *the markdown*, which is the
 * document's own source, so it is serialized by the same walk that writes the
 * file.
 *
 * **A `[[ref]]` is an id on disk and a title everywhere else.** The schema-only
 * `renderHTML` in `refNode.ts` emits the id inside `<a href="#doc_x">`; pasted
 * into a word processor that is a raw `doc_a1b2c3` wearing a link to nothing —
 * the rider's two explicit prohibitions in one element. Here a ref serializes
 * as the target's **title**, as an `<a>` only when the target has an address a
 * reader outside Corpus could follow, and as plain text otherwise. The id rides
 * along in `data-corpus-ref`, which is invisible in every external editor and
 * is exactly what `DocRef.parseHTML` reads back — so a Corpus-to-Corpus copy
 * still round-trips to the same reference.
 *
 * **Pasting is a clean-up, not a parser.** ProseMirror's own clipboard parser
 * runs the HTML through this schema's `parseHTML` rules, which is what turns a
 * word processor's `<span style="font-weight:700">` into a `bold` mark and
 * drops everything the schema cannot name. It needs help with exactly two
 * things Google Docs does that survive that pass as junk (see
 * {@link cleanPastedHtml}).
 */

/**
 * Where a referenced document can be read from outside Corpus, and what it is
 * called.
 *
 * `href` is `null` for every document in v1 and that is not a stub: a Corpus
 * workspace is local files behind a localhost server with a single `/` route,
 * so no document has an address a reader outside the app could follow. The
 * publish plugin (SPEC.md §13) is what mints one — a Google Doc id under
 * `publish.gdoc` — and when it does, it fills this in and the same rule below
 * starts emitting links. Keeping the branch in the serializer rather than the
 * caller is what stops "linking where the target is addressable" from being
 * re-decided per surface.
 */
export interface RefTarget {
  /** The target's current title, or `null` when it is not known here. */
  readonly title: string | null;
  /** An address a reader outside Corpus can follow, or `null`. */
  readonly href: string | null;
}

/** Answers {@link RefTarget} for a document id, synchronously. */
export type RefResolver = (id: string) => RefTarget;

/** The answer for a target nothing knows about: no title, no address. */
export const UNRESOLVED_REF: RefTarget = { title: null, href: null };

/** A resolver that knows nothing — the honest default before a cache is wired. */
export function noRefTargets(): RefTarget {
  return UNRESOLVED_REF;
}

interface RefAttributes {
  readonly id: string;
  readonly alias: string | null;
}

function refAttributes(attrs: Readonly<Record<string, unknown>>): RefAttributes {
  return { id: stringAttr(attrs["id"]), alias: optionalStringAttr(attrs["alias"]) };
}

/**
 * The words a ref shows when it leaves the editor.
 *
 * The author's alias wins, then the target's title, and the id is the last
 * resort rather than a choice — it is what `RefNodeView` puts on screen for a
 * target that does not resolve, and the clipboard carrying something the reader
 * never saw would be its own bug. An empty title counts as no title.
 */
export function refLabel(attributes: RefAttributes, target: RefTarget): string {
  const alias = attributes.alias;
  if (alias !== null && alias !== "") return alias;
  const title = target.title;
  if (title !== null && title !== "") return title;
  return attributes.id;
}

/**
 * The alias half of `[[id|alias]]` may not contain `]` or a newline — the
 * grammar in `@corpus/kit`'s `REF_PATTERN` says so, and the server's parser
 * agrees. A title that breaks it is not written into the bracket form, because
 * markdown that does not parse back as a reference is worse than a bare id.
 */
function aliasable(label: string): boolean {
  return label !== "" && !label.includes("]") && !label.includes("\n");
}

/* ── Copy out ───────────────────────────────────────────────────────── */

/**
 * The `text/html` flavor's serializer: the schema's own rendering, with
 * `docRef` replaced by the rider's rule.
 *
 * Built from the live schema so the node and mark specs are the editor's, not a
 * second opinion about them.
 */
export function clipboardSerializer(schema: Schema, resolve: RefResolver): DOMSerializer {
  const base = DOMSerializer.fromSchema(schema);
  return new DOMSerializer(
    { ...base.nodes, [NODE.docRef]: (node: PmModelNode) => refDom(node.attrs, resolve) },
    base.marks,
  );
}

/**
 * One ref as clipboard HTML.
 *
 * The element is an `<a>` only when the target is addressable outside Corpus.
 * An unaddressable ref is a `<span>` and not an `<a href="#doc_x">`: the
 * fragment is serialized in a detached document, so that hash resolves against
 * whatever page the browser had open — the reproduction caught it arriving in
 * the clipboard as `about:blank#doc_other` — and a link to nowhere is worse
 * than no link.
 */
function refDom(attrs: Readonly<Record<string, unknown>>, resolve: RefResolver): DOMOutputSpec {
  const attributes = refAttributes(attrs);
  const target = attributes.id === "" ? UNRESOLVED_REF : resolve(attributes.id);
  const carried: Record<string, string> = { [REF_ID_ATTRIBUTE]: attributes.id };
  if (attributes.alias !== null) carried[REF_ALIAS_ATTRIBUTE] = attributes.alias;
  const label = refLabel(attributes, target);
  return target.href === null
    ? ["span", { ...carried, class: "ref" }, label]
    : ["a", { ...carried, class: "ref", href: target.href }, label];
}

/**
 * The `text/plain` flavor: the copied slice as markdown.
 *
 * Refs are rewritten to their alias form so the plain flavor shows the reader a
 * title rather than a `doc_` id, while still parsing back into the same
 * reference when it is pasted into another Corpus document. Where the label
 * cannot be an alias — the grammar forbids `]` and newlines — the bare bracket
 * form stays.
 *
 * **A phrase loses the trailing newline** `serializeDoc` ends every document
 * with. That newline is a *file's* terminator, and words copied out of the
 * middle of a sentence are not a file: pasted back into another sentence they
 * would break the line. A selection of whole blocks keeps it, which is what
 * makes a whole-document copy byte-identical to the file on disk.
 */
export function sliceMarkdown(slice: Slice, resolve: RefResolver): string {
  const fragment = slice.content;
  if (fragment.childCount === 0) return "";
  const nodes = (fragment.toJSON() ?? []) as readonly PmNode[];
  const labelled = nodes.map((node) => withRefLabels(node, resolve));
  // A fragment is homogeneous at its top level, so the first child settles it:
  // bare inline content is a paragraph's worth and has to be given the
  // paragraph back before a block walk can serialize it.
  const bare = fragment.child(0).type.isInline;
  const content = bare ? [{ type: NODE.paragraph, content: labelled }] : labelled;
  const markdown = serializeDoc({ type: NODE.doc, content });
  return isPhrase(slice, bare) ? markdown.replace(/\n$/, "") : markdown;
}

/**
 * Is this selection words rather than blocks?
 *
 * **Not `isInline` on the fragment**, which is the trap: `Selection.content()`
 * on a caret dragged through a sentence returns the enclosing *paragraph* with
 * `openStart`/`openEnd` of 1, never a bare inline fragment. Testing the node
 * type alone therefore answers "blocks" for every real mid-sentence copy, and
 * the phrase arrives on the clipboard with a newline welded to it. The open
 * depths are where ProseMirror actually records that the selection cut into a
 * textblock at both ends.
 */
function isPhrase(slice: Slice, bare: boolean): boolean {
  return bare || (slice.content.childCount === 1 && slice.openStart > 0 && slice.openEnd > 0);
}

/** The whole tree with every `docRef` carrying a human-readable alias. */
function withRefLabels(node: PmNode, resolve: RefResolver): PmNode {
  if (node.type === NODE.docRef) {
    const attributes = refAttributes(node.attrs ?? {});
    if (attributes.alias !== null && attributes.alias !== "") return node;
    const label = refLabel(
      attributes,
      attributes.id === "" ? UNRESOLVED_REF : resolve(attributes.id),
    );
    if (label === attributes.id || !aliasable(label)) return node;
    // Spread from the node's own attrs, not from the two this walk read: a
    // future attribute on `docRef` must ride through rather than be dropped by
    // a helper that never heard of it.
    return { ...node, attrs: { ...node.attrs, alias: label } };
  }
  const content = node.content;
  if (content === undefined) return node;
  return { ...node, content: content.map((child) => withRefLabels(child, resolve)) };
}

/* ── Paste in ───────────────────────────────────────────────────────── */

/** Where Google Docs sends every external link, with the real one in `q`. */
const GOOGLE_REDIRECT = "https://www.google.com/url?";

/** The block containers a `<br>` legitimately sits inside. */
const BREAK_HOSTS = "p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote,pre";

/**
 * Google Docs' HTML, made parseable without loss.
 *
 * ProseMirror's clipboard parser already does the hard part — a
 * `font-weight:700` span becomes `bold`, an underline span becomes plain text,
 * and nothing the schema cannot name survives — so this is deliberately three
 * narrow repairs, each one a construct that otherwise reaches the *file*:
 *
 * 1. **The `docs-internal-guid` wrapper.** Docs wraps the whole selection in
 *    `<b style="font-weight:normal">`. TipTap's `bold` rule declines it on that
 *    inline style, so today it is harmless — and it is one missing style
 *    attribute away from bolding an entire pasted document. Unwrapping it means
 *    the paste never depends on that coincidence.
 * 2. **Redirect links.** Every link Docs copies is a
 *    `google.com/url?q=…&sa=D&usg=…` tracking hop. It survives the schema, so a
 *    paste writes a 200-character redirect into the markdown where the author
 *    wrote `https://example.com`. The real destination is `q`.
 * 3. **Block-level `<br>`.** Docs separates blocks with bare `<br>` elements
 *    outside any paragraph. The parser has to put them somewhere, so each
 *    becomes a paragraph holding a hard break — a `\` on its own line in the
 *    saved markdown. A break between blocks says nothing markdown does not say
 *    with a blank line.
 *
 * Everything else is left exactly as it arrived: the mark rules key on the
 * inline styles, so stripping them would lose the emphasis this is here to keep.
 */
export function cleanPastedHtml(html: string, parse: HtmlParser = domParse): string {
  const body = parse(html);
  if (body === null) return html;

  for (const wrapper of [...body.querySelectorAll('b[id^="docs-internal-guid-"]')]) {
    wrapper.replaceWith(...wrapper.childNodes);
  }

  for (const link of [...body.querySelectorAll("a[href]")]) {
    const direct = redirectTarget(link.getAttribute("href") ?? "");
    if (direct !== null) link.setAttribute("href", direct);
  }

  for (const linebreak of [...body.querySelectorAll("br")]) {
    if (linebreak.closest(BREAK_HOSTS) === null) linebreak.remove();
  }

  return body.innerHTML;
}

/** The destination a Google redirect wraps, or `null` when it is not one. */
function redirectTarget(href: string): string | null {
  if (!href.startsWith(GOOGLE_REDIRECT)) return null;
  const query = new URLSearchParams(href.slice(GOOGLE_REDIRECT.length));
  const target = query.get("q");
  return target === null || target === "" ? null : target;
}

/** Parses clipboard HTML into a detached body. Injected so the walk is testable. */
export type HtmlParser = (html: string) => HTMLElement | null;

function domParse(html: string): HTMLElement | null {
  if (typeof DOMParser === "undefined") return null;
  return new DOMParser().parseFromString(html, "text/html").body;
}
