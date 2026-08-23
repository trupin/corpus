import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EMPTY_REFLECT_STATE,
  REFLECT_FILE,
  advanceClock,
  readReflectState,
  recordAwaitingDigest,
  writeReflectState,
} from "./clock.js";

const EVENT = "evt_0123456789ab";
const OTHER_EVENT = "evt_ba9876543210";
const DIGEST = "th_aaaabbbb";
const OTHER_DIGEST = "th_ccccdddd";

describe("the reflection clock file (SPEC.md §7)", () => {
  let corpusDir: string;

  beforeEach(() => {
    corpusDir = mkdtempSync(join(tmpdir(), "corpus-s137-clock-"));
  });

  afterEach(() => {
    rmSync(corpusDir, { recursive: true, force: true });
  });

  const raw = (): string => readFileSync(join(corpusDir, REFLECT_FILE), "utf8");
  const corrupt = (text: string): void => {
    writeFileSync(join(corpusDir, REFLECT_FILE), text, "utf8");
  };

  it("reads a corpus that has never been reflected on as empty", () => {
    expect(readReflectState(corpusDir)).toEqual(EMPTY_REFLECT_STATE);
  });

  it("round-trips what it wrote, as JSON a person can read", () => {
    writeReflectState(corpusDir, {
      reflected: "2026-08-22T09:00:00Z",
      digest: DIGEST,
      awaitingDigest: null,
    });

    expect(readReflectState(corpusDir)).toEqual({
      reflected: "2026-08-22T09:00:00Z",
      digest: DIGEST,
      awaitingDigest: null,
    });
    expect(raw().endsWith("\n")).toBe(true);
    expect(raw()).toContain('  "reflected"');
  });

  // The `seen.json` call, for the same reason: this is derived comfort, and a
  // board that refused to load over a stray brace would be a far worse answer
  // than one that reflects over a window wider than it needed to be.
  it("reads anything unparseable as never reflected rather than failing", () => {
    corrupt("{ truncated");
    expect(readReflectState(corpusDir)).toEqual(EMPTY_REFLECT_STATE);

    corrupt("[]");
    expect(readReflectState(corpusDir)).toEqual(EMPTY_REFLECT_STATE);
  });

  it("validates each field on its own, so one bad entry does not cost the others", () => {
    corrupt(
      JSON.stringify({
        reflected: "2026-08-22T09:00:00Z",
        digest: "not-a-thread-id",
        awaitingDigest: { eventId: EVENT, threadId: 17 },
      }),
    );

    expect(readReflectState(corpusDir)).toEqual({
      reflected: "2026-08-22T09:00:00Z",
      digest: null,
      awaitingDigest: null,
    });
  });

  it("reads an unparseable instant as no clock at all", () => {
    corrupt(JSON.stringify({ reflected: "sometime last week" }));
    expect(readReflectState(corpusDir).reflected).toBeNull();
  });

  describe("advanceClock", () => {
    it("moves the clock to the processed event's `created`", () => {
      const outcome = advanceClock(corpusDir, EVENT, "2026-08-22T09:00:00Z");

      expect(outcome.moved).toBe(true);
      expect(readReflectState(corpusDir).reflected).toBe("2026-08-22T09:00:00Z");
    });

    it("promotes the digest the same event posted", () => {
      recordAwaitingDigest(corpusDir, EVENT, DIGEST);

      advanceClock(corpusDir, EVENT, "2026-08-22T09:00:00Z");

      expect(readReflectState(corpusDir)).toEqual({
        reflected: "2026-08-22T09:00:00Z",
        digest: DIGEST,
        awaitingDigest: null,
      });
    });

    // `lastDigest` is "the most recent digest there is", so a reflection that
    // posted none must not blank the link to the one before it.
    it("keeps the previous digest when this reflection posted none", () => {
      recordAwaitingDigest(corpusDir, EVENT, DIGEST);
      advanceClock(corpusDir, EVENT, "2026-08-22T09:00:00Z");

      advanceClock(corpusDir, OTHER_EVENT, "2026-08-22T10:00:00Z");

      expect(readReflectState(corpusDir)).toEqual({
        reflected: "2026-08-22T10:00:00Z",
        digest: DIGEST,
        awaitingDigest: null,
      });
    });

    it("leaves another event's awaiting digest awaiting", () => {
      recordAwaitingDigest(corpusDir, OTHER_EVENT, OTHER_DIGEST);

      advanceClock(corpusDir, EVENT, "2026-08-22T09:00:00Z");

      expect(readReflectState(corpusDir).digest).toBeNull();
      expect(readReflectState(corpusDir).awaitingDigest).toEqual({
        eventId: OTHER_EVENT,
        threadId: OTHER_DIGEST,
      });
    });

    /**
     * The one way the clock could run backwards, and the reason it is
     * forward-only rather than a literal write of whatever landed last.
     *
     * A reflection that failed keeps its window; a person asks for another,
     * which is processed; then somebody runs `corpus job retry` on the old one.
     * Winding the clock back to the older `created` would re-mark every document
     * changed in between as unreflected.
     */
    it("refuses to wind back for a retried older reflection", () => {
      advanceClock(corpusDir, OTHER_EVENT, "2026-08-22T10:00:00Z");

      const outcome = advanceClock(corpusDir, EVENT, "2026-08-22T09:00:00Z");

      expect(outcome.moved).toBe(false);
      expect(readReflectState(corpusDir).reflected).toBe("2026-08-22T10:00:00Z");
    });

    it("writes nothing for an event whose `created` does not parse", () => {
      const outcome = advanceClock(corpusDir, EVENT, "whenever");

      expect(outcome.moved).toBe(false);
      expect(readReflectState(corpusDir)).toEqual(EMPTY_REFLECT_STATE);
    });
  });

  // Only one reflection is ever live, so the last standalone thread a job posts
  // is its digest and an earlier one was not.
  it("keeps the last thread a reflection posted, not the first", () => {
    recordAwaitingDigest(corpusDir, EVENT, OTHER_DIGEST);
    recordAwaitingDigest(corpusDir, EVENT, DIGEST);

    expect(readReflectState(corpusDir).awaitingDigest).toEqual({
      eventId: EVENT,
      threadId: DIGEST,
    });
  });

  it("does not lose the clock when a digest is recorded during the next reflection", () => {
    advanceClock(corpusDir, OTHER_EVENT, "2026-08-22T09:00:00Z");

    recordAwaitingDigest(corpusDir, EVENT, DIGEST);

    expect(readReflectState(corpusDir).reflected).toBe("2026-08-22T09:00:00Z");
  });
});
