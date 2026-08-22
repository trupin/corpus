import type { UnauthorizedError } from "@corpus/contract";
import type { Locator, Page, Route } from "@playwright/test";
import { Buffer } from "node:buffer";
import { deflateSync } from "node:zlib";
import { expect, test } from "./coverage";
import { settledReader } from "./settle";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * UI-129, in a real browser: **an image reserves its box before the bytes**
 * (SPEC.md §10, rider signed 2026-08-20 — "a value that arrives later than the
 * box holding it" moves nothing else on the screen).
 *
 * **The delay is the test.** An `<img>` with no stated size occupies 0×0 until
 * it decodes and then takes its natural box, and an image already in the
 * browser's cache reproduces none of that: it is decoded before the paragraph
 * below it is ever laid out, so the jump the reader sees never happens to the
 * test. Every case here therefore holds `GET /attachments/*` **open**, measures
 * a sentinel paragraph beneath the picture, releases the response, waits for
 * the bytes to decode, and measures the same paragraph again. The assertion is
 * that the two numbers are identical.
 *
 * UI-128 measured the defect this pins, on the smallest fixture in the
 * repository: `IMG before: box=0x0 → after: box=48x36`, moving its sentinel by
 * **13px**. A turn attachment displaces up to 180px and a tall screenshot in a
 * document body displaces an unbounded amount.
 *
 * **Two sizes, on purpose.** The 48×36 fixture is the floor and not what anyone
 * attaches, so the trailing attachment here is a generated **900×600**
 * screenshot. One is smaller than the reserved box and one is far larger, which
 * is both halves of `object-fit: scale-down` and both ends of the displacement
 * this issue removes.
 *
 * All three surfaces are here because one renderer serves all three — a turn
 * body (`MarkdownView`), a turn attachment (`.turn-att-img`) and the editor's
 * ProseMirror node view — and a reservation that held in only one of them would
 * be a fix for one host rather than for the component.
 *
 * **The box is per surface, and that is asserted too** (PR #53 review). Prose
 * takes the reading measure, an attachment strip takes the mockup's 240×180
 * thumbnail, and a spec that only checked "nothing moved" would pass against a
 * body whose screenshot had been shrunk to a thumbnail — which is the defect the
 * review found. Every measurement below therefore names which box it expects.
 */

/**
 * The same flat 48×36 PNG `images.spec.ts` uses, and for its reasons:
 * `naturalWidth` is how these tests tell a decoded image from a held one, and a
 * 1×1 fixture renders as a box too small to point at.
 */
const SMALL_PNG_WIDTH = 48;
const SMALL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAADAAAAAkCAYAAADPRbkKAAAAO0lEQVR42u3PQREAAAQAMOnEEUddMni622MBFlk9n4WAgICAgICAgICAgICAgICAgICAgICAgICAwM0CTI5tokZcjBoAAAAASUVORK5CYII=",
  "base64",
);

/**
 * **The case a person actually has**, which the 48×36 fixture is not (this
 * issue's own verification plan says so: it "is the floor, not the case a person
 * has"). A pasted screenshot is far larger than the reserved box, so it exercises
 * the other half of `object-fit: scale-down` — the half that must be *contained*
 * rather than left alone — and it is the image whose 600px of natural height
 * would displace the rest of the conversation without a reservation.
 *
 * Generated rather than pasted: a solid 900×600 PNG deflates to ~2.5 KB of
 * bytes, and 3.3 KB of base64 in the middle of a spec would be 3.3 KB nobody can
 * read or check.
 */
const LARGE_PNG_WIDTH = 900;
const LARGE_PNG_HEIGHT = 600;

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function crc32(bytes: Buffer): number {
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[n] = value >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (table[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A solid truecolour PNG of the given size — the smallest honest screenshot. */
function solidPng(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  const scanline = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) {
    scanline[1 + x * 3] = 0x4a;
    scanline[2 + x * 3] = 0x6a;
    scanline[3 + x * 3] = 0x9a;
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => scanline));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const LARGE_PNG = solidPng(LARGE_PNG_WIDTH, LARGE_PNG_HEIGHT);

/**
 * The attachment strip's reserved box, as `apps/ui/src/thread/thread.css` and
 * `design/index.html` both state it. Asserted rather than derived: a box read
 * back out of the picture that is already on screen would agree with a
 * natural-size image, which is the defect.
 */
const ATTACHMENT_BOX = { width: 240, height: 180 };

/**
 * The shape every reserved box has, at whatever width its surface gives it —
 * `aspect-ratio: 4 / 3` in `@corpus/kit/markdown.css`, which is the mockup's
 * own figure.
 */
const BOX_RATIO = 4 / 3;

/**
 * A prose picture is **not** a thumbnail (PR #53 review of UI-129). It takes
 * the whole reading measure, so its box is derived from the surface rather than
 * stated here — the measure depends on the column's width and on `.doc-body`'s
 * 62ch, and hard-coding a pixel number would pin the column instead of the
 * image.
 *
 * The paragraph beneath the picture is what the measure is read from: it is a
 * block in the same body, so its content width **is** the width a `width: 100%`
 * image resolves against.
 *
 * This is the assertion the review turned on. A universal 240×180 fails it — a
 * body at the reading measure is far wider than 240 — which is exactly how the
 * fix was falsified.
 */
function expectReadingBox(picture: Box, measure: Box): void {
  expect(picture.width).toBe(measure.width);
  // The shape, to the pixel the rounding leaves.
  expect(Math.abs(picture.height - picture.width / BOX_RATIO)).toBeLessThanOrEqual(1);
  // And unmistakably a reading size rather than the thumbnail it used to be.
  expect(picture.width).toBeGreaterThan(ATTACHMENT_BOX.width * 1.5);
}

const THREAD_ID = "th_geo";
const TURN_TS = "2026-08-20T09:00:00Z";
const LATER_TS = "2026-08-20T09:05:00Z";
const SHOT = `attachments/${THREAD_ID}/2026-08-20T09%3A00%3A00.000Z/shot.png`;
const PLAN = `attachments/${THREAD_ID}/2026-08-20T09%3A00%3A00.000Z/plan.png`;

/** The paragraph under a mid-prose picture, inside the turn that holds it. */
const TURN_SENTINEL = "TURN-BODY-SENTINEL";
/** The turn under the first turn's trailing attachment. */
const ATTACHMENT_SENTINEL = "ATTACHMENT-SENTINEL";
/** The paragraph under a picture in a document body, in the editor. */
const EDITOR_SENTINEL = "EDITOR-SENTINEL";
/** The paragraph under the remote picture that never answers. */
const REMOTE_SENTINEL = "REMOTE-SENTINEL";
/** The paragraph under a **screenshot** in a document body. */
const BODY_SENTINEL = "BODY-SENTINEL";

const THREADS_VIEW: StubRow = {
  id: "doc_view_threads",
  type: "view",
  title: "Conversations",
  path: "data/docs/views/threads.md",
  pinned: true,
  order: 1,
  query: { type: "thread" },
};

const NOTES_VIEW: StubRow = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  pinned: true,
  order: 1,
  query: { folder: "inbox" },
};

/**
 * One conversation carrying both thread-side surfaces at once.
 *
 * The first turn references `shot.png` **mid-prose**, which `MarkdownView`
 * draws, and ends on a bare `plan.png` line, which the server's own reference
 * format makes the turn's trailing attachment (`splitTurnAttachments`) and which
 * the thread draws as `.turn-att-img`. The sentinel between them measures the
 * first, and the second turn — below everything the first turn holds — measures
 * the second.
 */
const THREAD: StubRow = {
  id: THREAD_ID,
  type: "thread",
  title: "The broker's chart",
  path: `data/docs/threads/${THREAD_ID}.md`,
  body: [
    `## user · ${TURN_TS}`,
    "The chart below is the one the broker sent.",
    "",
    `![shot.png](${SHOT})`,
    "",
    `${TURN_SENTINEL} — the paragraph under the mid-prose picture.`,
    "",
    `![plan.png](${PLAN})`,
    "",
    `## user · ${LATER_TS}`,
    `${ATTACHMENT_SENTINEL} — the turn under the attachment strip.`,
    "",
  ].join("\n"),
};

/** A document body whose picture sits above a paragraph, opened in the editor. */
const NOTE: StubRow = {
  id: "doc_note",
  title: "Rate assumptions",
  path: "data/docs/inbox/rates.md",
  body: [
    "The chart below is the one the broker sent.",
    "",
    `![shot.png](${SHOT})`,
    "",
    `${EDITOR_SENTINEL} — the paragraph under the picture.`,
    "",
    "And a remote one that never answers: ![remote](https://example.invalid/never.png)",
    "",
    `${REMOTE_SENTINEL} — the paragraph under the remote picture.`,
    "",
  ].join("\n"),
};

/**
 * **The reviewer's case**: a 900×600 screenshot in a document body, which is
 * what "an image that carries content" means in practice. It gets its own
 * document rather than joining `NOTE` so that the surfaces above keep measuring
 * exactly one picture each.
 */
const SCREENSHOT_NOTE: StubRow = {
  id: "doc_chart",
  title: "The broker's chart",
  path: "data/docs/inbox/chart.md",
  body: [
    "The chart below is the one the broker sent.",
    "",
    `![plan.png](${PLAN})`,
    "",
    `${BODY_SENTINEL} — the paragraph under the screenshot.`,
    "",
  ].join("\n"),
};

interface HeldAttachments {
  /** Lets every held `GET /attachments/*` answer with the PNG. */
  readonly release: () => void;
}

/**
 * `GET /attachments/*`, held open until the test says otherwise.
 *
 * The bearer guard is kept exactly as `images.spec.ts` states it: the route
 * answers `401` to a request carrying no `Authorization` header, so a rendering
 * that went back to a bare relative `<img src>` would fail here rather than pass
 * against a stub more forgiving than the server.
 */
async function holdAttachments(page: Page): Promise<HeldAttachments> {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/^https?:\/\/[^/]+\/attachments\//, async (route: Route) => {
    if ((await route.request().headerValue("authorization")) === null) {
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          code: "unauthorized",
          message: "missing bearer",
        } satisfies UnauthorizedError),
      });
    }
    await gate;
    // `plan.png` is the screenshot; `shot.png` is the icon-sized floor. One
    // route serves both so a single conversation exercises both halves of
    // `object-fit: scale-down`.
    const large = new URL(route.request().url()).pathname.endsWith("/plan.png");
    return route.fulfill({
      status: 200,
      contentType: "image/png",
      body: large ? LARGE_PNG : SMALL_PNG,
    });
  });
  return { release };
}

