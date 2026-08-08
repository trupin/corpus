import { Extension } from "@tiptap/core";
import type { Node as PmModelNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { NODE } from "./markdown/schema.js";

/**
 * A document's **changelog**, clipped past a threshold of entries (UI-089,
 * SPEC.md §5 and §11, rider signed 2026-08-07 and re-based on clipping the same
 * day).
 *
 * §5 gives a document a section at the end of its body where the agent records
 * what changed and what it made of it, appending and never rewriting. §11 says
 * how it is read: "past a threshold of entries it **clips**, exactly as a long
 * fenced block does and for the same reason — the newest entries stay visible,
 * the rest sit behind a control that expands them and **says how many are
 * hidden**, and expanding shows them whole."
 *
 * ## This is clipping, not collapse
 *
 * The distinction is the whole reason the rider was re-based, and it is
 * load-bearing: §11's set of default-**collapse** rules is closed and holds
 * exactly one member (a `resolved` thread), and adding to it takes a change to
 * SPEC.md. A changelog is body content rather than a conversation, so it clips —
 * the same behaviour `CodeFence` gives a tall fence, in the same words ("Show
 * all N …"), with no claim on the collapse rules at all.
 *
 * ## Why a decoration, and never a parse or an edit
 *
 * Exactly `SoftWrap`'s reason (UI-072): the editor autosaves, so anything that
 * changes the *document* is written to disk on the next keystroke. A clip is a
 * reading convenience and must cost the file nothing — so the model keeps the
 * author's bytes, the serializer writes them back unchanged, and the cut is made
 * at paint time. This extension contributes no node and no mark; the schema, and
 * therefore what a document serializes to, is exactly what it was.
 *
 * ## Why the entries stay in the DOM
 *
 * §11 requires that "clipped entries stay selectable, commentable and searchable
 * like any other body text", and §5 that commenting on an old entry is an
 * ordinary anchored thread. So a clipped entry is **not** removed and **not**
 * `display: none`: it keeps its place in the ProseMirror document and in the
 * DOM, clipped to zero height by `editor.css`, exactly as a clipped fence keeps
 * the lines below its cut. That is what makes every one of these true without a
 * special case anywhere else in the app:
 *
 * - **Search** reads the markdown on disk (SPEC.md §9.1), which is untouched.
 * - **Anchors** resolve against the document body (SPEC.md §6) — `offsetMap` and
 *   `sourceTrace` read the ProseMirror document, never the laid-out box — so an
 *   anchor into a clipped entry resolves whether or not it is on screen, and its
 *   highlight decoration is drawn on it.
 * - **Selection and editing** work because the text is really there: a selection
 *   that reaches into the clipped range opens the clip (see
 *   {@link clipStateApply}), so nothing is ever typed into a box nobody can see.
 * - **Revealing a conversation anchored inside the clip expands it** rather than
 *   scrolling to a zero-height box — the case §11 calls out by name. That is
 *   {@link expandClipAround}, which `useAnchorLayer` calls before it scrolls.
 *
 * ## The threshold is a count, and cannot be the fence's number
 *
 * One behaviour, but not one constant, and the reason is a unit mismatch rather
 * than a preference. The fence's threshold is a **length** —
 * `--fence-collapsed-height` in `markdown.css`, a CSS pixel height measured
 * against the laid-out box, because how much of a fence fits depends on the
 * width the reader gave it. §11 fixes the changelog's threshold in **entries**
 * ("past a threshold of entries"), and §5 and the workspace skill both speak of
 * how many entries sit behind the control. There is no conversion between the
 * two: a height cannot say how many entries are hidden, and a count cannot be a
 * `max-height`. So the number lives here, once, and the *behaviour* — clip,
 * a control naming the whole size, expand in place, keyboard-operable — is the
 * fence's, deliberately down to the wording of the button.
 */

/**
 * The section's heading, spelled exactly. The workspace skill pins this
 * spelling — "that heading is spelled `## Changelog` and nothing else — a second
 * spelling is a second section, and the reader's clip finds neither" — so this
 * constant and that sentence are one decision written down twice.
 */
export const CHANGELOG_HEADING = "Changelog";

/** The heading level the section is written at. */
const CHANGELOG_HEADING_LEVEL = 2;

/**
 * How many of the newest entries stay visible — and therefore the threshold,
 * since a section with no more than this many has nothing to hide.
 *
 * One number rather than a pair: "clips past a threshold" and "the newest
 * entries stay visible" are the same fact stated from either end, and two
 * constants could drift into a clip that hides one entry to save one line.
 */
export const CHANGELOG_VISIBLE_ENTRIES = 5;

/** The class `editor.css` clips to zero height. */
export const CHANGELOG_CLIPPED_CLASS = "changelog-clipped";

/** The marker `expandClipAround` looks for, and specs assert on. */
export const CHANGELOG_CLIPPED_ATTR = "data-changelog-clipped";

/** The expand/collapse control. */
export const CHANGELOG_MORE_ATTR = "data-changelog-more";

/**
 * The event that opens a clip from outside the editor.
 *
 * A DOM event rather than an exported command because the callers — the anchor
 * layer bringing a highlight into view, and anything else that finds a node it
 * needs on screen — hold an `Element`, not an `Editor`. It bubbles to
 * `view.dom`, where the plugin listens, so nothing outside this file has to know
 * that the clip is a ProseMirror decoration.
 */
export const CHANGELOG_EXPAND_EVENT = "corpus:changelog-expand";

export const CHANGELOG_CLIP_NAME = "corpusChangelogClip";

/** One entry of the section, as a range in the document. */
export interface ChangelogEntry {
  readonly from: number;
  readonly to: number;
}

export interface ChangelogSection {
  /** Where the control goes: immediately after the `## Changelog` heading. */
  readonly controlPos: number;
  /** Every entry in the section, oldest first — the document's own order. */
  readonly entries: readonly ChangelogEntry[];
  /** The entries the clip hides: all but the {@link CHANGELOG_VISIBLE_ENTRIES} newest. */
  readonly clipped: readonly ChangelogEntry[];
}

/** The list nodes whose *items* are entries rather than the list being one. */
const LIST_TYPES = new Set<string>([NODE.bulletList, NODE.orderedList, NODE.taskList]);

/**
 * The changelog section of `doc`, or `null` when it has none.
 *
 * **The last matching heading wins.** A document may legitimately mention the
 * word — a note *about* changelogs, a skill document quoting the spelling — and
 * §5 puts the real section at the end of the body, so reading backwards is both
 * the cheaper answer and the right one.
 *
 * **What counts as an entry.** The canonical section the agent writes is one
 * bullet list with one item per entry, so a list's *items* are counted
 * individually — counting the list as one block would mean a section of forty
 * entries never clipped. Anything else at the top level of the section (a
 * paragraph someone typed, a nested quote) counts as itself, because the section
 * is the person's to edit too (§5) and an entry they wrote as a paragraph is
 * still an entry.
 */
export function changelogSection(doc: PmModelNode): ChangelogSection | null {
  /** Every top-level block, paired with the position it starts at. */
  const blocks: { node: PmModelNode; at: number }[] = [];
  doc.forEach((node, offset) => {
    blocks.push({ node, at: offset });
  });

  const headingIndex = blocks.findLastIndex((block) => isChangelogHeading(block.node));
  const heading = blocks[headingIndex];
  if (heading === undefined) return null;

  const entries: ChangelogEntry[] = [];
  for (const block of blocks.slice(headingIndex + 1)) {
    // The section ends at the next heading of the same level or higher: what
    // follows belongs to that heading, not to the changelog.
    const isHeading = block.node.type.name === NODE.heading;
    if (isHeading && attrLevel(block.node) <= CHANGELOG_HEADING_LEVEL) break;
    if (LIST_TYPES.has(block.node.type.name)) {
      block.node.forEach((item, itemOffset) => {
        // A list's content starts one position inside the list itself.
        const from = block.at + 1 + itemOffset;
        entries.push({ from, to: from + item.nodeSize });
      });
      continue;
    }
    entries.push({ from: block.at, to: block.at + block.node.nodeSize });
  }

  const hidden = Math.max(0, entries.length - CHANGELOG_VISIBLE_ENTRIES);
  const headingEnd = heading.at + heading.node.nodeSize;
  return { controlPos: headingEnd, entries, clipped: entries.slice(0, hidden) };
}

function isChangelogHeading(node: PmModelNode): boolean {
  return (
    node.type.name === NODE.heading &&
    attrLevel(node) === CHANGELOG_HEADING_LEVEL &&
    node.textContent.trim() === CHANGELOG_HEADING
  );
}

/**
 * A heading's level. `Attrs` is `Record<string, any>` in prosemirror-model, so
 * the value is narrowed rather than trusted; a node whose level cannot be read
 * is treated as this section's own level, which makes it a boundary rather than
 * a block swallowed into the changelog.
 */
function attrLevel(node: PmModelNode): number {
  const level: unknown = node.attrs["level"];
  return typeof level === "number" ? level : CHANGELOG_HEADING_LEVEL;
}

/**
 * What the control says.
 *
 * Both numbers, because §11 asks for both and they answer different questions:
 * the whole size is what every fold in this app reports ("its whole size, the
 * way a clipped block names its whole length rather than a remainder"), and
 * "says how many are hidden" is what this rider asks of this control by name. A
 * label carrying one of them would be arguing with half the sentence.
 */
export function clipLabel(total: number, hidden: number): string {
  return `Show all ${String(total)} entries · ${String(hidden)} hidden`;
}

/** The same, spelled out for a reader who only hears it. */
export function clipDescription(total: number, hidden: number): string {
  const older = hidden === 1 ? "one older entry is" : `${String(hidden)} older entries are`;
  return `Show all ${String(total)} changelog entries — ${older} hidden`;
}

interface ClipState {
  readonly expanded: boolean;
  readonly decorations: DecorationSet;
}

interface ClipMeta {
  readonly expanded: boolean;
}

const clipKey = new PluginKey<ClipState>(CHANGELOG_CLIP_NAME);

/**
 * Whether `selection` reaches into any of `clipped` — the question that decides
 * whether a clip has to open.
 *
 * An empty selection counts: a caret placed inside a clipped entry (by keyboard
 * navigation, by ⌘A then an arrow key, by a click that landed there) is someone
 * about to type into text they cannot see.
 */
function touchesClip(clipped: readonly ChangelogEntry[], from: number, to: number): boolean {
  return clipped.some((entry) => from < entry.to && to > entry.from);
}

function decorate(doc: PmModelNode, expanded: boolean): DecorationSet {
  const section = changelogSection(doc);
  if (section === null || section.clipped.length === 0) return DecorationSet.empty;

  const total = section.entries.length;
  const hidden = section.clipped.length;
  const decorations: Decoration[] = [
    Decoration.widget(section.controlPos, (view) => control(view, total, hidden, expanded), {
      // Before whatever sits at this position, so the control reads as part of
      // the heading it belongs to rather than as the first thing kept.
      side: -1,
      // The widget is chrome, not content: a selection running past it must not
      // be redrawn because of it.
      ignoreSelection: true,
      stopEvent: () => true,
      // Rebuilt when — and only when — what it says would change.
      key: `${CHANGELOG_CLIP_NAME}:${String(total)}:${String(hidden)}:${String(expanded)}`,
    }),
  ];
  if (!expanded) {
    for (const entry of section.clipped) {
      decorations.push(
        Decoration.node(entry.from, entry.to, {
          class: CHANGELOG_CLIPPED_CLASS,
          [CHANGELOG_CLIPPED_ATTR]: "",
        }),
      );
    }
  }
  return DecorationSet.create(doc, decorations);
}

/** The control, built as DOM because a widget decoration is a DOM node. */
function control(view: EditorView, total: number, hidden: number, expanded: boolean): HTMLElement {
  const button = view.dom.ownerDocument.createElement("button");
  button.type = "button";
  button.className = expanded ? "changelog-more expanded" : "changelog-more";
  button.setAttribute(CHANGELOG_MORE_ATTR, "");
  // An island of chrome inside a contenteditable surface: without this the
  // caret can be placed *in* the button's text and the label becomes editable.
  // Set as an attribute rather than through the IDL property, which jsdom does
  // not implement — the DOM has to say this where a test can read it too.
  button.setAttribute("contenteditable", "false");
  button.setAttribute("aria-expanded", expanded ? "true" : "false");
  button.setAttribute(
    "aria-label",
    expanded ? "Clip the changelog back to its newest entries" : clipDescription(total, hidden),
  );
  button.textContent = expanded ? "Show less" : clipLabel(total, hidden);
  button.addEventListener("mousedown", (event) => {
    // A click on the control must not also place a caret in the body, which
    // would move the selection and (see `clipStateApply`) re-open the clip the
    // click was collapsing.
    event.preventDefault();
  });
  button.addEventListener("click", () => {
    toggleClip(view, !expanded);
  });
  button.addEventListener("keydown", (event) => {
    // `↵` and `space` are this button's own activation keys, and a host may bind
    // them globally — exactly `CodeFence.claimActivationKeys`'s reason. Stopped,
    // never prevented, so the native activation still happens.
    if (event.key === "Enter" || event.key === " ") event.stopPropagation();
  });
  return button;
}

/** Put the clip in `expanded` and repaint. */
export function toggleClip(view: EditorView, expanded: boolean): void {
  const meta: ClipMeta = { expanded };
  view.dispatch(view.state.tr.setMeta(clipKey, meta));
}

/**
 * Open the clip that contains `node`, if one does. Returns whether it did.
 *
 * The half of §11's anchor clause that is not automatic: "an anchor into a
 * clipped entry still resolves — revealing that conversation expands the clip
 * rather than quietly failing to reach it." Resolving is free (anchors read the
 * document, not the box); *reaching* it is this, and the caller is whoever is
 * about to scroll — see `useAnchorLayer`'s flash effect.
 *
 * Dispatching a ProseMirror transaction updates the DOM synchronously, so a
 * caller may scroll on the next line and find the entry laid out.
 */
export function expandClipAround(node: Node | null | undefined): boolean {
  const element = node instanceof Element ? node : (node?.parentElement ?? null);
  const clipped = element?.closest(`[${CHANGELOG_CLIPPED_ATTR}]`) ?? null;
  if (clipped === null) return false;
  clipped.dispatchEvent(new CustomEvent(CHANGELOG_EXPAND_EVENT, { bubbles: true }));
  return true;
}

/**
 * The plugin's `apply`, lifted out so it can be read (and tested) on its own.
 *
 * Three things move the state, and nothing else does:
 *
 * 1. the control, through a meta transaction;
 * 2. **a selection reaching into the clip**, which opens it — the clause that
 *    makes "clipped entries stay selectable, commentable and editable" true
 *    rather than merely claimed. Gated on the transaction having *set* a
 *    selection or changed the document, so that collapsing the clip while the
 *    caret happens to sit inside it does not instantly undo itself;
 * 3. the document changing, which only re-derives the decorations.
 */
export function clipStateApply(tr: Transaction, value: ClipState): ClipState {
  const meta = tr.getMeta(clipKey) as ClipMeta | undefined;
  let expanded = meta?.expanded ?? value.expanded;
  if (!expanded && (tr.selectionSet || tr.docChanged)) {
    const section = changelogSection(tr.doc);
    if (section !== null && touchesClip(section.clipped, tr.selection.from, tr.selection.to)) {
      expanded = true;
    }
  }
  if (!tr.docChanged && expanded === value.expanded) return value;
  return { expanded, decorations: decorate(tr.doc, expanded) };
}

/**
 * The extension, view-only. It adds no node, no mark and no command that writes:
 * a document opened, clipped, expanded and closed is byte-identical to the one
 * on disk.
 */
export const ChangelogClip = Extension.create({
  name: CHANGELOG_CLIP_NAME,

  addProseMirrorPlugins() {
    return [
      new Plugin<ClipState>({
        key: clipKey,
        state: {
          init: (_config, state) => ({
            expanded: false,
            decorations: decorate(state.doc, false),
          }),
          apply: clipStateApply,
        },
        props: {
          decorations: (state) => clipKey.getState(state)?.decorations ?? DecorationSet.empty,
        },
        view: (view) => {
          const open = (): void => {
            if (clipKey.getState(view.state)?.expanded === true) return;
            toggleClip(view, true);
          };
          view.dom.addEventListener(CHANGELOG_EXPAND_EVENT, open);
          return {
            destroy: () => {
              view.dom.removeEventListener(CHANGELOG_EXPAND_EVENT, open);
            },
          };
        },
      }),
    ];
  },
});
