import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubCorpus, type StubRow } from "./stubCorpus";

/**
 * UI-082 in a real browser: **every composer can choose how much thought the
 * work gets** (SPEC.md §10's rider, signed 2026-08-06).
 *
 * The half that is honest to assert here is the half above the transport, and it
 * is the load-bearing half of this feature: the offered levels are read from the
 * workspace's **own orchestrate skill**, as a projected document, so this spec
 * seeds that document and then changes it — which is the only way to see the
 * claim "editing the table changes what the composer offers, with no code
 * change" actually happen in a browser. Everything above `fetch` is the real
 * application: the real board, the real reader, the real composers, real clicks.
 *
 * The disk half — the `weight` field arriving in `.corpus/queue/pending/`, the
 * server's `weight stated by the request: <key>` job-log line, and the on-disk
 * proof that no document gained a field — is the issue's real-app drill against
 * a real `corpus init` workspace and a real server, recorded in its E2E
 * Verification Log. Neither half is acceptance on its own (sprint-016
 * Adjudication 19).
 */

const THREADS_VIEW: StubRow = {
  id: "doc_view_threads",
  type: "view",
  title: "Conversations",
  path: "data/docs/views/threads.md",
  order: 1,
  query: { type: "thread" },
};

const THREAD: StubRow = {
  id: "th_w",
  type: "thread",
  title: "About the rate",
  path: "data/docs/threads/th_w.md",
  body: "## user · 2026-08-08T10:00:00Z\n\nWhat should we do about the rate?\n",
};

/** A declaration in the shape the orchestrate skill states it (AGENT-015). */
function declaring(rows: readonly (readonly [string, string])[]): string {
  return [
    "## Delegation",
    "",
    "| Weight | Key | Model | What falls here |",
    "| ----------------------- | -------- | ---------- | ---------------- |",
    ...rows.map(([label, key]) => `| ${label} | ${key} | **A model** | Guidance. |`),
    "",
    "Nothing outside this table declares a level.",
  ].join("\n");
}

const THREE = declaring([
  ["Small and mechanical", "light"],
  ["Standard", "standard"],
  ["Heavy or judgment-laden", "heavy"],
]);

const RENAMED = declaring([
  ["Small and mechanical", "light"],
  ["Ordinary", "standard"],
  ["Heavy or judgment-laden", "heavy"],
  ["Exhaustive", "exhaustive"],
]);

function skill(body: string): StubRow {
  return {
    id: "doc_orchestrate",
    type: "skill",
    title: "orchestrate",
    path: ".claude/skills/orchestrate/SKILL.md",
    body,
  };
}

const OPTION = "[data-weight-key]";

/**
 * Opens a composer's address popover, which the levels sit behind since UI-126.
 * Typing closes it — a click into the field is a pointer landing outside — so
 * tests reopen it before reading the options back.
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

async function openAddress(page: Page, surface = "th_w"): Promise<void> {
  const pop = page.locator(`[data-address-pop="${surface}"]`);
  if ((await pop.count()) > 0) return;
  const line = page.locator(`button[data-address-line="${surface}"]`);
  await readyToPress(page, line);
  await line.click();
  await pop.waitFor();
}

async function board(page: Page, body: string): Promise<StubCorpus> {
  const corpus = await stubCorpus(page, [THREADS_VIEW, THREAD, skill(body)]);
  await page.goto("/");
  await page.locator(".board").waitFor();
  return corpus;
}

async function openThread(page: Page): Promise<void> {
  await page.locator('.row[data-row-doc="th_w"]').click();
  await expect(page.locator('.reader [data-composer="th_w"]')).toBeVisible();
}

/**
 * Waits for the conversation a reload restored.
 *
 * An open reader is browser-local state that survives a reload (SPEC.md §10), so
 * there is nothing to click: the row is behind the reader that is already there.
 */
async function reopenedThread(page: Page): Promise<void> {
  await expect(page.locator('.reader [data-composer="th_w"]')).toBeVisible();
}

/** The labels one composer's popover is offering, in order. */
function labels(page: Page, surface = "th_w"): Promise<string[]> {
  return page.locator(`[data-address-pop="${surface}"] ${OPTION}`).allInnerTexts();
}

const option = (page: Page, key: string, surface = "th_w") =>
  page.locator(`[data-address-pop="${surface}"] [data-weight-key="${key}"]`);

