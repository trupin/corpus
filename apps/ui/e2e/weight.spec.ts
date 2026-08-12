import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubCorpus, type StubRow } from "./stubCorpus";

/**
 * UI-082 in a real browser: **every composer can choose how much thought the
 * work gets** (SPEC.md §11's rider, signed 2026-08-06).
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
  pinned: true,
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

const PICKER = "[data-weight-picker]";
const OPTION = "[data-weight-key]";

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
 * An open reader is browser-local state that survives a reload (SPEC.md §11), so
 * there is nothing to click: the row is behind the reader that is already there.
 */
async function reopenedThread(page: Page): Promise<void> {
  await expect(page.locator('.reader [data-composer="th_w"]')).toBeVisible();
}

/** The labels one picker is offering, in order. */
function labels(page: Page, picker = PICKER): Promise<string[]> {
  return page.locator(`${picker} ${OPTION}`).allInnerTexts();
}

test.describe("the weight a composer may state", () => {
  test("offers the levels the workspace's own guidance declares, and preselects none", async ({
    page,
  }) => {
    await board(page, THREE);
    await openThread(page);

    const picker = page.locator('.reader .composer [data-weight-picker="th_w"]');
    await expect(picker).toBeVisible();
    expect(await labels(page, '[data-weight-picker="th_w"]')).toEqual([
      "Small and mechanical",
      "Standard",
      "Heavy or judgment-laden",
    ]);
    // Nothing preselected: the ordinary case is stating nothing, and a composer
    // nobody has touched behaves exactly as it did before this feature.
    await expect(picker.locator(`${OPTION}[aria-pressed="true"]`)).toHaveCount(0);
    // The Model column is the agent's and never reaches a composer.
    await expect(picker).not.toContainText("A model");
  });

  test("sends the chosen level's key, and nothing when nothing is chosen", async ({ page }) => {
    const corpus = await board(page, THREE);
    await openThread(page);

    await page.locator('[data-weight-picker="th_w"] [data-weight-key="heavy"]').click();
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
    await page.locator('[data-weight-picker="th_w"] [data-weight-key="heavy"]').click();
    await expect(
      page.locator('[data-weight-picker="th_w"] [data-weight-key="heavy"]'),
    ).toHaveAttribute("aria-pressed", "false");
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

    await page.locator('[data-weight-picker="th_w"] [data-weight-key="light"]').click();
    await page.locator('[data-composer="th_w"]').fill("A small edit, please.");
    await page.locator('[data-dropzone="th_w"] .send').click();

    // Visibly the starting point of the next one, without being re-chosen.
    await expect(
      page.locator('[data-weight-picker="th_w"] [data-weight-key="light"]'),
    ).toHaveAttribute("aria-pressed", "true");

    // Browser-local, and gone with the page: reload starts from nothing.
    await page.reload();
    await page.locator(".board").waitFor();
    await reopenedThread(page);
    await expect(page.locator('[data-weight-picker="th_w"] [aria-pressed="true"]')).toHaveCount(0);
  });

  test("shows as having nothing to act on for a note-only reply, keeping the choice", async ({
    page,
  }) => {
    await board(page, THREE);
    await openThread(page);

    const picker = page.locator('[data-weight-picker="th_w"]');
    await expect(picker).toHaveAttribute("data-weight-live", "true");

    await page.locator('[data-dropzone="th_w"] .composer-foot .toggle').click();
    await expect(picker).toHaveAttribute("data-weight-live", "false");
    // Flipping the toggle does not clear a choice, and the control never
    // disables the toggle in return — §8 alone decides what reaches the agent.
    await page.locator('[data-weight-picker="th_w"] [data-weight-key="standard"]').click();
    await expect(
      page.locator('[data-weight-picker="th_w"] [data-weight-key="standard"]'),
    ).toHaveAttribute("aria-pressed", "true");
    await page.locator('[data-dropzone="th_w"] .composer-foot .toggle').click();
    await expect(picker).toHaveAttribute("data-weight-live", "true");
    await expect(
      page.locator('[data-weight-picker="th_w"] [data-weight-key="standard"]'),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("follows the guidance when it is edited — a rename and a fourth level, no rebuild", async ({
    page,
  }) => {
    await board(page, THREE);
    await openThread(page);
    expect(await labels(page, '[data-weight-picker="th_w"]')).toEqual([
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

    await expect
      .poll(async () => labels(page, '[data-weight-picker="th_w"]'))
      .toEqual(["Small and mechanical", "Ordinary", "Heavy or judgment-laden", "Exhaustive"]);
  });

  test("offers no control at all in a workspace whose guidance declares none", async ({ page }) => {
    // A workspace on an older template (SPEC.md §2.4) — a real, shipping state.
    const corpus = await board(page, "## Delegation\n\nDispatch through the Task tool.\n");
    await openThread(page);

    // Not a fallback list, not a disabled control: nothing. The composer is
    // indistinguishable from the app before this feature — including on the
    // wire, where its requests state no weight at all.
    await expect(page.locator(PICKER)).toHaveCount(0);
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

    const picker = page.locator('.compose-panel [data-weight-picker="compose"]');
    await expect(picker).toBeVisible();
    await expect(picker).toHaveAttribute("data-weight-live", "true");
    await expect(picker.locator(`${OPTION}[aria-pressed="true"]`)).toHaveCount(0);

    await picker.locator('[data-weight-key="light"]').click();
    await page.locator('[data-composer="compose"]').fill("A question for the agent.");
    await page.locator(".btn-ask").click();

    await expect.poll(async () => (await corpus.of("POST", "/api/threads")).length).toBe(1);
    const asked = (await corpus.of("POST", "/api/threads"))[0]?.body as { weight?: string };
    expect(asked.weight).toBe("light");
  });

  test("claims no key — ↵ is still a newline in the composer it sits in", async ({ page }) => {
    const corpus = await board(page, THREE);
    await openThread(page);

    await page.locator('[data-weight-picker="th_w"] [data-weight-key="standard"]').click();
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
