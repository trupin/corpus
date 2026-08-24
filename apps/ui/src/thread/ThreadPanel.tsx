import { useSetResident, useSetThreadStatus, type RevealTarget, type RowNotice } from "@corpus/kit";
import { useCallback, useEffect, useMemo, type MouseEvent, type ReactElement } from "react";
import { useContextMenu } from "../menu/ContextMenuHost";
import type { MenuAction } from "../menu/menuModel";
import { CollapsedThread, type ThreadSummary } from "./CollapsedThread";
import { panelMenuTitle } from "./panelMenuLabel";
import { designatedNotice, RELEASED_NOTICE } from "./residentActions";
import { threadStatusNotice } from "./resolveNotice";
import { ThreadCard, type ThreadHost } from "./ThreadCard";
import { ThreadMenuItems } from "./ThreadMenuItems";
import { ThreadMenuTrigger } from "./ThreadMenuTrigger";
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

/**
 * The gap between a `⋯` and the menu it opens, in px — `ColumnHead` and
 * `PathColumn`'s own number, so every anchored menu in the app sits the same
 * distance under its trigger.
 */
const TRIGGER_GAP = 4;

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
   * The conversation's own menu (SPEC.md §10), **at a point** rather than at an
   * event.
   *
   * The fold **claims no new key**: it is an ordinary focusable control, and it
   * joins this conversation's existing actions in the menu §10 already binds to
   * "exactly that item's existing actions". Nothing here is invented — collapse
   * and resolve/reopen are the two controls the card's head has always carried,
   * and a nested conversation's "open in its own reader" is what the
   * navigate-away chip used to be, now offered as the choice §10 requires rather
   * than as the only way in.
   *
   * ## One function, two triggers — which is the whole of UI-167
   *
   * It took a `MouseEvent` and had exactly two callers, both right-click, so
   * every action this list carries — the designation among them — was reachable
   * by no other gesture than a right-click, on the one object in the product
   * that exposed nothing to a left one. Taking a **point** is what lets the
   * `⋯` in the card's head call the same function with its own box:
   * `menuModel.ts` exists so the two presentations cannot come to offer
   * different items, and a second list built for the button would have been
   * precisely that drift.
   *
   * Placement is the host's and not this caller's. `ContextMenuProvider.open`
   * clamps the point with `clampToViewport`, and `ContextMenu` then re-derives
   * the vertical half from the menu's measured height with `menuRoom` — which is
   * what a trigger inside a scrolling reader, or inside a 300px margin card,
   * needs and what UI-159 cost a blocking review finding for lacking.
   */
  const openMenu = useCallback(
    (clientX: number, clientY: number, autoFocus: boolean) => {
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
        label: panelMenuTitle(summary),
        clientX,
        clientY,
        autoFocus,
        items: (close) => (
          <ThreadMenuItems
            threadId={summary.id}
            hasParent={summary.parent !== null}
            actions={actions}
            pending={setResident.isPending}
            /*
             * `weight` travels straight through, `undefined` included: the hook
             * is where absence becomes an absent key, so no surface has to
             * remember which of `null`, `""` and *missing* the route means
             * (`useResident.ts`).
             */
            onDesignateGeneral={(weight) => {
              setResident.mutate({ id: summary.id, designate: null, weight });
            }}
            onDesignate={(name, weight) => {
              setResident.mutate({ id: summary.id, designate: name, weight });
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

  /** A right-click, wherever a placement hosts one: the pointer is the anchor. */
  const onContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      openMenu(event.clientX, event.clientY, false);
    },
    [openMenu],
  );

  /**
   * The visible trigger, wherever one is drawn: the button's own box is the
   * anchor, in the idiom the column head, the path column and the reader's ⋯ all
   * use — under the control, aligned to its left edge.
   *
   * `autoFocus` is true because a `⋯` is activated by `↵` or Space as readily as
   * by a click, and a menu opened from the keyboard that put focus nowhere would
   * be UI-030's defect again.
   */
  const onTriggerMenu = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (menu.isOpen) {
        menu.close();
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      openMenu(rect.left, rect.bottom + TRIGGER_GAP, true);
    },
    [menu, openMenu],
  );

  /** One name for the menu and for the `⋯` that opens it. */
  const menuLabel = panelMenuTitle(summary);

  const classes = [
    "thread-slot",
    `slot-${host}`,
    collapsed ? "collapsed" : "expanded",
    depth === 0 ? "" : "nested",
  ].join(" ");

  return (
    <div className={classes} data-slot-thread={summary.id} data-thread-panel={summary.id}>
      {collapsed ? (
        <>
          <CollapsedThread summary={summary} onExpand={toggle} onContextMenu={onContextMenu} />
          {/*
           * A folded conversation is still a conversation, and its actions are
           * still its actions (§10's "collapsed is never hidden"). The trigger
           * is a **sibling** of the line rather than a control inside it: the
           * line is one `<button>`, and a button inside a button is not markup a
           * browser will keep.
           */}
          <ThreadMenuTrigger threadId={summary.id} label={menuLabel} onOpen={onTriggerMenu} />
        </>
      ) : (
        <ThreadCard
          threadId={summary.id}
          host={host}
          depth={depth}
          summary={summary}
          flashing={flashing}
          onCollapse={toggle}
          onContextMenu={onContextMenu}
          onOpenMenu={onTriggerMenu}
          menuLabel={menuLabel}
          onOpenDoc={onOpenDoc}
          onNotify={onNotify}
        />
      )}
    </div>
  );
}
