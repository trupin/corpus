/**
 * `<br>` inside a table cell, read as the line break it is (UI-064).
 *
 * **Why this exists at all.** Markdown spells a line break three ways — two
 * trailing spaces, a trailing backslash, and a newline — and all three are a
 * newline, which is exactly the character that ends a table row. So a break
 * inside a cell has *no* markdown spelling: GFM's answer, and every generator's
 * answer, is the literal token `<br>`. It is the one construct our renderer
 * would otherwise have to show as source in order to stay honest, and showing
 * `<br>` as text is what the live report of 2026-08-04 was about.
 *
 * **What is qualified, and what is not.** This recognises a *token*, not HTML.
 * The value must be a bare `<br>` — optionally self-closing, in any case, with
 * no attributes — and it must sit inside a `tableCell`. Nothing else changes:
 * `<b>`, `<script>`, `<img onerror=…>`, `<br class="x">` and a `<br>` in
 * ordinary prose all stay the inert text they are today, because `MarkdownView`
 * still has no raw-HTML path and nothing here adds one. The narrow scope is the
 * whole argument — inside a cell markdown has no other spelling for a break, and
 * outside one it has two, so a `<br>` written in prose is a tag the author
 * typed rather than a break the format forced.
 *
 * **Both surfaces run this.** `MarkdownView` renders threads, focus-mode content
 * and `view` bodies; `apps/ui/src/editor/markdown/parse.ts` renders the document
 * body through TipTap and imports this same plugin. A document must not read
 * differently depending on which of the two is drawing it, and the editor's
 * serializer writes `<br>` back for a break in a cell, so the file is unchanged
 * by the round trip.
 */

/** The one token this plugin recognises. Attributes are deliberately excluded. */
const BR_TOKEN = /^<br\s*\/?>$/i;

/** True when a raw-HTML value is that token. Exported for the editor's tests. */
export function isLineBreakTag(value: string): boolean {
  return BR_TOKEN.test(value);
}

/**
 * Structural view of the mdast nodes this transform touches, declared locally
 * for the reason `refs.ts` declares its own: depending on `@types/mdast`'s full
 * surface would make a remark upgrade a kit release.
 */
interface MdastLike {
  type: string;
  value?: string;
  children?: MdastLike[];
  position?: unknown;
}

function isMdastLike(value: unknown): value is MdastLike {
  return (
    typeof value === "object" && value !== null && typeof (value as MdastLike).type === "string"
  );
}

/** Rewrites every `<br>` token below a cell, at any depth of emphasis or link. */
function convertBreaks(node: MdastLike): void {
  const children = node.children;
  if (children === undefined) return;
  for (const [index, child] of children.entries()) {
    if (child.type === "html" && typeof child.value === "string" && isLineBreakTag(child.value)) {
      // The position carries through: it is what lets the editor map an offset
      // in the file onto the node that occupies it.
      children[index] = {
        type: "break",
        ...(child.position === undefined ? {} : { position: child.position }),
      };
      continue;
    }
    convertBreaks(child);
  }
}

function findCells(node: MdastLike): void {
  if (node.type === "tableCell") {
    convertBreaks(node);
    return;
  }
  for (const child of node.children ?? []) findCells(child);
}

/**
 * The remark plugin. Attach it after `remark-gfm`, which is what makes the
 * cells this walks for.
 */
export function remarkTableCellBreaks(): (tree: unknown) => void {
  return (tree: unknown): void => {
    if (isMdastLike(tree)) findCells(tree);
  };
}
