import type { ConflictError, Health, Job, JobLog, JobList, QueueStatus } from "@corpus/contract";
import type { Page } from "@playwright/test";
// `test` comes from the coverage fixture, not from `@playwright/test`: it is the
// same runner plus the browser-side V8 collection the merged gate needs.
import { expect, test } from "./coverage";
import { LIGHT_ACCENT, hexToRgb, token } from "./tokens";

/** UI-098's agent-dot palette, read from the declared tokens (light theme). */
const LIGHT = ':root\\[data-theme="light"\\]';
const NEUTRAL = hexToRgb(token(LIGHT, "--ink-3"));
const GOOD = hexToRgb(token(LIGHT, "--good"));
const SIGNAL = hexToRgb(token(LIGHT, "--signal"));

/**
 * UI-011's console drawer, against the real Vite dev server with **no** workspace
 * server on `127.0.0.1:8765` (the suite's standing condition — `smoke.spec.ts`
 * asserts the strip says so).
 *
 * That is exactly the right environment for what a browser is needed to prove
 * here: the drawer **pushes rather than overlays**, the drag clamps, and the
 * height survives a reload — all layout facts that jsdom, which implements no
 * layout, cannot check at all. The parts that need a live queue (jobs, log
 * streaming, HALT, retry) are verified against a real server, a real CLI and a
 * real browser in the issue's E2E Verification Log; a mocked job list in
 * Playwright would prove less than the unit suite already does.
 */

const CONSOLE_STORAGE_KEY = "corpus.console";

async function expand(page: Page): Promise<void> {
  await page.locator(".console-strip").click();
  await page.locator(".console-body").waitFor();
}

function boxHeight(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluate((element) => element.getBoundingClientRect().height);
}

test.describe("the collapsed strip", () => {
  test("renders the prototype's one line, with counts beside the health notice", async ({
    page,
  }) => {
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));
    await page.goto("/");

    const strip = page.locator(".console-strip");
    await expect(strip.locator(".c-caret")).toHaveText("▴");
    await expect(strip).toContainText("console");
    await expect(strip).toHaveCSS("font-size", "11px");
    await expect(strip).toHaveCSS("padding", "7px 18px");
    await expect(strip).toHaveCSS("user-select", "none");

    /*
     * The agent pill and the counts, from the same queue status — unreachable
     * here, so the counts read their honest zeroes ("0 running" is true of a
     * server that is not there) and the pill reads `unknown`, because no value
     * of `agent` is true of a read that never answered (UI-098). It used to say
     * `idle`, which asserted somebody was connected and resting.
     */
    await expect(page.locator(".agent-pill")).toHaveText("agent: unknown");
    await expect(page.locator(".c-counts")).toHaveText("0 running · 0 done · 0 failed");
    await expect(page.locator(".halt-btn")).toHaveText("HALT ○");

    expect(uncaught).toEqual([]);
  });

  /**
   * UI-098's dots, in the one place they can actually be checked.
   *
   * The unit suite pins the class names; only a browser can say what those
   * classes *look* like, and §10's requirement is visual: `disconnected` must be
   * distinct from `idle` and from the `working` pulse, and must not be styled as
   * a failure — with no agent running it is the plain truth, not an error. The
   * assertions therefore compare against the declared tokens rather than against
   * colours copied into this file, and check `animation-name` because "nothing
   * else pulses" is the property that makes the pulse mean something.
   */
  test("dresses a disconnected agent as neither idle, nor halted, nor working", async ({
    page,
  }) => {
    const queue = (agent: QueueStatus["agent"], pending: number): QueueStatus => ({
      agent,
      halted: false,
      pending,
      inProgress: 0,
      deferred: 0,
      processed: 0,
      failed: 0,
      abandoned: 0,
    });
    let agent: QueueStatus["agent"] = { live: false, since: null };
    await page.route("**/api/queue/status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(queue(agent, 3)),
      }),
    );
    await page.goto("/");

    const pill = page.locator(".agent-pill");
    const dot = page.locator(".agent-pill .dot");
    // Nobody parked, three requests waiting — the sentence the queue depth is
    // beside it for.
    await expect(pill).toHaveText("agent: disconnected · queue 3");
    await expect(dot).toHaveCSS("background-color", NEUTRAL);
    await expect(dot).toHaveCSS("animation-name", "none");
    // Never red: `--signal` in this strip means needs-you, and this is not that.
    expect(NEUTRAL).not.toBe(SIGNAL);

    // And it is a claim with evidence on both sides: park an agent, and the same
    // strip says so on the next read.
    agent = { live: true, since: new Date().toISOString() };
    await page.reload();
    await expect(pill).toHaveText("agent: idle · queue 3");
    await expect(dot).toHaveCSS("background-color", GOOD);
    await expect(dot).toHaveCSS("animation-name", "none");
  });

  /*
   * Sprint-010 adjudication 5. `smoke.spec.ts` asserts `.console-strip .c-failed`
   * has exactly "server unreachable" in Playwright's strict mode; the failed-job
   * count is a second red number in the same strip and must never answer to that
   * locator. This is the assertion that would have caught it.
   */
  test("keeps the failed-job count off the health notice's class", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator(".console-strip .c-failed")).toHaveText("server unreachable", {
      timeout: 15_000,
    });
    await expect(page.locator(".console-strip .c-failed")).toHaveCount(1);
    await expect(page.locator(".c-failed-jobs")).toHaveText("0 failed");
  });

  test("the HALT button does not toggle the drawer it sits in", async ({ page }) => {
    await page.goto("/");
    // Unreachable server: halting would be a guess, so the control is disabled.
    await expect(page.locator(".halt-btn")).toBeDisabled();

    await page.locator(".halt-btn").click({ force: true });
    await expect(page.locator(".console")).toHaveClass("console");
    await expect(page.locator(".console-body")).toHaveCount(0);
  });
});

