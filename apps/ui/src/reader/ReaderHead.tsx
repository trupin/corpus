import type { Doc, DocRow } from "@corpus/contract";
import { useDoc, type RowNotice } from "@corpus/kit";
import { useState, type ReactElement } from "react";
import { CommentsSwitch, type ReaderTab } from "../comments/CommentsSwitch";
import { SaveChip } from "../editor/SaveChip";
import { DocMenu } from "./DocMenu";
import type { NavEntry } from "./useNavStack";

/**
 * The reader's header bar, element for element from `design/index.html`: a
 * `.back` accent button, the mono `.reader-id` pushed right, an (empty)
 * `.save-chip` slot, the `Document / Comments` switch, the ⋯ document menu and
 * the ⤢ focus button — the last two both `.expand`.
 *
 * **💬 is the switch now** (UI-063). It opened a popover listing every thread on
 * the document with nothing to do about any of them; it reaches a list that can
 * be filtered, replied to and written into, so the popover was subsumed rather
 * than kept beside it. One control, not two — see `CommentsSwitch` for the
 * measurement that rules the second one out.
 *
 * Shared by the column reader and focus mode, whose heads carry the same
 * actions; focus mode adds a close control and the esc hint and drops ⤢, since
 * it *is* full screen — and drops the back button until its excursion has depth
 * (see {@link showsBack}).
 *
 * The `.save-chip` is now UI-006's `SaveChip`, which reads the editor's save
 * state from a context the reader host mounts. With no editor below it — a
 * thread's conversation, a plugin-typed document — it renders as the empty
 * element the head has always carried, so the head does not reflow when the
 * surface changes.
 *
 * **The row is a fixed box holding text of unknown length**, and `Reader.css`'s
 * head block is where that is arranged (UI-135): the controls never yield, the
 * back label and the id truncate with the whole of each on a `title`, and the
 * save chip's box is reserved to its ordinary state. What this file owes that
 * arrangement is the two `title`s — see {@link backTitle} and
 * {@link readerIdText} — because a truncation with nothing behind it is a
 * value quietly cut, which SHARED-057 rules out.
 */

export interface ReaderHeadProps {
  readonly docId: string;
  /** The document, once it has loaded; the ⋯ menu needs it and hides until then. */
  readonly doc: Doc | undefined;
  readonly threads: readonly DocRow[];
  /** Thread status for the Resolve/Reopen item; `null` on non-thread documents. */
  readonly threadStatus: string | null;
  /** The entry Back would reveal — names the button when the stack has depth. */
  readonly previous: NavEntry | null;
  /** Shown on the back button when the stack has no depth: the column's name. */
  readonly listTitle: string;
  /** Extra controls before the back button (focus mode's ✕ Close). */
  readonly leading?: ReactElement | null;
  /** The mono hint focus mode carries; absent in a column. */
  readonly hint?: string | undefined;
  /** Chrome only — the prototype gives the two heads different padding. */
  readonly variant?: "column" | "focus";
  /** ⤢ — omitted in focus mode, which is already full screen. */
  readonly onExpand?: (() => void) | undefined;
  readonly onBack: (toList: boolean) => void;
  /** Which half of the reader is showing (SPEC.md §11's `Document / Comments` switch). */
  readonly tab: ReaderTab;
  readonly onTab: (tab: ReaderTab) => void;
  readonly onGone: () => void;
  readonly onNotify: (notice: RowNotice) => void;
}

/**
 * The back button's label.
 *
 * With depth it is the **previous** document's title — where Back actually goes
 * — and with an empty stack it is the column's title, because Back then leaves
 * the reader entirely. Naming it after the current document (the mistake this
 * exists to avoid) would make the control claim it does nothing.
 */
export function backLabel(
  previous: NavEntry | null,
  previousTitle: string | null,
  listTitle: string,
): string {
  if (previous === null) return `‹ ${listTitle}`;
  const title = previousTitle?.trim() ?? "";
  return `‹ ${title === "" ? previous.docId : title}`;
}

