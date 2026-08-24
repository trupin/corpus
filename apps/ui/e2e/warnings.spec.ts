import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * UI-106 — **a carried effect is not an error**, in a real browser.
 *
 * SPEC.md §11's warnings are the non-fatal channel, and the rider signed
 * 2026-08-10 says outright: *"A response's warnings also carry effects on
 * documents the request never named. A warning is not only a failure."*
 * CONTRACT-047 gave that sentence two codes — `carried_skill` and
 * `carried_reconciliation` — and every site in the app painted them the same red
 * as a failed commit, which is how a channel stops being read.
 *
 * ## Why a browser
 *
 * The tone is a **painted** difference, not only an attribute: `data-tone` is
 * what the toast stack sets and the stylesheet keys on, so a jsdom test can
 * assert the attribute and nothing about what a person actually sees. Here the
 * toasts are drawn by the bundle's own stylesheet and read back off the live
 * elements, both tones on screen in the same frame.
 *
 * ## What this suite cannot testify to, and where that half lives
 *
 * The **effect** these warnings report is a folder move on disk — §7 makes a
 * skill's location its enablement, so archiving a folder disables every nested
 * `SKILL.md`. This suite runs no workspace server and touches no disk
 * (INFRA-028), so the warnings are seeded (`StubOptions.archiveWarnings`) and
 * what is pinned is the UI's half: which tone the notice wears, and whether the
 * person is told about a document they did not act on. The disk half is the
 * issue's real-app drill.
 */

const VIEW: StubRow = {
  id: "doc_view_skills",
  type: "view",
  title: "Skills",
  path: "data/docs/views/skills.md",
  order: 1,
  query: { folder: "skills" },
};

/** The skill the act names — the one whose folder moves. */
const SKILL: StubRow = {
  id: "doc_skill_triage",
  type: "skill",
  title: "Triage",
  path: "data/docs/skills/triage/SKILL.md",
  body: "How to triage.",
};

const CARRIED = {
  code: "carried_skill",
  detail: "doc_skill_nested at .claude/skills-archived/triage/nested/SKILL.md — disabled",
} as const;

const RECONCILED = {
  code: "carried_reconciliation",
  detail: "doc_skill_nested at .claude/skills-archived/triage/nested/SKILL.md — status: resolved",
} as const;

/** A genuine failure, so the assertions below are about the code and not the channel. */
const FAILED = {
  code: "commit_failed",
  detail: "pre-commit hook rejected the write",
} as const;

/**
 * Archives the skill with §10's `e`, the act `archivedMessage` narrates.
 *
 * The column is activated with a hover and the row is reached with `j`, because
 * `e` archives *the row the keyboard cursor is on* — a hover alone leaves the
 * cursor empty and the act answers "Nothing to archive". The cursor's own class
 * is waited on rather than the keypress being assumed to have landed.
 */
async function archiveTheSkill(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.locator(`.row[data-row-doc="${SKILL.id}"]`)).toBeVisible();
  await page.locator(`.col[data-col="${VIEW.id}"]`).hover();
  await page.keyboard.press("j");
  await expect(page.locator(`.row.kbd[data-row-doc="${SKILL.id}"]`)).toHaveCount(1);
  await page.keyboard.press("e");
}

/** Every toast's message, in no assumed order — the stack renders newest first. */
async function messages(page: import("@playwright/test").Page): Promise<readonly string[]> {
  return page.locator(".toast .msg").allTextContents();
}

test.describe("archiving a skill that carried another one with it", () => {
  test("reports the carried effects as information, beside the act's own notice", async ({
    page,
  }) => {
    await stubCorpus(page, [VIEW, SKILL], { archiveWarnings: [CARRIED, RECONCILED] });
    await page.goto("/");
    await archiveTheSkill(page);

    // Three notices: the act narrating itself, and one per carried document.
    await expect(page.locator(".toast")).toHaveCount(3);
    // **None of them red.** This is the whole issue in one assertion: before it,
    // two of these three were errors.
    await expect(page.locator('.toast[data-tone="error"]')).toHaveCount(0);
    await expect(page.locator('.toast[data-tone="info"]')).toHaveCount(3);

    /*
     * Membership rather than order: the stack draws the newest toast in the
     * lowest slot, so a positional assertion here would be about the stack's
     * layout and not about the channel.
     */
    const shown = await messages(page);
    expect(shown.some((line) => line.includes('Archived "Triage"'))).toBe(true);
    // Legible about *which* document — a person reading this is being told about
    // one they did not act on, and the server's sentence names its id and path.
    expect(shown).toContain(`Also changed — ${CARRIED.detail}`);
    expect(shown).toContain(`Also changed — ${RECONCILED.detail}`);
  });
});

/**
 * The third acceptance criterion: **this is not a re-theming of the channel.** A
 * warning that reports something wrong keeps the tone and the wording it has
 * today, code and all — and a reader can pick it out of the carried effects
 * around it, which was the whole argument for the split.
 */
test.describe("a warning that reports something wrong", () => {
  test("is still an error, with the code on the line", async ({ page }) => {
    await stubCorpus(page, [VIEW, SKILL], { archiveWarnings: [FAILED] });
    await page.goto("/");
    await archiveTheSkill(page);

    await expect(page.locator(".toast")).toHaveCount(2);
    const failure = page.locator('.toast[data-tone="error"]');
    await expect(failure).toHaveCount(1);
    await expect(failure.locator(".msg")).toHaveText(`${FAILED.code} — ${FAILED.detail}`);
  });

  test("is drawn differently from a carried effect sent on the same response", async ({ page }) => {
    await stubCorpus(page, [VIEW, SKILL], { archiveWarnings: [CARRIED, FAILED] });
    await page.goto("/");
    await archiveTheSkill(page);

    await expect(page.locator(".toast")).toHaveCount(3);
    await expect(page.locator('.toast[data-tone="error"]')).toHaveCount(1);
    await expect(page.locator('.toast[data-tone="error"] .msg')).toContainText("commit_failed");
    const shown = await messages(page);
    expect(shown).toContain(`Also changed — ${CARRIED.detail}`);

    /*
     * The painted difference, both tones alive in one frame. It is the leading
     * mark that carries the tone (`.toast[data-tone="error"] .tick`, the one
     * deviation from the prototype), so that is what is measured — as an
     * inequality, because the claim is that a reader can tell them apart and not
     * which hex this theme happens to use.
     */
    const carriedInk = await page
      .locator('.toast[data-tone="info"] .tick')
      .first()
      .evaluate((node) => getComputedStyle(node).color);
    const failureInk = await page
      .locator('.toast[data-tone="error"] .tick')
      .evaluate((node) => getComputedStyle(node).color);
    expect(carriedInk).not.toBe(failureInk);
  });
});
