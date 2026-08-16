import { describe, expect, it } from "vitest";
import { CaptureRequestSchema } from "./capture.js";
import { FormAnswerRequestSchema } from "./form.js";
import { ORCHESTRATOR_LANE, LaneSchema, laneScopeParam, recipientField } from "./lane.js";
import { ClaimScopeQuerySchema, IdleQuerySchema } from "./queue.js";
import {
  AppendTurnRequestSchema,
  CreateThreadRequestSchema,
  MultipartAppendTurnRequestSchema,
  MultipartCreateThreadRequestSchema,
} from "./thread.js";

const THREAD_LANE = "th_x9y8";

describe("Lane — the two things that name a lane", () => {
  it.each([ORCHESTRATOR_LANE, THREAD_LANE, "th_ABC123"])("accepts %s", (lane) => {
    expect(LaneSchema.parse(lane)).toBe(lane);
  });

  it.each([
    ["doc_a1b2c3", "a document id — a document is not a conversation"],
    ["evt_7c1d", "an event id — that is a job, not a lane"],
    ["anc_k4f7", "an anchor id"],
    ["Orchestrator", "the literal is exact, so case is not a second spelling"],
    ["", "the empty string, which is not absence"],
    ["th_", "a bare prefix"],
  ])("refuses %s (%s)", (value) => {
    expect(LaneSchema.safeParse(value).success).toBe(false);
  });

  /**
   * The literal is not `null`, and this is the property that keeps "no scope"
   * from colliding with "the orchestrator's scope" (SPEC.md §7 — the
   * orchestrator's lane is a lane like any other).
   */
  it("does not admit null, which would be a second spelling of the orchestrator", () => {
    expect(LaneSchema.safeParse(null).success).toBe(false);
  });
});

describe("recipient — where a message is addressed", () => {
  it("is optional, because the default is computed from where the message is posted", () => {
    expect(recipientField.parse(undefined)).toBeUndefined();
  });

  it.each([ORCHESTRATOR_LANE, THREAD_LANE])("carries the stated lane %s through", (lane) => {
    expect(recipientField.parse(lane)).toBe(lane);
  });

  /**
   * There is one spelling of "no recipient" — the absent key. A `null` would be
   * a second, and a server reading two of them eventually treats one as a value
   * (the rule `./weight.ts` sets for the same class of field).
   */
  it("is not nullable, so absence has exactly one spelling", () => {
    expect(recipientField.safeParse(null).success).toBe(false);
  });

  it("refuses a document id, which would address a passage rather than a conversation", () => {
    expect(recipientField.safeParse("doc_a1b2c3").success).toBe(false);
  });

  /** A `default` on a request field would force every typed caller to send it. */
  it("carries no default", () => {
    expect(recipientField.safeParse({}).success).toBe(false);
    expect(recipientField.parse(undefined)).toBeUndefined();
  });
});

describe("scope — which lane a queue verb consumes", () => {
  it("is optional, and omitting it means the orchestrator's lane", () => {
    expect(laneScopeParam.parse(undefined)).toBeUndefined();
  });

  it.each([ORCHESTRATOR_LANE, THREAD_LANE])("accepts %s", (scope) => {
    expect(laneScopeParam.parse(scope)).toBe(scope);
  });

  it("refuses anything that is not a lane, rather than falling back to the orchestrator", () => {
    // Falling back would make a typo park an agent on somebody else's work.
    expect(laneScopeParam.safeParse("doc_a1b2c3").success).toBe(false);
    expect(laneScopeParam.safeParse("th_x9y8 ").success).toBe(false);
  });

  /**
   * `recipient` and `scope` are the same vocabulary read from two directions —
   * a message names the lane it is for, a claim names the lane it consumes —
   * so a roster row's `lane` is directly usable as either.
   */
  it("shares its vocabulary with `recipient`, so a roster row is usable as both", () => {
    for (const lane of [ORCHESTRATOR_LANE, THREAD_LANE]) {
      expect(laneScopeParam.safeParse(lane).success).toBe(true);
      expect(recipientField.safeParse(lane).success).toBe(true);
    }
  });
});

