import type { Doc, DocStatus } from "@corpus/contract";
import type { ComponentType } from "react";
import type { RowProps } from "../row/Row.js";

/**
 * The plugin manifest contract (SPEC.md §10) — the shape every
 * `plugins/<name>/manifest.ts` default-exports through {@link definePlugin}.
 *
 * This module is types only. The UI's registry (`apps/ui/src/plugins/`)
 * discovers manifests with `import.meta.glob`, validates them at runtime, and
 * resolves components through four slots (`View`, `ListItem`, `DocPanel`,
 * column `Component`); the types here are the compile-time half of that
 * contract, published under `@corpus/kit/plugin` so a plugin can be written
 * against the kit alone — importing `apps/ui` internals is lint-forbidden.
 */

/**
 * Props a plugin document `View` receives. The `View` replaces the standard
 * document view (the editor) wholesale for documents of its registered type;
 * documents of that type render read-only through it, and anything else the
 * component needs (threads, related docs, mutations) comes from the kit hooks.
 */
export interface DocViewProps {
  /** The full document — frontmatter (including `extra`) and raw markdown body. */
  readonly doc: Doc;
}

/**
 * Props a plugin `ListItem` receives — exactly the kit `Row`'s props, because a
 * `ListItem` replaces `Row` wholesale for its doc type in every column list
 * (the delegate seam is `Row`'s own `ListItem` prop). Re-published here so a
 * plugin author finds the row contract where the manifest contract lives.
 */
export type ListItemProps = RowProps;

/**
 * Props a plugin `DocPanel` receives. The panel renders in the **one core
 * injection slot of v1**: a fixed region above the document body, in both the
 * column reader and focus mode, for doc types the plugin owns.
 */
export interface DocPanelProps {
  /** The document the panel sits above. */
  readonly doc: Doc;
}

/**
 * Where inside a document an open should land — the **reveal target** (UI-037,
 * sprint-023 OC5).
 *
 * One discriminated field rather than two mechanisms: "open this document at
 * this item" and "open this document at this thread" are the same act with a
 * different destination, and a caller that could only name a document had to
 * choose between opening it and pointing at anything inside it.
 */
export type RevealTarget = RevealItem | RevealThread;

/**
 * A piece of the document's own text, quoted the way SPEC.md §6 quotes an
 * anchor: `exact` is what to find, `prefix`/`suffix` are the surrounding text
 * that says **which** occurrence when the quote is not unique (sprint-023 OC4 —
 * `exact` alone silently reveals the wrong duplicate item).
 *
 * The text is matched against what the reader *rendered*, so it is the
 * document's prose, not its markdown: quote the item, not `- [ ] the item`.
 */
export interface RevealItem {
  readonly kind: "item";
  readonly exact: string;
  readonly prefix?: string | undefined;
  readonly suffix?: string | undefined;
}

/** A thread on the document: the reader expands it, scrolls to it and flashes it. */
export interface RevealThread {
  readonly kind: "thread";
  readonly threadId: string;
}

/**
 * An open, with somewhere to land. `reveal` is honoured **once**, when the
 * document has rendered; the reader then forgets it, so Back onto the same
 * entry restores the scroll position the user left rather than re-flashing.
 */
export interface OpenRequest {
  readonly docId: string;
  readonly reveal?: RevealTarget | undefined;
}

/**
 * What every open seam accepts. A bare document id is exactly the request it
 * has always been — the reveal is additive, and a caller that has nothing to
 * reveal keeps passing a string.
 */
export type OpenPayload = string | OpenRequest;

/**
 * Props a plugin column `Component` receives. A plugin column IS a pinned
 * `type: view` document with `column: "<plugin>/<type>"` frontmatter (SPEC.md
 * §11); the component renders only the column *body* — header, drag-reorder,
 * deletion and persistence are the board's, identical for every column kind.
 */
export interface ColumnComponentProps {
  /** The pinned view document's id — the column's only identity. */
  readonly viewDocId: string;
  /** The column's title, from the view document. */
  readonly title: string;
  /**
   * The view document's stored query in wire form (every value a string),
   * exactly as a folder column would send it to `GET /api/docs`. Carries the
   * column type's `defaultQuery` keys merged at creation time.
   */
  readonly query: Readonly<Record<string, string>>;
  /**
   * Opens a document **in this column's reader** — the same act a row click
   * performs in a core column, and the "kit's reader affordances" SPEC.md §10
   * promises a plugin `Component` renders its body with.
   *
   * It is a prop rather than a hook because the capability belongs to the board
   * (it owns the column's navigation stack, its scroll and its flash), and a
   * plugin cannot reach the board: `apps/ui` internals are lint-forbidden to
   * plugins, which is precisely why aggregate columns had no way to link a row
   * to its source document before PLUGINS-002.
   *
   * Optional so a host that renders a plugin column outside a board (a test, a
   * future preview surface) is not forced to invent a navigation it does not
   * have; a column that cannot open anything simply does not.
   *
   * `onOpen(docId)` and `onOpen({docId, reveal})` are the same act (UI-037):
   * the second one also says where inside the document to land.
   */
  readonly onOpen?: ((target: OpenPayload) => void) | undefined;
}

