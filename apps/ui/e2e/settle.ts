import { expect, type Page } from "@playwright/test";

/**
 * Waits until the reader's document half has stopped moving.
 *
 * **What it was for, and what changed.** Opening a reader widens its column
 * (`board/columnWidth.ts`), and `Column.css` used to ease that over 0.25s. The
 * body painted *inside* that window, so a coordinate read the moment the
 * document appeared was a coordinate of the transition. It was worse than a
 * stale coordinate: since UI-093 the frontmatter form renders at all times and
 * its grid is `repeat(auto-fit, minmax(min(16ch, 100%), 1fr))` (SHARED-061), so
 * the widening reflowed the form 3 rows → 2 → 1 and the body rose 97.7px under
 * whoever was reading it. UI-146 removed the animation for the open — a column
 * with a reader in it takes its reading width in one commit — and
 * `column-open-geometry.spec.ts` now asserts per animation frame that the body
 * never moves after its first paint.
 *
 * **So why this still exists.** The reader's document half has other reasons to
 * settle late, and they are the reasons the specs importing this were written
 * for: images decoding into their reserved boxes, a plugin panel arriving after
 * discovery, a thread's turns rendering. A spec that measures a point and then
 * acts on it in the next round-trip is aiming at where the text *was*, and
 * three separate failures on this branch were exactly that — a drag that
 * selected nothing, a heading that "moved" across an unrelated click, and a
 * caret click that missed its paragraph.
 *
 * **One helper, not two.** `image-geometry.spec.ts` carried its own copy for
 * the same hazard on a thread reader ("a reader 345px wide at the first paint
 * and 558px once settled", moving its sentinel 28px on roughly one run in
 * three). Two helpers for one hazard is how they drift, so this is the only
 * one, and it reads `.doc-main` — the wrapper `DocView` puts around a document
 * body *and* around a thread's conversation, so both readers are covered.
 *
 * Two identical consecutive readings is what separates "settled" from "between
 * two changes". `expect.poll` bounds the wait, so a surface that never settles
 * fails here loudly instead of being waited out.
 */
export async function settledReader(page: Page): Promise<void> {
  const main = page.locator(".reader .doc-main").first();
  let previous = "";
  await expect
    .poll(
      async () => {
        const box = await main.boundingBox();
        if (box === null) return false;
        const now = `${String(box.x)}:${String(box.y)}:${String(box.width)}:${String(box.height)}`;
        const stable = now === previous;
        previous = now;
        return stable;
      },
      { message: "the reader's document half never stopped moving" },
    )
    .toBe(true);
}
