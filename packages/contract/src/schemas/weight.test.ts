import { describe, expect, it } from "vitest";
import { CaptureRequestSchema } from "./capture.js";
import { DocEditedPayloadSchema } from "./edit.js";
import { FormRespondPayloadSchema } from "./form.js";
import {
  AppendTurnRequestSchema,
  CreateThreadRequestSchema,
  MultipartAppendTurnRequestSchema,
  MultipartCreateThreadRequestSchema,
} from "./thread.js";
import {
  REQUESTED_WEIGHT_MAX_LENGTH,
  REQUESTED_WEIGHT_PAYLOAD_KEY,
  RequestedWeightSchema,
  readRequestedWeight,
  requestedWeightField,
  requestedWeightPayload,
} from "./weight.js";

describe("RequestedWeightSchema", () => {
  /**
   * The rider's Decision 1, as a test. A workspace's guidance names its own
   * levels and may rename them at any time (§2.4), so anything shaped like a
   * short label is a legal weight — including levels no shipped table has ever
   * carried, and names in another language.
   */
  it("takes any level name the workspace's guidance might use, never an enumerated set", () => {
    for (const level of [
      "Small and mechanical",
      "Standard",
      "Heavy or judgment-laden",
      "quick",
      "deep",
      "exhaustive", // a fourth level a workspace added
      "réfléchi", // a workspace writing in its own language
      "tier-2",
    ]) {
      expect(RequestedWeightSchema.safeParse(level).success, level).toBe(true);
    }
  });

  it("refuses a blank name, so an empty string can never stand in for absence", () => {
    for (const blank of ["", " ", "\t", "  \t "]) {
      expect(RequestedWeightSchema.safeParse(blank).success, JSON.stringify(blank)).toBe(false);
    }
  });

  it("refuses a newline: the value is echoed into a line-oriented job log", () => {
    expect(RequestedWeightSchema.safeParse("deep\nquick").success).toBe(false);
    expect(RequestedWeightSchema.safeParse("deep\r\ndispatched at: opus").success).toBe(false);
  });

  it("is bounded, so a composer's picker cannot grow a queue event without limit", () => {
    expect(RequestedWeightSchema.safeParse("w".repeat(REQUESTED_WEIGHT_MAX_LENGTH)).success).toBe(
      true,
    );
    expect(
      RequestedWeightSchema.safeParse("w".repeat(REQUESTED_WEIGHT_MAX_LENGTH + 1)).success,
    ).toBe(false);
  });

  it("refuses a non-string, which is what a client sending a tier number would send", () => {
    for (const value of [2, null, true, ["deep"], { level: "deep" }]) {
      expect(RequestedWeightSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
    }
  });
});

/**
 * §10 states the control once for the whole set of composers rather than per
 * surface — SHARED-012's lesson, and the reason three of five composers once
 * shipped without attachments. So the enumeration lives here, in the test, and
 * every request body a composer sends is checked against the same three rules.
 */
describe("the request field, on every composer's request body", () => {
  const requests = [
    ["CreateThreadRequest", CreateThreadRequestSchema, { body: "Is 6.1% still right?" }],
    [
      "MultipartCreateThreadRequest",
      MultipartCreateThreadRequestSchema,
      { text: "Is 6.1% still right?", files: [] },
    ],
    ["AppendTurnRequest", AppendTurnRequestSchema, { body: "Still right?" }],
    ["MultipartAppendTurnRequest", MultipartAppendTurnRequestSchema, { text: "Still?", files: [] }],
    ["CaptureRequest", CaptureRequestSchema, { text: "Rates moved again.", files: [] }],
  ] as const;

  it.each(requests)("%s carries a stated weight, verbatim", (_name, schema, base) => {
    const result = schema.safeParse({ ...base, weight: "Heavy or judgment-laden" });
    expect(result.success).toBe(true);
    expect(result.data?.weight).toBe("Heavy or judgment-laden");
  });

  /**
   * The premise of the whole feature: "Choosing nothing is the ordinary case and
   * means the agent decides" (§10). Absence must survive parsing as absence —
   * not as a level, not as `null`.
   */
  it.each(requests)("%s leaves it absent when nothing was chosen", (_name, schema, base) => {
    const result = schema.safeParse(base);
    expect(result.success).toBe(true);
    expect(result.data?.weight).toBeUndefined();
    expect(Object.hasOwn(result.data ?? {}, "weight")).toBe(false);
  });

  it.each(requests)("%s refuses a blank, multi-line or null weight", (_name, schema, base) => {
    expect(schema.safeParse({ ...base, weight: "" }).success).toBe(false);
    expect(schema.safeParse({ ...base, weight: " " }).success).toBe(false);
    expect(schema.safeParse({ ...base, weight: "deep\nquick" }).success).toBe(false);
    expect(schema.safeParse({ ...base, weight: null }).success).toBe(false);
  });

  /**
   * A weight is not a trigger. §8 alone decides what reaches the agent, and
   * §10 is explicit that choosing a weight "neither asks the agent nor stops it
   * being asked" — so a weight beside an explicit `requestsAgent: false` is a
   * valid request that simply governs no work, never a `400`.
   */
  it("accepts a weight beside an explicit note-only turn", () => {
    const result = AppendTurnRequestSchema.safeParse({
      body: "Noting this for later.",
      requestsAgent: false,
      weight: "quick",
    });
    expect(result.success).toBe(true);
    expect(result.data?.requestsAgent).toBe(false);
    expect(result.data?.weight).toBe("quick");
  });

  it("does not confuse the weight with the model that wrote the turn", () => {
    const result = AppendTurnRequestSchema.safeParse({
      body: "Checked.",
      model: "claude-opus-4-1",
      weight: "deep",
    });
    expect(result.success).toBe(true);
    expect(result.data?.model).toBe("claude-opus-4-1");
    expect(result.data?.weight).toBe("deep");
  });

  it("is the same field on every body — one description, stated once", () => {
    const description = requestedWeightField.description;
    expect(description).toContain("directive, not a hint");
    expect(description).toContain("never silently substituted");
    expect(description).toContain("the orchestrator decides");
  });
});

describe("requestedWeightPayload", () => {
  it("puts a stated weight on the payload under the documented key", () => {
    expect(requestedWeightPayload("deep")).toEqual({ [REQUESTED_WEIGHT_PAYLOAD_KEY]: "deep" });
  });

  /**
   * Absent stays absent, structurally. Not `{weight: undefined}` — which
   * `Object.hasOwn` still sees, and which a nullable column or a JSON round trip
   * turns into a `null` that reads as a second spelling of "no choice".
   */
  it("contributes no key at all when no weight was stated", () => {
    const fragment = requestedWeightPayload(undefined);
    expect(fragment).toEqual({});
    expect(Object.hasOwn(fragment, REQUESTED_WEIGHT_PAYLOAD_KEY)).toBe(false);
    expect(JSON.stringify({ threadId: "th_x9y8", ...fragment })).toBe('{"threadId":"th_x9y8"}');
  });

  it("spreads into a payload without disturbing what is already there", () => {
    const payload = { threadId: "th_x9y8", parentId: null, ...requestedWeightPayload("quick") };
    expect(payload).toEqual({ threadId: "th_x9y8", parentId: null, weight: "quick" });
  });
});

describe("readRequestedWeight", () => {
  it("reads the weight the request stated", () => {
    expect(readRequestedWeight({ threadId: "th_x9y8", weight: "deep" })).toBe("deep");
  });

  it("answers undefined for a payload that stated none — the orchestrator decides", () => {
    expect(readRequestedWeight({ threadId: "th_x9y8" })).toBeUndefined();
  });

  /**
   * Reachable only for an event this server did not write — a hand-edited queue
   * file, an older or foreign producer. Reading it as "none" puts the event in
   * the state that means the orchestrator decides, which is the only reading
   * that cannot run work at something nobody asked for.
   */
  it("answers undefined rather than throwing on a value that is not a weight", () => {
    for (const bad of [
      { weight: "" },
      { weight: 2 },
      { weight: null },
      { weight: ["deep"] },
      { weight: "deep\nquick" },
      { weight: "w".repeat(REQUESTED_WEIGHT_MAX_LENGTH + 1) },
    ]) {
      expect(readRequestedWeight(bad), JSON.stringify(bad)).toBeUndefined();
    }
  });

  it("answers undefined for a payload that is not an object at all", () => {
    for (const bad of [undefined, null, "deep", 7, ["deep"]]) {
      expect(readRequestedWeight(bad), JSON.stringify(bad)).toBeUndefined();
    }
  });

  /**
   * The key is event-type-agnostic on purpose: it rides beside whatever payload
   * the producing feature declares, so neither core payload has to grow a
   * variant and any other event type carries it with no contract change.
   */
  it("reads it beside a core payload without disturbing that payload's own parse", () => {
    const formRespond = {
      threadId: "th_x9y8",
      formTs: "2026-07-19T10:07:12Z",
      answers: [
        { question: "Ship it?", kind: "choose one", option: "yes", options: null, text: null },
      ],
      note: null,
      ...requestedWeightPayload("Small and mechanical"),
    };
    expect(readRequestedWeight(formRespond)).toBe("Small and mechanical");
    expect(FormRespondPayloadSchema.safeParse(formRespond).success).toBe(true);

    const docEdited = {
      docId: "doc_a1b2",
      sessionId: "s-1",
      actor: "user",
      endedBy: "idle",
      from: "0".repeat(40),
      to: "1".repeat(40),
      stats: { commits: 1, insertions: 3, deletions: 1 },
      ...requestedWeightPayload("deep"),
    };
    expect(readRequestedWeight(docEdited)).toBe("deep");
    expect(DocEditedPayloadSchema.safeParse(docEdited).success).toBe(true);
  });

  /** Queue events are files: what is written must be what is read back. */
  it("round-trips a request's weight through the payload and a JSON event file", () => {
    const request = AppendTurnRequestSchema.parse({ body: "Have another look.", weight: "deep" });
    const payload = { threadId: "th_x9y8", ...requestedWeightPayload(request.weight) };
    const onDisk: unknown = JSON.parse(JSON.stringify({ type: "comment.created", payload }));
    expect(readRequestedWeight((onDisk as { payload: unknown }).payload)).toBe("deep");
  });

  it("round-trips absence as absence", () => {
    const request = AppendTurnRequestSchema.parse({ body: "Have another look." });
    const payload = { threadId: "th_x9y8", ...requestedWeightPayload(request.weight) };
    const onDisk: unknown = JSON.parse(JSON.stringify({ type: "comment.created", payload }));
    expect(readRequestedWeight((onDisk as { payload: unknown }).payload)).toBeUndefined();
  });

  /**
   * One spelling, on the request and on the event. The queue surface's standing
   * rule (`InProgressEvent`): saying one thing twice, two different ways, is how
   * two readers come to disagree.
   */
  it("uses the same key the request body does", () => {
    expect(REQUESTED_WEIGHT_PAYLOAD_KEY).toBe("weight");
    expect(Object.hasOwn(CreateThreadRequestSchema.shape, REQUESTED_WEIGHT_PAYLOAD_KEY)).toBe(true);
  });
});
