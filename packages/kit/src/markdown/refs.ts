/**
 * Inline references (SPEC.md §5): `[[doc_a1b2c3]]` and the alias form
 * `[[doc_a1b2c3|as text]]`, in any body.
 *
 * A ref is **id-based and resolved at render time**. Nothing here stores a
 * title: SPEC.md §5 calls refs "rename/move-proof", which is only true if the
 * rendered text is read from the projection every time. The parser's job is
 * therefore narrow — find the ids, keep the alias when one was written — and the
 * resolution is a query, not a lookup table.
 *
 * The transform below is a remark plugin rather than a post-render string
 * replacement because a ref is legitimate anywhere inline text is: inside a list
 * item, inside emphasis, inside a table cell. A regex over rendered HTML would
 * have to know which of those it must not touch (code spans, fenced blocks, the
 * `href` of a real link); a plugin runs on `text` nodes only and never sees
 * them.
 */

/**
 * The ref grammar. Ids are the contract's shape (`doc_*`, `th_*`, …), so the id
 * half is deliberately strict — `[[not an id]]` is prose, not a broken ref — and
 * the alias half is deliberately loose, because it is display text.
 */
export const REF_PATTERN = /\[\[([A-Za-z0-9][A-Za-z0-9_-]*)(\|([^\]]*))?\]\]/g;

/** Marks the element a ref renders into; read back by `MarkdownView`. */
export const REF_ID_ATTRIBUTE = "data-corpus-ref";

/** Present only when the author wrote the alias form. */
export const REF_ALIAS_ATTRIBUTE = "data-corpus-alias";

/** The mdast node type this plugin introduces. */
export const REF_NODE_TYPE = "corpusRef";

export interface DocRef {
  /** The referenced document id, exactly as written. */
  readonly id: string;
  /** The alias half of `[[id|alias]]`, or `null` for the bare form. */
  readonly alias: string | null;
}

/** Every ref in a body, in source order, duplicates included. */
export function parseRefs(markdown: string): readonly DocRef[] {
  // `matchAll` seeds its clone from `lastIndex`; a shared global regex would
  // otherwise let one call's cursor decide where the next one starts.
  REF_PATTERN.lastIndex = 0;
  const refs: DocRef[] = [];
  for (const match of markdown.matchAll(REF_PATTERN)) {
    refs.push(refOf(match));
  }
  return refs;
}

/**
 * The distinct ids a body references, in first-appearance order.
 *
 * This is the number that bounds ref resolution: a body citing one document
 * eight times costs one lookup, because the caller resolves per distinct id and
 * the query cache dedupes the rest.
 */
export function refIds(markdown: string): readonly string[] {
  const seen = new Set<string>();
  for (const ref of parseRefs(markdown)) seen.add(ref.id);
  return [...seen];
}

function refOf(match: RegExpMatchArray): DocRef {
  const id = match[1] ?? "";
  // `[[id|]]` — an alias was written and it is empty. Treated as no alias: an
  // empty display string would render an invisible, unclickable link.
  const alias = match[3] === undefined || match[3].trim() === "" ? null : match[3].trim();
  return { id, alias };
}

/**
 * Structural view of the mdast nodes this transform touches.
 *
 * Declared locally rather than imported from `@types/mdast`: the plugin needs
 * exactly three fields, and depending on the AST's full type surface would make
 * a remark upgrade a kit release.
 */
interface MdastLike {
  type: string;
  value?: string;
  children?: MdastLike[];
  data?: Record<string, unknown>;
}

function isMdastLike(value: unknown): value is MdastLike {
  return (
    typeof value === "object" && value !== null && typeof (value as MdastLike).type === "string"
  );
}

/**
 * The node a ref becomes.
 *
 * `hName`/`hProperties` are `mdast-util-to-hast`'s escape hatch: the node is
 * unknown to the standard handlers, so it is rendered from this data instead. It
 * always becomes an `<a>` carrying the id — **resolution is not decided here**,
 * because whether a ref resolves is a query result and this transform is
 * synchronous. `MarkdownView` reads the attribute back and renders the resolved,
 * unresolved or still-loading treatment.
 */
function refNode(ref: DocRef): MdastLike {
  const properties: Record<string, string> = { [REF_ID_ATTRIBUTE]: ref.id };
  if (ref.alias !== null) properties[REF_ALIAS_ATTRIBUTE] = ref.alias;
  return {
    type: REF_NODE_TYPE,
    data: { hName: "a", hProperties: properties },
    children: [{ type: "text", value: ref.alias ?? ref.id }],
  };
}

/** Splits one `text` node into text and ref nodes; returns null when it has no refs. */
export function splitTextNode(value: string): MdastLike[] | null {
  REF_PATTERN.lastIndex = 0;
  const parts: MdastLike[] = [];
  let cursor = 0;
  for (const match of value.matchAll(REF_PATTERN)) {
    const start = match.index;
    if (start === undefined) continue;
    if (start > cursor) parts.push({ type: "text", value: value.slice(cursor, start) });
    parts.push(refNode(refOf(match)));
    cursor = start + match[0].length;
  }
  if (parts.length === 0) return null;
  if (cursor < value.length) parts.push({ type: "text", value: value.slice(cursor) });
  return parts;
}

function transform(node: MdastLike): void {
  const children = node.children;
  if (children === undefined) return;
  const next: MdastLike[] = [];
  let changed = false;
  for (const child of children) {
    if (child.type === "text" && typeof child.value === "string") {
      const split = splitTextNode(child.value);
      if (split !== null) {
        next.push(...split);
        changed = true;
        continue;
      }
    }
    transform(child);
    next.push(child);
  }
  if (changed) node.children = next;
}

/**
 * The remark plugin. `code`, `inlineCode` and link destinations carry no `text`
 * children, so they are never rewritten — which is why `[[doc_x]]` inside a code
 * span stays literal, as an author writing about the syntax expects.
 */
export function remarkCorpusRefs(): (tree: unknown) => void {
  return (tree: unknown): void => {
    if (isMdastLike(tree)) transform(tree);
  };
}
