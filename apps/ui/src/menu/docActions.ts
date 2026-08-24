import {
  THREAD_DOC_TYPE,
  hasStaleActions,
  useDeleteDoc,
  useMoveDoc,
  useRowActions,
  useSetDocArchived,
  useSetThreadStatus,
  useUpdateDoc,
  warningNotices,
  type RowNotice,
  type StalenessLevel,
} from "@corpus/kit";
import { statusLock } from "../doc/statusLock";
import { threadStatusNotice } from "../thread/resolveNotice";
import type { MenuAction } from "./menuModel";

/**
 * A document's or thread's actions, declared once (SPEC.md §10).
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

/**
 * What resolving or reopening an ordinary document narrates.
 *
 * The second sentence is the one thing a user cannot see for themselves and is
 * most likely to fear: SHARED-031 makes `resolved` "a statement about what is
 * left to do, not a way to tidy the board", so the document **keeps its place in
 * every list already showing it**. Saying so is what stops Resolve being read as
 * a quiet Archive.
 *
 * Keyed on what was **sent** rather than on the render's own status, for
 * `threadStatusNotice`'s reason: the callback outlives the menu that started the
 * write (UI-012).
 */
export function docStatusNotice(title: string, resolved: boolean): string {
  return resolved
    ? `Resolved “${title}” — committed. It stays where it is.`
    : `Reopened “${title}” — committed.`;
}

/** The unarmed Delete copy, and the copy the first activation replaces it with. */
export const DELETE_LABEL = "Delete…";
export const DELETE_META = "user-only · click twice to confirm";
export const DELETE_ARMED_LABEL = "Really delete? Click again";
export const DELETE_ARMED_META =
  "permanent · git keeps history · its threads become orphaned records";

/** One "open in… <board>" target: a board that is not the showing one. */
export interface BoardTarget {
  readonly id: string;
  readonly title: string;
  readonly open: () => void;
}

export interface DocActionSubject {
  readonly id: string;
  readonly title: string;
  readonly type: string;
  /** The document's own status; `"resolved"` is what makes a thread resolved. */
  readonly status: string;
  /** The staleness rung the row rendered at. Fresh (`0`) everywhere else. */
  readonly staleLevel?: StalenessLevel | undefined;
  /**
   * Where the document is filed, relative to `data/docs/`, with no trailing
   * slash. Only the move items read it, and only to leave the folder the
   * document is already in off the list.
   */
  readonly folder?: string | undefined;
}

/**
 * What a "Move to …" item says (SPEC.md §9.2: "moving a document rewrites its
 * path only").
 *
 * The sentence a person needs is the one they would otherwise fear: the id is
 * assigned at creation and never changes, so nothing that points at this
 * document breaks.
 */
export function movedMessage(title: string, folder: string): string {
  return (
    `Moved “${title}” to ${folder}/ — committed. Its id is unchanged, so every link, ` +
    "anchor and thread on it still resolves."
  );
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
  /** Open — a path off this row (SPEC.md §10, rider 3; the `↵` act). */
  readonly onOpen?: (() => void) | undefined;
  /**
   * What the Open item says, when the caller's surface opens somewhere the
   * default sentence does not describe.
   *
   * The board's row opens "a new column to the right"; the explorer's tree opens
   * a **preview path on the default-open board** (rider 1), which is a different
   * promise about a different place. Overriding the sentence rather than adding
   * a second Open item is what keeps the archive, resolve and delete items below
   * one declaration for both surfaces.
   */
  readonly openLabel?: { readonly label: string; readonly meta: string } | undefined;
  /**
   * "Open and keep" — the explorer's double click (rider 3: "the explorer's path
   * is a preview: the next explorer click replaces it unless it was kept").
   *
   * Absent on every other surface, because no other surface opens a path that
   * something later replaces.
   */
  readonly onOpenAndKeep?: (() => void) | undefined;
  /** Open here — the column's own in-place reader (the `⌥↵` act). */
  readonly onOpenHere?: (() => void) | undefined;
  readonly onOpenFocus?: (() => void) | undefined;
  /**
   * "open in… <boards>" (rider 3): one item per other board, each landing the
   * document as a loose path at the left edge of that board. Built by the
   * caller from the board surface, so this module stays board-free.
   */
  readonly boardTargets?: readonly BoardTarget[] | undefined;
  /**
   * "Move to …" (SPEC.md §9.2, `POST /api/docs/{id}/move`): every folder in the
   * workspace, as the caller's tree spells them — relative to `data/docs/`, no
   * trailing slash, deepest paths included.
   *
   * **A list of folders and not a dialog**, which is the decision UI-158 makes
   * and the reason the mockup's item could stay an ellipsis. The destinations
   * are a known, small, already-drawn set: the explorer is showing them. Naming
   * them as items reuses the menu the user already opened, cannot be mistyped,
   * and reaches the keyboard for free — where a modal would be a surface nothing
   * draws and a second place to hold a folder path.
   *
   * The list is **not bounded**: an act that could not reach some folders would
   * be broken rather than bounded, and the menu already derives its own ceiling
   * from the room and scrolls (`menuRoom`). Absent on every surface that does
   * not pass one, which is every surface but the explorer's tree today — the
   * document's folder chip in the reader is the second one, and is its own
   * issue.
   */
  readonly moveTargets?: readonly string[] | undefined;
  /**
   * Show this document's comments list (SPEC.md §10's rider, UI-063).
   *
   * The reader passes it; a row does not, because a row has no reader to switch.
   * It is the list's second way in and the **only** one on a document with no
   * conversations yet, where the head's 💬 toggle does not appear — see
   * `comments/CommentsSwitch` for the measurement behind that.
   */
  readonly onComments?: (() => void) | undefined;
}

