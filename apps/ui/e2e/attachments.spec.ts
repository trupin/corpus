import { Buffer } from "node:buffer";
import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import {
  multipartBodyOf,
  stubCorpus,
  type MultipartBody,
  type StubCorpus,
  type StubRow,
} from "./stubCorpus";

/**
 * **What actually goes on the wire when a composer carries a file** (SPEC.md §6;
 * §10's rider *"every composer takes attachments"*, signed 2026-08-05).
 *
 * UI-116 exists because this file did not. Five composers gained attachments in
 * this release and every proof that the files reached the server came from a
 * hand-driven browser drill that ran once — the specs all stopped at the chips,
 * and a chip is the easy half: a local object URL and some DOM. What breaks is
 * everything after it. So these tests assert the request, not the preview:
 * which parts went, under which field names, with which filenames — and what
 * comes back to the person when the post is refused.
 *
 * They could not have been written before `stubCorpus.ts` recorded a multipart
 * body without throwing on it, which is the other half of UI-116 and the reason
 * the gap had gone unnoticed: the recorder died inside the route handler, so an
 * attachment send simply hung, and nobody had ever tried.
 *
 * As everywhere in this directory, this is **half** the evidence (sprint-016
 * Adjudication 19): everything above `fetch` is the real application, and the
 * bytes-on-disk half stays in each issue's real-app drill against a real server.
 * The half asserted here is the half no drill can repeat on every push.
 */

const VIEW: StubRow = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  pinned: true,
  order: 1,
  query: { folder: "inbox" },
};

const THREADS_VIEW: StubRow = {
  id: "doc_view_threads",
  type: "view",
  title: "Conversations",
  path: "data/docs/views/threads.md",
  pinned: true,
  order: 2,
  query: { type: "thread" },
};

const NOTE: StubRow = {
  id: "doc_note",
  title: "Rates memo",
  body: "Short memo about lender spreads and the shape of the yield curve.",
};

const THREAD: StubRow = {
  id: "th_a",
  type: "thread",
  title: "About the rate",
  path: "data/docs/threads/th_a.md",
  body: "## user · 2026-08-08T10:00:00Z\n\nWhat should we do about the rate?\n",
};

/**
 * Two files with distinguishable everything — name, declared type and byte
 * length — so an assertion about *which* file arrived cannot be satisfied by the
 * other one. A spec that only checked "the request was multipart" would pass
 * against a composer that attached nothing at all.
 */
const SHOT = {
  name: "shot.png",
  mimeType: "image/png",
  buffer: Buffer.from("\x89PNG\r\n\x1a\nrates-screenshot", "binary"),
};
const NOTES = {
  name: "notes.txt",
  mimeType: "text/plain",
  buffer: Buffer.from("two lines\nof context\n", "utf8"),
};

/** `[field, filename, size]` per file part, in wire order. */
function filesOf(body: MultipartBody | undefined): (readonly [string, string, number])[] {
  return (body?.files ?? []).map((file) => [file.field, file.filename, file.size] as const);
}

/** The single value of a text part, or `undefined` when the part was not sent. */
function textPart(body: MultipartBody | undefined, field: string): string | undefined {
  return body?.text.find((part) => part.field === field)?.value;
}

async function board(page: Page, rows: readonly StubRow[]): Promise<StubCorpus> {
  const corpus = await stubCorpus(page, rows);
  await page.goto("/");
  await page.locator(".board").waitFor();
  return corpus;
}

async function openThread(page: Page): Promise<void> {
  await page.locator('.row[data-row-doc="th_a"]').click();
  await expect(page.locator('.reader [data-composer="th_a"]')).toBeVisible();
}

/**
 * Refuses one route, ahead of the stub, and keeps what it refused.
 *
 * Playwright consults handlers most-recently-registered first, so this shadows
 * the stub's catch-all for exactly one path. The refusal is a `500` carrying no
 * problem body — the honest shape of a server that fell over mid-upload, and the
 * one the multipart client turns into a bare `UploadError`.
 *
 * It returns the refused bodies rather than nothing, because "the chips came
 * back" is true of a composer that never sent them: a restore test that asserted
 * only the recovery would pass against exactly the bug this whole file exists to
 * catch. Reading the refused body is how it stays about attachments.
 */
function refuse(page: Page, path: string): { readonly refused: () => readonly MultipartBody[] } {
  const bodies: MultipartBody[] = [];
  void page.route(`**${path}`, async (route) => {
    const body = multipartBodyOf(route.request());
    if (body !== undefined) bodies.push(body);
    await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
  });
  return { refused: () => [...bodies] };
}

