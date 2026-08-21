import { createContext, useContext, useState, type ReactElement, type ReactNode } from "react";
import type { SaveState } from "./useAutosave.js";

/**
 * The `.save-chip` — what the editor is doing, in the reader's header.
 *
 * The chip lives in `ReaderHead` and the editor lives in the scroll area below
 * it, which is why the state travels through a context rather than a prop: the
 * two are siblings, and lifting the whole editor's state into the reader to
 * pass one string down would make every keystroke re-render the reader.
 *
 * **Two states, and both are the response's.** `.saving` while the `PUT` is on
 * the wire, `.saved` when it has answered — and because the server commits
 * inside the mutation pipeline, a `PUT` that has answered *is* committed, which
 * is what lets the chip say `committed · git ✓` truthfully rather than
 * hopefully (sprint-011 Adjudication 1). Nothing here advances on a timer.
 *
 * The anchor half of the copy is the response's too. `{remapped, orphaned}`
 * comes back from `PUT /api/docs/{id}`, and a save that orphaned a thread does
 * not get to claim `anchors ✓` (sprint-011 TEST-18).
 *
 * **The box does not follow the copy.** The five strings below span 246px, and
 * a chip that grew with them walked its neighbours across the head and pushed
 * the ⋯ and ⤢ controls out of the column (UI-135). So the element carries
 * {@link RESERVED_SAVE_CHIP_TEXT} on `data-reserve`, `Reader.css` renders that
 * invisibly to size the box, and the visible text draws inside it — reserved
 * to the widest thing it can hold, in the font that actually shipped.
 */

export interface SaveStatusValue {
  readonly state: SaveState;
  readonly onRetry: (() => void) | null;
}

export type PublishSaveStatus = (value: SaveStatusValue) => void;

const IDLE: SaveStatusValue = { state: { kind: "idle" }, onRetry: null };

/**
 * Two contexts, not one, and deliberately so: the **publisher** must keep a
 * stable identity across every state change, or the editor's publishing effect
 * would list a value that changes on every publish among its dependencies and
 * re-publish forever.
 */
const SaveStatusContext = createContext<SaveStatusValue>(IDLE);
const PublishContext = createContext<PublishSaveStatus | null>(null);

/**
 * Mounted by each reader host around its head *and* its body.
 *
 * Absent, the chip renders as the empty `.save-chip` element the head has
 * always carried — which is what keeps a surface with no editor (a thread
 * conversation, a plugin-rendered document) from reflowing when the editor is
 * not there.
 */
export function SaveStatusProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const [value, setValue] = useState<SaveStatusValue>(IDLE);
  return (
    <PublishContext.Provider value={setValue}>
      <SaveStatusContext.Provider value={value}>{children}</SaveStatusContext.Provider>
    </PublishContext.Provider>
  );
}

/** The publishing half, for the editor. `null` when no provider is mounted. */
export function useSaveStatusPublisher(): PublishSaveStatus | null {
  return useContext(PublishContext);
}

/** The reading half, for anything that wants the state without the chip. */
export function useSaveStatus(): SaveStatusValue {
  return useContext(SaveStatusContext);
}

/** The copy for a state. Exported because it is what the E2E log quotes. */
export function saveChipText(state: SaveState): string {
  switch (state.kind) {
    case "idle":
      return "";
    case "saving":
      return "saving…";
    case "saved": {
      if (state.orphaned > 0) {
        const noun = state.orphaned === 1 ? "anchor" : "anchors";
        return `committed · git ✓ · ${String(state.orphaned)} ${noun} orphaned`;
      }
      if (state.remapped > 0) {
        const noun = state.remapped === 1 ? "anchor" : "anchors";
        return `committed · git ✓ · ${String(state.remapped)} ${noun} moved`;
      }
      return "committed · git ✓";
    }
    case "error":
      return "save failed";
  }
}

/**
 * The widest string {@link saveChipText} produces, and therefore the width the
 * chip's box is reserved to (UI-135, SPEC.md §11's *"nothing resizes because of
 * what it holds"*).
 *
 * Derived rather than written out, so the reservation cannot drift from the
 * copy: change a word above and the box changes with it. `orphaned` beats
 * `moved` by three characters, and two digits is where the count stops being
 * ordinary — a corpus where one save orphans a hundred conversations has a
 * larger problem than a chip. Past that the text truncates into the reserved
 * box and its whole value is on the element's `title`, which is SHARED-057's
 * clause 2 and the reason an unbounded count needs no unbounded box.
 */
export const RESERVED_SAVE_CHIP_TEXT = saveChipText({
  kind: "saved",
  remapped: 0,
  orphaned: 99,
});

export function saveChipClass(state: SaveState): string {
  switch (state.kind) {
    case "saving":
      return "save-chip saving";
    case "saved":
      return "save-chip saved";
    case "error":
      return "save-chip failed";
    case "idle":
      return "save-chip";
  }
}

/**
 * **The chip is always the same element**, and the retry lives inside it.
 *
 * It used to *become* a `<button>` when a failure offered a retry, and that one
 * substitution was measurably a different width: Chromium refuses to shrink a
 * `<button>` below its own content whatever `min-width` says, so in a head with
 * a long back label the span shrank to 203px and the button held 247px — the
 * chip changing size between two of its five states, which is the defect this
 * whole file was corrected for (UI-135). Nesting the control keeps the flex item
 * one element for the row's whole life, and costs nothing: the button is still a
 * real button, still carries the failure's message, and still calls `retry`.
 */
export function SaveChip(): ReactElement {
  const { state, onRetry } = useContext(SaveStatusContext);
  const text = saveChipText(state);
  const retry =
    state.kind === "error" && onRetry !== null ? { message: state.message, run: onRetry } : null;

  return (
    <span
      className={saveChipClass(state)}
      data-save-chip
      data-reserve={RESERVED_SAVE_CHIP_TEXT}
      role={state.kind === "idle" ? undefined : "status"}
      // The failure's own sentence beats the chip's three words, so an error
      // keeps reporting it. Otherwise the title is the chip's whole text, which
      // is what makes truncating it into the reserved box honest (SHARED-057).
      {...(state.kind === "error" ? { title: state.message } : text === "" ? {} : { title: text })}
    >
      {retry === null ? (
        <span className="save-chip-text">{text}</span>
      ) : (
        <button
          type="button"
          className="save-chip-text save-chip-retry"
          title={retry.message}
          onClick={retry.run}
        >
          {text} — retry
        </button>
      )}
    </span>
  );
}