test.describe("the weight a composer may state", () => {
  test("offers the levels the workspace's own guidance declares, and preselects none", async ({
    page,
  }) => {
    await board(page, THREE);
    await openThread(page);

    // At rest the composer carries one line stating the outcome (UI-126); the
    // levels are one gesture behind it.
    const line = page.locator('button[data-address-line="th_w"]');
    await expect(line).toBeVisible();
    await openAddress(page);
    expect(await labels(page)).toEqual([
      "Small and mechanical",
      "Standard",
      "Heavy or judgment-laden",
    ]);
    // Nothing preselected: the ordinary case is stating nothing.
    await expect(
      page.locator(`[data-address-pop="th_w"] ${OPTION}[aria-pressed="true"]`),
    ).toHaveCount(0);
    // The Model column is the agent's and never reaches a composer.
    await expect(page.locator('[data-composer-address="th_w"]')).not.toContainText("A model");
  });

  test("sends the chosen level's key, and nothing when nothing is chosen", async ({ page }) => {
    const corpus = await board(page, THREE);
    await openThread(page);

    await openAddress(page);
    await option(page, "heavy").click();
    // The line states the outcome before sending (§10's statement).
    await expect(page.locator('[data-address-line="th_w"]')).toContainText(
      "Heavy or judgment-laden",
    );
    await page.locator('[data-composer="th_w"]').fill("Please restructure this.");
    await page.locator('[data-dropzone="th_w"] .send').click();

    await expect
      .poll(async () => (await corpus.of("POST", "/api/threads/th_w/turns")).length)
      .toBe(1);
    const first = (await corpus.of("POST", "/api/threads/th_w/turns"))[0]?.body as {
      weight?: string;
    };
    expect(first.weight).toBe("heavy");

    // Cleared in one gesture — and then the request states nothing at all.
    await openAddress(page);
    await option(page, "heavy").click();
    await expect(option(page, "heavy")).toHaveAttribute("aria-pressed", "false");
    await page.locator('[data-composer="th_w"]').fill("And this, unweighted.");
    await page.locator('[data-dropzone="th_w"] .send').click();

    await expect
      .poll(async () => (await corpus.of("POST", "/api/threads/th_w/turns")).length)
      .toBe(2);
    const second = (await corpus.of("POST", "/api/threads/th_w/turns"))[1]?.body as object;
    expect("weight" in second).toBe(false);
  });

  test("starts the next reply in the same conversation from the last choice, until a reload", async ({
    page,
  }) => {
    await board(page, THREE);
    await openThread(page);

    await openAddress(page);
    await option(page, "light").click();
    await page.locator('[data-composer="th_w"]').fill("A small edit, please.");
    await page.locator('[data-dropzone="th_w"] .send').click();

    // Visibly the starting point of the next one, without being re-chosen: the
    // line says it at rest, and the option is pressed behind it.
    await expect(page.locator('[data-address-line="th_w"]')).toContainText("Small and mechanical");
    await openAddress(page);
    await expect(option(page, "light")).toHaveAttribute("aria-pressed", "true");

    // Browser-local, and gone with the page: reload starts from nothing.
    await page.reload();
    await page.locator(".board").waitFor();
    await reopenedThread(page);
    await expect(page.locator('[data-address-line="th_w"]')).not.toContainText(
      "Small and mechanical",
    );
    await openAddress(page);
    await expect(page.locator(`[data-address-pop="th_w"] [aria-pressed="true"]`)).toHaveCount(0);
  });

  test("offers nothing to weigh on a note-only reply, and keeps the choice", async ({ page }) => {
    await board(page, THREE);
    await openThread(page);

    const address = page.locator('[data-composer-address="th_w"]');
    await expect(address).toHaveAttribute("data-address-live", "true");
    await openAddress(page);
    await option(page, "standard").click();

    // Note only is §10's floor since UI-126: the line says nobody is asked and
    // no level is offered anywhere — never a dimmed control holding a value.
    await page.locator('[data-dropzone="th_w"] .composer-foot .toggle').click();
    await expect(address).toHaveAttribute("data-address-live", "false");
    await expect(page.locator('[data-address-line="th_w"]')).toContainText("Nobody is asked");
    await expect(page.locator(`[data-composer-address="th_w"] ${OPTION}`)).toHaveCount(0);

    // Flipping back, the choice was kept — clearing it would be the control
    // acting on the person unseen — and the line states it again.
    await page.locator('[data-dropzone="th_w"] .composer-foot .toggle').click();
    await expect(address).toHaveAttribute("data-address-live", "true");
    await expect(page.locator('[data-address-line="th_w"]')).toContainText("Standard");
    await openAddress(page);
    await expect(option(page, "standard")).toHaveAttribute("aria-pressed", "true");
  });

  test("follows the guidance when it is edited — a rename and a fourth level, no rebuild", async ({
    page,
  }) => {
    await board(page, THREE);
    await openThread(page);
    await openAddress(page);
    expect(await labels(page)).toEqual([
      "Small and mechanical",
      "Standard",
      "Heavy or judgment-laden",
    ]);

    // The workspace edits its own orchestrate skill. Nothing else changes: no
    // rebuild, no reload, no code — the composer reads that document.
    //
    // The read before the write is not ceremony: SPEC.md §7 requires a write
    // that replaces a **body** to present the key of the version it read, and
    // this spec is the one caller in the suite that writes a body from inside
    // `page.evaluate` rather than through the editor. It used to `PUT` blind and
    // ignore the response, which after SHARED-041 is a `409` the test could not
    // see — the guidance simply never changed, and the assertion failed four
    // lines later on labels that had never had a chance to move. Presenting the
    // key is what a real client does; asserting the response is what stops this
    // failing silently again.
    const wrote = await page.evaluate(
      async ([body]) => {
        const read = await fetch("/api/docs/doc_orchestrate");
        const { key } = (await read.json()) as { key: string };
        const put = await fetch("/api/docs/doc_orchestrate", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body, key }),
        });
        return put.status;
      },
      [RENAMED] as const,
    );
    expect(wrote).toBe(200);
    await page.reload();
    await page.locator(".board").waitFor();
    await reopenedThread(page);

    await openAddress(page);
    await expect
      .poll(async () => labels(page))
      .toEqual(["Small and mechanical", "Ordinary", "Heavy or judgment-laden", "Exhaustive"]);
  });

  test("offers no control at all in a workspace whose guidance declares none", async ({ page }) => {
    // A workspace on an older template (SPEC.md §2.4) — a real, shipping state.
    const corpus = await board(page, "## Delegation\n\nDispatch through the Task tool.\n");
    await openThread(page);

    // Not a fallback list, not a disabled control: nothing to open. The line
    // says who answers as plain text — there is neither a level nor a second
    // lane behind it — and the wire states no weight at all.
    await expect(page.locator('[data-address-line="th_w"]')).toBeVisible();
    await expect(page.locator('button[data-address-line="th_w"]')).toHaveCount(0);
    await expect(page.locator(OPTION)).toHaveCount(0);
    await page.locator('[data-composer="th_w"]').fill("Just a reply.");
    await page.locator('[data-dropzone="th_w"] .send').click();

    await expect
      .poll(async () => (await corpus.of("POST", "/api/threads/th_w/turns")).length)
      .toBe(1);
    const sent = (await corpus.of("POST", "/api/threads/th_w/turns"))[0]?.body as object;
    expect("weight" in sent).toBe(false);
  });

  /**
   * The global composer. **Ask** rather than Capture only because Capture is
   * multipart on the wire even without files and this stub records JSON bodies;
   * both submits are covered surface by surface in
   * `apps/ui/src/weight/everyComposer.test.tsx` and both are exercised against
   * the real server in the issue's E2E log.
   */
  test("is offered by the global composer, live, with nothing preselected", async ({ page }) => {
    const corpus = await board(page, THREE);
    await page.keyboard.press("c");
    await expect(page.locator(".compose-panel")).toBeVisible();

    const address = page.locator('.compose-panel [data-composer-address="compose"]');
    await expect(address).toBeVisible();
    await expect(address).toHaveAttribute("data-address-live", "true");
    await openAddress(page, "compose");
    await expect(
      page.locator(`[data-address-pop="compose"] ${OPTION}[aria-pressed="true"]`),
    ).toHaveCount(0);

    await option(page, "light", "compose").click();
    await page.locator('[data-composer="compose"]').fill("A question for the agent.");
    await page.locator(".btn-ask").click();

    await expect.poll(async () => (await corpus.of("POST", "/api/threads")).length).toBe(1);
    const asked = (await corpus.of("POST", "/api/threads"))[0]?.body as { weight?: string };
    expect(asked.weight).toBe("light");
  });

  test("claims no key — ↵ is still a newline in the composer it sits in", async ({ page }) => {
    const corpus = await board(page, THREE);
    await openThread(page);

    await openAddress(page);
    await option(page, "standard").click();
    // The line toggles its popover closed — no key involved — so the field
    // underneath is clickable again.
    await page.locator('button[data-address-line="th_w"]').click();
    const field = page.locator('[data-composer="th_w"]');
    await field.click();
    await field.pressSequentially("one");
    await page.keyboard.press("Enter");
    await field.pressSequentially("two");
    await expect(field).toHaveValue("one\ntwo");
    expect(await corpus.of("POST", "/api/threads/th_w/turns")).toHaveLength(0);

    // …and ⌘↵ still sends, carrying what the control states.
    await page.keyboard.press("Meta+Enter");
    await expect
      .poll(async () => (await corpus.of("POST", "/api/threads/th_w/turns")).length)
      .toBe(1);
    expect(
      ((await corpus.of("POST", "/api/threads/th_w/turns"))[0]?.body as { weight?: string }).weight,
    ).toBe("standard");
  });
});