test.describe("the reply box, carrying files", () => {
  test("sends every file it showed a chip for, under the part name the route declares", async ({
    page,
  }) => {
    const corpus = await board(page, [VIEW, THREADS_VIEW, THREAD]);
    await openThread(page);

    await page.locator('[data-attach-input="th_a"]').setInputFiles([SHOT, NOTES]);
    // The easy half, kept because it is the precondition for the hard half: two
    // chips means the intake took both, so a request carrying one is a loss
    // between the composer and the wire rather than a file never picked up.
    await expect(page.locator('[data-dropzone="th_a"] .att-chip')).toHaveCount(2);

    await page.locator('[data-composer="th_a"]').fill("Here is what I meant.");
    await page.locator('[data-dropzone="th_a"] .send').click();

    await expect
      .poll(async () => (await corpus.of("POST", "/api/threads/th_a/turns")).length)
      .toBe(1);
    const sent = (await corpus.of("POST", "/api/threads/th_a/turns"))[0];

    // Multipart, and therefore not JSON: `body` is the JSON reading and there is
    // none. Asserting only this would prove nothing about the files.
    expect(sent?.body).toBeUndefined();
    expect(filesOf(sent?.multipart)).toEqual([
      ["files", "shot.png", SHOT.buffer.length],
      ["files", "notes.txt", NOTES.buffer.length],
    ]);
    // The prose rides as `text` on this branch and `body` on the JSON one
    // (`packages/contract/src/client/upload.ts`); sending the JSON spelling here
    // is a `400` from the real server, so the name is asserted, not just the value.
    expect(textPart(sent?.multipart, "text")).toBe("Here is what I meant.");
    expect(textPart(sent?.multipart, "body")).toBeUndefined();
    // §8's toggle survives the switch of encoding — the reply box asks by default.
    expect(textPart(sent?.multipart, "requestsAgent")).toBe("true");

    // And the corpus moved: the turn is in the conversation, not merely posted.
    await expect(page.locator('.reader [data-thread="th_a"] .turn')).toHaveCount(2);
  });

  test("sends a turn that is nothing but a file", async ({ page }) => {
    const corpus = await board(page, [VIEW, THREADS_VIEW, THREAD]);
    await openThread(page);

    // Not a word typed. SPEC.md §6 allows an attachment-only turn, and a
    // `canSend` that required text is exactly what breaks it first.
    await page.locator('[data-attach-input="th_a"]').setInputFiles([SHOT]);
    const send = page.locator('[data-dropzone="th_a"] .send');
    await expect(send).toBeEnabled();
    await send.click();

    await expect
      .poll(async () => (await corpus.of("POST", "/api/threads/th_a/turns")).length)
      .toBe(1);
    const sent = (await corpus.of("POST", "/api/threads/th_a/turns"))[0];
    expect(filesOf(sent?.multipart)).toEqual([["files", "shot.png", SHOT.buffer.length]]);
    // Absent, not empty: an empty `text` part is a second spelling of "no prose"
    // and the route's own rule is that neither text nor files is the `400`.
    expect(textPart(sent?.multipart, "text")).toBeUndefined();
  });

  test("gives back the words *and* the chips when the reply is refused", async ({ page }) => {
    await board(page, [VIEW, THREADS_VIEW, THREAD]);
    await openThread(page);
    const server = refuse(page, "/api/threads/th_a/turns");

    await page.locator('[data-attach-input="th_a"]').setInputFiles([SHOT]);
    await page.locator('[data-composer="th_a"]').fill("Look at this.");
    await page.locator('[data-dropzone="th_a"] .send').click();

    // The failure is narrated…
    await expect(page.locator(".toast[data-tone='error']")).toContainText("Reply failed —");
    // …over a request that really did carry the file, so what follows is a
    // statement about attachments and not about an empty JSON reply…
    expect(filesOf(server.refused()[0])).toEqual([["files", "shot.png", SHOT.buffer.length]]);
    // …and nothing the person put in the box was spent on it. UI-111: "a comment
    // that loses its screenshot because the post failed is worse than one that
    // could never take it" — and the sentence beside it was the same bug.
    await expect(page.locator('[data-composer="th_a"]')).toHaveValue("Look at this.");
    await expect(page.locator('[data-dropzone="th_a"] .att-chip')).toHaveCount(1);
    await expect(page.locator('[data-dropzone="th_a"] .att-chip')).toContainText("shot.png");
    // The thumbnail still resolves: `take()` deliberately does not revoke the
    // object URL, so a restored chip is a picture and not a broken image.
    await expect(page.locator('[data-dropzone="th_a"] .att-chip img')).toHaveAttribute(
      "src",
      /^blob:/,
    );
  });
});

