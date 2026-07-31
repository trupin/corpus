import { describe, expect, it } from "vitest";
import {
  answeredOption,
  FORM_ANSWER_LABEL,
  mapFormAnswers,
  optionParts,
  parseFormBlock,
  splitFormFence,
  type AnswerableTurn,
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

  /**
   * UI-021, paired case for case with `apps/server/src/core/form.test.ts`'s
   * block of the same name (wave-3 audit FIX 10). Only a hand-edited file
   * produces this turn, but `POST …/turns/{ts}/form` accepts an answer for its
   * form all the same — so until this fix the renderer left a form live and
   * unclearable while the server's `needs=form` said the thread was waiting on
   * it. The names match the server's on purpose: a paired test that is merely
   * similar is how the two sides drift again.
   */
  describe("a turn that both answers a form and carries one", () => {
    const form = (label: number, options: readonly string[]): string =>
      [
        "```form",
        `prompt: F${String(label)}?`,
        "options:",
        ...options.map((o) => `  - ${o}`),
        "```",
      ].join("\n");

    /** The `ts` scheme the server's fixture uses, so the two read alike. */
    const stamp = (index: number): string =>
      new Date(Date.UTC(2026, 6, 28, 10, index)).toISOString();

    const formTurn = (index: number, label: number): AnswerableTurn => ({
      author: "agent",
      ts: stamp(index),
      body: form(label, [`F${String(label)}-yes`, `F${String(label)}-no`]),
    });

    /** An agent turn whose first line answers `option` and whose body carries form `label`. */
    const answeringForm = (index: number, option: string, label: number): AnswerableTurn => ({
      author: "agent",
      ts: stamp(index),
      body: `${FORM_ANSWER_LABEL} ${option}\n\n${form(label, [`F${String(label)}-yes`, `F${String(label)}-no`])}`,
    });

    const answer = (index: number, option: string): AnswerableTurn => ({
      author: "user",
      ts: stamp(index),
      body: `${FORM_ANSWER_LABEL} ${option}`,
    });

    /**
     * The turns still rendering live controls — the renderer's half of what
     * `needs=form` advertises, and the counterpart of the server test's
     * `unanswered`. Derived from the same two functions the thread view uses, so
     * it cannot claim a state the rendered thread does not have.
     */
    const liveForms = (turns: readonly AnswerableTurn[]): string[] => {
      const answers = mapFormAnswers(turns);
      return turns
        .filter(
          (turn) =>
            turn.author === "agent" &&
            parseFormBlock(turn.body).status === "ok" &&
            !answers.has(turn.ts),
        )
        .map((turn) => turn.ts);
    };

    it("closes the earlier form and opens its own", () => {
      const turns = [formTurn(0, 1), answeringForm(1, "F1-yes", 2)];
      expect(mapFormAnswers(turns).get(stamp(0))).toBe("F1-yes");
      expect(liveForms(turns)).toEqual([stamp(1)]);
    });

    it("can then be answered like any other form, so the reason clears", () => {
      const turns = [formTurn(0, 1), answeringForm(1, "F1-yes", 2), answer(2, "F2-no")];
      const answers = mapFormAnswers(turns);
      expect(answers.get(stamp(0))).toBe("F1-yes");
      expect(answers.get(stamp(1))).toBe("F2-no");
      expect(liveForms(turns)).toEqual([]);
    });

    it("never answers itself, however its own options read", () => {
      // Its option is one of the form it carries — it must still be the
      // *earlier* form that closes, and its own must stay open.
      const turns = [formTurn(0, 2), answeringForm(1, "F2-no", 2)];
      expect(mapFormAnswers(turns).get(stamp(0))).toBe("F2-no");
      expect(liveForms(turns)).toEqual([stamp(1)]);
    });

    it("opens its form even when its answer matches nothing", () => {
      const turns = [answeringForm(0, "nothing offers this", 1)];
      expect(mapFormAnswers(turns).size).toBe(0);
      expect(liveForms(turns)).toEqual([stamp(0)]);
      // And it is a real form rather than a decoration: an answer clears it.
      expect(liveForms([...turns, answer(1, "F1-yes")])).toEqual([]);
    });
  });
});
