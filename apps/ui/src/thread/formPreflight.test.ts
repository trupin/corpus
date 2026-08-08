import {
  FORM_ANSWER_BLANK,
  FormSchema,
  formAnswerRecord,
  formatFormAnswerBody,
  parseFormAnswerBody,
  type Form,
  type FormAnswerRequest,
} from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { answerFaults } from "./formPreflight";

/**
 * PR #28 re-review, MAJOR. The server refuses an answer whose own text would
 * make the record unreadable; before this module the person found out as an
 * HTTP failure in a toast, with no field marked and no line pointed at. These
 * are the rules the *form* now applies before the round trip — and the last
 * test is the one that matters most, because it is the one that fails if this
 * module and the contract ever disagree about what is answerable.
 */

/** Two `write` fields and a `choose one`: the shape a delimiter can hijack. */
const FORM: Form = FormSchema.parse({
  fields: [
    { question: "What happened?", kind: "write" },
    { question: "Which quote should I file?", kind: "choose one", options: ["Lemonade", "Erie"] },
    { question: "Anything I should know?", kind: "write", optional: true },
  ],
});

const answer = (first: string, last = "", note?: string): FormAnswerRequest => ({
  answers: [
    ...(first === "" ? [] : [{ question: "What happened?", text: first }]),
    { question: "Which quote should I file?", option: "Lemonade" },
    ...(last === "" ? [] : [{ question: "Anything I should know?", text: last }]),
  ],
  ...(note === undefined ? {} : { note }),
});

describe("answerFaults", () => {
  it("finds nothing wrong with an ordinary answer", () => {
    expect(answerFaults(FORM, answer("The roof leaked.", "It is new.", "cheapest"))).toEqual([]);
  });

  it("finds nothing wrong with markdown that only looks structural", () => {
    const prose = [
      "**Note:** the roof is new",
      "",
      "- a bullet",
      "- another",
      "",
      "Some **Note:** inline, and a **bold** run.",
    ].join("\n");
    expect(answerFaults(FORM, answer(prose))).toEqual([]);
  });

  it("refuses a line that is exactly the note heading, and names it", () => {
    const faults = answerFaults(FORM, answer("the file moved\n\n**Note:**\n\nmine"));
    expect(faults).toHaveLength(1);
    expect(faults[0]?.question).toBe("What happened?");
    expect(faults[0]?.reason).toContain("**Note:**");
    expect(faults[0]?.reason).toContain("What happened?");
  });

  it("refuses a line that is exactly a later question's heading", () => {
    const faults = answerFaults(FORM, answer("first\n\n**Anything I should know?**\n\nsecond"));
    expect(faults).toHaveLength(1);
    expect(faults[0]?.question).toBe("What happened?");
    expect(faults[0]?.reason).toContain("Anything I should know?");
  });

  /**
   * Reading order is the whole of the rule: a question's block can only be
   * hijacked by a heading the reader has not claimed yet. The *last* field
   * quoting the *first* field's question round-trips, and refusing it would be
   * the client being stricter than the server with nothing to appeal to.
   */
  it("allows a line spelled like an earlier question's heading", () => {
    expect(answerFaults(FORM, answer("first", "**What happened?**"))).toEqual([]);
  });

  it("refuses text that is exactly how a blank field is written", () => {
    const faults = answerFaults(FORM, answer(FORM_ANSWER_BLANK));
    expect(faults).toHaveLength(1);
    expect(faults[0]?.question).toBe("What happened?");
    expect(faults[0]?.reason).toContain(FORM_ANSWER_BLANK);
  });

  /**
   * Each field is judged on its own text, so two bad answers produce two
   * messages rather than one that points at whichever came first. The
   * attribution is what makes this different from printing the server's
   * refusal: it is what marks a control.
   */
  it("attributes a fault to each field that earned one", () => {
    const faults = answerFaults(FORM, answer("**Note:**", "**Note:**"));
    expect(faults.map((fault) => fault.question)).toEqual([
      "What happened?",
      "Anything I should know?",
    ]);
  });

  it("blames only the offending field when its neighbour is innocent", () => {
    const faults = answerFaults(FORM, answer("perfectly ordinary prose", "**Note:**"));
    expect(faults.map((fault) => fault.question)).toEqual(["Anything I should know?"]);
  });

  /**
   * A refusal no field can carry. `FormSchema` keeps an option off the
   * delimiter line-space, so this form cannot come through the fence — but
   * `POST /api/threads` writes a first turn without the grammar check
   * (SERVER-070), so "the form itself is what cannot be recorded" is a state
   * the client must say something about rather than blame a person's typing for.
   */
  it("says it about the form when no single field's text is at fault", () => {
    const rigged = {
      fields: [
        {
          question: "Which?",
          kind: "choose one" as const,
          options: ["**Note:**"],
          optional: false,
        },
      ],
    };
    const faults = answerFaults(rigged, {
      answers: [{ question: "Which?", option: "**Note:**" }],
    });
    expect(faults).toHaveLength(1);
    expect(faults[0]?.question).toBeNull();
    expect(faults[0]?.reason).not.toBe("");
  });

  /**
   * The gate and the round trip are the same question, asked twice. Every
   * fixture above is run through the contract's own writer and reader: an
   * answer this module accepts must come back out of the turn it would write
   * exactly as it went in, and one it refuses must not. A drift in either
   * direction fails here — a lenient copy re-opens the toast this exists to
   * close, and a strict one refuses answers the server would take.
   */
  it.each([
    ["ordinary", answer("The roof leaked.", "It is new.", "cheapest")],
    ["inline lookalikes", answer("**Note:** inline\n\n- a bullet")],
    ["an earlier question's heading", answer("first", "**What happened?**")],
    ["the note heading on its own line", answer("a\n\n**Note:**\n\nb")],
    ["a later question's heading", answer("**Anything I should know?**")],
    ["the blank marker", answer(FORM_ANSWER_BLANK)],
  ])("agrees with the contract's own round trip — %s", (_name, request) => {
    const record = formAnswerRecord(FORM, request);
    const readBack = parseFormAnswerBody(formatFormAnswerBody(record), FORM);
    const roundTrips = JSON.stringify(readBack) === JSON.stringify(record);
    expect(answerFaults(FORM, request).length === 0).toBe(roundTrips);
  });
});
