import { expect, test } from "./coverage";
import { stubCorpus, type StubCorpus, type StubJob, type StubRow } from "./stubCorpus";

/**
 * UI-186 in a real browser: **the Residents tab says what a lane's listener
 * launched at, and changes it** (SPEC.md §7's resident riders — the one signed
 * 2026-08-19, which `SHARED-076`'s drafted-but-unsigned rider corrects — and
 * §10's console).
 *
 * The unit suite renders the tab against a fake transport. What a browser adds
 * is the path a person actually takes — open the drawer, press the tab, pick the
 * lane, read the sentence, choose a level, press — and, decisively, **the write
 * on the wire**: the acceptance criterion is that changing a weight is the
 * re-designation the server already performs and never a second mechanism, and
 * only the request body can testify to that.
 *
 * The disk half — `resident.weight` rewritten in the thread's frontmatter, a
 * `resident.released` with reason `replaced`, and a fresh `resident.designated`
 * enqueued — is the issue's real-workspace drill, recorded in its E2E
 * Verification Log. This suite's Vite has no server behind it (INFRA-028).
 */

const THREADS_VIEW: StubRow = {
  id: "doc_threads",
  type: "view",
  title: "Conversations",
  path: "data/docs/views/threads.md",
  query: { type: ["thread"] },
  order: 1,
};

const SOLO: StubRow = {
  id: "th_solo",
  type: "thread",
  title: "Q3 planning",
  path: "data/docs/threads/th_solo.md",
  body: "## user · 2026-08-17T10:00:00Z\n\nWhere did the forecast land?\n",
};

/** The workspace's own declaration — SHARED-022 Decision 1's one table. */
const SKILL: StubRow = {
  id: "doc_orchestrate",
  type: "skill",
  title: "orchestrate",
  path: ".claude/skills/orchestrate/SKILL.md",
  body: [
    "## Delegation",
    "",
    "| Weight | Key | Model | What falls here |",
    "| ----------------------- | -------- | ---------- | ---------------- |",
    "| Small and mechanical | light | **A model** | Guidance. |",
    "| Standard | standard | **A model** | Guidance. |",
    "| Heavy or judgment-laden | heavy | **A model** | Guidance. |",
    "",
    "Nothing outside this table declares a level.",
  ].join("\n"),
};

/**
 * The line AGENT-059 makes the orchestrator log on the designation's own event.
 * Copied from the shipped orchestrate skill's worked example — a fixture, and
 * never a vocabulary this suite or the tab holds.
 */
const LAUNCH_LINE =
  "launched a converse listener on th_solo — a general resident " +
  "(Haiku — judged: no weight chosen, the lane is for quick factual lookups)";

/**
 * The designation's own queue event, as `GET /api/jobs?originId=th_solo`
 * reports it. §7's carve-out puts it on the **orchestrator's** lane whoever is
 * designated, and its origin is the conversation — which is the predicate the
 * tab filters on.
 */
function designation(lastLine: string | null): StubJob {
  return {
    eventId: "evt_designated",
    type: "resident.designated",
    status: "processed",
    lane: "orchestrator",
    enqueued: "2026-08-29T09:00:00Z",
    started: "2026-08-29T09:00:01Z",
    updated: "2026-08-29T09:00:01Z",
    lastLine,
    originId: "th_solo",
  };
}

/** A general resident designated with **no** level: the launcher chose. */
const LAUNCHER_CHOSE = {
  lane: "th_solo",
  resident: { name: null, docId: null, weight: null, designationId: null },
  live: true,
  since: new Date().toISOString(),
  pending: 0,
  working: false,
  summary: null,
  origin: { id: "th_solo", title: "Q3 planning" },
};

async function openResidents(
  page: import("@playwright/test").Page,
  jobs: readonly StubJob[],
): Promise<StubCorpus> {
  const corpus = await stubCorpus(page, [THREADS_VIEW, SOLO, SKILL], {
    lanes: [LAUNCHER_CHOSE],
    jobs,
  });
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator(".console-strip").click();
  await page.locator(".console-body").waitFor();
  await page.getByRole("tab", { name: "Residents" }).click();
  await page.locator('[data-lane="th_solo"]').click();
  await expect(page.locator('[data-lane-scope="th_solo"]')).toBeVisible();
  return corpus;
}

