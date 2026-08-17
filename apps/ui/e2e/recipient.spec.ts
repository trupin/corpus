import type { AgentLane } from "@corpus/contract";
import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubCorpus, type StubRow } from "./stubCorpus";

/**
 * UI-118 in a real browser: **a pick the person made is a pick, even when it
 * names the lane the composer had already worked out** (SPEC.md §7 — *"Every
 * message has a recipient, and where you post computes it… A person may
 * override it for one message"*).
 *
 * ## Why this spec exists at all
 *
 * The composer's default is computed **here**, from a cached roster and a walk
 * bounded at `MAX_SCOPE_WALK`; the server's is computed from the live projection
 * and is unbounded. The two agree almost always, and the interesting case is the
 * moment they do not: a resident released in another tab, a roster this page has
 * not refetched, and a person pressing the lane they mean to address.
 *
 * With the pick sent as *absence* — which is what UI-108 did for the untouched
 * default, correctly, and what UI-118 found was also being done for a pick — the
 * server walked past the released thread and handed the message to the
 * orchestrator. Nothing refused it, because there was nothing to refuse: the
 * server's own `assertRecipientResolvable` guard cannot run on a value that
 * never left the browser. The person addressed one agent and another answered.
 *
 * ## What is real here, and what is not
 *
 * Everything above `fetch` is the real application: the real board, the real
 * reader, the real composer, real clicks, the real `422` handling. The corpus
 * behind it is `stubCorpus`, which models the server's refusal from the same
 * rule the server states — a `recipient` naming no current lane is a `422` and
 * **nothing is written** — so a green run here is not a stub agreeing with
 * itself about the interesting part. The on-disk half (an event landing in
 * `.corpus/queue/pending/` stamped with the lane) is the issue's real-app drill.
 */

const THREADS_VIEW: StubRow = {
  id: "doc_view_threads",
  type: "view",
  title: "Conversations",
  path: "data/docs/views/threads.md",
  pinned: true,
  order: 1,
  query: { type: "thread" },
};

/** The designated root thread — a lane, and the scope this reply is posted in. */
const RESIDENT_THREAD: StubRow = {
  id: "th_res",
  type: "thread",
  title: "The claims conversation",
  path: "data/docs/threads/th_res.md",
  body: "## user · 2026-08-16T10:00:00Z\n\nWhat is our exposure here?\n",
};

/** Fresh, never a literal: a `live: true` older than the grace window lapses. */
const JUST_NOW = new Date().toISOString();

const RESIDENT_LANE: AgentLane = {
  lane: "th_res",
  resident: { name: "claims-review", docId: "doc_claims_agent" },
  live: true,
  since: JUST_NOW,
  summary: "reading the policy",
  origin: { id: "th_res", title: "The claims conversation" },
};

const PICKER = '[data-recipient-picker="th_res"]';
const LANE = "[data-recipient-lane]";
const TURNS = "/api/threads/th_res/turns";

async function board(page: Page): Promise<StubCorpus> {
  const corpus = await stubCorpus(page, [THREADS_VIEW, RESIDENT_THREAD], {
    lanes: [RESIDENT_LANE],
  });
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator('.row[data-row-doc="th_res"]').click();
  await expect(page.locator('.reader [data-composer="th_res"]')).toBeVisible();
  // The control only draws once the roster has answered with more than one lane.
  await expect(page.locator(`${PICKER} ${LANE}`)).toHaveCount(2);
  return corpus;
}

const laneOption = (page: Page, lane: string) =>
  page.locator(`${PICKER} [data-recipient-lane="${lane}"]`);

async function reply(page: Page, text: string): Promise<void> {
  await page.locator('[data-composer="th_res"]').fill(text);
  await page.locator('[data-dropzone="th_res"] .send').click();
}

const sent = async (corpus: StubCorpus): Promise<readonly Record<string, unknown>[]> =>
  (await corpus.of("POST", TURNS)).map((call) => (call.body ?? {}) as Record<string, unknown>);