/**
 * What a {@link PluginDocType.deriveStatus} derivation may choose between.
 *
 * `archived` is deliberately not in it (SPEC.md §12, rider signed 2026-08-12):
 * archiving says where a document is kept, which no reading of its content can
 * imply — "the derivation chooses between `open` and `resolved` and nothing
 * else". Derived from the contract's status ladder so a change to §5's
 * vocabulary breaks here loudly instead of drifting.
 */
export type DerivedDocStatus = Exclude<DocStatus, "archived">;

/**
 * One document type a plugin owns. Every renderer is optional: a type with no
 * `View` renders through the standard document view, no `ListItem` through the
 * kit `Row`, no `DocPanel` with no panel — absence always means "core default".
 */
export interface PluginDocType {
  /** The frontmatter `type` this entry claims. Must also appear in the plugin's `types.yaml`. */
  readonly type: string;
  /** Replaces the default row renderer for this type in every column list. */
  readonly ListItem?: ComponentType<ListItemProps>;
  /** Replaces the standard document view (the editor) for this type. */
  readonly View?: ComponentType<DocViewProps>;
  /** Rendered above the document body — the single core injection slot in v1. */
  readonly DocPanel?: ComponentType<DocPanelProps>;
  /**
   * Validates a document of this type (its `extra` frontmatter is the plugin's
   * own schema — SPEC.md §5, §10). Returns problems, empty when valid.
   * Reserved: core does not invoke it in v1.
   */
  readonly validate?: (doc: Doc) => readonly string[];
  /**
   * Declares that this type's `status` is **derived from the document's own
   * content rather than set** (SPEC.md §12 — "A todo document's status is its
   * items", rider signed 2026-08-12), and computes it. The function's presence
   * IS the declaration on the UI side: a surface that would offer a status
   * edit renders the field locked instead (§11 — "a field that was never the
   * person's to set"), showing `deriveStatus(doc) ?? doc.frontmatter.status`.
   *
   * The contract, identical for every caller:
   *
   * - Returns {@link DerivedDocStatus} — the derivation chooses between `open`
   *   and `resolved` and nothing else.
   * - Returns `null` when the derivation does not apply, and the **stored**
   *   value stands. That covers exactly two states, and the function owns both
   *   so no caller can apply them differently: a document whose stored status
   *   is `archived` (archiving is not a claim about content and is never
   *   derived over), and a document whose content cannot be read (deriving
   *   over an unreadable record would be a quiet claim about a broken state —
   *   the same rule a plugin's panel applies to its counts).
   * - Pure and cheap: no fetching, no React, no side effects — it is called on
   *   render paths and, through its non-UI counterpart, on the server's
   *   projection path.
   *
   * The declaration must be readable **without loading UI code** too: a type
   * declaring it here also carries `derivedStatus: true` on its entry in the
   * plugin's `types.yaml`, and the executable non-UI counterpart is the
   * default export of `plugins/<dir>/server/derive.ts` — the plugin's own
   * `parity.test.ts` pins all three against each other, in both directions.
   */
  readonly deriveStatus?: (doc: Doc) => DerivedDocStatus | null;
}

/**
 * One board column type a plugin registers. It contributes a "＋ New list"
 * picker entry only; choosing it creates a pinned view document with
 * `column: "<plugin>/<type>"` (plus `defaultQuery`) in its frontmatter, and the
 * board renders `Component` as that column's body from then on.
 */
export interface PluginColumnType {
  /** The column type's name — the `<type>` half of the `"<plugin>/<type>"` reference. */
  readonly type: string;
  /** The picker entry's label. */
  readonly label: string;
  /** An optional picker glyph (an emoji or short string, rendered verbatim). */
  readonly icon?: string;
  /** Renders the column body. */
  readonly Component: ComponentType<ColumnComponentProps>;
  /** Query keys written into the created view document's `query` frontmatter. */
  readonly defaultQuery?: Readonly<Record<string, string>>;
}

/** The manifest itself — what `plugins/<name>/manifest.ts` default-exports. */
export interface PluginManifest {
  /** The plugin's stable identifier. By convention the plugin's directory name. */
  readonly id: string;
  /** Human-readable name, shown in warnings and error cards. */
  readonly name: string;
  /** An optional glyph for surfaces that render the plugin itself. */
  readonly icon?: string;
  /**
   * Tiebreak when two plugins claim the same doc type: lower `order` wins,
   * then directory name. Plugins that claim nothing contested never need it.
   */
  readonly order?: number;
  /** Document types this plugin owns. May be empty. */
  readonly docTypes: readonly PluginDocType[];
  /** Board column types this plugin registers. May be empty. */
  readonly columns: readonly PluginColumnType[];
}
