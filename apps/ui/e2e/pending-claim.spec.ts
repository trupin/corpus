import { expect, test } from "./coverage";
import { stubEventStream } from "./eventStream";
import { stubCorpus } from "./stubCorpus";

/**
 * UI-097 in a real browser: **"queued" is not "working"**, and the moment it
 * becomes working arrives over SSE (SPEC.md §8's rider, signed 2026-08-12;
 * SPEC.md §7's `pending → in-progress`).
 *
 * The bug this pins was one word wide and worth a whole spec anyway, because a
 * unit test asserting the wording cannot tell a component that *renders* the
 * right sentence from one that *reaches* it: the wording is chosen from a queue
 * status the page fetched, off a job list it fetched separately, and the
 * transition between the two states is announced by an `invalidate` frame and by
 * nothing else. So this spec runs the real board over a real event stream, moves
 * the event the way a claiming agent moves it — **behind the page's back**, with
 * no mutation of this page's to trigger a refetch — and asserts the flip
 * happened with no reload.
 *
 * The seeded roster says **nobody is parked**, which is the honest state of a
 * suite that runs no agent, and is exactly the state the bug was reported in: a
 * person posts to an agent that is not running.
 */

const VIEW = {
  id: "doc_view_threads",
  type: "view",
  title: "Threads",
  path: "data/docs/views/threads.md",
  order: 1,
  query: { type: "thread" },
};

/** The reader a row click opens — a path column since UI-149 (rider 3). */
const reader = (page: import("@playwright/test").Page) => page.locator(".pcol");

const column = (page: import("@playwright/test").Page) =>
  page.locator('.col[data-col="doc_view_threads"]');

const row = (page: import("@playwright/test").Page, id: string) =>
  column(page).locator(`.row[data-row-doc="${id}"]`);

/** The instant the person asked — recent, so the row is in its first tier. */
const ASKED_AT = new Date(Date.now() - 5_000).toISOString();

const THREAD = {
  id: "th_ask",
  type: "thread",
  title: "Which quote",
  path: "data/threads/th_ask.md",
  parent: null,
  unread: false,
  body: `## user · ${ASKED_AT}\n@agent which of these should I file?\n`,
};

/** The event that ask enqueued, as `GET /api/jobs` reports it while it waits. */
const QUEUED_EVENT = {
  eventId: "evt_ask",
  type: "comment.created",
  status: "pending" as const,
  started: ASKED_AT,
  originId: "th_ask",
};

test.describe("a request nobody has picked up", () => {
  test("reads as waiting, and turns into working over SSE when an agent claims it", async ({
    page,
  }) => {
    const corpus = await stubCorpus(page, [VIEW, THREAD], { jobs: [QUEUED_EVENT] });
    const events = await stubEventStream(page);

    try {
      await page.goto("/");
      await expect(row(page, "th_ask")).toBeVisible();
      // Never assumed: without the stream open, the flip below would prove
      // nothing about what arrives unasked.
      await events.waitForConnection();

      // On the row: something is owed, and **nothing is pulsing**. A queue full
      // of unclaimed work must not spin a dot on every row it names.
      await expect(column(page).locator(".queued-dot")).toHaveCount(1);
      await expect(column(page).locator(".working-dot")).toHaveCount(0);

      // In the card: the sentence itself, and the clock it counts from.
      await row(page, "th_ask").click();
      const pending = reader(page).locator(".thread-card .working");
      await expect(pending).toBeVisible();
      await expect(pending).toHaveAttribute("data-pending-state", "waiting");
      await expect(pending).toHaveText("queued — waiting to be picked up");
      await expect(pending).toHaveAttribute("data-working-since", ASKED_AT);
      await expect(pending.locator(".working-dot")).toHaveCount(0);
      await expect(pending.locator(".queued-dot")).toHaveCount(1);

      /*
       * An agent claims it. Nothing on this page did that, so nothing on this
       * page is going to ask again on its own — `staleTime: Infinity` and no
       * poller — and the row is still saying "waiting" while the corpus has
       * moved on.
       */
      await corpus.claimJob("evt_ask");
      await expect(pending).toHaveAttribute("data-pending-state", "waiting");

      // The frame the server sends on every queue transition, and nothing else.
      events.push([["jobs"], ["queue"]]);

      await expect(pending).toHaveAttribute("data-pending-state", "working");
      await expect(pending).toHaveText("agent is working…");
      await expect(pending.locator(".working-dot")).toHaveCount(1);
      // **The wait did not restart.** The claim changed the words and not the
      // clock: same element, same `since`, no reload and no remount.
      await expect(pending).toHaveAttribute("data-working-since", ASKED_AT);
      expect(events.connections()).toBeGreaterThan(0);
      expect(page.url().endsWith("/")).toBe(true);

      // …and the row's dot now pulses, because now something is running.
      await reader(page).getByRole("button", { name: "‹ Threads" }).click();
      await expect(row(page, "th_ask")).toBeVisible();
      await expect(column(page).locator(".working-dot")).toHaveCount(1);
      await expect(column(page).locator(".queued-dot")).toHaveCount(0);
    } finally {
      await events.close();
    }
  });

  /**
   * The two dots are one signal in two states, so they are the same object at
   * the same size — what differs is that one is filled and moving and the other
   * is not. Measured rather than asserted from the stylesheet, because "does not
   * pulse" is a computed fact.
   */
  test("draws the queued dot as a still ring the size of the working one", async ({ page }) => {
    await stubCorpus(page, [VIEW, THREAD], { jobs: [QUEUED_EVENT] });
    await page.goto("/");
    await expect(column(page).locator(".queued-dot")).toHaveCount(1);

    const dot = await column(page)
      .locator(".queued-dot")
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          width: style.width,
          height: style.height,
          radius: style.borderRadius,
          animation: style.animationName,
          fill: style.backgroundColor,
          border: style.borderTopWidth,
        };
      });

    expect(dot.width).toBe("7px");
    expect(dot.height).toBe("7px");
    expect(dot.radius).toBe("50%");
    expect(dot.animation).toBe("none");
    expect(dot.fill).toBe("rgba(0, 0, 0, 0)");
    expect(dot.border).not.toBe("0px");
  });
});

