import { useDoc, type RevealTarget, type RowNotice } from "@corpus/kit";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
} from "react";
import { useContextMenu } from "../menu/ContextMenuHost";
import { PathColumnMenuItems } from "../menu/PathColumnMenuItems";
import { Reader } from "../reader/Reader";
import {
  COLUMN_RESIZE_STEP,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  clampColumnWidth,
} from "./columnWidth";
import {
  PATH_COLUMN_WIDTH,
  pathColumnKey,
  topDoc,
  type NavEntry,
  type PathCol,
  type PathItem,
} from "./strip";

/**
 * One reader column of a path (SPEC.md §10, rider 3; `design/navigation.html`'s
 * `.pcol`): the prototype's head — `◂ <origin>` / `◂ from <previous doc>` /
 * `◦ path · no origin`, the path ⋯ and ✕ — over **the existing `Reader`**,
 * mounted with its own `NavStackApi` over this column's stack. That reuse is
 * the issue's design: scroll restore, reveal, the abandonment rule, the save
 * chip and the comments switch all work unchanged inside a path.
 *
 * What is different from a query column's reader is one seam: following a link
 * goes through `onFollow`, so the path **continues to the right** instead of
 * pushing in place (rider 3). "Open here" (`⌥↵`) is the act that pushes here.
 *
 * **Width is this browser's** — a path column has no document to carry one, so
 * `440px` and any adjustment live on the strip's own `PathCol`, under the same
 * min/max rule as every column (§10: "the user-adjustable width rule applies to
 * it like any column").
 */

export interface PathColumnProps {
  readonly path: PathItem;
  readonly index: number;
  readonly col: PathCol;
  /** The origin column's title, for the root column's `◂` label; `null` when loose. */
  readonly originTitle: string | null;
  readonly isActive: boolean;
  readonly isFlashing: boolean;
  /** True when the shown document was just created — its title is selected. */
  readonly selectTitle: boolean;
  readonly onActivate: () => void;
  /** A link followed here: the path continues right (the board owns the act). */
  readonly onFollow: (docId: string, fromScrollY: number, reveal?: RevealTarget) => void;
  /** The reader replaced its stack; the strip decides what that means. */
  readonly onSetStack: (stack: readonly NavEntry[]) => void;
  readonly onSetWidth: (width: number) => void;
  readonly onCloseAfter: () => void;
  readonly onCloseWholePath: () => void;
  readonly onRestartHere: () => void;
  readonly onNewPathRight: () => void;
  readonly onDetach: () => void;
  readonly onFocusMode: (docId: string) => void;
  readonly onNotify: (notice: RowNotice) => void;
}

function viewportWidth(): number {
  return typeof window === "undefined" ? 0 : window.innerWidth;
}

/**
 * The column-edge drag, on `useColumnWidth`'s own pattern (pointer capture on
 * the handle, window listeners while dragging, one commit on release) — minus
 * the wire: the committed width goes to the strip, not to a document.
 */
