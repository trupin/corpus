import { REF_ALIAS_ATTRIBUTE, REF_ID_ATTRIBUTE, REF_NODE_TYPE } from "@corpus/kit";

/**
 * The mdast shapes the two walks exchange, declared structurally.
 *
 * Imported from nowhere on purpose — `@types/mdast` would make a remark upgrade
 * a change to this module's public types, and the walks touch six fields. This
 * is the same reasoning `packages/kit/src/markdown/refs.ts` gives for its own
 * `MdastLike`, and it keeps the two modules independent of each other's
 * dependency graph while they agree on the one node type they both know:
 * {@link REF_NODE_TYPE}.
 */

export interface MdPosition {
  readonly start: { readonly offset?: number | undefined };
  readonly end: { readonly offset?: number | undefined };
}

export interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  position?: MdPosition | undefined;
  data?: Record<string, unknown> | undefined;
  /** `heading` */
  depth?: number;
  /** `list` */
  ordered?: boolean | null | undefined;
  start?: number | null | undefined;
  spread?: boolean | null | undefined;
  /** `listItem` — GFM task list state; `null` for an ordinary item. */
  checked?: boolean | null | undefined;
  /** `code` */
  lang?: string | null | undefined;
  meta?: string | null | undefined;
  /** `link` / `image` */
  url?: string;
  title?: string | null | undefined;
  alt?: string | null | undefined;
  /** `table` */
  align?: readonly (string | null)[] | null | undefined;
}

export interface MdRoot extends MdNode {
  type: "root";
  children: MdNode[];
}

/** The `{id, alias}` a kit-produced {@link REF_NODE_TYPE} node carries. */
export function refAttributesOf(node: MdNode): { id: string; alias: string | null } | null {
  if (node.type !== REF_NODE_TYPE) return null;
  const properties = node.data?.["hProperties"];
  if (typeof properties !== "object" || properties === null) return null;
  const record = properties as Record<string, unknown>;
  const id = record[REF_ID_ATTRIBUTE];
  if (typeof id !== "string" || id === "") return null;
  const alias = record[REF_ALIAS_ATTRIBUTE];
  return { id, alias: typeof alias === "string" && alias !== "" ? alias : null };
}

/**
 * The source text a node occupies, for the constructs kept verbatim.
 *
 * Returns `null` when the node carries no usable position — a synthesised node,
 * which cannot be a construct the parser produced and therefore is never a
 * candidate for verbatim preservation.
 */
export function sourceOf(node: MdNode, source: string): string | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (typeof start !== "number" || typeof end !== "number" || end <= start) return null;
  return source.slice(start, end);
}