export function useDocActions(
  subject: DocActionSubject,
  options: DocActionOptions,
): readonly MenuAction[] {
  const { surface, onNotify, close, onGone, onOpen, onOpenHere, onOpenFocus, onComments } = options;
  const { boardTargets } = options;
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
  /**
   * The **other** status write — an ordinary document's, which has no route of
   * its own (SPEC.md §9.2's `PUT /api/docs/{id}`).
   *
   * Not the thread mutation, and not a unification of the two. Resolving a
   * thread does things a document write must not: `POST …/resolve` rewrites and
   * commits the thread file (SPEC.md §6), releases a designated resident
   * (SPEC.md §7) and invalidates the thread's own key alongside the document's.
   * The menu picks the mutation its subject needs.
   */
  const setDocStatus = useUpdateDoc(subject.id, {
    onSuccess: (_response, changes) => {
      onNotify({
        tone: "info",
        message: docStatusNotice(subject.title, changes.status === "resolved"),
      });
    },
    onError: (error, changes) => {
      onNotify({
        tone: "error",
        message: `${changes.status === "resolved" ? "Resolve" : "Reopen"} failed — ${error.message}`,
      });
    },
  });

  const deleteDoc = useDeleteDoc();

  /*
   * On the hook rather than on the call, for the reason every other write here
   * is (UI-012): a move item closes the menu that started it, and a per-call
   * `onSuccess` dies with the observer that closing removes.
   */
  const moveDoc = useMoveDoc({
    onSuccess: (_response, variables) => {
      onNotify({ tone: "info", message: movedMessage(subject.title, variables.folder) });
    },
    onError: (error, variables) => {
      onNotify({
        tone: "error",
        message: `Move to ${variables.folder}/ failed — ${error.message}`,
      });
    },
  });

  /*
   * Restoring rides on its own hook for the same UI-012 reason resolve/reopen
   * does: this item closes the menu in the same click, so the notice has to
   * survive the surface that started the write.
   */
  const setArchived = useSetDocArchived({
    onSuccess: (response) => {
      onNotify({ tone: "info", message: unarchivedMessage(subject.title) });
      /*
       * The same channel `useRowActions`' Archive reports (UI-106). Unarchiving a
       * skill folder is the direction that raises `carried_reconciliation`: a
       * nested document swept back under the enabled root has its stale
       * `status: archived` corrected, and nothing else in this response says so.
       */
      for (const notice of warningNotices(response.warnings)) onNotify(notice);
    },
    onError: (error) => {
      onNotify({ tone: "error", message: `Unarchive failed — ${error.message}` });
    },
  });

  const isThread = subject.type === THREAD_DOC_TYPE;
  const archived = subject.status === ARCHIVED;
  const resolved = subject.status === "resolved";
  const stale = hasStaleActions(subject.staleLevel ?? 0);
  /**
   * Whether this document's status is anyone's to set — the same question the
   * frontmatter form asks, from the one function that answers it.
   *
   * The form renders the control locked with the reason; this menu **omits** the
   * action instead, because §10's context menu lists "exactly that item's
   * existing actions" and an item nothing could ever arm is not one of them. The
   * one case left is an archived document, whose `PUT` the server refuses
   * outright (SERVER-039), so offering the act would promise a refusal.
   *
   * **It is the only case, and `type:` is not one of them.** Every document's
   * status is its own to set, whatever its type says — including a type this
   * build does not recognise, which SPEC.md §10 requires and §5's open `type`
   * makes routine.
   */
  const settable = statusLock(subject) === null;
  const list: MenuAction[] = [];

  /*
   * The four ways to open a row (SPEC.md §10, rider 3): a path off the row, the
   * column's own reader, the full-screen overlay, and a loose path on another
   * board. The keys named in the metas are the registry's own.
   */
  if (surface === "row" && onOpen !== undefined) {
    list.push({
      id: "open",
      label: options.openLabel?.label ?? "Open",
      meta: options.openLabel?.meta ?? "a new column to the right (↵)",
      run: onOpen,
    });
  }
  if (surface === "row" && options.onOpenAndKeep !== undefined) {
    list.push({
      id: "open-keep",
      label: "Open and keep",
      meta: "the next pick opens a new path beside it (double click)",
      run: options.onOpenAndKeep,
    });
  }
  if (surface === "row" && onOpenHere !== undefined) {
    list.push({
      id: "open-here",
      label: "Open here",
      meta: "in this column’s own reader (⌥↵)",
      run: onOpenHere,
    });
  }
  if (surface === "row" && onOpenFocus !== undefined) {
    list.push({
      id: "open-focus",
      label: "Open in full screen",
      meta: "the overlay (⇧↵)",
      run: onOpenFocus,
    });
  }
  if (surface === "row") {
    for (const target of boardTargets ?? []) {
      list.push({
        id: `open-in-board:${target.id}`,
        label: `Open in ${target.title}`,
        meta: "a loose path at that board’s left edge",
        run: target.open,
      });
    }
  }

  // The comments list, first on the reader's menu because it is a place to go
  // rather than a change to make: everything below it writes something.
  if (onComments !== undefined) {
    list.push({
      id: "comments",
      label: "Comments",
      meta: "every conversation on this document — and where a new one starts",
      run: onComments,
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

  /**
   * Resolve / Reopen — on **every** document, not only a thread (UI-094).
   *
   * `status` is one vocabulary and not per-type (SPEC.md §5, rider signed
   * 2026-08-12): every document is `open`, `resolved` or `archived`, and each
   * word means the same thing whatever the document is. The gate here used to be
   * `isThread`, which made this menu the only surface in the product that
   * disagreed — the frontmatter form has always offered `resolved` on a note,
   * and the write path gates only on leaving `archived`.
   *
   * **One branch, both menus.** The reader's ⋯ sheet and the row context menu
   * are the same array (`DocMenu` and `RowMenuItems`), so they were wrong
   * together and are right together. There was never a divergence *between* them
   * to fix, and adding a second gate to either is how one would start.
   *
   * The **subject** picks the mutation, and the two are not interchangeable —
   * see {@link setDocStatus}. What is identical is the label, which flips to
   * Reopen on an already-resolved subject either way, and the meta, which says
   * the same true thing about both.
   */
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
  } else if (settable) {
    list.push({
      id: "resolve",
      label: resolved ? "Reopen" : "Resolve",
      meta: "status flip, committed",
      disabled: setDocStatus.isPending,
      run: () => {
        setDocStatus.mutate({ status: resolved ? "open" : "resolved" });
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
   * "Move to …" — one item per folder that is not this document's own
   * (SPEC.md §9.2). The current folder is left out rather than shown disabled:
   * a move to where the document already is writes nothing, and §10's rule is
   * that a context menu lists the acts this item has.
   */
  for (const folder of options.moveTargets ?? []) {
    if (folder === subject.folder) continue;
    list.push({
      id: `move-to:${folder}`,
      label: `Move to ${folder}`,
      meta: "rewrites the path only — the id, and every link to it, are unchanged",
      disabled: moveDoc.isPending,
      run: () => {
        moveDoc.mutate({ id: subject.id, folder });
      },
    });
  }

  /*
   * The two directions of one reversible act, and only ever one of them
   * (SPEC.md §7 — an archived skill is "restorable"). Availability is the
   * document's own `status`, which `DocActionSubject` already carries, so both
   * presentations gain the inverse from this one declaration. No confirm on
   * either: neither is destructive, and §10 keeps the two-click ceremony for the
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