/**
 * **A request that was seen and put down** — SPEC.md §7's `deferred`, in the
 * words §8's row says it in (UI-115).
 *
 * UI-097 folded `deferred` into "waiting", which is true and invites a false
 * inference: read *"still waiting to be picked up"* against a deferred event and
 * the reasonable conclusion is that nothing has happened and nobody has looked.
 * §7 says the opposite — *"Nothing refused it: the agent deferred because it
 * saw, not because it was blocked"* — and it is the one wait the person reading
 * the row can end, by finishing the edit.
 *
 * **Seeded rather than produced.** Deferring is something the agent does through
 * the CLI while somebody holds an edit session; this page cannot cause it. What
 * the browser is here for is that the sentence and the row's dot come from two
 * different modules (`apps/ui`'s `PendingIndicator` and `@corpus/kit`'s
 * `useRowSignals`) and must agree — which is the last acceptance criterion, and
 * is not a thing either module's own unit test can check.
 */
test.describe("a request the agent parked on somebody's editing", () => {
  const POLICY = {
    id: "doc_policy",
    type: "note",
    title: "The reimbursement policy",
    path: "data/docs/notes/policy.md",
    body: "Reimbursement is capped at the published rate for the quarter.\n",
  };

  const DEFERRED_EVENT = {
    eventId: "evt_ask",
    type: "comment.created",
    status: "deferred" as const,
    started: ASKED_AT,
    originId: "th_ask",
    blockedOn: "doc_policy",
  };

  test("says it is paused, names the document, and the row's dot agrees", async ({ page }) => {
    await stubCorpus(page, [VIEW, THREAD, POLICY], { jobs: [DEFERRED_EVENT] });
    await page.goto("/");
    await expect(row(page, "th_ask")).toBeVisible();

    // The row: still not pulsing — nothing is being worked — and its dot says
    // what the pause is on rather than that nobody has looked.
    await expect(column(page).locator(".working-dot")).toHaveCount(0);
    await expect(column(page).locator(".queued-dot")).toHaveAttribute(
      "title",
      `Paused while ${POLICY.title} is being edited`,
    );

    // The card: its own state, its own sentence, and the same document named.
    await row(page, "th_ask").click();
    const pending = reader(page).locator(".thread-card .working");
    await expect(pending).toBeVisible();
    await expect(pending).toHaveAttribute("data-pending-state", "deferred");
    await expect(pending).toHaveText(`paused while you are editing ${POLICY.title}`);
    // Never the inference this state exists to prevent.
    await expect(pending).not.toContainText("picked up");
    // The clock is the wait's, unchanged: being parked is not a fresh request.
    await expect(pending).toHaveAttribute("data-working-since", ASKED_AT);
    await expect(pending.locator(".queued-dot")).toHaveCount(1);
    await expect(pending.locator(".working-dot")).toHaveCount(0);
  });
});
