import { FormSchema, type Form, type FormField } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import {
  draftRequest,
  emptyDraft,
  fieldAnswer,
  fieldDraft,
  isBlank,
  missingRequired,
  toggleOption,
  withField,
} from "./formDraft";

const FORM: Form = FormSchema.parse({
  fields: [
    {
      question: "Which quote should I file?",
      kind: "choose one",
      options: ["Lemonade — $1,840/yr", "State Farm — $1,975/yr"],
    },
    {
      question: "Which riders do you want?",
      kind: "choose any",
      options: ["Water backup", "Extended replacement"],
    },
    { question: "Anything I should know?", kind: "write", optional: true },
  ],
});

const field = (index: number): FormField => {
  const found = FORM.fields[index];
  if (found === undefined) throw new Error(`no field ${String(index)}`);
  return found;
};

const set = (question: string, patch: Partial<ReturnType<typeof fieldDraft>>) =>
  withField(emptyDraft(FORM), question, { ...fieldDraft(emptyDraft(FORM), question), ...patch });

describe("the required gate", () => {
  it("names every required field still empty, in the form's order", () => {
    expect(missingRequired(FORM, emptyDraft(FORM)).map((each) => each.question)).toEqual([
      "Which quote should I file?",
      "Which riders do you want?",
    ]);
  });

  it("does not hold the optional field against the submit", () => {
    const draft = withField(
      set("Which quote should I file?", { option: "Lemonade — $1,840/yr" }),
      "Which riders do you want?",
      { option: null, options: ["Water backup"], text: "" },
    );
    expect(missingRequired(FORM, draft)).toEqual([]);
  });

  /**
   * §6: "a required `choose any` needs at least one option". Ticking nothing is
   * the same as not answering — which is exactly why the entry is omitted rather
   * than sent empty.
   */
  it("counts a required choose-any with nothing ticked as missing", () => {
    const draft = set("Which quote should I file?", { option: "Lemonade — $1,840/yr" });
    expect(missingRequired(FORM, draft).map((each) => each.question)).toEqual([
      "Which riders do you want?",
    ]);
  });

  it("counts a write field of only whitespace as blank", () => {
    const optional = field(2);
    expect(isBlank(optional, { option: null, options: [], text: "   \n " })).toBe(true);
    expect(isBlank(optional, { option: null, options: [], text: " hi " })).toBe(false);
  });
});

describe("what a field contributes", () => {
  /**
   * Absence is the single spelling of blank (CONTRACT-038). An empty string or
   * an empty option list would be a **value** on the wire, and the server reads
   * it as one: `nonBlank` and `min(1)` reject both, turning "I left it blank" on
   * an optional field into a `400`.
   */
  it("sends no entry at all for a field with nothing given", () => {
    expect(fieldAnswer(field(0), { option: null, options: [], text: "" })).toBeUndefined();
    expect(fieldAnswer(field(1), { option: null, options: [], text: "" })).toBeUndefined();
    expect(fieldAnswer(field(2), { option: null, options: [], text: "" })).toBeUndefined();
  });

  it("puts each kind's value under the key its kind names", () => {
    expect(
      fieldAnswer(field(0), { option: "Lemonade — $1,840/yr", options: [], text: "" }),
    ).toEqual({ question: "Which quote should I file?", option: "Lemonade — $1,840/yr" });
    expect(fieldAnswer(field(1), { option: null, options: ["Water backup"], text: "" })).toEqual({
      question: "Which riders do you want?",
      options: ["Water backup"],
    });
    expect(
      fieldAnswer(field(2), { option: null, options: [], text: "  the roof is new " }),
    ).toEqual({ question: "Anything I should know?", text: "the roof is new" });
  });
});

describe("toggling a choose-any option", () => {
  it("adds, removes, and keeps the form's own order", () => {
    const riders = field(1);
    const one = toggleOption(riders, [], "Extended replacement");
    expect(one).toEqual(["Extended replacement"]);
    const both = toggleOption(riders, one, "Water backup");
    expect(both).toEqual(["Water backup", "Extended replacement"]);
    expect(toggleOption(riders, both, "Water backup")).toEqual(["Extended replacement"]);
  });
});

describe("the whole submit", () => {
  it("carries one entry per field answered and the trimmed note", () => {
    const draft = withField(
      set("Which quote should I file?", { option: "State Farm — $1,975/yr" }),
      "Which riders do you want?",
      { option: null, options: ["Water backup"], text: "" },
    );
    expect(draftRequest(FORM, draft, "  cheapest  ")).toEqual({
      answers: [
        { question: "Which quote should I file?", option: "State Farm — $1,975/yr" },
        { question: "Which riders do you want?", options: ["Water backup"] },
      ],
      note: "cheapest",
    });
  });

  it("omits a blank note rather than sending an empty one", () => {
    expect(draftRequest(FORM, emptyDraft(FORM), "   ")).toEqual({ answers: [] });
  });

  /** A form of only optional fields: an empty submit is a real answer (§6). */
  it("submits an empty answers array for an all-optional form", () => {
    const optional: Form = FormSchema.parse({
      fields: [{ question: "Anything?", kind: "write", optional: true }],
    });
    expect(missingRequired(optional, emptyDraft(optional))).toEqual([]);
    expect(draftRequest(optional, emptyDraft(optional), "")).toEqual({ answers: [] });
  });
});
