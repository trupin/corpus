import { useLayoutEffect, type RefObject } from "react";

/**
 * A document title that wraps to as many lines as it needs (UI-065).
 *
 * **Why a textarea and a measurement, and not CSS.** The title is an *editable*
 * surface — the reader has no edit mode (SPEC.md §11), so the heading is the
 * field. A single-line `<input>` cannot wrap by construction, and everything
 * past its width is scrolled out of view: `Catch-Up Report — 2026-08-03` and
 * `Catch-Up Report — 2026-08-04` differ only in the part it hides. A textarea
 * wraps, but it has a fixed row count instead, so its height has to be measured
 * from its content. This is that measurement, kept beside the reader that needs
 * it rather than generalised into a shared box nothing else asks for.
 *
 * Caret placement, selection and typing are untouched: this only ever writes
 * `style.height`, never the value, never the selection.
 */

/** Sets the field's height to exactly its content, in one reflow. */
export function fitToContent(field: HTMLTextAreaElement): void {
  // Released first: `scrollHeight` reports the content height only while the
  // box is not already tall enough to hold it.
  field.style.height = "auto";
  const content = field.scrollHeight;
  // A tree with no layout — jsdom, a detached node — reports 0. Leaving the
  // intrinsic height is the honest answer there; writing `0px` would collapse
  // the title to nothing.
  if (content > 0) field.style.height = `${content}px`;
}

/**
 * Keeps {@link fitToContent} true as the title and the column both change.
 *
 * The number of lines is a function of width as much as of text — a column is
 * resizable and focus mode is a wider measure — so a value-only effect would
 * leave a two-line title in a one-line box after a drag. The observer watches
 * the **parent**: this effect writes the field's own height, and an observer on
 * the field would be re-entered by every fit it caused.
 */
export function useTitleFit(field: RefObject<HTMLTextAreaElement | null>, value: string): void {
  useLayoutEffect(() => {
    const element = field.current;
    if (element === null) return undefined;
    fitToContent(element);

    const box = element.parentElement;
    if (box === null || typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(() => {
      fitToContent(element);
    });
    observer.observe(box);
    return () => {
      observer.disconnect();
    };
  }, [field, value]);
}
