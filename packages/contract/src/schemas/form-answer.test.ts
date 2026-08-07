import { describe, expect, it } from "vitest";
import {
  FORM_ANSWER_BLANK,
  FORM_ANSWER_LABEL,
  FormSchema,
  formAnswerRecord,
  formAnswerRecords,
  formatFormAnswerBody,
  isFormAnswerBody,
  parseFormAnswerBody,
  unreadableAnswer,
  type Form,
  type FormAnswerRecord,
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

/**
 * PR #28 finding 2. A person's `write` answer is arbitrary text landing in a
 * format whose delimiters that text can imitate — the same class as the fence
 * bug that broke the turn parser. The parse **succeeds** on such a body, so
 * nothing downstream flags it: the bytes on disk are what they wrote, and every
 * later read shows them, beside a question, something they did not write there.
 */
describe("an answer whose own text imitates the prose's delimiters", () => {
  /** Two `write` fields, so a hijacked heading has a later block to steal. */
  const TWO_WRITES: Form = FormSchema.parse({
    fields: [
      { question: "What happened?", kind: "write" },
      { question: "What should I do?", kind: "write", optional: true },
    ],
  });

  const answerWith = (text: string, note?: string): FormAnswerRecord =>
    formAnswerRecord(TWO_WRITES, {
      answers: [{ question: "What happened?", text }],
      ...(note === undefined ? {} : { note }),
    });

  it("refuses a written answer containing a line that is exactly the note heading", () => {
    const reason = unreadableAnswer(TWO_WRITES, answerWith("the file moved\n\n**Note:**\n\nmine"));
    expect(reason).toContain("What happened?");
    expect(reason).toContain("**Note:**");
  });

  it("refuses a written answer containing a later question's heading", () => {
    const reason = unreadableAnswer(
      TWO_WRITES,
      answerWith("the file moved\n\n**What should I do?**\n\nfile it"),
    );
    expect(reason).toContain("**What should I do?**");
  });

  /**
   * The damage the refusal prevents, shown once. The parse **succeeds** and
   * lies: the first answer truncates at the imitated heading, and the field the
   * person deliberately left blank comes back carrying the rest of their
   * sentence — including the real heading and the blank marker, now read as
   * content. Nothing anywhere reports a problem.
   */
  it("is a silent corruption when it is not refused", () => {
    const record = answerWith("the file moved\n\n**What should I do?**\n\nfile it");
    const parsed = parseFormAnswerBody(formatFormAnswerBody(record), TWO_WRITES);
    expect(parsed).not.toBeUndefined();
    expect(parsed?.answers[0]?.text).toBe("the file moved");
    expect(parsed?.answers[1]?.text).toBe(
      `file it\n\n**What should I do?**\n\n${FORM_ANSWER_BLANK}`,
    );
    expect(unreadableAnswer(TWO_WRITES, record)).not.toBeUndefined();
  });

  it("refuses a written answer that is exactly the blank marker", () => {
    expect(unreadableAnswer(TWO_WRITES, answerWith(FORM_ANSWER_BLANK))).toContain(
      FORM_ANSWER_BLANK,
    );
  });

  /**
   * Reading order decides: a heading naming a question the reader has already
   * claimed is ordinary content, and the note is written last, so a `**Note:**`
   * line inside the note is content too. Refusing either would be a `400` for
   * text that survives the round trip perfectly well.
   */
  it("allows a heading the reader has already claimed, and one inside the note", () => {
    const answered = formAnswerRecord(TWO_WRITES, {
      answers: [
        { question: "What happened?", text: "moved it" },
        { question: "What should I do?", text: "quoting you:\n\n**What happened?**\n\nthat" },
      ],
      note: "for the record\n\n**Note:**\n\nstill mine",
    });
    expect(unreadableAnswer(TWO_WRITES, answered)).toBeUndefined();
    expect(parseFormAnswerBody(formatFormAnswerBody(answered), TWO_WRITES)).toEqual(answered);
  });

  it("passes ordinary prose, markdown and all", () => {
    const record = answerWith("**bold**, a `code span`, and\n\n- a list\n- of things");
    expect(unreadableAnswer(TWO_WRITES, record)).toBeUndefined();
    expect(parseFormAnswerBody(formatFormAnswerBody(record), TWO_WRITES)).toEqual(record);
  });

  /**
   * Surrounding blank lines are normalised rather than refused: they change
   * nothing a person meant by starting a textarea with a newline, and a `400`
   * for whitespace would be the wrong trade. Interior ones survive.
   */
  it("normalises a written answer's surrounding whitespace instead of refusing it", () => {
    const record = answerWith("\n\n  first\n\n  second  \n\n");
    expect(record.answers[0]?.text).toBe("first\n\n  second");
    expect(unreadableAnswer(TWO_WRITES, record)).toBeUndefined();
    expect(parseFormAnswerBody(formatFormAnswerBody(record), TWO_WRITES)).toEqual(record);
  });

  it("normalises the note's surrounding whitespace the same way", () => {
    const record = answerWith("moved it", "  and a remark\n");
    expect(record.note).toBe("and a remark");
    expect(unreadableAnswer(TWO_WRITES, record)).toBeUndefined();
  });

  /**
   * The other half of the invariant lives in the grammar: a form whose *options*
   * could imitate a delimiter does not parse, so no accepted form can be
   * unanswerable. Asserted here, beside the check it is the counterpart of, so
   * the pair reads as one rule.
   */
  it("cannot be reached through a form's options, because such a form does not parse", () => {
    expect(
      FormSchema.safeParse({
        fields: [{ question: "Ready?", kind: "choose one", options: ["**Note:**", "No"] }],
      }).success,
    ).toBe(false);
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
