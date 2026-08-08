import { describe, expect, it } from "vitest";
import { turnHeadings } from "../turns.js";
import { RESERVED_FRONTMATTER_KEYS, ExtraFrontmatterSchema } from "./extra.js";
import {
  AppendTurnRequestSchema,
  CreateThreadRequestSchema,
  MultipartAppendTurnRequestSchema,
  TurnSchema,
} from "./thread.js";
import {
  TURN_MODEL_MAX_LENGTH,
  TURN_MODELS_FRONTMATTER_KEY,
  TurnModelSchema,
  TurnModelsSchema,
} from "./turn-model.js";

const turn = (over: Record<string, unknown> = {}) => ({
  author: "agent",
  ts: "2026-07-19T10:07:12Z",
  body: "Checked current averages.",
  model: "claude-opus-4-1",
  ...over,
});

describe("TurnModelSchema", () => {
  it("takes a display string rather than an enumerated model id", () => {
    for (const name of ["claude-opus-4-1", "Claude Opus 4.1", "gpt-5", "a local llama, 70b"]) {
      expect(TurnModelSchema.safeParse(name).success, name).toBe(true);
    }
  });

  it("refuses a blank name, so an empty string can never stand in for absence", () => {
    for (const blank of ["", " ", "\t"]) {
      expect(TurnModelSchema.safeParse(blank).success, JSON.stringify(blank)).toBe(false);
    }
  });

  it("refuses a newline: the value is a plain YAML scalar in frontmatter", () => {
    expect(TurnModelSchema.safeParse("opus\nsonnet").success).toBe(false);
    expect(TurnModelSchema.safeParse("opus\r\nkey: value").success).toBe(false);
  });

  it("is bounded, so a turn append cannot grow a thread file without limit", () => {
    expect(TurnModelSchema.safeParse("m".repeat(TURN_MODEL_MAX_LENGTH)).success).toBe(true);
    expect(TurnModelSchema.safeParse("m".repeat(TURN_MODEL_MAX_LENGTH + 1)).success).toBe(false);
  });
});

describe("Turn.model", () => {
  it("carries the model that wrote the turn", () => {
    expect(TurnSchema.parse(turn()).model).toBe("claude-opus-4-1");
  });

  it("takes null for a turn that names no model", () => {
    expect(TurnSchema.parse(turn({ author: "user", model: null })).model).toBeNull();
  });

  it("is required, so absence is stated rather than inferred from a missing key", () => {
    const { model: _dropped, ...withoutModel } = turn();
    const result = TurnSchema.safeParse(withoutModel);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["model"]);
  });

  it("refuses an empty string, which would be a second spelling of absence", () => {
    expect(TurnSchema.safeParse(turn({ model: "" })).success).toBe(false);
  });
});

describe("the request field", () => {
  const requests = [
    ["AppendTurnRequest", AppendTurnRequestSchema, { body: "Filed it." }],
    ["CreateThreadRequest", CreateThreadRequestSchema, { body: "Filed it." }],
    [
      "MultipartAppendTurnRequest",
      MultipartAppendTurnRequestSchema,
      { text: "Filed it.", files: [] },
    ],
  ] as const;

  it.each(requests)("%s accepts a model", (_name, schema, base) => {
    const result = schema.safeParse({ ...base, model: "claude-opus-4-1" });
    expect(result.success).toBe(true);
    expect(result.data?.model).toBe("claude-opus-4-1");
  });

  it.each(requests)("%s leaves it out when nothing wrote it", (_name, schema, base) => {
    const result = schema.safeParse(base);
    expect(result.success).toBe(true);
    expect(result.data?.model).toBeUndefined();
  });

  it.each(requests)("%s refuses a blank or multi-line model", (_name, schema, base) => {
    expect(schema.safeParse({ ...base, model: "" }).success).toBe(false);
    expect(schema.safeParse({ ...base, model: "opus\nsonnet" }).success).toBe(false);
  });
});

