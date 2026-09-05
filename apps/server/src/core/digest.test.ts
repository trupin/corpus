// `core/digest.ts` — the frontmatter shape of SPEC.md §6's digest (rider signed
// 2026-09-05), and the two questions every staleness trigger asks of it.
//
// Unit-level on purpose: this module is I/O-free, and the write path, the
// projection and the watcher all reach a digest through it, so what it accepts
// is what a file may say on every one of those surfaces at once.

import { describe, expect, it } from "vitest";
import {
  bodyEditStalenessPatch,
  coveredTurnsChanged,
  digestCovers,
  digestToStored,
  markedStale,
  stalenessPatch,
  storedDigest,
} from "./digest.js";

const WATERMARK = "2026-09-05T10:00:00Z";
const DIGEST = { body: "They agreed on the rate.", watermark: WATERMARK, stale: false };

const turnsBody = (...turns: readonly (readonly [string, string, string])[]): string =>
  turns.map(([author, ts, body]) => `## ${author} · ${ts}\n\n${body}\n`).join("\n");

describe("storedDigest", () => {
  it("reads the three fields a digest carries", () => {
    expect(storedDigest({ body: "prose", watermark: WATERMARK, stale: true })).toEqual({
      body: "prose",
      watermark: WATERMARK,
      stale: true,
    });
  });

  it("reads a missing `stale` as false, so a hand-written digest is not refused for it", () => {
    expect(storedDigest({ body: "prose", watermark: WATERMARK })).toEqual({
      body: "prose",
      watermark: WATERMARK,
      stale: false,
    });
  });

  it("normalizes a hand-written watermark to the instant the wire publishes", () => {
    expect(storedDigest({ body: "prose", watermark: "2026-09-05 12:00:00+0200" })).toEqual({
      body: "prose",
      watermark: "2026-09-05T10:00:00Z",
      stale: false,
    });
  });

  it("ignores keys that are not part of a digest rather than failing on them", () => {
    expect(storedDigest({ body: "prose", watermark: WATERMARK, author: "someone" })).toEqual({
      body: "prose",
      watermark: WATERMARK,
      stale: false,
    });
  });

  it.each([
    ["nothing at all", undefined],
    ["an explicit null", null],
    ["a string", "just prose"],
    ["a list", [{ body: "a", watermark: WATERMARK }]],
    ["prose with no watermark", { body: "prose" }],
    ["a watermark that names no moment", { body: "prose", watermark: "soon" }],
    ["a watermark that is not a string", { body: "prose", watermark: 5 }],
    ["a coverage claim with nothing to read", { watermark: WATERMARK }],
    ["a non-string body", { body: 5, watermark: WATERMARK }],
    ["a non-boolean stale", { body: "prose", watermark: WATERMARK, stale: "yes" }],
  ])("reads %s as no digest — the ordinary state, not a fault", (_label, value) => {
    expect(storedDigest(value)).toBeNull();
  });

  it("round-trips through `digestToStored`, all three keys written out", () => {
    const stored = digestToStored(DIGEST);
    expect(stored).toEqual({ body: DIGEST.body, watermark: WATERMARK, stale: false });
    expect(storedDigest(stored)).toEqual(DIGEST);
  });
});

describe("digestCovers", () => {
  it("covers a turn before the watermark and the watermark's own turn", () => {
    expect(digestCovers(DIGEST, "2026-09-05T09:59:59Z")).toBe(true);
    expect(digestCovers(DIGEST, WATERMARK)).toBe(true);
  });

  it("does not cover a turn after the watermark — that is uncovered, not stale", () => {
    expect(digestCovers(DIGEST, "2026-09-05T10:00:01Z")).toBe(false);
  });

  it("compares instants rather than strings, so two spellings of one moment agree", () => {
    expect(digestCovers(DIGEST, "2026-09-05T12:00:00+02:00")).toBe(true);
  });

  it("covers nothing when the `ts` names no moment", () => {
    expect(digestCovers(DIGEST, "whenever")).toBe(false);
  });
});

