import type { AgentLane } from "@corpus/contract";
import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * **Two rows of chrome that a person said were ugly, measured** (UI-179,
 * UI-180 — both reported 2026-08-27 with screenshots).
 *
 * SPEC.md §10's rider signed 2026-08-20 is the rule both broke, from opposite
 * directions: *"a component's size is a property of its place in the layout,
 * never of the text that happens to be in it."*
 *
 * - The **Reflect control** reserved its switch's slot in `ch` of the wrong
 *   font, so the switch overflowed the box that was meant to hold it and ate
 *   the gap before the clock.
 * - The **composer's foot** let its keyboard legend wrap inside itself, so a
 *   sentence became three lines and the whole row grew to fit it.
 *
 * Every assertion here is a **relation between measured rectangles**, never a
 * pixel count, for `address-geometry.spec.ts`'s reason: a number in a test is a
 * number that has to be maintained, and the complaint was never about a number.
 */

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const VIEW: StubRow = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  order: 1,
  query: { folder: "inbox" },
};

async function boxOf(page: Page, selector: string): Promise<Box> {
  return page.evaluate((css) => {
    const node = document.querySelector(css);
    if (node === null) throw new Error(`no ${css}`);
    const { x, y, width, height } = node.getBoundingClientRect();
    return { x, y, width, height };
  }, selector);
}

/** One line of an element's own font, so no line count is a hardcoded pixel. */
async function oneLineHeight(page: Page, selector: string): Promise<number> {
  return page.evaluate((css) => {
    const node = document.querySelector(css);
    if (node === null) throw new Error(`no ${css}`);
    const probe = document.createElement("span");
    const style = getComputedStyle(node);
    probe.style.font = style.font;
    probe.style.lineHeight = style.lineHeight;
    probe.style.position = "absolute";
    probe.style.whiteSpace = "nowrap";
    probe.textContent = "Mg";
    node.parentElement?.append(probe);
    const height = probe.getBoundingClientRect().height;
    probe.remove();
    return height;
  }, selector);
}

test.describe("the board bar's Reflect control", () => {
  /**
   * The user's screenshot: `reflecting…`, `auto off` and `reflected 1d`, with
   * the switch hard against the clock and a normal gap before it.
   *
   * The claim is a **relation**: whatever the row's rhythm is, it is one
   * rhythm. A test that pinned "6px" would have to be edited the day the gap
   * changes, and would still pass if the switch overflowed by exactly 6.
   */
  test("the switch sits inside its slot, and the gaps either side of it match", async ({
    page,
  }) => {
    await stubCorpus(page, [VIEW], { reflect: { quiet: 0 } });
    await page.goto("/");
    await page.locator(".boardbar").waitFor();
    await page.locator(".reflect-auto-switch").waitFor();

    const ask = await boxOf(page, ".reflect-ask");
    const slot = await boxOf(page, ".reflect-auto");
    const swtch = await boxOf(page, ".reflect-auto-switch");
    const clock = await boxOf(page, ".reflect-clock");

    // The switch is inside the box that reserves room for it. Overflowing it is
    // what ate the gap, and it is the defect rather than a symptom of one.
    expect(swtch.x).toBeGreaterThanOrEqual(slot.x - 0.5);
    expect(swtch.x + swtch.width).toBeLessThanOrEqual(slot.x + slot.width + 0.5);

    // One rhythm: the space before the switch and the space after it agree.
    const before = slot.x - (ask.x + ask.width);
    const after = clock.x - (slot.x + slot.width);
    expect(Math.abs(before - after)).toBeLessThanOrEqual(1);

    // And nothing is on top of anything.
    expect(clock.x).toBeGreaterThan(swtch.x + swtch.width);
  });

  /** Flipping it must not re-width the row — the reason the slot exists. */
  test("flipping the switch moves nothing beside it", async ({ page }) => {
    await stubCorpus(page, [VIEW], { reflect: { quiet: 0 } });
    await page.goto("/");
    await page.locator(".reflect-auto-switch").waitFor();

    const before = await boxOf(page, ".reflect-clock");
    await page.locator(".reflect-auto-switch").click();
    await expect(page.locator('.reflect-auto-switch[aria-checked="true"]')).toBeVisible();
    const after = await boxOf(page, ".reflect-clock");

    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(0.5);
  });
});