describe("`recipient` on the posting surface", () => {
  /**
   * §7 gives *every message* a recipient, so the field is listed one by one
   * rather than looped over a registry: a shape that quietly loses it fails
   * here instead of being silently skipped (the rule `provenance.test.ts` set
   * for `job`, on the same three routes).
   */
  it("is accepted on every posting shape the rider names", () => {
    expect(
      CreateThreadRequestSchema.parse({ body: "First turn.", recipient: THREAD_LANE }).recipient,
    ).toBe(THREAD_LANE);
    expect(
      AppendTurnRequestSchema.parse({ body: "Reply.", recipient: THREAD_LANE }).recipient,
    ).toBe(THREAD_LANE);
    expect(
      FormAnswerRequestSchema.parse({ answers: [], recipient: ORCHESTRATOR_LANE }).recipient,
    ).toBe(ORCHESTRATOR_LANE);
  });

  /**
   * The multipart twins are hand-maintained beside their JSON forms, so a field
   * added to one and not the other is the standing failure mode here.
   */
  it("travels on the multipart twins too", () => {
    for (const schema of [CreateThreadRequestSchema, MultipartCreateThreadRequestSchema]) {
      expect("recipient" in schema.shape).toBe(true);
    }
    for (const schema of [AppendTurnRequestSchema, MultipartAppendTurnRequestSchema]) {
      expect("recipient" in schema.shape).toBe(true);
    }
    expect(
      MultipartAppendTurnRequestSchema.parse({
        text: "Reply.",
        recipient: THREAD_LANE,
        files: [],
      }).recipient,
    ).toBe(THREAD_LANE);
  });

  it("is omittable on every one of them, because the default is computed", () => {
    expect(CreateThreadRequestSchema.parse({ body: "First turn." }).recipient).toBeUndefined();
    expect(AppendTurnRequestSchema.parse({ body: "Reply." }).recipient).toBeUndefined();
    expect(FormAnswerRequestSchema.parse({ answers: [] }).recipient).toBeUndefined();
  });

  /**
   * Capture creates a standalone thread, which is in no scope by construction,
   * so it addresses the orchestrator by the ordinary default rule and needs no
   * override. Pinned so the omission reads as a decision rather than a gap.
   */
  it("is deliberately absent from capture, which is in no scope by construction", () => {
    expect("recipient" in CaptureRequestSchema.shape).toBe(false);
    expect(
      CaptureRequestSchema.safeParse({ text: "note", files: [], recipient: THREAD_LANE }).success,
    ).toBe(false);
  });
});

describe("`scope` on the queue verbs", () => {
  it("reads the lane off both verbs' query, spelled the same way", () => {
    expect(IdleQuerySchema.parse({ scope: THREAD_LANE }).scope).toBe(THREAD_LANE);
    expect(ClaimScopeQuerySchema.parse({ scope: THREAD_LANE }).scope).toBe(THREAD_LANE);
  });

  /** Backward compatible: a caller written before lanes existed still parks. */
  it("leaves an omitted scope absent on both, which the server reads as the orchestrator", () => {
    expect(IdleQuerySchema.parse({}).scope).toBeUndefined();
    expect(ClaimScopeQuerySchema.parse({}).scope).toBeUndefined();
  });

  it("keeps the idle timeout working beside it", () => {
    const parsed = IdleQuerySchema.parse({ scope: ORCHESTRATOR_LANE, timeout: "30" });
    expect(parsed).toEqual({ scope: ORCHESTRATOR_LANE, timeout: 30 });
  });

  it("refuses a scope that names no lane on both verbs", () => {
    expect(IdleQuerySchema.safeParse({ scope: "doc_a1b2c3" }).success).toBe(false);
    expect(ClaimScopeQuerySchema.safeParse({ scope: "doc_a1b2c3" }).success).toBe(false);
  });
});