describe("markedStale", () => {
  it("records staleness without touching the prose or the coverage", () => {
    expect(markedStale(DIGEST)).toEqual({ ...DIGEST, stale: true });
  });

  it("returns the same object when it already says so", () => {
    const already = { ...DIGEST, stale: true };
    expect(markedStale(already)).toBe(already);
  });
});

describe("stalenessPatch", () => {
  it("writes the flag and nothing else when a covered turn changed", () => {
    expect(stalenessPatch(DIGEST, true)).toEqual({
      digest: { body: DIGEST.body, watermark: WATERMARK, stale: true },
    });
  });

  it.each([
    ["there is no digest", null, true],
    ["nothing covered changed", DIGEST, false],
    ["it already says so", { ...DIGEST, stale: true }, true],
  ])("writes nothing when %s", (_label, digest, affected) => {
    expect(stalenessPatch(digest, affected)).toEqual({});
  });
});

describe("coveredTurnsChanged", () => {
  const BEFORE = turnsBody(
    ["user", "2026-09-05T09:00:00Z", "What is the rate?"],
    ["agent", WATERMARK, "Six point one."],
    ["user", "2026-09-05T11:00:00Z", "Thanks."],
  );

  it("is true when a covered turn was deleted", () => {
    const after = turnsBody(
      ["agent", WATERMARK, "Six point one."],
      ["user", "2026-09-05T11:00:00Z", "Thanks."],
    );
    expect(coveredTurnsChanged(DIGEST, BEFORE, after)).toBe(true);
  });

  it("is true when a covered turn's body was revised in place", () => {
    const after = BEFORE.replace("Six point one.", "Six point four.");
    expect(coveredTurnsChanged(DIGEST, BEFORE, after)).toBe(true);
  });

  it("is true when a covered turn changed author", () => {
    const after = BEFORE.replace(`## agent · ${WATERMARK}`, `## user · ${WATERMARK}`);
    expect(coveredTurnsChanged(DIGEST, BEFORE, after)).toBe(true);
  });

  it("is false when the turn that changed is after the watermark", () => {
    const after = BEFORE.replace("Thanks.", "Thanks, that settles it.");
    expect(coveredTurnsChanged(DIGEST, BEFORE, after)).toBe(false);
  });

  it("is false when a turn was appended after the watermark — uncovered is not stale", () => {
    const after = `${BEFORE}\n## user · 2026-09-05T12:00:00Z\n\nOne more thing.\n`;
    expect(coveredTurnsChanged(DIGEST, BEFORE, after)).toBe(false);
  });

  it("is false when only the thread's preamble changed", () => {
    expect(coveredTurnsChanged(DIGEST, `Intro.\n\n${BEFORE}`, `Rewritten.\n\n${BEFORE}`)).toBe(
      false,
    );
  });

  it("is false when the digest covers nothing that was in the old body", () => {
    const early = { ...DIGEST, watermark: "2026-09-01T00:00:00Z" };
    expect(coveredTurnsChanged(early, BEFORE, "")).toBe(false);
  });
});

describe("bodyEditStalenessPatch", () => {
  const BEFORE = turnsBody(["agent", WATERMARK, "Six point one."]);

  it("marks a live digest stale when the edit removed a turn it covers", () => {
    expect(bodyEditStalenessPatch({ digest: digestToStored(DIGEST) }, BEFORE, "")).toEqual({
      digest: { body: DIGEST.body, watermark: WATERMARK, stale: true },
    });
  });

  it("writes nothing for a document with no digest, without parsing either body", () => {
    expect(bodyEditStalenessPatch({ title: "A note" }, BEFORE, "")).toEqual({});
  });

  it("writes nothing for a digest that already says it is stale", () => {
    const stale = digestToStored({ ...DIGEST, stale: true });
    expect(bodyEditStalenessPatch({ digest: stale }, BEFORE, "")).toEqual({});
  });
});
