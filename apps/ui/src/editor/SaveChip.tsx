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

export function SaveChip(): ReactElement {
  const { state, onRetry } = useContext(SaveStatusContext);

  if (state.kind === "error" && onRetry !== null) {
    return (
      <button
        type="button"
        className={saveChipClass(state)}
        data-save-chip
        title={state.message}
        onClick={onRetry}
      >
        {saveChipText(state)} — retry
      </button>
    );
  }

  return (
    <span
      className={saveChipClass(state)}
      data-save-chip
      role={state.kind === "idle" ? undefined : "status"}
      {...(state.kind === "error" ? { title: state.message } : {})}
    >
      {saveChipText(state)}
    </span>
  );
}
