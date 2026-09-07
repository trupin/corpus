import { Buffer } from "node:buffer";
import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type MultipartBody, type StubCorpus, type StubRow } from "./stubCorpus";

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

// The kit `Select` pills (UI-191), reached by the hook each one declares.
const OWNER = '[data-select="owner"]';
const LEVEL = '[data-select="resident-weight"]';

/** Drives a kit `Select`: open the pill, press the row by its visible label. */
async function pick(page: Page, control: string, label: string): Promise<void> {
  await page.locator(control).click();
  await page.getByRole("menuitemradio", { name: label, exact: true }).click();
}

/** A file with a distinguishable name and length, so "which file" is answerable. */
const SHOT = {
  name: "shot.png",
  mimeType: "image/png",
  buffer: Buffer.from("\x89PNG\r\n\x1a\nforecast-screenshot", "binary"),
};

/** The single value of a text part, or `undefined` when the part was not sent. */
function textPart(body: MultipartBody | undefined, field: string): string | undefined {
  return body?.text.find((part) => part.field === field)?.value;
}

test.describe("the one dropdown (UI-191)", () => {
  test("the owner control is fully operable from the keyboard", async ({ page }) => {
    await openComposer(page);
    await page.locator(OWNER).focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menu")).toBeVisible();
    // Type-ahead lands on the first label starting with what was typed…
    await page.keyboard.press("r");
    // …and Enter chooses it, with no pointer event anywhere in the gesture.
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.locator(`${OWNER} .select-value`)).toHaveText("researcher");

    // Escape closes with the value unchanged and focus on the trigger.
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.locator(OWNER)).toBeFocused();
    await expect(page.locator(`${OWNER} .select-value`)).toHaveText("researcher");
  });

  test("a long owner label ellipsises on the pill and is whole in the menu", async ({ page }) => {
    const LONG_NAME = "a-methodical-researcher-of-long-standing";
    await stubCorpus(page, [
      THREADS_VIEW,
      PROFILE,
      SKILL,
      {
        id: "doc_long",
        type: "agent-def",
        title: LONG_NAME,
        path: `.claude/agents/${LONG_NAME}.md`,
      },
    ]);
    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.keyboard.press("c");
    await expect(page.locator(".compose-panel textarea")).toBeVisible();

    await pick(page, OWNER, LONG_NAME);
    const value = page.locator(`${OWNER} .select-value`);
    // Truncated with an affordance, never cut mid-word without one: the full
    // value rides the ellipsised span's own title.
    await expect(value).toHaveAttribute("title", LONG_NAME);
    expect(await value.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);

    // The popover is free to be wider than its trigger, and shows the whole
    // option text.
    await page.locator(OWNER).click();
    const option = page.getByRole("menuitemradio", { name: LONG_NAME });
    await expect(option).toBeVisible();
    expect(await option.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    const menuBox = await page.getByRole("menu").boundingBox();
    const triggerBox = await page.locator(OWNER).boundingBox();
    expect(menuBox?.width ?? 0).toBeGreaterThan(triggerBox?.width ?? 0);
  });
});