test.describe("the global composer's foot", () => {
  /**
   * The composer as the person reporting this saw it: an agent the workspace
   * can reach, so the address renders as its **live pill** with a caret rather
   * than as the plain said-statement it falls back to. That is the variant the
   * owner picker sits beside and has to match.
   */
  const LANES: readonly AgentLane[] = [
    {
      lane: "orchestrator",
      resident: null,
      live: true,
      since: "2026-08-01T09:00:00.000Z",
      pending: 0,
      working: false,
      summary: null,
      origin: null,
    },
  ];

  async function openComposer(page: Page): Promise<void> {
    await stubCorpus(page, [VIEW], { lanes: LANES });
    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.keyboard.press("c");
    await expect(page.locator(".compose-panel")).toBeVisible();
    await page.locator(".compose-actions").waitFor();
  }

  /**
   * The whole of "crowded": every item in the row squeezed below the width of
   * its own content, so the legend rendered as three lines and `Capture ⇧⌘↵`
   * and `Ask ⌘↵` broke across three each.
   *
   * **The claim is that nothing is squeezed**, not that nothing wraps. An
   * earlier version of this test asserted only "the legend is one line", and a
   * falsification proved that too weak: with the two pickers put back in this
   * row, an ellipsised legend crammed between them satisfies it. A truncated
   * label in a 640px panel is the same complaint by another route, so the
   * measurement is each control's rendered width against its own `max-content`.
   */
  test("no control in the row is squeezed below its own content", async ({ page }) => {
    await openComposer(page);

    const squeezed = await page.evaluate(() => {
      const row = document.querySelector(".compose-actions");
      if (row === null) throw new Error("no .compose-actions");
      const tight: string[] = [];
      for (const child of [...row.children] as HTMLElement[]) {
        const rendered = child.getBoundingClientRect().width;
        const probe = child.cloneNode(true) as HTMLElement;
        probe.style.position = "absolute";
        probe.style.width = "max-content";
        probe.style.whiteSpace = "nowrap";
        probe.style.visibility = "hidden";
        row.append(probe);
        const natural = probe.getBoundingClientRect().width;
        probe.remove();
        if (natural - rendered > 0.5) {
          tight.push(
            `${child.className || child.tagName} ${rendered.toFixed(1)} of ${natural.toFixed(1)}`,
          );
        }
      }
      return tight;
    });

    expect(squeezed).toEqual([]);

    // …and with nothing squeezed, the legend is one line of its own font.
    const line = await oneLineHeight(page, ".compose-actions .hint");
    const hint = await boxOf(page, ".compose-actions .hint");
    expect(hint.height).toBeLessThanOrEqual(line * 1.5);

    // The row is as tall as its tallest control, not as tall as its longest
    // sentence: the submit buttons are the tallest thing in it.
    const row = await boxOf(page, ".compose-actions");
    const ask = await boxOf(page, ".btn-ask");
    expect(row.height).toBeLessThanOrEqual(ask.height * 2);
  });

  /**
   * "The drop downs aren't even consistent." They are two different kinds of
   * element — a kit pill and a native `<select>` — which is exactly why they
   * have to be told to agree.
   */
  test("the two pickers share one visual register", async ({ page }) => {
    await openComposer(page);

    const register = await page.evaluate(() => {
      const read = (css: string) => {
        const node = document.querySelector(css);
        if (node === null) throw new Error(`no ${css}`);
        const style = getComputedStyle(node);
        return {
          fontSize: style.fontSize,
          fontFamily: style.fontFamily,
          borderRadius: style.borderTopLeftRadius,
          height: Math.round(node.getBoundingClientRect().height),
        };
      };
      return {
        address: read('[data-address-line="compose"]'),
        owner: read(".compose-resident select"),
      };
    });

    expect(register.owner.fontSize).toBe(register.address.fontSize);
    expect(register.owner.fontFamily).toBe(register.address.fontFamily);
    expect(register.owner.borderRadius).toBe(register.address.borderRadius);
    // Same height, because two pill-shaped controls of different heights in one
    // row is the thing that reads as unfinished.
    expect(Math.abs(register.owner.height - register.address.height)).toBeLessThanOrEqual(1);
  });

  /** Everything in the row is on the row — nothing has been pushed off it. */
  test("every control is inside the panel", async ({ page }) => {
    await openComposer(page);

    const panel = await boxOf(page, ".compose-panel");
    for (const css of [".compose-actions .hint", ".compose-resident", ".btn-capture", ".btn-ask"]) {
      const box = await boxOf(page, css);
      expect(box.x).toBeGreaterThanOrEqual(panel.x - 0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width + 0.5);
    }
  });
});