test.describe("the drawer pushes the board", () => {
  test("expanding shrinks the board instead of covering it", async ({ page }) => {
    await page.goto("/");
    const boardBefore = await boxHeight(page, ".board");

    await expand(page);

    const boardAfter = await boxHeight(page, ".board");
    const bodyHeight = await boxHeight(page, ".console-body");
    expect(boardAfter).toBeLessThan(boardBefore);
    // The board gave up exactly what the drawer took (plus the 5px resizer).
    expect(Math.round(boardBefore - boardAfter)).toBeGreaterThanOrEqual(Math.round(bodyHeight));

    // §10's one explicit prohibition.
    await expect(page.locator(".console")).toHaveCSS("position", "static");
    await expect(page.locator(".console-body")).toHaveCSS("position", "static");
    await expect(page.locator(".console-body")).toHaveCSS("height", "210px");

    // The shipped flex contract, unchanged (`smoke.spec.ts` asserts it collapsed).
    const grow = await page.evaluate(() => ({
      topbar: window.getComputedStyle(document.querySelector(".topbar") as Element).flexGrow,
      board: window.getComputedStyle(document.querySelector(".board") as Element).flexGrow,
      console: window.getComputedStyle(document.querySelector(".console") as Element).flexGrow,
    }));
    expect(grow).toEqual({ topbar: "0", board: "1", console: "0" });
  });

  test("leaves the top of the board reachable", async ({ page }) => {
    await page.goto("/");
    await expand(page);

    const boardBox = await page.locator(".board").boundingBox();
    const consoleBox = await page.locator(".console").boundingBox();
    expect(boardBox).not.toBeNull();
    expect(consoleBox).not.toBeNull();
    if (boardBox === null || consoleBox === null) return;
    // Nothing of the board is behind the drawer.
    expect(consoleBox.y).toBeGreaterThanOrEqual(boardBox.y + boardBox.height - 1);

    // Hit-test the top of the board: whatever is there must be the thing the
    // pointer reaches, which is the property an overlay would break.
    const topmost = await page.evaluate(() => {
      const board = document.querySelector(".board") as Element;
      const box = board.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + 20, box.y + 20);
      return {
        insideBoard: board.contains(hit),
        insideConsole: document.querySelector(".console")?.contains(hit) ?? false,
      };
    });
    expect(topmost).toEqual({ insideBoard: true, insideConsole: false });
  });
});