function useLocalWidth(
  stored: number | undefined,
  onCommit: (width: number) => void,
): {
  readonly width: number;
  readonly resizing: boolean;
  readonly onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
} {
  const settled = clampColumnWidth(stored ?? PATH_COLUMN_WIDTH, viewportWidth());
  const [live, setLive] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);
  const latest = useRef(settled);
  latest.current = live ?? settled;
  const drag = useRef<{ readonly x: number; readonly width: number } | null>(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  useEffect(() => {
    if (live !== null && live === settled) setLive(null);
  }, [live, settled]);

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    drag.current = { x: event.clientX, width: latest.current };
    setResizing(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }, []);

  useEffect(() => {
    if (!resizing) return undefined;
    const onMove = (event: globalThis.PointerEvent): void => {
      const start = drag.current;
      if (start === null) return;
      setLive(clampColumnWidth(start.width + (event.clientX - start.x), viewportWidth()));
    };
    const onUp = (): void => {
      drag.current = null;
      setResizing(false);
      commitRef.current(latest.current);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [resizing]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    const step =
      event.key === "ArrowRight"
        ? COLUMN_RESIZE_STEP
        : event.key === "ArrowLeft"
          ? -COLUMN_RESIZE_STEP
          : 0;
    if (step === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const next = clampColumnWidth(latest.current + step, viewportWidth());
    setLive(next);
    commitRef.current(next);
  }, []);

  return { width: live ?? settled, resizing, onPointerDown, onKeyDown };
}

export function PathColumn({
  path,
  index,
  col,
  originTitle,
  isActive,
  isFlashing,
  selectTitle,
  onActivate,
  onFollow,
  onSetStack,
  onSetWidth,
  onCloseAfter,
  onCloseWholePath,
  onRestartHere,
  onNewPathRight,
  onDetach,
  onFocusMode,
  onNotify,
}: PathColumnProps): ReactElement {
  const key = pathColumnKey(path.id, index);
  const docId = topDoc(col) ?? "";
  const menu = useContextMenu();
  const size = useLocalWidth(col.width, onSetWidth);

  /*
   * The previous column's document names this one's `◂ from` — read through the
   * same cache entry that column's reader is already holding, so this costs no
   * request of its own.
   */
  const previousId = index === 0 ? null : (topDoc(path.cols[index - 1] as PathCol) ?? null);
  const previous = useDoc(previousId ?? undefined);
  const previousTitle =
    previousId === null ? null : (previous.data?.frontmatter.title ?? previousId);

  const openMenu = (clientX: number, clientY: number, autoFocus: boolean): void => {
    menu.open({
      label: "Path column actions",
      clientX,
      clientY,
      autoFocus,
      items: (close) => (
        <PathColumnMenuItems
          docId={docId}
          hasOrigin={path.origin !== null}
          index={index}
          close={close}
          onFocusMode={() => {
            onFocusMode(docId);
          }}
          onRestartHere={onRestartHere}
          onNewPathRight={onNewPathRight}
          onDetach={onDetach}
          onCloseAfter={onCloseAfter}
          onCloseWholePath={onCloseWholePath}
        />
      ),
    });
  };

  const className = [
    "col",
    "pcol",
    isActive ? "kactive" : "",
    isFlashing ? "flash" : "",
    size.resizing ? "resizing" : "",
  ]
    .filter((part) => part !== "")
    .join(" ");

  const from =
    index === 0 ? (
      originTitle === null ? (
        <span className="pcol-from">
          ◦ <b>path</b> · no origin
        </span>
      ) : (
        <span className="pcol-from" title={`Opened from a row in ${originTitle}`}>
          ◂ <b>{originTitle}</b>
        </span>
      )
    ) : (
      <span className="pcol-from" title={previousTitle ?? undefined}>
        ◂ from <b>{previousTitle}</b>
      </span>
    );

  return (
    <section
      className={className}
      data-col={key}
      data-path={String(path.id)}
      data-idx={String(index)}
      aria-label={`Path column ${String(index + 1)}`}
      style={{ width: `${String(size.width)}px` }}
      onMouseOver={onActivate}
      onFocus={onActivate}
    >
      <div
        className="pcol-head"
        onContextMenu={(event) => {
          event.preventDefault();
          openMenu(event.clientX, event.clientY, false);
        }}
      >
        {from}
        <span className="pcol-spacer" />
        <button
          type="button"
          className="hbtn"
          aria-label="Path actions"
          title="Path actions"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            openMenu(rect.left, rect.bottom + 4, true);
          }}
        >
          ⋯
        </button>
        <button
          type="button"
          className="hbtn pcol-close"
          aria-label="Close this column and everything after it"
          title="Close this column and everything after it (esc)"
          onClick={onCloseAfter}
        >
          ✕
        </button>
      </div>

      <Reader
        columnId={key}
        columnTitle={originTitle ?? "path"}
        nav={col.stack}
        setNav={onSetStack}
        selectTitle={selectTitle}
        isActive={isActive}
        onFollow={onFollow}
        onFocusMode={onFocusMode}
        onNotify={onNotify}
      />

      <div
        className="col-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize path column"
        aria-valuenow={Math.round(size.width)}
        aria-valuemin={MIN_COLUMN_WIDTH}
        aria-valuemax={MAX_COLUMN_WIDTH}
        tabIndex={0}
        onPointerDown={size.onPointerDown}
        onKeyDown={size.onKeyDown}
      />
    </section>
  );
}
