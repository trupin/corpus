import { describe, expect, it } from "vitest";
import {
  FORM_ANSWER_BLANK,
  FORM_ANSWER_LABEL,
  FormSchema,
  formAnswerRecords,
  formatFormAnswerBody,
  isFormAnswerBody,
  parseFormAnswerBody,
  type Form,
  type FormAnswerRequest,
} from "./index.js";

/** The three kinds in one form, with the `write` field optional. */
const THREE_KINDS: Form = FormSchema.parse({
  fields: [
    {
      question: "Which quote should I file?",
      kind: "choose one",
      options: ["Lemonade — $1,840/yr", "State Farm — $2,010/yr"],
    },
    {
      question: "Which riders do you want?",
      kind: "choose any",
      options: ["Water backup", "Extended replacement", "Ordinance or law"],
    },
    { question: "Anything I should know?", kind: "write", optional: true },
  ],
});

const LEGACY: Form = FormSchema.parse({
  prompt: "Which rate should the model assume?",
  options: ["6.1% fixed", "5.4% variable"],
});

/** Format, then read straight back against the same form. */
const roundTrip = (form: Form, answer: FormAnswerRequest) =>
  parseFormAnswerBody(
    formatFormAnswerBody({ answers: formAnswerRecords(form, answer), note: answer.note ?? null }),
    form,
  );

describe("the answer turn's prose (SPEC.md §6)", () => {
  it("names every field the form asked, in the form's order, with the blank one said out loud", () => {
    const body = formatFormAnswerBody({
      answers: formAnswerRecords(THREE_KINDS, {
        answers: [
          { question: "Which quote should I file?", option: "Lemonade — $1,840/yr" },
          {
            question: "Which riders do you want?",
            options: ["Water backup", "Ordinance or law"],
          },
        ],
      }),
      note: "matches the quote we discussed",
    });

    // The record, asserted as bytes: this is what lands in git.
    expect(body).toBe(
      [
        "**Answered:**",
        "",
        "**Which quote should I file?**",
        "",
        "Lemonade — $1,840/yr",
        "",
        "**Which riders do you want?**",
        "",
        "- Water backup",
        "- Ordinance or law",
        "",
        "**Anything I should know?**",
        "",
        FORM_ANSWER_BLANK,
        "",
        "**Note:**",
        "",
        "matches the quote we discussed",
      ].join("\n"),
    );
  });

  it("carries no fence, no id and no key/value markup", () => {
    const body = formatFormAnswerBody({
      answers: formAnswerRecords(THREE_KINDS, {
        answers: [
          { question: "Which quote should I file?", option: "Lemonade — $1,840/yr" },
          { question: "Which riders do you want?", options: ["Water backup"] },
          { question: "Anything I should know?", text: "call me first" },
        ],
      }),
      note: null,
    });

    expect(body).not.toContain("```");
    expect(body).not.toMatch(/\bth_[a-z0-9]/);
    expect(body).not.toMatch(/^\s*(question|kind|option|options|text):/m);
    // And it still reads as the exchange with the fence out of view.
    expect(body).toContain("**Which quote should I file?**");
    expect(body).toContain("call me first");
  });

  it("omits the note block entirely when no note was given", () => {
    const body = formatFormAnswerBody({
      answers: formAnswerRecords(LEGACY, {
        answers: [{ question: LEGACY.fields[0]?.question ?? "", option: "6.1% fixed" }],
      }),
      note: null,
    });
    expect(body).not.toContain("**Note:**");
    expect(body.split("\n").at(-1)).toBe("6.1% fixed");
  });
});

describe("format → parse round trip", () => {
  it("returns the same answers, blanks included", () => {
    const answer: FormAnswerRequest = {
      answers: [
        { question: "Which quote should I file?", option: "State Farm — $2,010/yr" },
        {
          question: "Which riders do you want?",
          options: ["Extended replacement", "Water backup"],
        },
      ],
    };
    expect(roundTrip(THREE_KINDS, answer)).toEqual({
      answers: formAnswerRecords(THREE_KINDS, answer),
      note: null,
    });
  });

  it("returns the same answers for a form answered in full, note and all", () => {
    const answer: FormAnswerRequest = {
      answers: [
        { question: "Which quote should I file?", option: "Lemonade — $1,840/yr" },
        { question: "Which riders do you want?", options: ["Ordinance or law"] },
        {
          question: "Anything I should know?",
          text: "the deductible matters more than the premium",
        },
      ],
      note: "happy either way",
    };
    expect(roundTrip(THREE_KINDS, answer)).toEqual({
      answers: formAnswerRecords(THREE_KINDS, answer),
      note: "happy either way",
    });
  });

  it("survives a form whose fields are all optional, submitted empty", () => {
    const allOptional: Form = FormSchema.parse({
      fields: [
        { question: "Rename it?", kind: "write", optional: true },
        { question: "Which tags?", kind: "choose any", options: ["a", "b"], optional: true },
      ],
    });
    const parsed = roundTrip(allOptional, { answers: [] });
    expect(parsed).toEqual({
      answers: formAnswerRecords(allOptional, { answers: [] }),
      note: null,
    });
    // Every value key null: "they declined" and "it was never asked" are not the same bytes.
    expect(
      parsed?.answers.every((record) => record.option === null && record.options === null),
    ).toBe(true);
  });

  it("keeps a written answer's interior blank lines and its markdown", () => {
    const text = "first paragraph\n\n- a list item\n- another\n\nlast word";
    const answer: FormAnswerRequest = {
      answers: [
        { question: "Which quote should I file?", option: "Lemonade — $1,840/yr" },
        { question: "Which riders do you want?", options: ["Water backup"] },
        { question: "Anything I should know?", text },
      ],
    };
    expect(roundTrip(THREE_KINDS, answer)?.answers.at(-1)?.text).toBe(text);
  });

  it("keeps an option containing the separators a looser reader would split on", () => {
    const tricky: Form = FormSchema.parse({
      fields: [
        { question: "Which one?", kind: "choose one", options: ["a — b: c", "- d"] },
        { question: "Which several?", kind: "choose any", options: ["x — y", "- z"] },
      ],
    });
    const answer: FormAnswerRequest = {
      answers: [
        { question: "Which one?", option: "a — b: c" },
        { question: "Which several?", options: ["- z", "x — y"] },
      ],
    };
    expect(roundTrip(tricky, answer)).toEqual({
      answers: formAnswerRecords(tricky, answer),
      note: null,
    });
  });
});

