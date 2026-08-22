import { useSetResident, useSetThreadStatus, type RowNotice } from "@corpus/kit";
import type { RevealTarget } from "@corpus/kit/plugin";
import { useCallback, useEffect, useMemo, type MouseEvent, type ReactElement } from "react";
import { useContextMenu } from "../menu/ContextMenuHost";
import type { MenuAction } from "../menu/menuModel";
import { CollapsedThread, type ThreadSummary } from "./CollapsedThread";
import { designatedNotice, RELEASED_NOTICE } from "./residentActions";
import { threadStatusNotice } from "./resolveNotice";
import { ThreadCard, type ThreadHost } from "./ThreadCard";
import { ThreadMenuItems } from "./ThreadMenuItems";
import { useThreadCollapse } from "./ThreadCollapseContext";
import { RESOLVED_STATUS, type ThreadCollapseSubject } from "./threadCollapse";
import { MAX_DRAWN_DEPTH } from "./threadDepth";

/**
 * One conversation, wherever it is shown — and the one place that decides
 * whether it is folded (SPEC.md §10, rider signed 2026-08-05).
 *
 * Every placement goes through here: a chip at its anchor, a card in the margin,
 * a thread listed below the body, a whole-document or detached thread, a
 * `type: thread` document open in a reader, and a child thread nested under a
 * turn at any depth. That is the cohesion the rider asks for, spelled as code:
 * **which placement a thread gets depends on the width; whether it can be
 * collapsed does not**, because the fold is decided here and the placement is
 * decided by the caller.
 *
 * **Collapsed unmounts the card rather than hiding it.** SPEC.md §7 counts
 * displayed content, so the two states are two components: `CollapsedThread`
 * shows a line and fetches nothing, `ThreadCard` shows the conversation and
 * marks it seen. There is no third state in which a conversation is rendered
 * but not read, and no way to be in one by accident.
 */

export interface ThreadPanelProps {
  readonly summary: ThreadSummary;
  readonly host: ThreadHost;
  /** 0 for a top-level conversation; each child thread is one deeper. */
  readonly depth?: number;
  /** True for ~1.2s after the 💬 popover jumped here. */
  readonly flashing?: boolean;
  readonly onOpenDoc: (docId: string, reveal?: RevealTarget) => void;
  readonly onNotify: (notice: RowNotice) => void;
}

/** `“lender spreads”` / `this whole-document thread`, for the menu's label. */
export function panelMenuLabel(summary: ThreadSummary): string {
  if (summary.quote !== "") return `“${summary.quote}”`;
  return summary.parent === null ? "this standalone thread" : "this whole-document thread";
}