test.describe("the composer under a turn, carrying a file", () => {
  /**
   * The fourth of §10's five composers, and the one that does not use
   * `take`/`restore` at all: it **holds** its chips and clears them by id once
   * the server has accepted, so "the chips survive a refusal" is true here by
   * construction rather than by recovery. Worth pinning for exactly that reason
   * — a refactor toward the other three's shape would be invisible otherwise.
   */
  test("sends the file with the child thread, and keeps it when refused", async ({ page }) => {
    const corpus = await board(page, [VIEW, THREADS_VIEW, THREAD]);
    await openThread(page);

    await page.locator('.reader [data-thread="th_a"] .turn .turn-comment').first().click();
    const child = page.locator('[data-child-composer="th_a"]');
    await expect(child).toBeVisible();

    const server = refuse(page, "/api/threads");
    await page.locator('[data-attach-input="child:th_a"]').setInputFiles([NOTES]);
    await child.getByLabel("Comment on this turn").fill("See the numbers here.");
    await child.locator(".send").click();

    await expect
      .poll(() => filesOf(server.refused()[0]))
      .toEqual([["files", "notes.txt", NOTES.buffer.length]]);
    // Nothing was cleared, because nothing was accepted.
    await expect(child.locator(".att-chip")).toHaveCount(1);
    await expect(child.getByLabel("Comment on this turn")).toHaveValue("See the numbers here.");

    // And once the server does accept, the same file goes and the box empties.
    await page.unroute("**/api/threads");
    await child.locator(".send").click();
    await expect.poll(async () => (await corpus.of("POST", "/api/threads")).length).toBe(1);
    const sent = (await corpus.of("POST", "/api/threads"))[0];
    expect(filesOf(sent?.multipart)).toEqual([["files", "notes.txt", NOTES.buffer.length]]);
    expect(textPart(sent?.multipart, "text")).toBe("See the numbers here.");
    expect(textPart(sent?.multipart, "parent")).toBe("th_a");
    // A comment on a turn is a note until the person says otherwise (SPEC.md §8).
    expect(textPart(sent?.multipart, "requestsAgent")).toBe("false");
    await expect(page.locator('[data-child-composer="th_a"]')).toHaveCount(0);
  });
});

test.describe("a comment on a selection, carrying a file", () => {
  async function commentOnTheNote(page: Page, words: string): Promise<void> {
    await page.locator('.row[data-row-doc="doc_note"]').click();
    await page.locator(".reader .ProseMirror").waitFor();
    const paragraph = page.locator(".reader .doc-body[contenteditable] > p").first();
    await paragraph.selectText();
    await paragraph.click({ button: "right" });
    await page.getByRole("menu").locator('[data-act="comment"]').click();
    const popover = page.getByRole("dialog", { name: "New comment" });
    await popover.getByLabel("Comment").fill(words);
  }

  test("puts the file on the same request as the quote", async ({ page }) => {
    const corpus = await board(page, [VIEW, NOTE]);
    await commentOnTheNote(page, "Is this the right chart?");

    await page.locator('[data-attach-input="comment"]').setInputFiles([SHOT]);
    await expect(page.locator('[data-dropzone="comment"] .att-chip')).toHaveCount(1);
    await page.locator("[data-comment-send]").click();

    await expect.poll(async () => (await corpus.of("POST", "/api/threads")).length).toBe(1);
    const sent = (await corpus.of("POST", "/api/threads"))[0];
    expect(filesOf(sent?.multipart)).toEqual([["files", "shot.png", SHOT.buffer.length]]);
    expect(textPart(sent?.multipart, "text")).toBe("Is this the right chart?");
    expect(textPart(sent?.multipart, "parent")).toBe("doc_note");
    // The selector is one JSON-encoded part on this branch — not three flat
    // ones — and losing it would orphan the comment while the file still landed.
    const selector = JSON.parse(textPart(sent?.multipart, "selector") ?? "null") as {
      readonly exact?: string;
    };
    expect(selector.exact).toContain("lender spreads");

    // The comment exists, anchored: the file did not cost it its highlight.
    await expect(page.locator(".reader .doc-body .anchor-hl")).toHaveCount(1);
  });

  test("re-opens holding the words and the chip when the comment is refused", async ({ page }) => {
    await board(page, [VIEW, NOTE]);
    await commentOnTheNote(page, "Is this the right chart?");
    const server = refuse(page, "/api/threads");

    await page.locator('[data-attach-input="comment"]').setInputFiles([SHOT]);
    await page.locator("[data-comment-send]").click();

    await expect
      .poll(() => filesOf(server.refused()[0]))
      .toEqual([["files", "shot.png", SHOT.buffer.length]]);
    const popover = page.getByRole("dialog", { name: "New comment" });
    await expect(popover).toBeVisible();
    await expect(popover.getByLabel("Comment")).toHaveValue("Is this the right chart?");
    await expect(page.locator('[data-dropzone="comment"] .att-chip')).toHaveCount(1);
    await expect(page.locator('[data-dropzone="comment"] .att-chip')).toContainText("shot.png");
  });
});

