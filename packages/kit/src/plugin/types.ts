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
 * What a {@link PluginDocType.deriveDue} derivation answers.
 *
 * A wrapper rather than a bare `string | null` because a due date has **three**
 * answers where a status has two, and collapsing any pair of them is the bug
 * PLUGINS-018 exists to prevent:
 *
 * - `{ due: "YYYY-MM-DD" }` — this is the document's deadline.
 * - `{ due: null }` — the derivation applies and the answer is *no deadline*.
 *   The field is **absent** from the document, not `null`-and-therefore-today:
 *   a list nobody dated must never appear in Attention.
 * - `null` (the outer value) — the derivation does **not** apply and whatever
 *   the document already stores stands, exactly like {@link DerivedDocStatus}.
 *
 * The middle case is the one a bare `string | null` cannot say, and it is the
 * one that has to clear the field when the last dated item is checked.
 */
export interface DerivedDocDue {
  /** An ISO calendar date (`YYYY-MM-DD`), or `null` for "no deadline". */
  readonly due: string | null;
}

/**
 * One document type a plugin owns. Every renderer is optional: a type with no
 * `View` renders through the standard document view, no `ListItem` through the
 * kit `Row`, no `DocPanel` with no panel — absence always means "core default".
 *
 * **Derived fields** (`deriveStatus`, `deriveDue`) are one seam with one member
 * per core field, not one mechanism each. Every member follows the same three
 * rules, so learning one teaches the rest:
 *
 * 1. The function here is the UI half, and its presence IS the declaration:
 *    a surface that would offer an edit of that field renders it locked
 *    instead (§11 — "a field that was never the person's to set").
 * 2. `null` means *the derivation does not apply* and the **stored** value
 *    stands. Every member owns the same two not-applicable states — a stored
 *    status of `archived` (archiving says where a document is kept, which no
 *    reading of its content can imply) and content that cannot be read
 *    (deriving over a broken record would be a quiet claim about it) — so no
 *    caller can apply them differently, or to one field and not another.
 * 3. The declaration is readable **without loading UI code**: the type's entry
 *    in the plugin's `types.yaml` carries `derived<Field>: true` (`true` is the
 *    only spelling — absent means not derived, `false` is not a way of saying
 *    so), and the executable non-UI counterpart is exported from
 *    `plugins/<dir>/server/derive.ts` — one module for every field, so a
 *    second field is never a second discovery rule. The plugin's own
 *    `parity.test.ts` pins all three declarations against each other, per
 *    field, in both directions.
 *
 * Every derivation is pure and cheap — no fetching, no React, no side effects,
 * no clock. They are called on render paths and, through their non-UI
 * counterparts, on the server's projection path, where a reading that depended
 * on the time of day would make a reprojection non-deterministic.
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
   * items", rider signed 2026-08-12), and computes it. Surfaces show
   * `deriveStatus(doc) ?? doc.frontmatter.status`.
   *
   * Returns {@link DerivedDocStatus} — the derivation chooses between `open`
   * and `resolved` and nothing else — or `null` under rule 2 above. Its
   * non-UI counterpart is `types.yaml`'s `derivedStatus: true` plus the
   * **default** export of `plugins/<dir>/server/derive.ts`.
   */
  readonly deriveStatus?: (doc: Doc) => DerivedDocStatus | null;
  /**
   * Declares that this type's `due` is **derived from the document's own
   * content rather than set**, and computes it (PLUGINS-018). A surface that
   * would offer a `due` edit renders it locked, for the same §11 reason the
   * status control is locked.
   *
   * **Compose it on the outer value, never with `??` on the inner one.** The
   * derivation applies whenever this returns an object, *including* when that
   * object's `due` is `null`:
   *
   * ```ts
   * const derived = deriveDue(doc);
   * const due = derived === null ? doc.frontmatter.due : derived.due;
   * ```
   *
   * `deriveDue(doc)?.due ?? doc.frontmatter.due` is **wrong** and this comment
   * carried it until SERVER-134's implementer caught it. That `??` collapses
   * `{ due: null }` into the not-applicable case, so a list whose last dated
   * item was just checked keeps a deadline it no longer has — the exact defect
   * {@link DerivedDocDue}'s three answers exist to prevent.
   *
   * {@link PluginDocType.deriveStatus} genuinely has two answers, so its
   * `deriveStatus(doc) ?? doc.frontmatter.status` is correct. Do not generalise
   * from one to the other in either direction.
   *
   * The field it derives is core's own `due` (SPEC.md §5 — "optional deadline
   * (ISO date) on ANY type — surfaces in Attention and filters"), which is why
   * a document-level rollup of a plugin's item-level deadlines belongs here
   * and not in a surface of the plugin's own: Attention, `--due overdue`,
   * `--needs due` and `--needs me` all read the document's field and none of
   * them can be taught to read a plugin's items.
   *
   * Returns {@link DerivedDocDue}, whose three answers are the whole contract,
   * or `null` under rule 2 above. Its non-UI counterpart is `types.yaml`'s
   * `derivedDue: true` plus the **named** `deriveDue` export of
   * `plugins/<dir>/server/derive.ts`.
   */
  readonly deriveDue?: (doc: Doc) => DerivedDocDue | null;
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