export function ThreadPanel({
  summary,
  host,
  depth = 0,
  flashing = false,
  onOpenDoc,
  onNotify,
}: ThreadPanelProps): ReactElement {
  const collapse = useThreadCollapse();
  const menu = useContextMenu();

  /**
   * What this conversation is being placed with, decided by the **surface**
   * rather than by this component (SPEC.md §10's "reading never collapses
   * anything" — see `ThreadCollapseApi.place`).
   *
   * The record used to be a ref here, which made it a property of one mounted
   * panel; the chip↔margin swap is an unmount and a remount, so dragging a
   * column past `MARGIN_MIN_WIDTH` while reading a resolved conversation
   * re-placed it against the row it had just marked read and folded it under the
   * reader (PR #25 re-review, MINOR). `hold` below is what gives the surface's
   * record the right lifetime: as long as the conversation is on screen, and no
   * longer, so coming back to it later is a fresh placement.
   */
  const { place, hold, observe } = collapse;
  const readState = place({
    threadId: summary.id,
    status: summary.status,
    readState: summary.readState,
  });

  const subject = useMemo<ThreadCollapseSubject>(
    () => ({
      threadId: summary.id,
      status: summary.status,
      readState,
      tooDeep: depth > MAX_DRAWN_DEPTH,
    }),
    [depth, readState, summary.id, summary.status],
  );

  useEffect(() => hold(summary.id), [hold, summary.id]);

  /*
   * The status this conversation is being placed with, reported to the surface.
   * A status change is what re-asserts the rule and clears a stale override —
   * see `ThreadCollapseApi.observe`.
   */
  useEffect(() => {
    observe(subject);
  }, [observe, subject]);

  const collapsed = collapse.isCollapsed(subject);

  const setStatus = useSetThreadStatus({
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
   * Designating and releasing this conversation's resident (SPEC.md §7).
   *
   * Mounted here rather than inside the menu because the menu closes on the same
   * click that writes: an observer that unmounts with its own request drops the
   * report, which is what hook-level `SettledCallbacks` exist to prevent (UI-012,
   * UI-015). The reads the items need are the other way round and live in
   * `ThreadMenuItems`, which is not mounted until the menu opens.
   */
  const setResident = useSetResident({
    onSuccess: (result, variables) => {
      /*
       * Read off the **variables** rather than off `result.thread.resident`,
       * which no longer distinguishes the two acts: since SHARED-048 a
       * designation may resolve to `{name: null}`, so a null resident name is a
       * general resident on the way in and a release on the way out, and the
       * response alone cannot say which one this was.
       */
      onNotify({
        tone: "info",
        message:
          "release" in variables
            ? RELEASED_NOTICE
            : designatedNotice(result.thread.resident?.name ?? null),
      });
    },
    onError: (error, variables) => {
      onNotify({
        tone: "error",
        message: `${"release" in variables ? "Release" : "Designation"} failed — ${error.message}`,
      });
    },
  });

  const toggle = useCallback(() => {
    collapse.setCollapsed(subject, !collapsed);
  }, [collapse, collapsed, subject]);

  /**
   * The conversation's own right-click menu (SPEC.md §10).
   *
   * The fold **claims no new key**: it is an ordinary focusable control, and it
   * joins this conversation's existing actions in the menu §10 already binds to
   * "exactly that item's existing actions". Nothing here is invented — collapse
   * and resolve/reopen are the two controls the card's head has always carried,
   * and a nested conversation's "open in its own reader" is what the
   * navigate-away chip used to be, now offered as the choice §10 requires rather
   * than as the only way in.
   */
  const openMenu = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const resolved = summary.status === RESOLVED_STATUS;
      const actions: MenuAction[] = [
        {
          id: "collapse",
          label: collapsed ? "Expand" : "Collapse",
          meta: collapsed
            ? `shows all ${String(summary.turnCount)} turns, here`
            : "folds to one line — nothing is hidden",
          run: toggle,
        },
        {
          id: "resolve",
          label: resolved ? "Reopen" : "Resolve",
          meta: "status flip, committed",
          disabled: setStatus.isPending,
          run: () => {
            setStatus.mutate({ id: summary.id, resolved: !resolved });
          },
        },
      ];
      if (host === "nested") {
        actions.push({
          id: "open",
          label: "Open thread",
          meta: "in this reader — a choice, not the only way",
          run: () => {
            onOpenDoc(summary.id);
          },
        });
      }
      menu.open({
        label: `Actions for ${panelMenuLabel(summary)}`,
        clientX: event.clientX,
        clientY: event.clientY,
        items: (close) => (
          <ThreadMenuItems
            threadId={summary.id}
            hasParent={summary.parent !== null}
            actions={actions}
            pending={setResident.isPending}
            onDesignateGeneral={() => {
              setResident.mutate({ id: summary.id, designate: null });
            }}
            onDesignate={(name) => {
              setResident.mutate({ id: summary.id, designate: name });
            }}
            onRelease={() => {
              setResident.mutate({ id: summary.id, release: true });
            }}
            onDone={close}
          />
        ),
      });
    },
    [collapsed, host, menu, onOpenDoc, setResident, setStatus, summary, toggle],
  );

  const classes = [
    "thread-slot",
    `slot-${host}`,
    collapsed ? "collapsed" : "expanded",
    depth === 0 ? "" : "nested",
  ].join(" ");

  return (
    <div className={classes} data-slot-thread={summary.id} data-thread-panel={summary.id}>
      {collapsed ? (
        <CollapsedThread summary={summary} onExpand={toggle} onContextMenu={openMenu} />
      ) : (
        <ThreadCard
          threadId={summary.id}
          host={host}
          depth={depth}
          summary={summary}
          flashing={flashing}
          onCollapse={toggle}
          onCardContextMenu={openMenu}
          onOpenDoc={onOpenDoc}
          onNotify={onNotify}
        />
      )}
    </div>
  );
}
