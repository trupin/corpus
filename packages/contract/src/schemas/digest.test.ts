import { describe, expect, it } from "vitest";
import {
  DIGEST_MAX_CHARS,
  ThreadDigestResponseSchema,
  ThreadDigestSchema,
  WriteDigestRequestSchema,
  digestField,
} from "./digest.js";

const digest = {
  body: "The user doubts the 6.1% assumption; the agent quoted 6.4% from current averages.",
  watermark: "2026-07-19T10:07:12Z",
  stale: false,
};

/** `n` characters of prose, so a length assertion reads as a length rather than as content. */
const chars = (n: number): string => "x".repeat(n);

describe("ThreadDigest", () => {
  it("round-trips the three fields a digest is", () => {
    expect(ThreadDigestSchema.parse(digest)).toEqual(digest);
  });

  /**
   * SPEC.md §6's rider: *"a stale digest is shown as stale wherever it is
   * shown"*. That is guaranteed by the shape rather than by discipline — the
   * flag is inside the object, so no surface can carry the prose without it.
   */
  it.each(["body", "watermark", "stale"] as const)("requires %s", (field) => {
    const { [field]: _dropped, ...missing } = digest;
    expect(ThreadDigestSchema.safeParse(missing).success).toBe(false);
  });

  it("keeps the watermark an instant, since it is a turn's identity", () => {
    expect(ThreadDigestSchema.safeParse({ ...digest, watermark: "yesterday" }).success).toBe(false);
    expect(ThreadDigestSchema.safeParse({ ...digest, watermark: 1_752_921_600 }).success).toBe(
      false,
    );
  });

  /**
   * The read side publishes **no** ceiling, and that is a decision rather than
   * an oversight (CONTRACT-096). The only repair available for an over-long
   * stored digest is truncation, and the rider forbids the server to edit a
   * digest at all — so a bound here would either be violated on the wire or
   * force the server to break a signed sentence. The bound lives on the write.
   */
  it("reads a digest longer than the write bound rather than refusing it", () => {
    const long = { ...digest, body: chars(DIGEST_MAX_CHARS + 500) };
    expect(ThreadDigestSchema.parse(long).body).toHaveLength(DIGEST_MAX_CHARS + 500);
  });
});

describe("the digest as a field", () => {
  it("reads null as the ordinary state and an object as a digest", () => {
    expect(digestField.parse(null)).toBeNull();
    expect(digestField.parse(digest)).toEqual(digest);
  });

  it("refuses anything that is neither", () => {
    expect(digestField.safeParse(undefined).success).toBe(false);
    expect(digestField.safeParse("no digest").success).toBe(false);
    expect(digestField.safeParse({}).success).toBe(false);
  });
});

describe("WriteDigestRequest", () => {
  it("takes prose and nothing else", () => {
    expect(WriteDigestRequestSchema.parse({ body: "A short account." })).toEqual({
      body: "A short account.",
    });
  });

  /**
   * The refusal that matters most, because it is the mistake a writer is most
   * likely to make: stating its own coverage. The server stamps the watermark,
   * and a strict body turns the attempt into a `400` naming the key instead of a
   * value that is silently ignored.
   */
  it("refuses a watermark by name, which is the whole reason the body is strict", () => {
    const refused = WriteDigestRequestSchema.safeParse({
      body: "A short account.",
      watermark: "2026-07-19T10:07:12Z",
    });
    expect(refused.success).toBe(false);
    expect(JSON.stringify(refused.error?.issues)).toContain("watermark");
  });

  it("refuses `stale` too, since staleness is recorded and never claimed", () => {
    expect(
      WriteDigestRequestSchema.safeParse({ body: "A short account.", stale: false }).success,
    ).toBe(false);
  });

  it(`bounds the body at ${DIGEST_MAX_CHARS} characters, and accepts exactly that many`, () => {
    expect(WriteDigestRequestSchema.safeParse({ body: chars(DIGEST_MAX_CHARS) }).success).toBe(
      true,
    );
    expect(WriteDigestRequestSchema.safeParse({ body: chars(DIGEST_MAX_CHARS + 1) }).success).toBe(
      false,
    );
  });

  /**
   * **Deliberately parseable.** An empty body is refused by the route with a
   * `422` — an empty `PUT` is not a clear, and clearing has its own verb — and a
   * `.min(1)` here would quietly move that refusal to the `400` that tells a
   * caller to fix its body and retry. For a caller that meant to clear, that is
   * a loop. The parse boundary must therefore let the empty string through so
   * the route can refuse it with the status that names the real remedy.
   */
  it("parses a blank body, leaving the refusal to the route that can explain it", () => {
    expect(WriteDigestRequestSchema.safeParse({ body: "" }).success).toBe(true);
    expect(WriteDigestRequestSchema.safeParse({ body: "   " }).success).toBe(true);
  });
});

describe("ThreadDigestResponse", () => {
  it("carries the stamped digest, the thread and §11's warnings", () => {
    const response = { threadId: "th_x9y8", digest, warnings: [] };
    expect(ThreadDigestResponseSchema.parse(response)).toEqual(response);
  });

  it("carries a null digest, which is what a clear leaves behind", () => {
    const cleared = { threadId: "th_x9y8", digest: null, warnings: [] };
    expect(ThreadDigestResponseSchema.parse(cleared)).toEqual(cleared);
  });

  it("carries a rejected auto-commit, the way every thread mutation does", () => {
    const warned = {
      threadId: "th_x9y8",
      digest,
      warnings: [{ code: "commit_failed", detail: "hook rejected the write" }],
    };
    expect(ThreadDigestResponseSchema.parse(warned).warnings).toHaveLength(1);
  });
});