test.describe("the global composer, carrying a file", () => {
  async function openCompose(page: Page): Promise<void> {
    await page.getByRole("button", { name: /Ask \/ Capture/ }).click();
    await expect(page.getByRole("dialog", { name: "Ask or capture" })).toBeVisible();
  }

  test("Ask starts a standalone thread whose first turn carries the file", async ({ page }) => {
    const corpus = await board(page, [VIEW, NOTE]);
    await openCompose(page);

    await page.locator('[data-attach-input="compose"]').setInputFiles([SHOT, NOTES]);
    await expect(page.locator('[data-dropzone="compose"] .att-chip')).toHaveCount(2);
    await page.locator('[data-composer="compose"]').fill("What do you make of these?");
    await page.locator(".compose-panel .btn-ask").click();

    await expect.poll(async () => (await corpus.of("POST", "/api/threads")).length).toBe(1);
    const sent = (await corpus.of("POST", "/api/threads"))[0];
    expect(filesOf(sent?.multipart)).toEqual([
      ["files", "shot.png", SHOT.buffer.length],
      ["files", "notes.txt", NOTES.buffer.length],
    ]);
    expect(textPart(sent?.multipart, "text")).toBe("What do you make of these?");
    // Standalone: absent, not `null`. The multipart form has no way to spell a
    // null and a literal `"null"` part would name a document.
    expect(textPart(sent?.multipart, "parent")).toBeUndefined();
    expect(textPart(sent?.multipart, "selector")).toBeUndefined();
  });

  test("Capture files a screenshot plus one line", async ({ page }) => {
    const corpus = await board(page, [VIEW, NOTE]);
    await openCompose(page);

    await page.locator('[data-attach-input="compose"]').setInputFiles([SHOT]);
    await page.locator('[data-composer="compose"]').fill("Rates chart from the deck.");
    await page.locator(".compose-panel .btn-capture").click();

    await expect.poll(async () => (await corpus.of("POST", "/api/capture")).length).toBe(1);
    const sent = (await corpus.of("POST", "/api/capture"))[0];
    expect(filesOf(sent?.multipart)).toEqual([["files", "shot.png", SHOT.buffer.length]]);
    expect(textPart(sent?.multipart, "text")).toBe("Rates chart from the deck.");
    // SPEC.md §6: "screenshot + one line is a first-class capture".
    await expect(page.locator(".toast")).toContainText("Captured to inbox/");
  });

  test("gives back the words and the chips when the Ask is refused", async ({ page }) => {
    await board(page, [VIEW, NOTE]);
    await openCompose(page);
    const server = refuse(page, "/api/threads");

    await page.locator('[data-attach-input="compose"]').setInputFiles([SHOT]);
    await page.locator('[data-composer="compose"]').fill("What do you make of this?");
    await page.locator(".compose-panel .btn-ask").click();

    await expect
      .poll(() => filesOf(server.refused()[0]))
      .toEqual([["files", "shot.png", SHOT.buffer.length]]);
    // The panel stays open, because the person still means to send this.
    await expect(page.getByRole("dialog", { name: "Ask or capture" })).toBeVisible();
    await expect(page.locator('[data-composer="compose"]')).toHaveValue(
      "What do you make of this?",
    );
    await expect(page.locator('[data-dropzone="compose"] .att-chip')).toHaveCount(1);
    await expect(page.locator('[data-dropzone="compose"] .att-chip')).toContainText("shot.png");
  });
});
