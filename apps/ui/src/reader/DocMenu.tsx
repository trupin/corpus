import type { Doc } from "@corpus/contract";
import { useDeleteDoc, useRowActions, useSetThreadStatus, type RowNotice } from "@corpus/kit";
import { useRef, useState, type ReactElement } from "react";
import { usePopoverShift } from "./popover";
import { EscapeLayerPriority, useEscapeLayer } from "./useEscapeStack";

/**
 * The reader's ⋯ menu (SPEC.md §11): Still current, Resolve/Reopen for threads,
 * Archive, and Delete.
 *
 * **Two of these are not new code.** Archive and Still current go through the
 * kit's `useRowActions` — the same unit UI-004 shipped and verified for the
 * board's stale-row quick actions. "Still current" in particular writes
 * `reviewed` and *nothing else* (SPEC.md §5 makes it an act distinct from
 * editing); a second implementation here is exactly how `updated` eventually
 * gets clobbered in one of them, invisibly and permanently.
 *
 * **The publish-plugin items are deliberately absent.** The prototype's menu
 * carries "Copy for Google Docs" and "Push update to Google Doc…", but SPEC.md
 * §13 says the publish *plugin* adds them and §10 says the core must not know a
 * plugin's name. They arrive through the manifest with the plugin, not as inert
 * placeholders here.
 */

export interface DocMenuProps {
  readonly doc: Doc;
  /** Thread status, for the Resolve/Reopen label; `null` on non-threads. */
  readonly threadStatus: string | null;
  readonly onClose: () => void;
  /** The document left: the host pops it off the navigation stack. */
  readonly onGone: () => void;
  readonly onNotify: (notice: RowNotice) => void;
}

/** The unarmed Delete copy, and the copy the first click replaces it with. */
export const DELETE_LABEL = "Delete…";
export const DELETE_META = "user-only · click twice to confirm";
export const DELETE_ARMED_LABEL = "Really delete? Click again";
export const DELETE_ARMED_META =
  "permanent · git keeps history · its threads become orphaned records";

interface MenuItemProps {
  readonly action: string;
  readonly label: string;
  readonly meta: string;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

function MenuItem({
  action,
  label,
  meta,
  danger,
  disabled,
  onSelect,
}: MenuItemProps): ReactElement {
  return (
    <button
      type="button"
      className={danger === true ? "cp-item cp-danger" : "cp-item"}
      role="menuitem"
      data-dm-act={action}
      disabled={disabled === true}
      onClick={onSelect}
    >
      <div className="cp-quote">{label}</div>
      <div className="cp-meta">{meta}</div>
    </button>
  );
}

export function DocMenu({
  doc,
  threadStatus,
  onClose,
  onGone,
  onNotify,
}: DocMenuProps): ReactElement {
  const docId = doc.frontmatter.id;
  const actions = useRowActions({ id: docId, title: doc.frontmatter.title }, { onNotify });
  /*
   * The notices ride on the hook, not on the call (UI-012).
   *
   * Every item here closes the menu, which unmounts this component before the
   * request settles, and TanStack v5 skips a `mutate(…, { onSuccess })`
   * callback once its observer has no listeners — so all three of Still
   * current, Resolve and Archive committed their write and said nothing.
   * `SettledCallbacks` are the mutation's own, and outlive the menu. The close
   * stays immediate, because that is what returns focus to the ⋯ button that
   * opened it.
   */
  const setThreadStatus = useSetThreadStatus({
    onSuccess: (_result, variables) => {
      onNotify({
        tone: "info",
        message: variables.resolved
          ? "Thread resolved — committed. Replying reopens it."
          : "Thread reopened — committed.",
      });
    },
    onError: (error, variables) => {
      onNotify({
        tone: "error",
        message: `${variables.resolved ? "Resolve" : "Reopen"} failed — ${error.message}`,
      });
    },
  });
  const deleteDoc = useDeleteDoc();
  const [armed, setArmed] = useState(false);
  const pop = useRef<HTMLDivElement>(null);
  const shift = usePopoverShift(pop, true);
  useEscapeLayer({ active: true, priority: EscapeLayerPriority.Popover, onEscape: onClose });

  const resolved = threadStatus === "resolved";

  return (
    <div
      ref={pop}
      className="comments-pop open"
      role="menu"
      aria-label="Document actions"
      data-dm-pop
      style={shift === 0 ? undefined : { transform: `translateX(${String(-shift)}px)` }}
    >
      <MenuItem
        action="review"
        label="Still current"
        meta="sets reviewed: now — resets staleness"
        disabled={actions.isBusy}
        onSelect={() => {
          actions.stillCurrent();
          onClose();
        }}
      />

      {threadStatus === null ? null : (
        <MenuItem
          action="resolve"
          label={resolved ? "Reopen" : "Resolve"}
          meta="status flip, committed"
          disabled={setThreadStatus.isPending}
          onSelect={() => {
            setThreadStatus.mutate({ id: docId, resolved: !resolved });
            onClose();
          }}
        />
      )}

      <MenuItem
        action="archive"
        label="Archive"
        meta="reversible — hidden from default lists"
        disabled={actions.isBusy}
        onSelect={() => {
          actions.archive();
          onClose();
        }}
      />

      <MenuItem
        action="delete"
        danger
        label={armed ? DELETE_ARMED_LABEL : DELETE_LABEL}
        meta={armed ? DELETE_ARMED_META : DELETE_META}
        disabled={deleteDoc.isPending}
        onSelect={() => {
          if (!armed) {
            // Arming issues no request at all. The confirmation is the two
            // clicks, and the second one is the only thing that reaches the wire.
            setArmed(true);
            return;
          }
          deleteDoc.mutate(docId, {
            onSuccess: (result) => {
              const orphans = result.orphanedThreadIds.length;
              onNotify({
                tone: "info",
                message:
                  `Deleted “${doc.frontmatter.title}” — user-only act; git retains its history.` +
                  (orphans === 0
                    ? ""
                    : ` ${String(orphans)} thread${orphans === 1 ? " became an orphaned record" : "s became orphaned records"}.`),
              });
              onClose();
              onGone();
            },
            onError: (error) => {
              onNotify({ tone: "error", message: `Delete failed — ${error.message}` });
              setArmed(false);
            },
          });
        }}
      />
    </div>
  );
}
