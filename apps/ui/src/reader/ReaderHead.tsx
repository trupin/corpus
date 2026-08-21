import type { Doc, DocRow } from "@corpus/contract";
import { useDoc, type RowNotice } from "@corpus/kit";
import { useState, type ReactElement } from "react";
import { SaveChip } from "../editor/SaveChip";
import { CommentsPopover } from "./CommentsPopover";
import { DocMenu } from "./DocMenu";
import type { NavEntry } from "./useNavStack";

/**
 * The reader's header bar, element for element from `design/index.html`: a
 * `.back` accent button, the mono `.reader-id` pushed right, an (empty)
 * `.save-chip` slot, the 💬 `.comments-btn`, the ⋯ document menu and the ⤢
 * focus button — the last two both `.expand`.
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
  readonly onSelectThread: (threadId: string) => void;
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
  const [open, setOpen] = useState<"comments" | "menu" | null>(null);
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
      {threads.length === 0 ? null : (
        <button
          type="button"
          className="comments-btn"
          aria-label={`${String(threads.length)} threads on this document`}
          aria-expanded={open === "comments"}
          onClick={() => {
            setOpen(open === "comments" ? null : "comments");
          }}
        >
          {/* The count is its own box, so crossing into two digits does not
              widen the control and re-cut `.back` and `.reader-id` beside it
              (SPEC.md §11's rider; `.comments-count` carries the reservation).
              `textContent` is unchanged — still `💬 1`. */}
          💬 <span className="comments-count">{threads.length}</span>
        </button>
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

      {open === "comments" ? (
        <CommentsPopover
          threads={threads}
          onSelect={(threadId) => {
            setOpen(null);
            props.onSelectThread(threadId);
          }}
          onClose={() => {
            setOpen(null);
          }}
        />
      ) : null}

      {open === "menu" && doc !== undefined ? (
        <DocMenu
          doc={doc}
          threadStatus={props.threadStatus}
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