const NOTE = '[data-lane-weight-note="th_solo"]';
const LEVEL = '[data-lane-weight-panel="th_solo"] select';
const APPLY = '[data-lane-weight-apply="th_solo"]';
const COST = '[data-lane-weight-cost="th_solo"]';

test.describe("the Residents tab's weight", () => {
  test("says what the launch went out at, read off the designation's own log", async ({ page }) => {
    await openResidents(page, [designation(LAUNCH_LINE)]);

    // The designation stated no level, so the first clause names who decided…
    await expect(page.locator(NOTE)).toContainText("No level was stated, so the launcher decides.");
    // …and the second shows what they decided, verbatim from the launch record.
    await expect(page.locator(NOTE)).toContainText(
      "The launch recorded: Haiku — judged: no weight chosen, the lane is for quick factual lookups.",
    );
  });

  /*
   * §7 makes a job's log runtime state reaped with its event, so a lane
   * designated days ago legitimately has nothing left to read. §10's standing
   * rule decides what to say: the unknown, said plainly, never a level nobody
   * wrote down. This is the exact row the screenshot behind UI-186 showed.
   */
  test("says the record is gone rather than naming a level nobody recorded", async ({ page }) => {
    await openResidents(page, []);

    await expect(page.locator(NOTE)).toContainText("No level was stated, so the launcher decides.");
    await expect(page.locator(NOTE)).toContainText("Nothing is guessed in its place.");
  });

  test("offers the workspace's own levels, launcher-first, and the cost of changing", async ({
    page,
  }) => {
    await openResidents(page, [designation(LAUNCH_LINE)]);

    await expect(page.locator(`${LEVEL} option`)).toHaveText([
      "the launcher decides",
      "Small and mechanical",
      "Standard",
      "Heavy or judgment-laden",
    ]);
    // Nothing is stated, so the control stands on the launcher's own member.
    await expect(page.locator(LEVEL)).toHaveValue("");
    // Pressing now would write the state already in force, so the act is
    // offered and dimmed rather than removed — and no price is quoted for a
    // change nobody has asked for.
    await expect(page.locator(APPLY)).toBeDisabled();
    await expect(page.locator(COST)).toHaveCount(0);

    // SHARED-076: the act says what it costs **before** it is taken. The price
    // arrives with the act, while the press is still available.
    await page.locator(LEVEL).selectOption("light");
    await expect(page.locator(COST)).toContainText(
      "releases the running listener and launches a new one at the new level",
    );
    // …and names the thing that is **not** lost, which is the half SHARED-076
    // corrects §7 on.
    await expect(page.locator(COST)).toContainText(
      "never the conversation, which is a document the new listener reads",
    );
    await expect(page.locator(APPLY)).toBeEnabled();
  });

  /**
   * The acceptance criterion, and the assertion the falsification targets:
   * changing the weight is a **re-designation of this thread carrying the new
   * level**, which is the write `apps/server/src/threads/resident.ts` already
   * performs — releasing the standing resident with reason `replaced` and
   * launching a new listener. No second mechanism, and no second route.
   */
  test("changes the weight by re-designating the thread at the level chosen", async ({ page }) => {
    const corpus = await openResidents(page, [designation(LAUNCH_LINE)]);

    await page.locator(LEVEL).selectOption("heavy");
    await expect(page.locator(APPLY)).toBeEnabled();
    await page.locator(APPLY).click();

    await expect
      .poll(async () => (await corpus.of("POST", "/api/threads/th_solo/resident")).length)
      .toBe(1);
    const [write] = await corpus.of("POST", "/api/threads/th_solo/resident");
    // The level, on the designation. No `name`: this resident has no profile,
    // and inventing one would designate somebody nobody asked for.
    expect(write?.body).toEqual({ weight: "heavy" });

    // The write landed, the roster refetched, and the tab now reports a level
    // somebody stated — a different fact from one the launcher picked.
    await expect(page.locator(NOTE)).toContainText(
      "Stated at designation: Heavy or judgment-laden.",
    );
    await expect(page.locator(APPLY)).toBeDisabled();
  });

  test("says out loud what it did, once the change lands", async ({ page }) => {
    await openResidents(page, [designation(LAUNCH_LINE)]);

    await page.locator(LEVEL).selectOption("light");
    await page.locator(APPLY).click();

    await expect(page.locator(".toast .msg")).toContainText(
      "Re-designated at Small and mechanical",
    );
  });
});
