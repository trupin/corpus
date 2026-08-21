import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type RefObject,
} from "react";
import {
  DOC_WIDTH_STEP,
  MARGIN_COLUMN_RESERVE,
  MAX_DOC_WIDTH,
  MIN_DOC_WIDTH,
  clampDocWidth,
  readDocWidthState,
  surfaceWidth,
  withSurfaceWidth,
  writeDocWidthState,
} from "./docWidth";

/**
 * The control SPEC.md §11's width rider asks for, and the two hosts that carry
 * it.
 *
 * **Why a dragged edge and not a preset.** The report was *"I want to be able
 * to resize to the desired width"*, and the app already answers that question
 * twice — the console drawer's top edge and a column's own right edge — so this
 * is a convention to follow rather than one to invent. Both of those are
 * `role="separator"` strips with arrow-key resizing beside the drag, which is
 * also what keeps this off the pointer-only list (§11 adds no exclusive-pointer
 * capability).
 *
 * **Why it is not in the reader's head.** The head is full. UI-135's rules for
 * it are written into `Reader.css`, and UI-063 measured one configuration with
 * 13px of slack — a control there would push ⋯ and ⤢ out of a narrow column,
 * which is the defect UI-135 was filed for. The body's own right edge is where
 * a width control belongs anyway: it is the thing being moved.
 *
 * **Why the rail exists at all.** The handle has to sit at the body's measure,
 * and the measure is `62ch` / `66ch` — font-dependent, so only the browser
 * knows it in pixels. The rail is an empty box that carries the *same*
 * `max-width` the body carries, so its right edge is the body's right edge by
 * construction rather than by arithmetic. The handle hangs off it, entirely
 * outside the measure, so it can never swallow a click meant for the last
 * character of a line.
 *
 * **What it never does.** It does not widen the column. A column's width is its
 * view document's (`board/columnWidth.ts`) and travels with the view; this is
 * the viewer's own reading posture and stays in this browser. The column's edge
 * is still the gesture for making the column bigger, and the body then has more
 * room to be dragged into.
 */

/** The CSS custom property every measured element in the reader reads. */
export const DOC_MEASURE_PROPERTY = "--doc-measure";

/** Names the control for a screen reader, and for `getByRole` in the tests. */
export const DOC_WIDTH_LABEL = "Document width";

export interface DocWidthControl {
  /** The chosen width, or `null` while the stylesheet's default is in force. */
  readonly width: number | null;
  readonly choose: (width: number) => void;
}

/**
 * `null` means "this host offers no width control" — a `DocView` rendered
 * outside a reader, which is what the component tests do. The handle then
 * renders nothing, rather than a control that would move a measure nobody owns.
 */
export const DocWidthContext = createContext<DocWidthControl | null>(null);

/**
 * One reader's width: read at mount, written on every change, and pushed onto
 * the host element as {@link DOC_MEASURE_PROPERTY} so every measured element
 * below inherits it.
 *
 * **Written on every change, not on `pointerup`.** The column's edge batches
 * its drag into one write because each write is a `PUT`, a git commit and a
 * line of history (`useColumnWidth`). This one goes to `localStorage`, so there
 * is nothing to batch — and committing only at the end would lose the width to
 * a `pointercancel`, which is what a drag that leaves the window becomes.
 */
export function useDocWidthSurface(
  surfaceKey: string,
  host: RefObject<HTMLElement | null>,
): DocWidthControl {
  const [width, setWidth] = useState<number | null>(null);

  // Read per surface, and re-read when the surface changes: a column reader
  // that is handed a different column is a different reader.
  useEffect(() => {
    setWidth(surfaceWidth(readDocWidthState(), surfaceKey));
  }, [surfaceKey]);

  useLayoutEffect(() => {
    const element = host.current;
    if (element === null) return;
    if (width === null) element.style.removeProperty(DOC_MEASURE_PROPERTY);
    else element.style.setProperty(DOC_MEASURE_PROPERTY, `${String(width)}px`);
  }, [host, width]);

  const choose = useCallback(
    (next: number) => {
      setWidth(next);
      writeDocWidthState(withSurfaceWidth(readDocWidthState(), surfaceKey, next));
    },
    [surfaceKey],
  );

  return { width, choose };
}

/**
 * How much room the body has to be dragged into: from its own left edge to the
 * end of the reader's content box, less whatever the margin column is holding.
 *
 * Measured rather than assumed, because the answer differs per host (a column's
 * 22px padding, focus mode's 48px and its centred inner column) and changes
 * with the window. The margin reserve is what keeps the pointer and the edge
 * together in Docs-style placement — see {@link MARGIN_COLUMN_RESERVE}.
 */
function roomFor(rail: HTMLElement): number {
  const host = rail.closest(".reader-scroll, .focus-scroll");
  if (host === null) return MAX_DOC_WIDTH;
  const padding = Number.parseFloat(globalThis.getComputedStyle(host).paddingRight);
  const contentRight =
    host.getBoundingClientRect().left + host.clientWidth - (Number.isNaN(padding) ? 0 : padding);
  const reserve = rail.closest(".with-margin") === null ? 0 : MARGIN_COLUMN_RESERVE;
  return contentRight - reserve - rail.getBoundingClientRect().left;
}

