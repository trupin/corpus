import { expect, type Page } from "@playwright/test";

/**
 * Waits until the reader's document half has stopped moving.
 *
 * **Opening a reader is an animation.** Clicking a row widens its column from
 * the view's own width to the reading width (`board/columnWidth.ts`), and
 * `Column.css` eases that over 0.25s. The body paints *inside* that window, so
 * a coordinate read the moment `.ProseMirror` appears is a coordinate of the
 * transition rather than of the document.
 *
 * **What it costs, measured on this branch.** The frontmatter form is
 * `grid-template-columns: repeat(auto-fit, minmax(min(16ch, 100%), 1fr))`
 * (SHARED-061) and it is on screen at all times since UI-093 — so as the column
 * eases from 317px to 527px the three fields go from stacked to one row, the
 * form shrinks from 146.9px to 91.7px, and the body **rises 75.5px** over about
 * 210ms. Sampled every 40ms across an open: `bodyTop` 422.3 → 361.3 → 346.8,
 * then stationary. Before UI-093 the form rendered only while `editing`, so the
 * same animation moved nothing vertically and every spec could measure a
 * coordinate the instant the body appeared.
 *
 * That reflow is the responsive behaviour SHARED-061 asked for and it is not a
 * defect — but a spec that measures a point and then acts on it in the next
 * round-trip is aiming at where the text *was*. Three separate failures on this
 * branch were that: a drag that selected nothing, a heading that "moved" across
 * an unrelated click, and a caret click that missed its paragraph and sank a
 * whole list under an empty item on 4 runs in 10.
 *
 * **Two identical consecutive readings is what separates the two events** —
 * the same test `image-geometry.spec.ts` already applies to the same hazard
 * ("a reader 345px wide at the first paint and 558px once settled"), kept there
 * in its own local form. `expect.poll` bounds the wait, so a surface that never
 * settles fails here loudly instead of being waited out.
 */
export async function settledReader(page: Page): Promise<void> {
  const main = page.locator(".reader .doc-main").first();
  let previous = "";
  await expect
    .poll(
      async () => {
        const box = await main.boundingBox();
        if (box === null) return false;
        // Sub-pixel on purpose: an eased width is still changing by fractions
        // in its last frames, and rounding would call that settled.
        const now = `${String(box.x)}:${String(box.y)}:${String(box.width)}:${String(box.height)}`;
        const stable = now === previous;
        previous = now;
        return stable;
      },
      { message: "the reader's document half never stopped moving" },
    )
    .toBe(true);
}