describe("pairing an answer with a form", () => {
  it("refuses a body that names a different form's questions", () => {
    const other: Form = FormSchema.parse({
      fields: [{ question: "Ship it?", kind: "choose one", options: ["Yes", "No"] }],
    });
    const body = formatFormAnswerBody({
      answers: formAnswerRecords(other, { answers: [{ question: "Ship it?", option: "Yes" }] }),
      note: null,
    });
    expect(parseFormAnswerBody(body, other)).not.toBeUndefined();
    expect(parseFormAnswerBody(body, THREE_KINDS)).toBeUndefined();
  });

  it("refuses a body that names only some of this form's questions", () => {
    const body = [
      FORM_ANSWER_LABEL,
      "",
      "**Which quote should I file?**",
      "",
      "Lemonade — $1,840/yr",
    ].join("\n");
    expect(parseFormAnswerBody(body, THREE_KINDS)).toBeUndefined();
  });

  it("refuses a block that does not fit its field's kind", () => {
    const body = [
      FORM_ANSWER_LABEL,
      "",
      "**Which quote should I file?**",
      "",
      // A `choose one` gets one line, not a list.
      "- Lemonade — $1,840/yr",
      "- State Farm — $2,010/yr",
      "",
      "**Which riders do you want?**",
      "",
      "- Water backup",
      "",
      "**Anything I should know?**",
      "",
      FORM_ANSWER_BLANK,
    ].join("\n");
    expect(parseFormAnswerBody(body, THREE_KINDS)).toBeUndefined();
  });

  it("is not an answer at all when the label is missing", () => {
    expect(isFormAnswerBody("just a reply")).toBe(false);
    expect(parseFormAnswerBody("just a reply", LEGACY)).toBeUndefined();
  });
});

describe("the short spelling, still on disk in every older workspace", () => {
  it("reads `**Answered:** <option>` as that field's answer", () => {
    expect(parseFormAnswerBody(`${FORM_ANSWER_LABEL} 6.1% fixed`, LEGACY)).toEqual({
      answers: [
        {
          question: "Which rate should the model assume?",
          kind: "choose one",
          option: "6.1% fixed",
          options: null,
          text: null,
        },
      ],
      note: null,
    });
  });

  it("takes anything after the first line as the note", () => {
    const parsed = parseFormAnswerBody(
      `${FORM_ANSWER_LABEL} 5.4% variable\n\ncheaper for now`,
      LEGACY,
    );
    expect(parsed?.note).toBe("cheaper for now");
  });

  it("pairs only with a form that offers that option", () => {
    // The membership test is the whole of the pairing for a short answer: without
    // it a repeated answer would retire a different open form nobody answered.
    expect(parseFormAnswerBody(`${FORM_ANSWER_LABEL} 9.9% teaser`, LEGACY)).toBeUndefined();
  });

  it("never pairs with a multi-field form", () => {
    expect(
      parseFormAnswerBody(`${FORM_ANSWER_LABEL} Lemonade — $1,840/yr`, THREE_KINDS),
    ).toBeUndefined();
  });

  it("is not an answer when the label stands alone", () => {
    expect(parseFormAnswerBody(FORM_ANSWER_LABEL, LEGACY)).toBeUndefined();
    expect(parseFormAnswerBody(`${FORM_ANSWER_LABEL}   `, LEGACY)).toBeUndefined();
  });
});

describe("a form that asks a question spelled like the note heading", () => {
  it("gives the field the first block and the note the second", () => {
    const asksNote: Form = FormSchema.parse({
      fields: [{ question: "Note:", kind: "choose one", options: ["kept", "dropped"] }],
    });
    const body = formatFormAnswerBody({
      answers: formAnswerRecords(asksNote, { answers: [{ question: "Note:", option: "kept" }] }),
      note: "and a remark",
    });
    expect(parseFormAnswerBody(body, asksNote)).toEqual({
      answers: [
        { question: "Note:", kind: "choose one", option: "kept", options: null, text: null },
      ],
      note: "and a remark",
    });
  });
});
