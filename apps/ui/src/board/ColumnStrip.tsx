import { useDoc } from "@corpus/kit";
import { useEffect, useMemo, useRef, type ReactElement, type RefObject } from "react";
import { columnTabs, tabKeys, type StripTab } from "./columnTabs";
import { parsePathKey, type BoardStrip } from "./strip";
import { useColumnVisibility } from "./useColumnVisibility";
import type { BoardColumn } from "./viewDoc";
import "./ColumnStrip.css";

/**
 * The column strip (SPEC.md §10, rider 4; `design/navigation.html`'s
 * `.colbar`): the board in miniature — one tab per column, in board order,
 * grouped exactly as the board groups them, dimmed while its column is off
 * screen, clicked to scroll there.
 *
 * **It renders from the board's own strip**, through {@link columnTabs}, so it
 * cannot disagree with the board about what columns exist or where they sit.
 * Everything it can *do* is a callback: the board holds the strip and owns
 * every act over it (`strip.ts`).
 *
 * **It is chrome** (SPEC.md §10 — "nothing resizes because of what it holds"):
 * a fixed height that no tab can push on, and a title too long for its tab
 * truncates and gives the whole of itself to the tooltip. See
 * `ColumnStrip.css`, which derives that height from the tab's own box rather
 * than declaring a number.
 */

export interface ColumnStripProps {
  /** The reconciled strip the board is rendering — the single source of order. */
  readonly strip: BoardStrip;
  /** The rendered column set, for a query tab's kind and title. */
  readonly columns: readonly BoardColumn[];
  /** The board's scroller, which is the visibility observer's root. */
  readonly boardRef: RefObject<HTMLElement | null>;
  readonly activeKey: string | null;
  /** Scroll that column in and make it active. */
  readonly onGo: (key: string) => void;
  /** Close a path column and everything after it (UI-149's `closeCol`). */
  readonly onClose: (pathId: number, index: number) => void;
}

export function ColumnStrip({
  strip,
  columns,
  boardRef,
  activeKey,
  onGo,
  onClose,
}: ColumnStripProps): ReactElement {
  const entries = useMemo(() => columnTabs(strip, columns), [columns, strip]);
  const keys = useMemo(() => tabKeys(entries), [entries]);
  const seen = useColumnVisibility(boardRef, keys);
  const nav = useRef<HTMLElement>(null);

  /*
   * The active tab is kept in view *inside the strip* (rider 4's "the keyboard's
   * column movement follows the strip"): `←` walking off the visible end of a
   * twenty-column board must not leave the outline somewhere the user cannot
   * see. `nearest` so a tab already in view moves nothing.
   */
  const signature = keys.join(",");
  useEffect(() => {
    if (activeKey === null) return;
    const tab = nav.current?.querySelector<HTMLElement>(`.ctab[data-col="${activeKey}"]`);
    // jsdom implements no layout and therefore no `scrollIntoView`.
    if (tab !== null && tab !== undefined && typeof tab.scrollIntoView === "function") {
      tab.scrollIntoView({ inline: "nearest", block: "nearest" });
    }
  }, [activeKey, signature]);

  return (
    <nav className="colbar" aria-label="Columns" ref={nav}>
      {entries.map((entry) => {
        if (entry.kind === "query") {
          return (
            <ColumnTab
              key={entry.tab.key}
              tab={entry.tab}
              face="q"
              isActive={entry.tab.key === activeKey}
              isSeen={seen.has(entry.tab.key)}
              onGo={onGo}
              onClose={onClose}
            />
          );
        }
        return (
          <div
            key={`path-${String(entry.pathId)}`}
            className={entry.loose ? "cgroup loose" : "cgroup"}
            role="group"
            aria-label={
              entry.originTitle === null ? "Loose path" : `Path from ${entry.originTitle}`
            }
          >
            <span className="cfrom">
              {entry.originTitle === null ? (
                <>
                  ◦ <b>path</b>
                </>
              ) : (
                <>
                  ◂ <b>{entry.originTitle}</b>
                </>
              )}
            </span>
            {entry.tabs.map((tab) => (
              <ColumnTab
                key={tab.key}
                tab={tab}
                face="p"
                isActive={tab.key === activeKey}
                isSeen={seen.has(tab.key)}
                onGo={onGo}
                onClose={onClose}
              />
            ))}
          </div>
        );
      })}
    </nav>
  );
}

interface ColumnTabProps {
  readonly tab: StripTab;
  /** `q` — the sans face of a list; `p` — the serif face of a document. */
  readonly face: "q" | "p";
  readonly isActive: boolean;
  readonly isSeen: boolean;
  readonly onGo: (key: string) => void;
  readonly onClose: (pathId: number, index: number) => void;
}

/**
 * One tab.
 *
 * Its own component because a tab naming a document reads that document — from
 * the very cache entry the column beside it filled, so the strip issues no
 * request of its own for a board that is already drawn.
 */
function ColumnTab({ tab, face, isActive, isSeen, onGo, onClose }: ColumnTabProps): ReactElement {
  const doc = useDoc(tab.docId ?? undefined);
  const frontmatter = tab.docId === null ? undefined : doc.data?.frontmatter;
  const badge = frontmatter?.type ?? tab.badge;
  const title = frontmatter?.title ?? tab.title;
  const parsed = tab.closable ? parsePathKey(tab.key) : null;

  const className = ["ctab", face, isSeen ? "seen" : "", isActive ? "on" : ""]
    .filter((part) => part !== "")
    .join(" ");

  return (
    <span className={className} data-col={tab.key}>
      <button
        type="button"
        className="ctab-go"
        title={title}
        {...(isActive ? { "aria-current": true as const } : {})}
        onClick={() => {
          onGo(tab.key);
        }}
      >
        <span className="ck">{badge}</span>
        <span className="ct">{title}</span>
      </button>
      {parsed === null ? null : (
        <button
          type="button"
          className="cx"
          aria-label={`Close ${title} and everything after it`}
          title="Close this column and after"
          onClick={() => {
            onClose(parsed.pathId, parsed.index);
          }}
        >
          ✕
        </button>
      )}
    </span>
  );
}
