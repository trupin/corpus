import { describe, expect, it } from "vitest";
import {
  DEFAULT_REFLECT_QUIET_MINUTES,
  isUnreflected,
  ReflectAskResultSchema,
  ReflectStatusSchema,
  WORKSPACE_REFLECT_EVENT_TYPE,
  WorkspaceReflectPayloadSchema,
} from "./reflect.js";

describe("WorkspaceReflectPayload", () => {
  it("carries one timestamp and nothing else", () => {
    const payload = { since: "2026-08-22T09:00:00Z" };
    expect(WorkspaceReflectPayloadSchema.parse(payload)).toEqual(payload);
  });

  /** `since: null` means everything: the agent's gather runs with no `--since`. */
  it("carries a null window for a corpus never reflected on", () => {
    expect(WorkspaceReflectPayloadSchema.parse({ since: null }).since).toBeNull();
  });

  it("requires the key to be present, so absent and never are not confusable", () => {
    expect(WorkspaceReflectPayloadSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a malformed instant — nullable is not lenient", () => {
    expect(WorkspaceReflectPayloadSchema.safeParse({ since: "yesterday" }).success).toBe(false);
  });

  it("is the event type SPEC.md §7 names", () => {
    expect(WORKSPACE_REFLECT_EVENT_TYPE).toBe("workspace.reflect");
  });
});

describe("ReflectAskResult", () => {
  it("answers a fresh ask with the event it enqueued", () => {
    const result = { eventId: "evt_7c1d", since: "2026-08-22T09:00:00Z", pending: false };
    expect(ReflectAskResultSchema.parse(result)).toEqual(result);
  });

  /**
   * §7: an ask while one is pending is answered with the pending one, never
   * doubled and never refused. `pending` is what lets a client say "already
   * asked" without holding an id to compare against.
   */
  it("answers a second ask with the pending reflection, flagged", () => {
    const result = { eventId: "evt_7c1d", since: null, pending: true };
    expect(ReflectAskResultSchema.parse(result)).toEqual(result);
  });

  it("rejects an event id that is not one", () => {
    expect(
      ReflectAskResultSchema.safeParse({ eventId: "doc_a1b2c3", since: null, pending: false })
        .success,
    ).toBe(false);
  });
});

describe("ReflectStatus", () => {
  const status = {
    reflected: "2026-08-22T09:00:00Z",
    pending: null,
    changed: 3,
    lastDigest: "th_x9y8",
    quiet: DEFAULT_REFLECT_QUIET_MINUTES,
  };

  it("round-trips the clock as the board bar reads it", () => {
    expect(ReflectStatusSchema.parse(status)).toEqual(status);
  });

  /** A corpus nobody has reflected on yet: no clock, no digest, nothing pending. */
  it("round-trips a corpus never reflected on", () => {
    const fresh = { ...status, reflected: null, lastDigest: null, changed: 0 };
    expect(ReflectStatusSchema.parse(fresh)).toEqual(fresh);
  });

  it("carries the pending reflection's id while one is in flight", () => {
    expect(ReflectStatusSchema.parse({ ...status, pending: "evt_7c1d" }).pending).toBe("evt_7c1d");
  });

  it("refuses a negative count: `changed` is arithmetic, and 0 always means none", () => {
    expect(ReflectStatusSchema.safeParse({ ...status, changed: -1 }).success).toBe(false);
  });

  it("accepts `quiet: 0`, which disables the automatic path rather than meaning `never`", () => {
    expect(ReflectStatusSchema.parse({ ...status, quiet: 0 }).quiet).toBe(0);
  });

  it("defaults the window to §7's thirty minutes", () => {
    expect(DEFAULT_REFLECT_QUIET_MINUTES).toBe(30);
  });

  it("rejects a digest that is not a thread id, since a digest is a standalone thread", () => {
    expect(ReflectStatusSchema.safeParse({ ...status, lastDigest: "doc_a1b2c3" }).success).toBe(
      false,
    );
  });
});

/**
 * The predicate both consumers apply: `changed` counts the set server-side, the
 * board marks each row in it. Shipped once so the count and the marks cannot
 * disagree, which is the whole reason it is a function and not two paragraphs.
 */
describe("isUnreflected", () => {
  const CLOCK = "2026-08-22T09:00:00Z";
  const row = {
    updated: "2026-08-22T10:00:00Z",
    lastActor: "user" as const,
    status: "open" as const,
  };

  it("marks a person's write made after the clock", () => {
    expect(isUnreflected(row, CLOCK)).toBe(true);
  });

  it("leaves a write made before the clock alone", () => {
    expect(isUnreflected({ ...row, updated: "2026-08-22T08:00:00Z" }, CLOCK)).toBe(false);
  });

  /** Strictly after: a document written at the instant of the reflection is in it. */
  it("treats a write at exactly the clock as reflected", () => {
    expect(isUnreflected({ ...row, updated: CLOCK }, CLOCK)).toBe(false);
  });

  /**
   * §7's amendment, signed 2026-08-22: what a reflection produces is its own
   * output, not new work for it.
   */
  it("never marks the agent's own write, however recent", () => {
    expect(isUnreflected({ ...row, lastActor: "agent" }, CLOCK)).toBe(false);
  });

  /**
   * PR #56's review: an archived document shows on no board, so a mark for it is
   * impossible; the agent's gather sees archives with `--include-archived`.
   */
  it("never marks an archived document, whoever wrote it", () => {
    expect(isUnreflected({ ...row, status: "archived" }, CLOCK)).toBe(false);
  });

  it("still marks a resolved document, which is settled but visible", () => {
    expect(isUnreflected({ ...row, status: "resolved" }, CLOCK)).toBe(true);
  });

  /** With no clock yet, everything a person wrote and did not archive counts. */
  it("marks everything else when the corpus has never been reflected on", () => {
    expect(isUnreflected(row, null)).toBe(true);
    expect(isUnreflected({ ...row, lastActor: "agent" }, null)).toBe(false);
    expect(isUnreflected({ ...row, status: "archived" }, null)).toBe(false);
  });

  /**
   * A hand-written `SKILL.md` carries no timestamps, and the staleness ramp
   * already reads an unknown age as fresh rather than ancient. Marking it would
   * put a mark on every board that never cleared.
   */
  it("does not mark a document whose age is unknown", () => {
    expect(isUnreflected({ ...row, updated: null }, CLOCK)).toBe(false);
    expect(isUnreflected({ ...row, updated: null }, null)).toBe(false);
  });

  it("does not mark on an unparseable instant either", () => {
    expect(isUnreflected({ ...row, updated: "yesterday" }, CLOCK)).toBe(false);
    expect(isUnreflected(row, "whenever")).toBe(false);
  });
});