/** A laid-out box, rounded to whole pixels — the unit a reader's eye works in. */
interface Box {
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("element has no box");
  return { y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
}

/** Every rendered `.md-img`'s intrinsic width — `-1` for one still holding. */
async function naturalWidths(page: Page, selector: string): Promise<number[]> {
  return page.$$eval(selector, (nodes) =>
    nodes.map((node) => (node instanceof HTMLImageElement ? node.naturalWidth : -1)),
  );
}

test.describe("an image reserves its box before the bytes arrive", () => {
  test("holds a turn's prose and its attachment strip in place while two pictures decode", async ({
    page,
  }) => {
    const held = await holdAttachments(page);
    await stubCorpus(page, [THREADS_VIEW, THREAD]);

    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.locator(`.row[data-row-doc="${THREAD_ID}"]`).click();
    await expect(page.locator(".reader .thread-conversation .turn")).toHaveCount(2);

    // Both references are still waiting on the held response — this is the
    // state the defect lives in, and measuring before reaching it would measure
    // nothing.
    const pending = page.locator(".reader .md-img-pending");
    await expect(pending).toHaveCount(2);
    await settledReader(page);

    const turnSentinel = page.locator(".reader .turn-markdown p", { hasText: TURN_SENTINEL });
    const attachmentSentinel = page.locator(".reader .turn-markdown p", {
      hasText: ATTACHMENT_SENTINEL,
    });
    const before = {
      turn: await boxOf(turnSentinel),
      attachment: await boxOf(attachmentSentinel),
      prose: await boxOf(pending.first()),
      strip: await boxOf(pending.last()),
    };

    // The reservation itself: neither placeholder is a chip hugging its label,
    // and each is its own surface's box — the message's prose takes the reading
    // measure, the attachment strip takes the mockup's thumbnail.
    expectReadingBox(before.prose, before.turn);
    expect({ width: before.strip.width, height: before.strip.height }).toEqual(ATTACHMENT_BOX);

    held.release();
    await expect
      .poll(async () => naturalWidths(page, ".reader img.md-img"))
      .toEqual([SMALL_PNG_WIDTH, LARGE_PNG_WIDTH]);

    const after = {
      turn: await boxOf(turnSentinel),
      attachment: await boxOf(attachmentSentinel),
      prose: await boxOf(page.locator(".reader .turn-markdown img.md-img")),
      strip: await boxOf(page.locator(".reader img.turn-att-img")),
    };

    // Nothing moved, on either surface.
    expect(after.turn.y).toBe(before.turn.y);
    expect(after.attachment.y).toBe(before.attachment.y);

    // And the picture took the box that was reserved for it rather than its own
    // natural 48×36 — which is what makes the two lines above true.
    expectReadingBox(after.prose, after.turn);
    expect({ width: after.strip.width, height: after.strip.height }).toEqual(ATTACHMENT_BOX);
    expect(after.prose.y).toBe(before.prose.y);
    expect(after.strip.y).toBe(before.strip.y);
  });

  test("holds a document body in place while its picture decodes in the editor", async ({
    page,
  }) => {
    const held = await holdAttachments(page);
    await stubCorpus(page, [NOTES_VIEW, NOTE]);

    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.locator('.row[data-row-doc="doc_note"]').click();
    await expect(page.locator(".reader .ProseMirror")).toBeVisible();

    const pending = page.locator(".reader .doc-image .md-img-pending");
    await expect(pending).toHaveCount(1);
    await settledReader(page);

    const sentinel = page.locator(".reader .ProseMirror p", { hasText: EDITOR_SENTINEL });
    const before = { sentinel: await boxOf(sentinel), picture: await boxOf(pending) };
    expectReadingBox(before.picture, before.sentinel);

    held.release();
    const attachment = page.locator('.reader img.md-img[alt="shot.png"]');
    await expect
      .poll(async () => attachment.evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBe(SMALL_PNG_WIDTH);

    const after = { sentinel: await boxOf(sentinel), picture: await boxOf(attachment) };
    expect(after.sentinel.y).toBe(before.sentinel.y);
    expect(after.picture.y).toBe(before.picture.y);
    expectReadingBox(after.picture, after.sentinel);
  });

  /**
   * Clause 3 of the fix: a reference whose bytes never arrive **keeps** its box.
   * Collapsing it later is the same jump in the other direction — everything
   * below rises after the reader's eye has settled — so the remote URL that
   * never answers has to hold the reservation for as long as it is on screen.
   */
  test("keeps the reserved box for an image whose bytes never arrive", async ({ page }) => {
    const held = await holdAttachments(page);
    /*
     * The failure is delayed for the same reason every load here is: an image
     * that has already failed by first paint collapses before anyone is
     * reading, which the criterion explicitly allows. What it forbids is a
     * collapse *later*, so the request is held open, the surface is measured
     * around it, and only then is it failed. `abort` is the same event the
     * browser reports for a host that never answers, minus the timeout.
     */
    let failRemote: () => void = () => undefined;
    const remoteGate = new Promise<void>((resolve) => {
      failRemote = resolve;
    });
    await page.route("https://example.invalid/**", async (route: Route) => {
      await remoteGate;
      return route.abort("failed");
    });
    await stubCorpus(page, [NOTES_VIEW, NOTE]);

    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.locator('.row[data-row-doc="doc_note"]').click();
    await expect(page.locator(".reader .ProseMirror")).toBeVisible();

    // The attachment beside it is settled first, so the only thing still in
    // flight when the measurement is taken is the remote image.
    held.release();
    await expect
      .poll(async () => naturalWidths(page, '.reader img.md-img[alt="shot.png"]'))
      .toEqual([SMALL_PNG_WIDTH]);

    const remote = page.locator('.reader img.md-img[src="https://example.invalid/never.png"]');
    await expect(remote).toHaveCount(1);
    await settledReader(page);
    const sentinel = page.locator(".reader .ProseMirror p", { hasText: REMOTE_SENTINEL });
    const before = { sentinel: await boxOf(sentinel), remote: await boxOf(remote) };
    expectReadingBox(before.remote, before.sentinel);

    failRemote();
    // `complete` with no intrinsic width is the browser reporting a load that
    // failed — the moment a collapse would happen.
    await expect
      .poll(async () =>
        remote.evaluate((node) =>
          (node as HTMLImageElement).complete ? (node as HTMLImageElement).naturalWidth : -1,
        ),
      )
      .toBe(0);

    const after = { sentinel: await boxOf(sentinel), remote: await boxOf(remote) };
    expectReadingBox(after.remote, after.sentinel);
    expect(after.remote.y).toBe(before.remote.y);
    expect(after.sentinel.y).toBe(before.sentinel.y);
  });

  /**
   * **The review's own case** (PR #53, MAJOR against the first version of this
   * fix): a 900×600 screenshot in a document body used to render at the reading
   * measure and be legible there, and a universal 240×180 reservation made it a
   * thumbnail — turning the full-screen viewer into the ordinary way to read an
   * image that carries content, which SPEC.md §10's third clause forbids
   * ("revealing is the uncommon case and not the ordinary reading path").
   *
   * So this measures the picture as well as the sentinel: the box must be both
   * **stable** across the decode and **the reading measure**, and no earlier
   * version of the CSS satisfies both. The natural-size original fails the first
   * assertion, the 240×180 reservation fails the second.
   */
  test("draws a document body's screenshot at the reading measure, not a thumbnail", async ({
    page,
  }) => {
    const held = await holdAttachments(page);
    await stubCorpus(page, [NOTES_VIEW, SCREENSHOT_NOTE]);

    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.locator('.row[data-row-doc="doc_chart"]').click();
    await expect(page.locator(".reader .ProseMirror")).toBeVisible();

    const pending = page.locator(".reader .doc-image .md-img-pending");
    await expect(pending).toHaveCount(1);
    await settledReader(page);

    const sentinel = page.locator(".reader .ProseMirror p", { hasText: BODY_SENTINEL });
    const before = { sentinel: await boxOf(sentinel), picture: await boxOf(pending) };
    expectReadingBox(before.picture, before.sentinel);

    held.release();
    const picture = page.locator('.reader img.md-img[alt="plan.png"]');
    await expect
      .poll(async () => picture.evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBe(LARGE_PNG_WIDTH);

    const after = { sentinel: await boxOf(sentinel), picture: await boxOf(picture) };
    // Stable, first: the paragraph under a screenshot does not move when the
    // 900×600 lands, which is the guarantee this issue exists for.
    expect(after.sentinel.y).toBe(before.sentinel.y);
    expect(after.picture.y).toBe(before.picture.y);
    // And readable, second: the box is the body's own measure, so the whole
    // screenshot is drawn as wide as the prose beside it. `scale-down` fits the
    // 3:2 picture inside the 4:3 box by its width, so what is actually painted
    // is the full measure across — nothing is left for the viewer to reveal.
    expectReadingBox(after.picture, after.sentinel);
    const painted = await picture.evaluate((node) => {
      const image = node as HTMLImageElement;
      const box = image.getBoundingClientRect();
      const scale = Math.min(
        box.width / image.naturalWidth,
        box.height / image.naturalHeight,
        1, // `scale-down` never enlarges.
      );
      return { width: image.naturalWidth * scale, height: image.naturalHeight * scale };
    });
    expect(Math.round(painted.width)).toBe(after.picture.width);
  });
});
