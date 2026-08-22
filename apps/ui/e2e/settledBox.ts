import type { Locator, Page } from "@playwright/test";

/**
 * Resolves once `locator`'s box has read the same three times running, 100ms
 * apart — **has this element stopped moving?**
 *
 * Sibling to `settle.ts`'s `settledReader`, and deliberately not the same
 * function. That one asks a fixed question of a fixed target (`.reader
 * .doc-main`) and can therefore take no argument beyond the page; this one is
 * asked of whatever a spec is about to measure, which is why it could not simply
 * be a second export with the same signature. Reach for `settledReader` when the
 * concern is a reader's document half arriving, and for this when the concern is
 * one element's geometry across a change the spec itself makes.
 *
 * Both `derived-status.spec.ts` and `derived-due.spec.ts` carried byte-identical
 * private copies of this, added in the same round whose `settle.ts` work removed
 * a duplicate for precisely this reason (PR #55 re-review, finding 3). Two
 * helpers for one hazard is how they drift.
 *
 * **The hazard, stated once.** The frontmatter form is sized against its column,
 * so a box measured before everything in the reader has arrived is a box of a
 * surface still moving — measured that way, a `status` flip appeared to resize
 * the form by 82px, all of it the column arriving. (The column's own widening
 * stopped being a transition in UI-146; the reader still has other reasons to
 * settle late — images decoding, a thread's turns rendering.)
 *
 * This is a **fixture concern and never an assertion**. What a spec asserts is
 * that two settled boxes either side of a value change are identical
 * (SHARED-057); this only decides when to read them. A surface that never
 * settles fails here loudly rather than being waited out.
 */
export async function settledBox(page: Page, locator: Locator): Promise<void> {
  let last = "";
  let same = 0;
  for (let tick = 0; tick < 60; tick += 1) {
    const box = JSON.stringify(await locator.boundingBox());
    same = box !== "null" && box === last ? same + 1 : 0;
    if (same >= 3) return;
    last = box;
    await page.waitForTimeout(100);
  }
  throw new Error("the element never stopped moving");
}
