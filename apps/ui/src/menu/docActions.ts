import {
  THREAD_DOC_TYPE,
  hasStaleActions,
  useDeleteDoc,
  useRowActions,
  useSetDocArchived,
  useSetThreadStatus,
  type RowNotice,
  type StalenessLevel,
} from "@corpus/kit";
import { threadStatusNotice } from "../thread/resolveNotice";
import type { MenuAction } from "./menuModel";

/**
 * A document's or thread's actions, declared once (SPEC.md §11).
 *
 * The reader's ⋯ menu and every context menu on that document read this array,
 * so an action's availability — a thread that was just resolved, a document that
 * is already archived, a row that has no staleness tier — changes in both at
 * once. Each item performs the **same** operation as its existing route:
 * `useRowActions` for Archive and Still current (SPEC.md §5 makes "still
 * current" a distinct act from editing, and a second implementation is how
 * `updated` eventually gets clobbered in one of them), `useSetDocArchived` for
 * Unarchive, `useSetThreadStatus` for resolve/reopen, `useDeleteDoc` for
 * Delete. Nothing here is a parallel implementation of anything.
 *
 * **Rows gain a menu they never had, and that is not "inventing".** Rows have
 * no ⋯ today, and the signed bullet nonetheless enumerates open · open in focus
 * · archive · delete · resolve/reopen · the staleness quick actions for them
 * (sprint-016 Adjudication 20). What "nothing invented" forbids is a new
 * *capability*, and there is none here.
 */

/** The archived document's status, as `GET /api/docs/{id}` reports it. */
const ARCHIVED = "archived";

/**
 * What restoring narrates.
 *
 * Exported for the same reason the kit's `archivedMessage` is: the sentence is
 * the only account the user gets of a write that moved a folder on disk, and a
 * second copy of it is a second claim about what happened.
 */
export function unarchivedMessage(title: string): string {
  return `Restored “${title}” — committed. It is back in the default lists.`;
}

/** The unarmed Delete copy, and the copy the first activation replaces it with. */
export const DELETE_LABEL = "Delete…";
export const DELETE_META = "user-only · click twice to confirm";
export const DELETE_ARMED_LABEL = "Really delete? Click again";
export const DELETE_ARMED_META =
  "permanent · git keeps history · its threads become orphaned records";

export interface DocActionSubject {
  readonly id: string;
  readonly title: string;
  readonly type: string;
  /** The document's own status; `"resolved"` is what makes a thread resolved. */
  readonly status: string;
  /** The staleness rung the row rendered at. Fresh (`0`) everywhere else. */
  readonly staleLevel?: StalenessLevel | undefined;
}

export interface DocActionOptions {
  /**
   * `reader` is the open document's own menu — the shipped ⋯ set. `row` is a
   * list item, which additionally offers the two ways to open it.
   */
  readonly surface: "reader" | "row";
  readonly onNotify: (notice: RowNotice) => void;
  /** Dismiss the menu. Only the actions that own their own close call it. */
  readonly close: () => void;
  /** The document left: the host pops it off its navigation stack. */
  readonly onGone?: (() => void) | undefined;
  readonly onOpen?: (() => void) | undefined;
  readonly onOpenFocus?: (() => void) | undefined;
}