test.describe("the weight Ask designates a resident at", () => {
  test("offers the workspace's own levels behind the owner, launcher-first", async ({ page }) => {
    await openComposer(page);

    // The control appears beside the owner once the declaration is read, and
    // its set is the parsed table plus the explicit way of choosing nothing —
    // the same wording the thread menu's rows carry.
    const level = page.locator(LEVEL);
    await expect(level).toBeVisible();
    await level.click();
    await expect(page.getByRole("menuitemradio")).toHaveText([
      "the launcher decides",
      "Small and mechanical",
      "Standard",
      "Heavy or judgment-laden",
    ]);
    await page.keyboard.press("Escape");
    await expect(level.locator(".select-value")).toHaveText("the launcher decides");
  });

  test("sends the level inside the designation — a profile at heavy, and no message weight", async ({
    page,
  }) => {
    const corpus = await openComposer(page);

    await pick(page, OWNER, "researcher");
    await pick(page, LEVEL, "Heavy or judgment-laden");
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
    await pick(page, LEVEL, "Heavy or judgment-laden");
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

/**
 * CONTRACT-095, in a real browser: **an Ask that carries an attachment keeps the
 * owner the person picked.**
 *
 * Attaching a file switches the request to `multipart/form-data`, and until this
 * issue the designation was simply dropped in that switch — so the same form
 * made two different threads depending on whether a screenshot rode along, and
 * the send succeeded either way. The absence of exactly this test is why it
 * shipped: every designation spec sent no file, and every attachment spec picked
 * no owner.
 *
 * The assertion is on the encoded **part**, not on a JSON body, because there is
 * no JSON body here at all — which is the whole hazard.
 */
test.describe("an Ask that carries an attachment", () => {
  test("sends the owner and the level as one encoded part, beside the file", async ({ page }) => {
    const corpus = await openComposer(page);

    await pick(page, OWNER, "researcher");
    await pick(page, LEVEL, "Heavy or judgment-laden");
    await page.locator('[data-attach-input="compose"]').setInputFiles([SHOT]);
    // The chip first: it is the precondition, so a request carrying no file is a
    // loss between the composer and the wire rather than a file never taken.
    await expect(page.locator('[data-dropzone="compose"] .att-chip')).toHaveCount(1);
    await page.locator(".compose-panel textarea").fill("Take this forecast apart.");
    await page.locator(".btn-ask").click();

    await expect.poll(async () => (await corpus.of("POST", "/api/threads")).length).toBe(1);
    const sent = (await corpus.of("POST", "/api/threads"))[0];
    // Multipart, so the JSON body the other specs read is not there to read.
    expect(sent?.body).toBeUndefined();
    expect((sent?.multipart?.files ?? []).map((part) => [part.field, part.filename])).toEqual([
      ["files", "shot.png"],
    ]);
    // One part, carrying the whole designation — the level inside it, exactly
    // as the JSON twin carries it. Asserted present before it is decoded, so a
    // dropped part reads as the missing designation it is rather than as a JSON
    // parse error.
    const encoded = textPart(sent?.multipart, "resident");
    expect(encoded).toBeDefined();
    expect(JSON.parse(encoded ?? "")).toEqual({ name: "researcher", weight: "heavy" });
    // The prose still rides `text` on this branch, and no message weight was
    // picked, so the designation's level cannot have leaked onto that field.
    expect(textPart(sent?.multipart, "text")).toBe("Take this forecast apart.");
    expect(textPart(sent?.multipart, "weight")).toBeUndefined();
  });

  /**
   * The state the encoding exists for. An omitted part and a `null` part mean
   * opposite things here — the default general resident against no resident at
   * all — so "nobody" has to arrive as a part rather than as an absence.
   */
  test("keeps 'nobody' a value: `null` as a part, where the default sends none", async ({
    page,
  }) => {
    const corpus = await openComposer(page);

    await pick(page, OWNER, "no owner — the main agent");
    await page.locator('[data-attach-input="compose"]').setInputFiles([SHOT]);
    await page.locator(".compose-panel textarea").fill("Nobody owns this.");
    await page.locator(".btn-ask").click();

    await expect.poll(async () => (await corpus.of("POST", "/api/threads")).length).toBe(1);
    expect(textPart((await corpus.of("POST", "/api/threads"))[0]?.multipart, "resident")).toBe(
      "null",
    );
  });

  test("sends no designation part at all when the default owner stands", async ({ page }) => {
    const corpus = await openComposer(page);

    await page.locator('[data-attach-input="compose"]').setInputFiles([SHOT]);
    await page.locator(".compose-panel textarea").fill("Just a screenshot and a question.");
    await page.locator(".btn-ask").click();

    await expect.poll(async () => (await corpus.of("POST", "/api/threads")).length).toBe(1);
    const sent = (await corpus.of("POST", "/api/threads"))[0];
    expect(textPart(sent?.multipart, "resident")).toBeUndefined();
    expect((sent?.multipart?.files ?? []).length).toBe(1);
  });
});