test.describe("drag resize", () => {
  test("is a 5px separator with an accessible label", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".console-resizer")).toHaveCount(0);

    await expand(page);
    const resizer = page.locator(".console-resizer");
    await expect(resizer).toHaveCSS("height", "5px");
    await expect(resizer).toHaveCSS("cursor", "ns-resize");
    await expect(resizer).toHaveAttribute("role", "separator");
    await expect(resizer).toHaveAttribute("aria-label", "Resize console");
    await expect(resizer).toHaveAttribute("aria-valuemin", "120");
  });

  test("clamps at 120px and 60vh, and re-clamps when the window shrinks", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await expand(page);

    const dragTo = async (y: number): Promise<void> => {
      const box = await page.locator(".console-resizer").boundingBox();
      if (box === null) throw new Error("no resizer");
      await page.mouse.move(box.x + box.width / 2, box.y + 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, y, { steps: 15 });
      await page.mouse.up();
    };

    await dragTo(0);
    expect(Math.round(await boxHeight(page, ".console-body"))).toBe(Math.round(900 * 0.6));

    await dragTo(895);
    expect(Math.round(await boxHeight(page, ".console-body"))).toBe(120);

    // A window that shrinks under a stored height must not squeeze the board out.
    await dragTo(300);
    await page.setViewportSize({ width: 1280, height: 400 });
    await expect(page.locator(".console-body")).toHaveCSS("height", "240px");
    expect(await boxHeight(page, ".board")).toBeGreaterThan(0);
  });

  test("resizes by arrow key, so it is not mouse-only", async ({ page }) => {
    await page.goto("/");
    await expand(page);
    const before = await boxHeight(page, ".console-body");

    await page.locator(".console-resizer").focus();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    expect(await boxHeight(page, ".console-body")).toBe(before + 32);

    await page.keyboard.press("ArrowDown");
    expect(await boxHeight(page, ".console-body")).toBe(before + 16);
  });
});

/*
 * SPEC.md §12 M3's named check: "expand the console → job list + selected job's
 * log detail render **and the drawer height persists after drag-resize**".
 */
test.describe("sticky state", () => {
  test("the expanded flag and the dragged height survive a reload", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await expand(page);

    const box = await page.locator(".console-resizer").boundingBox();
    if (box === null) throw new Error("no resizer");
    const grabY = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, grabY);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, grabY - 90, { steps: 10 });
    await page.mouse.up();
    // Dragging *up* 90px grows the drawer by 90px, from the 210px default.
    const dragged = await boxHeight(page, ".console-body");
    expect(dragged).toBe(300);

    await page.reload();
    await expect(page.locator(".console")).toHaveClass("console open");
    expect(await boxHeight(page, ".console-body")).toBe(dragged);

    // Its own key, and nothing in it but the two browser-local facts.
    const stored = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      CONSOLE_STORAGE_KEY,
    );
    expect(JSON.parse(stored ?? "{}")).toEqual({ version: 1, open: true, height: 300 });
    // Not smuggled into the board's blob, which is versioned around other state.
    const board = await page.evaluate(() => window.localStorage.getItem("corpus.board"));
    expect(board ?? "").not.toContain("console");
  });

  test("a corrupted value falls back to the defaults rather than throwing", async ({ page }) => {
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));
    await page.goto("/");
    await page.evaluate((key) => {
      window.localStorage.setItem(key, "{not json");
    }, CONSOLE_STORAGE_KEY);

    await page.reload();
    await expect(page.locator(".console")).toHaveClass("console");
    await expect(page.locator(".console-body")).toHaveCount(0);
    expect(uncaught).toEqual([]);
  });
});