/**
 * Whether this head carries a back button at all.
 *
 * In a column it always does: Back is the only way out of the reader and into
 * the list. In focus mode ✕ Close already *is* that way out — at the bottom of
 * the excursion `FocusMode`'s depth-0 effect turns Back into a second Close, so
 * the head would render two adjacent controls performing one action (UI-022).
 * The back button earns its place only once the stack has depth, where it is
 * named after the previous document and navigates *within* the excursion.
 *
 * `design/index.html` models exactly this: `#focus-back` ships `hidden` and
 * `openFocus` unhides it only when the focus stack has a previous entry.
 */
export function showsBack(variant: ReaderHeadProps["variant"], previous: NavEntry | null): boolean {
  return variant !== "focus" || previous !== null;
}

/**
 * The back button's tooltip: **the label, whole, and then what the button does**.
 *
 * The label is a parent document's title and the button truncates it — the head
 * is a fixed box and the title is not (UI-135) — so SHARED-057's clause 2
 * applies: *"truncate it in place and give the whole of it to a tooltip"*. The
 * hint that used to be the entire tooltip follows it, because the shift-click
 * shortcut is not discoverable anywhere else.
 */
export function backTitle(label: string, previous: NavEntry | null): string {
  return previous === null
    ? `${label} — Back to list`
    : `${label} — Back (shift-click, or ⇧esc: straight to list)`;
}

/** What `.reader-id` reads, and what its `title` reveals when it is truncated. */
export function readerIdText(docId: string): string {
  return `${docId} · git ✓`;
}

export function ReaderHead(props: ReaderHeadProps): ReactElement {
  const { doc, previous, threads } = props;
  const [open, setOpen] = useState<"menu" | null>(null);
  // The document Back returns to is the one we just came from, so it is in the
  // cache and this costs no request in the case that matters.
  const previousDoc = useDoc(previous?.docId);
  const previousTitle = previousDoc.data?.frontmatter.title ?? null;

  return (
    <div className={props.variant === "focus" ? "reader-head focus-head" : "reader-head"}>
      {props.leading ?? null}
      {showsBack(props.variant, previous) ? (
        <button
          type="button"
          className="back"
          title={backTitle(backLabel(previous, previousTitle, props.listTitle), previous)}
          onClick={(event) => {
            props.onBack(event.shiftKey);
          }}
        >
          {/* The label is its own element so it can carry the ellipsis: the
              button is a flex row and `text-overflow` does not reach a flex
              container's own text. */}
          <span className="back-label">{backLabel(previous, previousTitle, props.listTitle)}</span>
        </button>
      ) : null}
      {props.hint === undefined ? null : <span className="focus-hint">{props.hint}</span>}
      <span className="reader-id" title={readerIdText(props.docId)}>
        {readerIdText(props.docId)}
      </span>
      <SaveChip />
      {/* Under 💬's own condition, plus one: whenever the list is showing, so
          the way back is never missing. A document with no comments reaches the
          list through the ⋯ menu — see `CommentsSwitch` for why the head cannot
          simply carry it unconditionally. */}
      {threads.length === 0 && props.tab !== "comments" ? null : (
        <CommentsSwitch tab={props.tab} count={threads.length} onTab={props.onTab} />
      )}
      <button
        type="button"
        className="expand"
        data-doc-menu
        aria-label="Document actions"
        title="Document actions"
        aria-expanded={open === "menu"}
        disabled={doc === undefined}
        onClick={() => {
          setOpen(open === "menu" ? null : "menu");
        }}
      >
        ⋯
      </button>
      {props.onExpand === undefined ? null : (
        <button
          type="button"
          className="expand"
          data-expand
          aria-label="Read full screen"
          title="Read full screen"
          onClick={props.onExpand}
        >
          ⤢
        </button>
      )}

      {open === "menu" && doc !== undefined ? (
        <DocMenu
          doc={doc}
          threadStatus={props.threadStatus}
          /*
           * The list's other way in, and the only one on a document with no
           * comments yet (UI-067). It costs the head nothing, and the ⋯ set is
           * where a document's own actions already live.
           */
          onComments={() => {
            setOpen(null);
            props.onTab("comments");
          }}
          onClose={() => {
            setOpen(null);
          }}
          onGone={props.onGone}
          onNotify={props.onNotify}
        />
      ) : null}
    </div>
  );
}
