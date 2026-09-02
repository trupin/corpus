import { expect, test } from "./coverage";
import { stubCorpus, type StubCorpus, type StubRow } from "./stubCorpus";

/**
 * UI-185 in a real browser: **Ask can state the weight of the resident it
 * designates**, and the two weights the overlay now holds — the designation's
 * and the message's — leave on the wire in their own places.
 *
 * The half that is honest to assert here is the wire and the surface: the
 * levels come from the workspace's own orchestrate skill (SHARED-022 Decision
 * 1), the choice rides **inside** the `resident` object (`CreateThreadResident`
 * — three states, and a weight is never a fourth), and the message-weight rows
 * say out loud what they do not govern. The disk half — `resident.weight` in
 * the created thread's frontmatter, `Resident.weight` echoed by
 * `GET /api/agents` — is the issue's real-workspace drill, recorded in its E2E
 * Verification Log; this suite's Vite has no server behind it (INFRA-028).
 */

const THREADS_VIEW: StubRow = {
  id: "doc_view_threads",
  type: "view",
  title: "Conversations",
  path: "data/docs/views/threads.md",
  order: 1,
  query: { type: "thread" },
};

/** Under `.claude/agents/`, because only a document there is designatable (UI-123). */
const PROFILE: StubRow = {
  id: "doc_researcher",
  type: "agent-def",
  title: "researcher",
  path: ".claude/agents/researcher.md",
};

/** The declaration, in the shape the orchestrate skill states it (AGENT-015). */
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

async function openComposer(page: import("@playwright/test").Page): Promise<StubCorpus> {
  const corpus = await stubCorpus(page, [THREADS_VIEW, PROFILE, SKILL]);
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.keyboard.press("c");
  await expect(page.locator(".compose-panel textarea")).toBeVisible();
  return corpus;
}

// The weight label reuses `.compose-resident`'s register, so the owner is the
// one that is not it.
const OWNER = ".compose-resident:not(.compose-resident-weight) select";
const LEVEL = ".compose-resident-weight select";

test.describe("the weight Ask designates a resident at", () => {
  test("offers the workspace's own levels behind the owner, launcher-first", async ({ page }) => {
    await openComposer(page);

    // The control appears beside the owner once the declaration is read, and
    // its set is the parsed table plus the explicit way of choosing nothing —
    // the same wording the thread menu's rows carry.
    const level = page.locator(LEVEL);
    await expect(level).toBeVisible();
    await expect(level.locator("option")).toHaveText([
      "the launcher decides",
      "Small and mechanical",
      "Standard",
      "Heavy or judgment-laden",
    ]);
    await expect(level).toHaveValue("");
  });

  test("sends the level inside the designation — a profile at heavy, and no message weight", async ({
    page,
  }) => {
    const corpus = await openComposer(page);

    await page.locator(OWNER).selectOption("researcher");
    await page.locator(LEVEL).selectOption("heavy");
    await page.locator(".compose-panel textarea").fill("Take the forecast apart.");
    await page.locator(".btn-ask").click();

    await expect.poll(async () => (await corpus.of("POST", "/api/threads")).length).toBe(1);
    const body = (await corpus.of("POST", "/api/threads"))[0]?.body as {
      resident?: unknown;
      weight?: unknown;
    };
    // Inside the object (CreateThreadResident), never a fourth top-level state.
    expect(body.resident).toEqual({ name: "researcher", weight: "heavy" });
    // No message weight was chosen, so the message's field stays off the body —
    // the designation's level must never leak onto it.
    expect("weight" in body).toBe(false);
  });

  test("keeps the two weights apart on the wire, and says which is which first", async ({
    page,
  }) => {
    const corpus = await openComposer(page);
    await expect(page.locator(LEVEL)).toBeVisible();

    // The message weight, one gesture behind the address line — whose rows now
    // carry the boundary: a level here rides the message and governs only what
    // the resident hands off.
    await page.locator('button[data-address-line="compose"]').click();
    const pop = page.locator('[data-address-pop="compose"]');
    await pop.waitFor();
    await expect(pop.locator("[data-designation-boundary]")).toContainText(
      "governs only what its own agent hands off",
    );
    await pop.locator('[data-weight-key="light"]').click();

    // The designation's own level, on the owner control.
    await page.locator(LEVEL).selectOption("heavy");
    await page.locator(".compose-panel textarea").fill("Both weights, both stated.");
    await page.locator(".btn-ask").click();

    await expect.poll(async () => (await corpus.of("POST", "/api/threads")).length).toBe(1);
    const body = (await corpus.of("POST", "/api/threads"))[0]?.body as {
      resident?: unknown;
      weight?: unknown;
    };
    // Each on its own field: the message's at top level, where §7 gives it the
    // hand-off job — the resident's inside the designation, where §7 puts the
    // only place the choice exists.
    expect(body.weight).toBe("light");
    expect(body.resident).toEqual({ weight: "heavy" });
  });
});