test.describe("the master-detail body", () => {
  test("says so when there are no jobs", async ({ page }) => {
    await page.goto("/");
    await expand(page);

    await expect(page.locator(".job-empty")).toHaveText(
      "No jobs yet — agent activity will stream here.",
    );
    await expect(page.locator(".job")).toHaveCount(0);
    await expect(page.locator(".job-list")).toHaveCSS("width", "380px");
  });

  /**
   * PR #12 review, MAJOR 2 — the one queue interaction that used to be silent.
   *
   * A job row's menu closes in the tick it acts, which unmounts the component
   * that started the request; TanStack Query v5 then skips a per-call `onError`,
   * so a **refused** retry said nothing at all and the row simply stayed failed.
   * The queue this test needs is one failed job and one refusal, so it is served
   * from inside the page (the technique `stubCorpus` exists for) — everything
   * above `fetch` is the real application.
   */
  test("a refused retry says so, though the menu that asked has closed", async ({ page }) => {
    const failedJob: Job = {
      eventId: "evt_e2e",
      type: "comment.created",
      status: "failed",
      lane: "orchestrator",
      enqueued: "2026-07-27T09:12:00Z",
      started: "2026-07-27T09:12:04Z",
      updated: "2026-07-27T09:12:09Z",
      lastLine: "the agent exited 1",
      originId: null,
      originTitle: null,
      blockedOn: null,
      blockedOnTitle: null,
    };
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const body = (payload: unknown, status = 200): Promise<void> =>
        route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
      if (url.pathname === "/api/jobs")
        return body({ jobs: [failedJob], total: 1, truncated: false } satisfies JobList);
      if (url.pathname.endsWith("/retry")) {
        // Still on the wire when the menu goes: the teardown this pins.
        await new Promise((resolve) => setTimeout(resolve, 300));
        /*
         * The **contract's** refusal, `{code, message}` — this used to send
         * `{error: "queue is halted"}`, which `isApiError` rejects, so
         * `CorpusRequestError` fell back to its developer string and the toast
         * read `POST /api/jobs/{id}/retry failed (HTTP 409): {"error":…}`. The
         * assertion below only looked for the "Could not retry" prefix, so the
         * spec passed while exercising the branch PR #28's re-review exists to
         * keep off the screen (UI-102).
         */
        return body({ code: "conflict", message: "queue is halted" } satisfies ConflictError, 409);
      }
      if (url.pathname.endsWith("/log")) return body({ lines: [], nextCursor: 0 } satisfies JobLog);
      if (url.pathname === "/api/health") {
        return body({
          status: "ok",
          version: "1.2.3",
          uptimeSeconds: 4,
          workspace: "/tmp/ws",
        } satisfies Health);
      }
      if (url.pathname === "/api/queue/status") {
        return body({
          agent: { live: true, since: new Date().toISOString() },
          halted: true,
          pending: 0,
          inProgress: 0,
          deferred: 0,
          processed: 0,
          failed: 1,
          abandoned: 0,
        } satisfies QueueStatus);
      }
      return body({});
    });
    await page.goto("/");
    await expand(page);

    await page.locator(".job-list .job").first().click({ button: "right" });
    const menu = page.getByRole("menu");
    await menu.locator('[data-act="retry"]').click();
    // The surface that carried the observer is gone before the answer arrives.
    await expect(menu).toBeHidden();

    // The **server's own sentence**, not a route template and a status code:
    // what a person reads in a 360px toast (UI-102).
    await expect(page.locator(".toast")).toContainText("Could not retry evt_e2e: queue is halted");
    await expect(page.locator(".toast")).toHaveAttribute("data-tone", "error");
  });
});

test.describe("keyboard", () => {
  test("the strip is reachable, takes the shipped focus ring, and toggles", async ({ page }) => {
    await page.goto("/");
    const strip = page.locator(".console-strip");
    await expect(strip).toHaveAttribute("role", "button");
    await expect(strip).toHaveAttribute("tabindex", "0");
    await expect(strip).toHaveAttribute("aria-expanded", "false");

    await strip.focus();
    // `global.css`'s one focus-ring rule, not a second one for the console.
    await expect(strip).toHaveCSS("outline-width", "2px");
    await expect(strip).toHaveCSS("outline-style", "solid");
    await expect(strip).toHaveCSS("outline-color", LIGHT_ACCENT);
    await expect(strip).toHaveCSS("outline-offset", "2px");

    await page.keyboard.press("Enter");
    await expect(page.locator(".console")).toHaveClass("console open");
    await expect(strip).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.press(" ");
    await expect(page.locator(".console")).toHaveClass("console");
  });
});

test.describe("reduced motion", () => {
  test("the running job dot joins the existing guard", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expand(page);

    // No live queue here, so the rule is read off the cascade rather than off a
    // rendered dot; the rendered dot is verified against a real running job in
    // the issue's E2E log.
    const animation = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.className = "job-dot running";
      document.querySelector(".job-list")?.appendChild(probe);
      const name = window.getComputedStyle(probe).animationName;
      probe.remove();
      return name;
    });
    expect(animation).toBe("none");
  });
});
