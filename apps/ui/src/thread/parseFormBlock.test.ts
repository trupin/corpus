import { describe, expect, it } from "vitest";
import {
  answeredOption,
  mapFormAnswers,
  optionParts,
  parseFormBlock,
  splitFormFence,
} from "./parseFormBlock";

const FENCE = [
  "Which policy?",
  "",
  "```form",
  "prompt: Which quote should I file?",
  "options:",
  "  - Lemonade — $1,840/yr",
  "  - State Farm — $1,975/yr",
  "```",
  "",
  "Tell me if none fit.",
].join("\n");

describe("parseFormBlock", () => {
  it("parses a well-formed fence with the contract's schema", () => {
    const parsed = parseFormBlock(FENCE);
    expect(parsed.status).toBe("ok");
    if (parsed.status !== "ok") return;
    expect(parsed.form.prompt).toBe("Which quote should I file?");
    expect(parsed.form.options).toEqual(["Lemonade — $1,840/yr", "State Farm — $1,975/yr"]);
  });

  /** The contract matches the info string whole (`schemas/form.ts`). */
  it.each(["formula", "form-builder", "yaml"])("does not treat ```%s as a form", (info) => {
    const body = ["```" + info, "prompt: x", "options:", "  - a", "```"].join("\n");
    expect(parseFormBlock(body).status).toBe("none");
  });

  it("degrades a malformed fence rather than throwing", () => {
    const broken = ["```form", "prompt: [unclosed", "```"].join("\n");
    const parsed = parseFormBlock(broken);
    expect(parsed.status).toBe("invalid");
    if (parsed.status !== "invalid") return;
    expect(parsed.reason).not.toBe("");
  });

  it("rejects a form with no options", () => {
    const empty = ["```form", "prompt: pick", "options: []", "```"].join("\n");
    expect(parseFormBlock(empty).status).toBe("invalid");
  });

  it("splits the fence out so the controls can take its place", () => {
    const { before, after, source } = splitFormFence(FENCE);
    expect(before).toBe("Which policy?");
    expect(after).toBe("Tell me if none fit.");
    expect(source).toContain("prompt:");
  });
});

describe("optionParts", () => {
  it("puts the last em-dash segment in the right-aligned detail", () => {
    expect(optionParts("Lemonade — $500 deductible — $1,840/yr")).toEqual({
      label: "Lemonade — $500 deductible",
      detail: "$1,840/yr",
    });
    expect(optionParts("Just an option")).toEqual({ label: "Just an option", detail: null });
  });
});

describe("answers", () => {
  it("recognises the server's answer turn", () => {
    expect(answeredOption("**Answered:** Lemonade — $1,840/yr\n\nfine by me")).toBe(
      "Lemonade — $1,840/yr",
    );
    expect(answeredOption("just a reply")).toBeUndefined();
    expect(answeredOption("**Answered:**")).toBeUndefined();
  });

  it("pairs each form with the first later answer naming one of its options", () => {
    const answers = mapFormAnswers([
      { author: "agent", ts: "1", body: FENCE },
      { author: "user", ts: "2", body: "**Answered:** Lemonade — $1,840/yr" },
      {
        author: "agent",
        ts: "3",
        body: [
          "```form",
          "prompt: And the deductible?",
          "options:",
          "  - $500",
          "  - $1,000",
          "```",
        ].join("\n"),
      },
    ]);
    expect(answers.get("1")).toBe("Lemonade — $1,840/yr");
    // The second form is still open.
    expect(answers.has("3")).toBe(false);
  });

  it("does not let an unrelated turn answer a form", () => {
    const answers = mapFormAnswers([
      { author: "agent", ts: "1", body: FENCE },
      { author: "user", ts: "2", body: "**Answered:** something else entirely" },
    ]);
    expect(answers.size).toBe(0);
  });

  /**
   * Two forms open at once (PR #10 finding 12). A single "current form" slot
   * let the second evict the first, so the first could never be answered and an
   * option both of them offer went to the wrong one.
   */
  describe("two unanswered forms", () => {
    const form = (prompt: string, options: readonly string[]): string =>
      ["```form", `prompt: ${prompt}`, "options:", ...options.map((o) => `  - ${o}`), "```"].join(
        "\n",
      );

    const AMBIGUOUS = [
      { author: "agent", ts: "1", body: form("First?", ["Yes", "No"]) },
      { author: "agent", ts: "2", body: form("Second?", ["Yes", "Later"]) },
      { author: "user", ts: "3", body: "**Answered:** Yes" },
    ];

    it("falls back to the earlier one when nothing knows better", () => {
      const answers = mapFormAnswers(AMBIGUOUS);
      expect(answers.get("1")).toBe("Yes");
      expect(answers.has("2")).toBe(false);
    });

    /**
     * The half the prose cannot supply. `POST …/turns/{ts}/form` addressed a
     * form by its `ts`; the turn it wrote back names only the option. Observed
     * in a browser: answering the *second* of two forms offering "Yes" marked
     * the first one answered and left the second live.
     */
    it("credits the form the session actually answered, not the earlier one", () => {
      const answers = mapFormAnswers(AMBIGUOUS, [{ formTs: "2", option: "Yes" }]);
      expect(answers.get("2")).toBe("Yes");
      expect(answers.has("1")).toBe(false);
    });

    it("leaves a known pairing's form alone when a later answer could also fit it", () => {
      const answers = mapFormAnswers(
        [...AMBIGUOUS, { author: "user", ts: "4", body: "**Answered:** No" }],
        [{ formTs: "2", option: "Yes" }],
      );
      expect(answers.get("2")).toBe("Yes");
      expect(answers.get("1")).toBe("No");
    });

    it("ignores a pairing for a form this thread does not carry", () => {
      const answers = mapFormAnswers(AMBIGUOUS, [{ formTs: "999", option: "Yes" }]);
      expect(answers.get("1")).toBe("Yes");
    });

    it("still answers the earlier one after the later one has been answered", () => {
      const answers = mapFormAnswers([
        { author: "agent", ts: "1", body: form("First?", ["Yes", "No"]) },
        { author: "agent", ts: "2", body: form("Second?", ["Later"]) },
        { author: "user", ts: "3", body: "**Answered:** Later" },
        { author: "user", ts: "4", body: "**Answered:** No" },
      ]);
      expect(answers.get("2")).toBe("Later");
      expect(answers.get("1")).toBe("No");
    });

    it("gives each of two answers to a different form", () => {
      const answers = mapFormAnswers([
        { author: "agent", ts: "1", body: form("First?", ["Yes", "No"]) },
        { author: "agent", ts: "2", body: form("Second?", ["Yes", "No"]) },
        { author: "user", ts: "3", body: "**Answered:** Yes" },
        { author: "user", ts: "4", body: "**Answered:** No" },
      ]);
      expect(answers.get("1")).toBe("Yes");
      expect(answers.get("2")).toBe("No");
    });

    it("keys every answer by the carrying turn's ts, never by the option's prose", () => {
      const answers = mapFormAnswers([
        { author: "agent", ts: "2026-07-28T10:00:00.000Z", body: form("Pick", ["Yes"]) },
        { author: "user", ts: "2026-07-28T10:01:00.000Z", body: "**Answered:** Yes" },
      ]);
      expect([...answers.keys()]).toEqual(["2026-07-28T10:00:00.000Z"]);
    });
  });
});
