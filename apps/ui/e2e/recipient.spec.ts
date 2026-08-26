import type { AgentLane } from "@corpus/contract";
import { MISSING_PROFILE_NOTE } from "@corpus/kit";
import type { Locator, Page } from "@playwright/test";
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
 * The composer's default is computed **here**, from a cached roster and the
 * documents this page has read; the server's is computed from the live
 * projection. Since UI-119 both run the identical traversal
 * (`@corpus/contract`'s `walkScope`), so what can still differ is the *inputs* —
 * and the interesting case is the moment they do: a resident released in another
 * tab, a roster this page has not refetched, and a person pressing the lane they
 * mean to address.
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
  resident: {
    name: "claims-review",
    docId: "doc_claims_agent",
    weight: "heavy",
    designationId: null,
  },
  live: true,
  since: JUST_NOW,
  pending: 0,
  working: false,
  summary: "reading the policy",
  origin: { id: "th_res", title: "The claims conversation" },
};

const PICKER = '[data-composer-address="th_res"]';
const LANE = "[data-recipient-lane]";
const TURNS = "/api/threads/th_res/turns";

/**
 * Opens the address popover the rows live behind (UI-126). Typing closes it —
 * a click into the field is a pointer landing outside — so tests reopen it
 * before reading the rows back.
 */
/**
 * The address line, brought fully into view and left to stop moving.
 *
 * A fixture concern and never an assertion. The composer sits at the foot of a
 * scrollable reader, so a click on the line can scroll the reader first — and a
 * press whose `pointerdown` lands on the line and whose `pointerup` lands on
 * whatever slid under it is no press at all: the popover never opens, and the
 * failure reads as if the control were broken. **Focusing it is what takes that
 * scroll**: the browser scrolls a partly-clipped control into view when it gains
 * focus, so doing it separately gets the movement over with before anything is
 * measured. UI-148's board
 * bar is what made this reachable at 1280×720 — the bar is 38px of chrome the
 * reader no longer has.
 */
async function readyToPress(page: Page, line: Locator): Promise<void> {
  await line.scrollIntoViewIfNeeded();
  await line.focus();
  let last = "";
  let same = 0;
  for (let tick = 0; tick < 60; tick += 1) {
    const box = JSON.stringify(await line.boundingBox());
    same = box !== "null" && box === last ? same + 1 : 0;
    if (same >= 3) return;
    last = box;
    await page.waitForTimeout(50);
  }
}

async function openAddress(page: Page): Promise<void> {
  const pop = page.locator('[data-address-pop="th_res"]');
  if ((await pop.count()) > 0) return;
  const line = page.locator('button[data-address-line="th_res"]');
  await readyToPress(page, line);
  await line.click();
  await pop.waitFor();
}

async function board(page: Page, lane: AgentLane = RESIDENT_LANE): Promise<StubCorpus> {
  const corpus = await stubCorpus(page, [THREADS_VIEW, RESIDENT_THREAD], {
    lanes: [lane],
  });
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator('.row[data-row-doc="th_res"]').click();
  await expect(page.locator('.reader [data-composer="th_res"]')).toBeVisible();
  // The line only opens once the roster has answered with more than one lane.
  await expect(page.locator('button[data-address-line="th_res"]')).toBeVisible();
  await openAddress(page);
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
    await openAddress(page);
    await expect(laneOption(page, "th_res")).toHaveAttribute("data-recipient-chosen", "false");
    await reply(page, "And this one however you like.");
    await expect.poll(async () => (await sent(corpus)).length).toBe(2);
    expect("recipient" in ((await sent(corpus))[1] ?? {})).toBe(false);
  });

  /**
   * SPEC.md §7: a designation whose profile has gone stands, and *"the missing
   * profile is reported rather than silently substituted"*. The ways in are
   * renamed, deleted, or moved out of `.claude/agents/`
   * (`MISSING_PROFILE_CAUSES`); **archiving is not one**, so an archived profile
   * never reaches this surface as a report.
   * The report held on the board badge and in `corpus agents` and stopped at the
   * picker, which drew the lane exactly as it draws a healthy one — on the one
   * surface where the lane is **chosen** (PR #49 review).
   *
   * The lane is seeded in the state the server answers with, which is the state
   * this page cannot produce for itself: `{name, docId: null}` is the server
   * re-resolving a stored name at read time and finding nothing.
   */
  test("reports a lane whose profile has gone, and still lets a person pick it", async ({
    page,
  }) => {
    const corpus = await board(page, {
      ...RESIDENT_LANE,
      resident: { name: "claims-review", docId: null, weight: "heavy", designationId: null },
    });
    const lane = laneOption(page, "th_res");

    await expect(lane).toHaveAttribute("data-recipient-kind", "profile-gone");
    // At rest — no hover, no focus, nothing typed.
    await expect(lane).toContainText("claims-review");
    await expect(lane).toContainText("profile gone");
    // …and the whole sentence where there is room for it. Through the kit's own
    // constant, which is composed from `MISSING_PROFILE_CAUSES`: a literal here
    // was one of the eight typed copies of this claim, and typed copies are how
    // it stayed wrong for a release.
    await expect.poll(async () => lane.getAttribute("title")).toContain(MISSING_PROFILE_NOTE);
    await expect(page.locator('[data-recipient-statement="th_res"]')).toContainText(
      `claims-review will answer — ${MISSING_PROFILE_NOTE}`,
    );

    // §7 keeps the designation, so the lane is a legal recipient and nothing
    // here gates on it: the report is news, not a refusal.
    await lane.click();
    await reply(page, "Carry on with the exposure figure, please.");
    await expect.poll(async () => (await sent(corpus)).length).toBe(1);
    expect((await sent(corpus))[0]?.["recipient"]).toBe("th_res");
  });

  test("marks no lane whose profile is where the designation left it", async ({ page }) => {
    await board(page);
    await expect(laneOption(page, "th_res")).toHaveAttribute("data-recipient-kind", "profiled");
    // The report is the exception; nothing else gains a word (§7's ordinary
    // lanes must look exactly as they did).
    await expect(page.locator(`${PICKER} .recipient-mark`)).toHaveCount(0);
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
    // …and stays on the surface after the toast has dismissed itself: the
    // address line itself says it, before anything is reopened…
    await expect(page.locator('[data-address-line="th_res"]')).toContainText(
      "is not a lane any more",
    );
    // …and the row wears it inside the popover.
    await openAddress(page);
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
