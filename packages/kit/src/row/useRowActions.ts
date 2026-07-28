import type { DocRow } from "@corpus/contract";
import { useCallback, useState } from "react";
import { useCreateThread } from "../query/useCreateThread.js";
import { useUpdateDoc } from "../query/useUpdateDoc.js";

/**
 * The three quick actions a stale row grows (SPEC.md §5, §11). Each one is a
 * real, committed mutation through the kit's hooks — the ramp is actionable, not
 * decorative, and none of these is a local UI flag.
 */

/** What the caller is told when an action lands or fails. Wired to a toast by the host. */
export type RowNotice = { readonly tone: "info" | "error"; readonly message: string };

export interface RowActionsOptions {
  readonly onNotify?: ((notice: RowNotice) => void) | undefined;
  /** Overridable so a test can pin the `reviewed` instant it asserts on disk. */
  readonly now?: (() => Date) | undefined;
}

export interface RowActions {
  archive: () => void;
  stillCurrent: () => void;
  triage: () => void;
  /** True from the first click until the mutation settles — the double-click guard. */
  readonly isBusy: boolean;
  /** True once Archive has been accepted: the row plays `.leaving` while it is. */
  readonly isLeaving: boolean;
  readonly error: Error | null;
}

/**
 * The prompt the triage thread opens with. A first turn that asks nothing gives
 * the agent nothing to answer, and this thread exists precisely to get a
 * recommendation back.
 */
export function triagePrompt(title: string): string {
  return (
    `This document has gone stale. Please review "${title}" and recommend one of: ` +
    "archive it, update it, or split it into what is still current and what is not."
  );
}

export function useRowActions(row: DocRow, options: RowActionsOptions = {}): RowActions {
  const { onNotify } = options;
  const clock = options.now ?? (() => new Date());
  const update = useUpdateDoc(row.id);
  const createThread = useCreateThread();
  const [isLeaving, setLeaving] = useState(false);

  const notify = useCallback(
    (tone: RowNotice["tone"], message: string) => {
      onNotify?.({ tone, message });
    },
    [onNotify],
  );

  const failed = useCallback(
    (verb: string, error: Error) => {
      // The row is left exactly as it was. A quick action on an agent-locked
      // document is refused by the server (423), and a row that had already
      // optimistically removed itself would be lying about corpus state.
      notify("error", `${verb} failed — ${error.message}`);
    },
    [notify],
  );

  const isBusy = update.isPending || createThread.isPending || isLeaving;

  const archive = useCallback(() => {
    if (isBusy) return;
    // Visual only, and applied before the round trip so the slide has the
    // request's own latency to play against. The row does not *leave* until the
    // corpus says it left — the refetch that follows the invalidation is what
    // removes it, never a timer.
    setLeaving(true);
    update.mutate(
      { status: "archived" },
      {
        onSuccess: () => {
          notify("info", `Archived "${row.title}" — committed. Archiving is reversible.`);
        },
        onError: (error) => {
          setLeaving(false);
          failed("Archive", error);
        },
      },
    );
  }, [failed, isBusy, notify, row.title, update]);

  const stillCurrent = useCallback(() => {
    if (isBusy) return;
    // `reviewed` and nothing else. SPEC.md §5 makes this a distinct act from
    // editing: it must not touch `updated` and it must not be modelled as a body
    // save, or every future staleness reading is wrong and silently so.
    update.mutate(
      { reviewed: clock().toISOString() },
      {
        onSuccess: () => {
          notify("info", `"${row.title}" marked still current — reviewed: now (committed).`);
        },
        onError: (error) => {
          failed("Still current", error);
        },
      },
    );
  }, [clock, failed, isBusy, notify, row.title, update]);

  const triage = useCallback(() => {
    if (isBusy) return;
    createThread.mutate(
      {
        parent: row.id,
        // Whole-document: the request is about the document, not about a phrase in it.
        selector: null,
        title: `Stale review — ${row.title}`,
        body: triagePrompt(row.title),
        requestsAgent: true,
      },
      {
        onSuccess: () => {
          notify("info", "Queued — the agent will review this document and propose next steps.");
        },
        onError: (error) => {
          failed("@agent triage", error);
        },
      },
    );
  }, [createThread, failed, isBusy, notify, row.id, row.title]);

  return {
    archive,
    stillCurrent,
    triage,
    isBusy,
    isLeaving,
    error: update.error ?? createThread.error,
  };
}