export function useDocActions(
  subject: DocActionSubject,
  options: DocActionOptions,
): readonly MenuAction[] {
  const { surface, onNotify, close, onGone, onOpen, onOpenFocus } = options;
  const actions = useRowActions({ id: subject.id, title: subject.title }, { onNotify });

  /*
   * The notices ride on the hook, not on the call (UI-012): every item here
   * closes the menu, which unmounts the surface before the request settles, and
   * TanStack v5 skips a per-call `onSuccess` once its observer has no listeners.
   */
  const setThreadStatus = useSetThreadStatus({
    onSuccess: (_result, variables) => {
      onNotify({ tone: "info", message: threadStatusNotice(variables.resolved) });
    },
    onError: (error, variables) => {
      onNotify({
        tone: "error",
        message: `${variables.resolved ? "Resolve" : "Reopen"} failed — ${error.message}`,
      });
    },
  });
  const deleteDoc = useDeleteDoc();

  /*
   * Restoring rides on its own hook for the same UI-012 reason resolve/reopen
   * does: this item closes the menu in the same click, so the notice has to
   * survive the surface that started the write.
   */
  const setArchived = useSetDocArchived({
    onSuccess: () => {
      onNotify({ tone: "info", message: unarchivedMessage(subject.title) });
    },
    onError: (error) => {
      onNotify({ tone: "error", message: `Unarchive failed — ${error.message}` });
    },
  });

  const isThread = subject.type === THREAD_DOC_TYPE;
  const archived = subject.status === ARCHIVED;
  const resolved = subject.status === "resolved";
  const stale = hasStaleActions(subject.staleLevel ?? 0);
  const list: MenuAction[] = [];

  if (surface === "row" && onOpen !== undefined) {
    list.push({
      id: "open",
      label: "Open",
      meta: "in this column’s reader",
      run: onOpen,
    });
  }
  if (surface === "row" && onOpenFocus !== undefined) {
    list.push({
      id: "open-focus",
      label: "Open in focus",
      meta: "full screen (⇧↵)",
      run: onOpenFocus,
    });
  }

  // "Still current" is unconditional on the reader's own menu — that is the
  // shipped set — and on a row only where the ramp already shows it.
  if (surface === "reader" || stale) {
    list.push({
      id: "review",
      label: "Still current",
      meta: "sets reviewed: now — resets staleness",
      disabled: actions.isBusy,
      run: actions.stillCurrent,
    });
  }

  if (isThread) {
    list.push({
      id: "resolve",
      label: resolved ? "Reopen" : "Resolve",
      meta: "status flip, committed",
      disabled: setThreadStatus.isPending,
      run: () => {
        setThreadStatus.mutate({ id: subject.id, resolved: !resolved });
      },
    });
  }

  if (surface === "row" && stale) {
    list.push({
      id: "triage",
      label: "@agent triage",
      meta: "opens a stale-review thread for the agent",
      disabled: actions.isBusy,
      run: actions.triage,
    });
  }

  /*
   * The two directions of one reversible act, and only ever one of them
   * (SPEC.md §7 — an archived skill is "restorable"). Availability is the
   * document's own `status`, which `DocActionSubject` already carries, so both
   * presentations gain the inverse from this one declaration. No confirm on
   * either: neither is destructive, and §11 keeps the two-click ceremony for the
   * one act that is.
   */
  if (archived) {
    list.push({
      id: "unarchive",
      label: "Unarchive",
      meta: "restores it — a skill’s folder moves back too",
      disabled: setArchived.isPending,
      run: () => {
        setArchived.mutate({ id: subject.id, archived: false });
      },
    });
  } else {
    list.push({
      id: "archive",
      label: "Archive",
      meta: "reversible — hidden from default lists",
      disabled: actions.isBusy,
      run: actions.archive,
    });
  }

  list.push({
    id: "delete",
    label: DELETE_LABEL,
    meta: DELETE_META,
    danger: true,
    disabled: deleteDoc.isPending,
    confirm: { label: DELETE_ARMED_LABEL, meta: DELETE_ARMED_META },
    // The request can be refused, so this item owns its own close: a menu that
    // had already gone would leave the refusal with nothing to re-arm.
    keepOpen: true,
    /*
     * Through the promise rather than through per-call callbacks (PR #12
     * review, NIT 24). This item keeps the menu open — but `esc`, an outside
     * click or the reader closing dismisses it anyway, and a per-call callback
     * dies with the observer that dismissal removes (`SettledCallbacks`). The
     * one outcome nobody may lose is a *refused* deletion: without it the
     * document is still there and the user was told nothing. `useDeleteDoc`
     * takes no hook-level callbacks and `@corpus/kit` is not this issue's to
     * change; `mutateAsync` returns the mutation's own promise, which settles
     * wherever the menu went. `close`/`onGone`/`disarm` are surface state and
     * are no-ops once the surface has gone, which is the correct behaviour for
     * them.
     */
    run: (disarm) => {
      void deleteDoc
        .mutateAsync(subject.id)
        .then((result) => {
          const orphans = result.orphanedThreadIds.length;
          onNotify({
            tone: "info",
            message:
              `Deleted “${subject.title}” — user-only act; git retains its history.` +
              (orphans === 0
                ? ""
                : ` ${String(orphans)} thread${
                    orphans === 1 ? " became an orphaned record" : "s became orphaned records"
                  }.`),
          });
          close();
          onGone?.();
        })
        .catch((error: unknown) => {
          const detail = error instanceof Error ? error.message : "the server refused it";
          onNotify({ tone: "error", message: `Delete failed — ${detail}` });
          disarm();
        });
    },
  });

  return list;
}
