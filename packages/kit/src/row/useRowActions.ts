import type { DocRow } from "@corpus/contract";
import { useCallback, useState } from "react";
import { useCreateThread } from "../query/useCreateThread.js";
import { useSetDocArchived } from "../query/useSetDocArchived.js";
import { useUpdateDoc } from "../query/useUpdateDoc.js";

/**
 * The three quick actions a stale row grows (SPEC.md §5, §10). Each one is a
 * real, committed mutation through the kit's hooks — the ramp is actionable, not
 * decorative, and none of these is a local UI flag.
 *
 * The subject is `Pick<DocRow, "id" | "title">` rather than a whole row because
 * these are **document** acts, not row acts: the reader's ⋯ menu offers the same
 * Archive and the same "Still current" from a `Doc`, and it must be the same
 * unit. Two implementations of "Still current" is how `updated` eventually gets
 * clobbered in one of them, silently and permanently (SPEC.md §5).
 */

/** The subject of a quick action: any document, however the caller learned of it. */
export type RowActionSubject = Pick<DocRow, "id" | "title">;

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

/**
 * What archiving narrates. Exported because archiving has two entry points —
 * this row action and SPEC.md §10's `e` — and a second wording would be a second
 * claim about what the same `POST /api/docs/{id}/archive` call did.
 */
export function archivedMessage(title: string): string {
  return `Archived "${title}" — committed. Archiving is reversible.`;
}

export function useRowActions(row: RowActionSubject, options: RowActionsOptions = {}): RowActions {
  const { onNotify } = options;
  const clock = options.now ?? (() => new Date());
  const [isLeaving, setLeaving] = useState(false);

  const notify = useCallback(
    (tone: RowNotice["tone"], message: string) => {
      onNotify?.({ tone, message });
    },
    [onNotify],
  );

  const failed = useCallback(
    (verb: string, error: Error) => {
      // The row is left exactly as it was. A quick action the server refuses
      // — validation, a `403`, an unreachable server — leaves a row that had
      // already optimistically removed itself lying about corpus state.
      notify("error", `${verb} failed — ${error.message}`);
    },
    [notify],
  );

  /*
   * Three mutations, and every notice on the **hook's** callbacks rather than on
   * `mutate`'s (UI-012).
   *
   * The hook-level ones survive the caller's unmount, which is the difference
   * between a toast and silence for the reader's ⋯ menu: it closes itself the
   * moment an item is clicked, and a per-call callback dies with the observer
   * (`SettledCallbacks`). "Still current" and "@agent triage" then need their own
   * mutations because a hook-level callback is bound to the hook, not to the
   * call — one shared write would have to guess which verb it was reporting by
   * sniffing the patch it sent.
   *
   * Archive is a **route**, not a patch (UI-020, sprint-018 Adjudication 7).
   * `PUT {status: "archived"}` sets the frontmatter key and leaves a skill's
   * folder in `.claude/skills/`, where Claude Code still reads it and where it
   * still holds its name against `corpus skill create` — §7's promise with the
   * only part that mattered missing. Only `POST …/archive` moves the folder.
   */
  const archiveWrite = useSetDocArchived({
    onSuccess: () => {
      notify("info", archivedMessage(row.title));
    },
    onError: (error) => {
      setLeaving(false);
      failed("Archive", error);
    },
  });

  const reviewWrite = useUpdateDoc(row.id, {
    onSuccess: () => {
      notify("info", `"${row.title}" marked still current — reviewed: now (committed).`);
    },
    onError: (error) => {
      failed("Still current", error);
    },
  });

  const createThread = useCreateThread({
    onSuccess: () => {
      notify("info", "Queued — the agent will review this document and propose next steps.");
    },
    onError: (error) => {
      failed("@agent triage", error);
    },
  });

  const isBusy =
    archiveWrite.isPending || reviewWrite.isPending || createThread.isPending || isLeaving;

  const archive = useCallback(() => {
    if (isBusy) return;
    // Visual only, and applied before the round trip so the slide has the
    // request's own latency to play against. The row does not *leave* until the
    // corpus says it left — the refetch that follows the invalidation is what
    // removes it, never a timer.
    setLeaving(true);
    archiveWrite.mutate({ id: row.id, archived: true });
  }, [archiveWrite, isBusy, row.id]);

  const stillCurrent = useCallback(() => {
    if (isBusy) return;
    // `reviewed` and nothing else. SPEC.md §5 makes this a distinct act from
    // editing: it must not touch `updated` and it must not be modelled as a body
    // save, or every future staleness reading is wrong and silently so.
    reviewWrite.mutate({ reviewed: clock().toISOString() });
  }, [clock, isBusy, reviewWrite]);

  const triage = useCallback(() => {
    if (isBusy) return;
    createThread.mutate({
      parent: row.id,
      // Whole-document: the request is about the document, not about a phrase in it.
      selector: null,
      title: `Stale review — ${row.title}`,
      body: triagePrompt(row.title),
      requestsAgent: true,
    });
  }, [createThread, isBusy, row.id, row.title]);

  return {
    archive,
    stillCurrent,
    triage,
    isBusy,
    isLeaving,
    error: archiveWrite.error ?? reviewWrite.error ?? createThread.error,
  };
}
