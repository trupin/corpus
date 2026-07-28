import type { Doc, DocRow } from "@corpus/contract";
import { useDoc, type RowNotice } from "@corpus/kit";
import { useState, type ReactElement } from "react";
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
 * it *is* full screen.
 *
 * The `.save-chip` is deliberately present and empty. It is UI-006's slot for
 * the autosave state; leaving the element out would make the head reflow the
 * moment autosave lands, and leaving a *word* in it would claim a save path that
 * does not exist yet.
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
      <button
        type="button"
        className="back"
        title={previous === null ? "Back to list" : "Back (shift-click, or ⇧esc: straight to list)"}
        onClick={(event) => {
          props.onBack(event.shiftKey);
        }}
      >
        {backLabel(previous, previousTitle, props.listTitle)}
      </button>
      {props.hint === undefined ? null : <span className="focus-hint">{props.hint}</span>}
      <span className="reader-id">{props.docId} · git ✓</span>
      <span className="save-chip" data-save-chip />
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
          💬 {threads.length}
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