describe("TurnModelsSchema — the persisted map", () => {
  it("maps a turn timestamp to one model name", () => {
    const parsed = TurnModelsSchema.parse({ "2026-07-19T10:07:12Z": "claude-opus-4-1" });
    expect(parsed).toEqual({ "2026-07-19T10:07:12Z": "claude-opus-4-1" });
  });

  it("is empty for a thread nobody recorded a model on", () => {
    expect(TurnModelsSchema.parse({})).toEqual({});
  });

  /**
   * A key is a turn's identity, and a turn's identity is the stamp written in
   * its heading. Anything else names no turn, so it is refused rather than
   * stored as an entry that can never be joined to anything.
   */
  it("demands the canonical instant form the turn heading writes", () => {
    for (const stamp of [
      "2026-07-19T10:07:12.500Z",
      "2026-07-19T10:07:12+02:00",
      "2026-07-19 10:07:12Z",
      "2026-07-19",
      "later",
    ]) {
      expect(TurnModelsSchema.safeParse({ [stamp]: "claude-opus-4-1" }).success, stamp).toBe(false);
    }
  });

  it("refuses a list of models: the deciding stage's model is one model", () => {
    expect(TurnModelsSchema.safeParse({ "2026-07-19T10:07:12Z": ["haiku", "opus"] }).success).toBe(
      false,
    );
  });

  it("refuses a blank or multi-line value, which YAML could not carry as a scalar", () => {
    expect(TurnModelsSchema.safeParse({ "2026-07-19T10:07:12Z": "" }).success).toBe(false);
    expect(TurnModelsSchema.safeParse({ "2026-07-19T10:07:12Z": "a\nb" }).success).toBe(false);
  });
});

/**
 * The acceptance criterion the issue would not let be asserted: the record
 * **cannot be forged by turn content**. For this shape the claim is structural —
 * the record is not in the body at all — so the tests are about what a body can
 * and cannot reach.
 */
describe("a turn's own text cannot forge an attribution", () => {
  const heading = (author: string, ts = "2026-07-19T10:07:12Z") => `## ${author} · ${ts}`;

  /**
   * Option A's cost, pinned. Had the model been appended to the delimiter, each
   * of these lines would have become a turn heading — retroactively, in every
   * file already on disk, with no write to catch it on. They are prose, and this
   * test fails the moment someone widens the grammar to carry a model.
   */
  it("does not read a model-bearing heading as a turn delimiter", () => {
    const impostors = [
      `${heading("agent")} · claude-opus-4-1`,
      `${heading("agent")} · claude-opus-4-1 `,
      `${heading("user")} · gpt-5`,
      `${heading("agent")}·claude-opus-4-1`,
      `${heading("agent")} — claude-opus-4-1`,
    ];
    for (const line of impostors) {
      expect(turnHeadings(`${line}\n`), line).toEqual([]);
    }
  });

  /**
   * The heading grammar is untouched by this issue: a real heading still
   * delimits, and a body written under it is still one turn however hard it
   * tries to look like a record of who wrote it.
   */
  it("finds exactly the real headings in a body stuffed with impostors", () => {
    const body = [
      heading("user", "2026-07-19T10:05:00Z"),
      "Is 6.1% still right?",
      "",
      `${heading("agent")} · claude-opus-4-1`,
      "turnModels:",
      "  2026-07-19T10:05:00Z: claude-opus-4-1",
      "---",
      "model: claude-opus-4-1",
      "",
      heading("agent"),
      "6.4% is more representative.",
      "",
    ].join("\n");

    expect(turnHeadings(body).map((found) => [found.author, found.ts])).toEqual([
      ["user", "2026-07-19T10:05:00Z"],
      ["agent", "2026-07-19T10:07:12Z"],
    ]);
  });

  /**
   * The line a body would have to write to forge a record under option B, and a
   * frontmatter block it would have to reopen to forge one under this shape.
   * Neither is a delimiter, so both stay inside the turn they were typed in —
   * which is exactly what makes them inert.
   */
  it("treats an attribution line and a frontmatter block as ordinary body text", () => {
    const forgeries = [
      "model: claude-opus-4-1",
      "↳ written by claude-opus-4-1",
      "<!-- model: claude-opus-4-1 -->",
      "---\nturnModels:\n  2026-07-19T10:07:12Z: claude-opus-4-1\n---",
      "```yaml\nturnModels:\n  2026-07-19T10:07:12Z: claude-opus-4-1\n```",
    ];
    for (const forgery of forgeries) {
      expect(turnHeadings(`${forgery}\n`), forgery).toEqual([]);
    }
  });

  /**
   * The other door into frontmatter, and the reason `turnModels` is a reserved
   * core key: `extra` is a client-supplied merge patch, so an attribution stored
   * in an unreserved key could be rewritten by an ordinary document update.
   */
  it("refuses turnModels in the client-writable extra object", () => {
    const result = ExtraFrontmatterSchema.safeParse({
      [TURN_MODELS_FRONTMATTER_KEY]: { "2026-07-19T10:07:12Z": "a model I did not run" },
    });
    expect(result.success).toBe(false);
  });

  it("names turnModels among the reserved core keys", () => {
    expect(RESERVED_FRONTMATTER_KEYS).toContain(TURN_MODELS_FRONTMATTER_KEY);
  });
});