/**
 * How far the width has to move for the body's right edge to move one pixel.
 *
 * **1 in a column, 2 in focus mode**, and the difference is the centring:
 * `.focus-inner` is `margin: 0 auto`, so a body made 100px wider grows 50px in
 * each direction and its right edge — the thing under the pointer — moves only
 * 50. Measured in Chromium: a 260px drag in focus mode widened the body by 189
 * and left the handle 130px behind the cursor, which reads as the control
 * slipping rather than as the document expanding.
 *
 * A servo on the live geometry was the alternative and is worse: it converges
 * only while `pointermove` keeps arriving, so a fast throw that stops leaves the
 * residual error on screen. This is exact, and it is one class name of
 * knowledge about a stylesheet in the same directory.
 */
function pointerGain(rail: HTMLElement): number {
  return rail.closest(".focus-inner") === null ? 1 : 2;
}

/**
 * The body's right edge, as a grab handle.
 *
 * Rendered inside `.doc-main` so it scrolls with the document and spans it: the
 * edge is grabbable wherever you happen to be reading, which is what a person
 * expects of an edge. It is invisible until hovered, focused or dragged —
 * exactly like `.col-resizer`, whose behaviour it copies.
 */
export function DocWidthHandle(): ReactElement | null {
  const control = useContext(DocWidthContext);
  const railRef = useRef<HTMLDivElement>(null);
  const [resizing, setResizing] = useState(false);
  /** What the body currently measures, for an honest `aria-valuenow`. */
  const [measured, setMeasured] = useState<number | null>(null);
  const drag = useRef<{
    readonly x: number;
    readonly width: number;
    readonly gain: number;
  } | null>(null);

  const choose = useRef(control?.choose);
  choose.current = control?.choose;
  const chosen = useRef<number | null>(null);
  chosen.current = control?.width ?? null;

  /**
   * Re-reads the body's width for {@link DocWidthControl.width}'s stand-in.
   *
   * **This is deliberately not a `ResizeObserver`, and not a layout effect.**
   * The first version was both, and it broke the reader's scroll: a reveal that
   * opens a document and scrolls to a line stopped scrolling at all, 20 runs out
   * of 20, with `scrollTop` stuck at 0 and the flash left 584px above the line
   * it had found. Bisected to this effect — with the rail rendered but the
   * observer gone, the same reader scrolled to 1239px, which is the number it
   * reaches without a width control at all. A `setState` in a **layout** effect
   * makes React re-render synchronously inside the mount commit, which is the
   * same commit the reveal is arming in; one update was enough, and the observer
   * then repeated it every frame while the column's width transition ran.
   *
   * So it measures on the three occasions the number is actually read, and never
   * between them: once after mount, when the surface takes focus (which is when
   * assistive technology asks), and as a gesture begins. Every other path sets a
   * real chosen width, and `control.width` is exact from then on. The cost is
   * that `aria-valuenow` can be stale after a window resize nobody has touched
   * the control through — a worse answer than a live one, and a far better one
   * than a reader that will not scroll.
   */
  const remeasure = useCallback((): void => {
    const width = railRef.current?.getBoundingClientRect().width ?? 0;
    if (width > 0) setMeasured(Math.round(width));
  }, []);

  useEffect(() => {
    remeasure();
  }, [remeasure]);

  /**
   * The width a gesture starts from.
   *
   * **Measured, not remembered**, because the default is the stylesheet's
   * `62ch` and only the browser knows what that is in pixels — so a first drag
   * on a surface nobody has touched starts exactly where the body already is,
   * with no jump. The chosen width is the fallback for the one case where a
   * measurement means nothing: a rail that is not laid out reads `0`, which is
   * what a surface reports before it has been painted.
   */
  const current = useCallback((): number => {
    const width = railRef.current?.getBoundingClientRect().width ?? 0;
    return width > 0 ? width : (chosen.current ?? MIN_DOC_WIDTH);
  }, []);

  const commit = useCallback(
    (next: number) => {
      const rail = railRef.current;
      choose.current?.(clampDocWidth(next, rail === null ? MAX_DOC_WIDTH : roomFor(rail)));
    },
    [choose],
  );

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const rail = railRef.current;
      remeasure();
      drag.current = {
        x: event.clientX,
        width: current(),
        gain: rail === null ? 1 : pointerGain(rail),
      };
      setResizing(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
    },
    [current, remeasure],
  );

  useEffect(() => {
    if (!resizing) return undefined;
    const onMove = (event: globalThis.PointerEvent): void => {
      const start = drag.current;
      if (start === null) return;
      commit(start.width + (event.clientX - start.x) * start.gain);
    };
    const onUp = (): void => {
      drag.current = null;
      setResizing(false);
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
          ? DOC_WIDTH_STEP
          : event.key === "ArrowLeft"
            ? -DOC_WIDTH_STEP
            : 0;
      if (step === 0) return;
      event.preventDefault();
      event.stopPropagation();
      commit(current() + step);
    },
    [commit, current],
  );

  if (control === null) return null;

  return (
    <div className="doc-width-rail" ref={railRef}>
      <div
        className={`doc-width-handle${resizing ? " resizing" : ""}`}
        role="separator"
        aria-orientation="vertical"
        aria-label={DOC_WIDTH_LABEL}
        aria-valuenow={control.width ?? measured ?? MIN_DOC_WIDTH}
        aria-valuemin={MIN_DOC_WIDTH}
        aria-valuemax={MAX_DOC_WIDTH}
        tabIndex={0}
        onFocus={remeasure}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