test.describe("the recipient a composer states", () => {
  test("says who answers here before anything is typed, and states nothing untouched", async ({
    page,
  }) => {
    const corpus = await board(page);

    // §7: "the default is never a guess a person has to check — it follows from
    // where they are". A reply inside the designated thread goes to its resident.
    await expect(laneOption(page, "th_res")).toHaveAttribute("data-recipient-default", "true");
    await expect(laneOption(page, "th_res")).toHaveAttribute("aria-pressed", "true");
    await expect(laneOption(page, "th_res")).toHaveAttribute("data-recipient-chosen", "false");
    await expect(page.locator('[data-recipient-statement="th_res"]')).toContainText(
      "claims-review will answer — reading the policy",
    );

    await reply(page, "Any movement on this?");
    await expect.poll(async () => (await sent(corpus)).length).toBe(1);
    // Nobody chose, so nothing is stated: UI-108's property, which is what keeps
    // this build's walk and the server's from being able to disagree.
    expect("recipient" in ((await sent(corpus))[0] ?? {})).toBe(false);
  });

  test("sends a pick that names the lane the default already named", async ({ page }) => {
    const corpus = await board(page);

    await laneOption(page, "th_res").click();
    await expect(laneOption(page, "th_res")).toHaveAttribute("data-recipient-chosen", "true");
    // Still the default, still where a message goes — and now also chosen.
    await expect(laneOption(page, "th_res")).toHaveAttribute("data-recipient-default", "true");
    await expect(page.locator('[data-recipient-statement="th_res"]')).toContainText(
      "will answer this message",
    );

    await reply(page, "Directly to you, please.");
    await expect.poll(async () => (await sent(corpus)).length).toBe(1);
    expect((await sent(corpus))[0]?.["recipient"]).toBe("th_res");

    // Pressed again it is dropped, and the next message states nothing.
    await expect(laneOption(page, "th_res")).toHaveAttribute("data-recipient-chosen", "false");
    await reply(page, "And this one however you like.");
    await expect.poll(async () => (await sent(corpus)).length).toBe(2);
    expect("recipient" in ((await sent(corpus))[1] ?? {})).toBe(false);
  });

  /**
   * The reviewer's scenario end to end, in one page: the resident is released
   * somewhere else, this page's roster is stale, and the person presses the lane
   * they mean to address.
   */
  test("a pick gone stale is refused out loud, not delivered to somebody else", async ({
    page,
  }) => {
    const corpus = await board(page);
    const before = await corpus.doc("th_res");

    // The other tab. No invalidate frame is pushed, so this page is told nothing
    // and its picker still offers `th_res` as the lane it is posting into.
    await corpus.releaseLane("th_res");
    await expect(laneOption(page, "th_res")).toHaveAttribute("data-recipient-default", "true");

    await laneOption(page, "th_res").click();
    await expect(laneOption(page, "th_res")).toHaveAttribute("data-recipient-chosen", "true");
    await reply(page, "Can you confirm the exposure figure?");

    // It reached the wire, which is the whole fix: the server's guard cannot run
    // on a value the browser keeps to itself.
    await expect.poll(async () => (await sent(corpus)).length).toBe(1);
    expect((await sent(corpus))[0]?.["recipient"]).toBe("th_res");

    // The refusal is said in the server's own sentence…
    const toast = page.locator('.toast[data-tone="error"]');
    await expect(toast).toContainText("names no lane");
    await expect(toast).toContainText("Nothing was written");
    // …and stays on the row after the toast has dismissed itself.
    await expect(laneOption(page, "th_res")).toHaveAttribute("data-recipient-refused", "true");
    await expect(page.locator('[data-recipient-statement="th_res"]')).toContainText(
      "is not a lane any more",
    );

    // Nothing was written: the reply is back in the box and the thread is as it was.
    await expect(page.locator('[data-composer="th_res"]')).toHaveValue(
      "Can you confirm the exposure figure?",
    );
    expect((await corpus.doc("th_res"))?.body).toBe(before?.body);

    // The refusal is the only evidence this page's roster is behind — nothing
    // polls it — so it refetches, and the picker stops calling the released
    // thread the lane this composer posts into.
    await expect(laneOption(page, "orchestrator")).toHaveAttribute(
      "data-recipient-default",
      "true",
    );

    // And the retry still addresses the lane the person picked, rather than
    // being quietly handed to whoever the corrected default now names.
    await page.locator('[data-dropzone="th_res"] .send').click();
    await expect.poll(async () => (await sent(corpus)).length).toBe(2);
    expect((await sent(corpus))[1]?.["recipient"]).toBe("th_res");
  });
});
