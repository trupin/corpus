import { useUpdateDocById, type RowNotice } from "@corpus/kit";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  COLUMN_RESIZE_STEP,
  DEFAULT_COLUMN_WIDTH,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  clampColumnWidth,
} from "./columnWidth";

/**
 * Dragging a column's edge (SPEC.md §10), on the console's own pattern.
 *
 * `useConsoleLayout` is the precedent the spec names — pointer capture on the
 * handle, `pointermove`/`pointerup`/`pointercancel` on the window, a clamp
 * recomputed from the live viewport — and this follows it in everything except
 * where the result goes. The console's height is browser-local; a column's
 * width is **corpus state**, so it lands in the view document's frontmatter
 * through the same `PUT` `order` already uses, and the server stays the sole
 * writer.
 *
 * **One drag is one write.** The pointer moves per pixel and the width follows
 * live, but nothing reaches the wire until `pointerup`: fifty `PUT`s would be
 * fifty commits, and the spec asks for "one history entry, not fifty". (The
 * server's 30-second idle squash then folds successive adjustments to the same
 * document into one entry, which is what makes a second thought free.)
 */

export interface ColumnWidthOptions {
  readonly viewDocId: string;
  readonly title: string;
  /** The width the view document carries, or `null` for the default. */
  readonly stored: number | null;
  readonly onNotify: (notice: RowNotice) => void;
}

export interface ColumnWidth {
  /** The base width to render at — the live drag when there is one. */
  readonly width: number;
  readonly resizing: boolean;
  readonly onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  /** Arrow-key resizing, so the edge is not pointer-only. */
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  readonly min: number;
  readonly max: number;
}

function viewportWidth(): number {
  return typeof window === "undefined" ? 0 : window.innerWidth;
}

export function useColumnWidth({
  viewDocId,
  title,
  stored,
  onNotify,
}: ColumnWidthOptions): ColumnWidth {
  const update = useUpdateDocById();
  const settled = clampColumnWidth(stored ?? DEFAULT_COLUMN_WIDTH, viewportWidth());

  /** The width this gesture is producing; `null` when the document's is current. */
  const [live, setLive] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);
  // Pointer moves fire per pixel; refs let the handlers read the live values
  // without being rebound on every frame.
  const latest = useRef(settled);
  latest.current = live ?? settled;
  const drag = useRef<{ readonly x: number; readonly width: number } | null>(null);
  const write = useRef(update.mutate);
  write.current = update.mutate;
  const notify = useRef(onNotify);
  notify.current = onNotify;

  // The document caught up (this session's write landed, or another browser's
  // did): the local override has nothing left to say.
  useEffect(() => {
    if (live !== null && live === settled) setLive(null);
  }, [live, settled]);

  const commit = useCallback(
    (next: number) => {
      if (next === settled) {
        setLive(null);
        return;
      }
      setLive(next);
      write.current(
        // Only the one key: `extra` is merged per RFC 7386, so sending the
        // whole object would be how a resize destroys frontmatter the core does
        // not define and cannot read (SPEC.md §9's `extra_json` passthrough).
        { id: viewDocId, changes: { extra: { width: next } } },
        {
          onError: (error: Error) => {
            setLive(null);
            notify.current({
              tone: "error",
              message: `Resize failed — “${title}” kept its stored width (${error.message}).`,
            });
          },
        },
      );
    },
    [settled, title, viewDocId],
  );

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    drag.current = { x: event.clientX, width: latest.current };
    setResizing(true);
    // Pointer capture keeps the drag alive when the pointer outruns the handle,
    // which it does immediately on any real gesture.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    // Also stops the header's drag-to-reorder from ever seeing this press.
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
      commit(latest.current);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [commit, resizing]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const step =
        event.key === "ArrowRight"
          ? COLUMN_RESIZE_STEP
          : event.key === "ArrowLeft"
            ? -COLUMN_RESIZE_STEP
            : 0;
      if (step === 0) return;
      event.preventDefault();
      // The board's own `←`/`→` switch columns; a press on the handle is about
      // the handle.
      event.stopPropagation();
      commit(clampColumnWidth(latest.current + step, viewportWidth()));
    },
    [commit],
  );

  return {
    width: live ?? settled,
    resizing,
    onPointerDown,
    onKeyDown,
    min: MIN_COLUMN_WIDTH,
    max: MAX_COLUMN_WIDTH,
  };
}
