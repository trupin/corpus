import { describe, expect, it } from "vitest";
import {
  THREAD_REOPENED_NOTICE,
  THREAD_RESOLVED_NOTICE,
  threadStatusNotice,
} from "./resolveNotice.js";

/**
 * The wording, pinned once (UI-078).
 *
 * This file asserts the *strings*; `scripts/resolve-notice-promise.test.ts`
 * asserts the claim one of them makes against `decideParticipation`, the server
 * function that actually decides what a person's reply does to a resolved
 * thread. Both have to move together, which is the point: the sentence was
 * false for as long as nothing connected it to a write path.
 */
describe("the resolve/reopen confirmations", () => {
  it("says the thread is resolved, that it is committed, and that replying reopens it", () => {
    expect(THREAD_RESOLVED_NOTICE).toBe("Thread resolved — committed. Replying reopens it.");
  });

  it("says the thread is reopened and committed", () => {
    expect(THREAD_REOPENED_NOTICE).toBe("Thread reopened — committed.");
  });

  it("reports the direction that was sent", () => {
    expect(threadStatusNotice(true)).toBe(THREAD_RESOLVED_NOTICE);
    expect(threadStatusNotice(false)).toBe(THREAD_REOPENED_NOTICE);
  });

  it("claims committed in both directions — SPEC.md §11, the write landed on disk", () => {
    expect(THREAD_RESOLVED_NOTICE).toContain("committed");
    expect(THREAD_REOPENED_NOTICE).toContain("committed");
  });

  /*
   * The resolve notice deliberately stops after the reopen (see the module
   * header): §8's enqueue matrix is the composer toggle's business, not this
   * toast's. Nothing here forbids revisiting that — but it should be a decision,
   * not a paragraph that grew.
   */
  it("stays one glanceable line", () => {
    expect(THREAD_RESOLVED_NOTICE.split(". ")).toHaveLength(2);
    expect(THREAD_RESOLVED_NOTICE.length).toBeLessThan(60);
  });
});
