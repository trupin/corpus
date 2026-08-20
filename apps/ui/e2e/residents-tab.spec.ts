import type { StubRow } from "./stubCorpus";
import { stubCorpus } from "./stubCorpus";
// `test` comes from the coverage fixture, not from `@playwright/test`: it is the
// same runner plus the browser-side V8 collection the merged gate needs.
import { expect, test } from "./coverage";

/**
 * UI-125's console tab, in a real browser: **who is running, and on what**.
 *
 * The unit suite already renders the tab against a fake transport. What a
 * browser adds is the path a person actually takes — open the drawer, press the
 * tab, pick a lane, read its scope — and the fact that the scope is fetched
 * **on selection** rather than once per lane on mount, which is a request
 * pattern jsdom's fake transport cannot distinguish from an eager one.
 */

const THREADS_VIEW: StubRow = {
  id: "doc_threads",
  type: "view",
  title: "Threads",
  path: "data/docs/views/threads.md",
  query: { type: ["thread"] },
  column: "threads",
  pinned: true,
  order: 1,
};

const SOLO: StubRow = {
  id: "th_solo",
  type: "thread",
  title: "Q3 planning",
  path: "data/docs/threads/th_solo.md",
  body: "## user · 2026-08-17T10:00:00Z\n\nWhere did the forecast land?\n",
};

/** A subthread of the conversation: in scope by `parent`. */
const CHILD: StubRow = {
  id: "th_child",
  type: "thread",
  title: "Re: the forecast",
  path: "data/docs/threads/th_child.md",
  parent: "th_solo",
  body: "## user · 2026-08-17T11:00:00Z\n\nA follow-up.\n",
};

/** A conversation nobody designated, so nothing about it is in the lane. */
const OTHER: StubRow = {
  id: "th_other",
  type: "thread",
  title: "Rent planning",
  path: "data/docs/threads/th_other.md",
  body: "## user · 2026-08-17T12:00:00Z\n\nUnrelated.\n",
};

test.describe("the console's residents tab", () => {
  test("names the lane's resident and lists what it owns, and nothing else", async ({ page }) => {
    const corpus = await stubCorpus(page, [THREADS_VIEW, SOLO, CHILD, OTHER], {
      lanes: [
        {
          lane: "th_solo",
          resident: { name: "researcher", docId: "doc_researcher", weight: "heavy" },
          live: true,
          // Presence is a park held **now** (SPEC.md §7), so the stamp has to be
          // fresh against the wall clock rather than a fixed date that lapses.
          since: new Date().toISOString(),
          summary: null,
          origin: { id: "th_solo", title: "Q3 planning" },
        },
      ],
    });
    await page.goto("/");
    await page.locator(".board").waitFor();

    await page.locator(".console-strip").click();
    await page.locator(".console-body").waitFor();
    await page.getByRole("tab", { name: "Residents" }).click();

    // Both lanes are listed: the orchestrator's, which has no resident, and the
    // designated one, which does.
    await expect(page.locator("[data-lane]")).toHaveCount(2);
    const lane = page.locator('[data-lane="th_solo"]');
    await expect(lane).toContainText("researcher");
    await expect(lane).toHaveAttribute("data-lane-liveness", "live");

    // Nothing was fetched for a lane nobody selected — §7 forbids sweeping, and
    // one request per lane on mount is what that would look like here.
    expect(await corpus.of("GET", "/api/threads/th_solo/scope")).toHaveLength(0);

    await lane.click();
    await expect(page.locator('[data-lane-scope="th_solo"]')).toBeVisible();

    // The conversation itself, then its subthread — and the `via` distinction
    // says which walk put each one there (SPEC.md §7).
    await expect(page.locator('[data-scope-member="th_solo"]')).toHaveAttribute(
      "data-scope-via",
      "self",
    );
    await expect(page.locator('[data-scope-member="th_child"]')).toHaveAttribute(
      "data-scope-via",
      "parent",
    );
    // The undesignated conversation is in nobody's scope.
    await expect(page.locator('[data-scope-member="th_other"]')).toHaveCount(0);
  });
});
