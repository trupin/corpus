import { forwardRef, type TextareaHTMLAttributes } from "react";

/**
 * A composer field that is one line tall and grows with what is typed into it.
 *
 * **Why it exists.** SPEC.md §10's composer key contract makes `↵` a newline in
 * every composer. The reply box and the turn-comment box were `<input>`
 * elements, which cannot hold a newline at all — re-binding their keys without
 * changing the element would have left `↵` doing nothing, which is a worse bug
 * than the `↵`-sends it replaced. They are textareas now, and a textarea that
 * stays two rows tall while the text scrolls out of sight is its own small
 * betrayal, so they grow.
 *
 * **How.** The wrapper duplicates the value into a hidden `::after` stacked in
 * the *same* grid cell as the field (`thread.css`, `.composer-grow`), so the row
 * is exactly as tall as the text and the field stretches to it. The measurement
 * is the browser's own layout of the same string in the same font — there is no
 * `scrollHeight` read, no write-back, no resize observer, and therefore no
 * layout thrash and nothing to get out of sync when the column is resized.
 *
 * The design mockup draws these as one-line boxes (`design/index.html`'s
 * `.composer input`) and that is still what they look like empty; growing is
 * the behaviour §10 now requires, and it wins over the mockup's static markup.
 */

export interface GrowingTextareaProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "rows" | "value"
> {
  /** Controlled, always: the mirror renders this string, so it cannot be optional. */
  readonly value: string;
}

export const GrowingTextarea = forwardRef<HTMLTextAreaElement, GrowingTextareaProps>(
  function GrowingTextarea({ value, ...rest }, ref) {
    return (
      <div className="composer-grow" data-replicated-value={value}>
        <textarea ref={ref} rows={1} value={value} {...rest} />
      </div>
    );
  },
);
