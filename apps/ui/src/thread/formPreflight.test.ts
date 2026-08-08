import {
  FORM_ANSWER_BLANK,
  FormSchema,
  formAnswerRecord,
  formatFormAnswerBody,
  parseFormAnswerBody,
  turnHeadings,
  unterminatedFence,
  type Form,
  type FormAnswerRequest,
} from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { answerFaults } from "./formPreflight";

/**
 * PR #28 re-review, MAJOR, and UI-091. The server refuses an answer whose own
 * text would make the record unreadable, leave a code fence open or fabricate a
 * turn heading; before this module the person found out as an HTTP failure in a
 * toast, with no field marked and no line pointed at. These are the rules the
 * *form* now applies before the round trip — and the agreement tests are the
 * ones that matter most, because they are the ones that fail if this module and
 * the contract ever disagree about what is appendable.
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

/**
 * ── The two refusals the composer could not see (UI-091) ────────────────────
 *
 * `assertAppendableAnswer` makes three checks and this module could only make
 * one of them: the fence scanner and the turn-heading grammar lived in
 * `apps/server`, which `apps/ui` cannot import. CONTRACT-044 moved both into
 * `@corpus/contract`, so the remaining two arrive in the form instead of as a
 * `400` after the attempt.
 *
 * A bare heading is a `## user · <instant>` line; the instant is written out in
 * full because the grammar is exact about it — seconds precision, `Z`, U+00B7 as
 * the separator — and a fixture that got it wrong would pass by accident.
 */
const HEADING = "## user · 2026-07-19T10:20:00Z";

describe("answerFaults — an unterminated code fence", () => {
  it("catches a fence left open, naming the field and the line it opened on", () => {
    const faults = answerFaults(FORM, answer("it printed:\n\n```js\nconst a = 1;"));
    expect(faults).toHaveLength(1);
    expect(faults[0]?.question).toBe("What happened?");
    // Line 3 of the answer's own text, not of the turn prose around it.
    expect(faults[0]?.reason).toContain("the ``` on line 3 is never closed");
    expect(faults[0]?.reason).toContain("holding nothing but ```");
  });

  it("reports the marker the closing line has to repeat", () => {
    const faults = answerFaults(FORM, answer("~~~~\nnot closed"));
    expect(faults[0]?.reason).toContain("the ~~~~ on line 1 is never closed");
    expect(faults[0]?.reason).toContain("holding nothing but ~~~~");
  });

  it("says nothing about a fence that closes, however wide", () => {
    expect(answerFaults(FORM, answer("````\n```\n````"))).toEqual([]);
    expect(answerFaults(FORM, answer("```js\nconst a = 1;\n```"))).toEqual([]);
  });

  it("blames the note when the note is what left one open", () => {
    const faults = answerFaults(FORM, answer("ordinary", "", "```"));
    expect(faults).toHaveLength(1);
    // The note is one control beside the fields, so there is no field to mark.
    expect(faults[0]?.question).toBeNull();
    expect(faults[0]?.reason).toContain("the note leaves a code fence open");
    expect(faults[0]?.reason).toContain("on line 1");
  });

  /**
   * The record is one stream of bytes, so a fence opened in one field and closed
   * in another leaves the turn with **no** open fence — and the server accepts
   * it. Marking either field here would be the client refusing what the server
   * would have written, which is the failure this whole module exists to avoid.
   */
  it("accepts fences that balance across two fields, exactly as the server does", () => {
    const request = answer("```\nx", "```\ny");
    expect(unterminatedFence(formatFormAnswerBody(formAnswerRecord(FORM, request)))).toBeNull();
    expect(answerFaults(FORM, request)).toEqual([]);
  });

  /**
   * Both faults at once. The fence is what is reported, because an open fence
   * masks everything below it — including the line the other rule would name.
   */
  it("reports the fence before the collision it would hide", () => {
    const faults = answerFaults(FORM, answer("```\n\n**Note:**\n\nmine"));
    expect(faults).toHaveLength(1);
    expect(faults[0]?.reason).toContain("leaves a code fence open");
  });
});

describe("answerFaults — a fabricated turn heading", () => {
  it("catches a bare heading, naming the field, the line and its author", () => {
    const faults = answerFaults(FORM, answer(`the roof leaked\n\n${HEADING}\n\nand then`));
    expect(faults).toHaveLength(1);
    expect(faults[0]?.question).toBe("What happened?");
    expect(faults[0]?.reason).toContain(`line 3 of this answer is \`${HEADING}\``);
    expect(faults[0]?.reason).toContain("separate turn signed by user");
    expect(faults[0]?.reason).toContain("code fence, an inline code span or a block quote");
  });

  it("catches an agent heading too — the one an exemption would have excused", () => {
    const faults = answerFaults(FORM, answer(`## agent · 2026-07-19T10:20:00Z\n\nsigned by them`));
    expect(faults[0]?.question).toBe("What happened?");
    expect(faults[0]?.reason).toContain("signed by agent");
  });

  it("blames the note when the note is the fabricated heading", () => {
    const faults = answerFaults(FORM, answer("ordinary", "", HEADING));
    expect(faults).toHaveLength(1);
    expect(faults[0]?.question).toBeNull();
    expect(faults[0]?.reason).toContain(`line 1 of the note is \`${HEADING}\``);
  });

  /**
   * **The agreement that matters most.** SERVER-076 refuses only a *bare,
   * line-initial, unfenced* heading; every way of writing the format down
   * survives, and the skills' own examples depend on it. A pre-check stricter
   * than that marks fields the server would have accepted, with nothing to
   * appeal to — so each survivor is pinned here and cross-checked against the
   * contract's own scanner below.
   */
  it.each([
    ["inside a fence", `like this:\n\n\`\`\`md\n${HEADING}\n\`\`\``],
    ["inside an inline code span", `the format is \`${HEADING}\``],
    ["as an inline span on its own line", `\`${HEADING}\``],
    ["behind a block-quote marker", `quoting:\n\n> ${HEADING}`],
    ["under indentation", `quoting:\n\n    ${HEADING}\n\nand back`],
    ["as a level-three heading", `### user · 2026-07-19T10:20:00Z`],
    ["with millisecond precision", "## user · 2026-07-19T10:20:00.000Z"],
    ["with a hyphen for the separator", "## user - 2026-07-19T10:20:00Z"],
    ["signed by somebody who is not an actor", "## nobody · 2026-07-19T10:20:00Z"],
  ])("leaves a quoted heading alone — %s", (_name, text) => {
    expect(answerFaults(FORM, answer(text))).toEqual([]);
  });

  /**
   * A heading masked by a fence the *other* field opened. The turn reader would
   * not see it, so the server does not refuse it — and neither does this.
   */
  it("says nothing about a heading a neighbouring field's fence masks", () => {
    const request = answer("```", `${HEADING}\n\`\`\``);
    expect(turnHeadings(formatFormAnswerBody(formAnswerRecord(FORM, request)))).toEqual([]);
    expect(answerFaults(FORM, request)).toEqual([]);
  });
});

/**
 * The gate is the server's own composition, called rather than described.
 * `assertAppendableAnswer` asks three questions of the record it is about to
 * write — an open fence, a fabricated heading, a broken read-back — and this
 * module must accept exactly what all three accept. Every fixture in this file
 * is run through both, so a drift in either direction fails here.
 */
describe("answerFaults agrees with the contract on every fixture", () => {
  const accepted = (request: FormAnswerRequest): boolean => {
    const record = formAnswerRecord(FORM, request);
    const body = formatFormAnswerBody(record);
    const readBack = parseFormAnswerBody(body, FORM);
    return (
      unterminatedFence(body) === null &&
      turnHeadings(body).length === 0 &&
      JSON.stringify(readBack) === JSON.stringify(record)
    );
  };

  it.each([
    ["ordinary prose", answer("The roof leaked.", "It is new.", "cheapest")],
    ["a closed fence", answer("```js\nconst a = 1;\n```")],
    ["a wider closed fence", answer("````\n```\n````")],
    ["an open fence", answer("it printed:\n\n```js\nconst a = 1;")],
    ["an open tilde fence", answer("~~~~\nnot closed")],
    ["fences that balance across fields", answer("```\nx", "```\ny")],
    ["an open fence in the note", answer("ordinary", "", "```")],
    ["a bare turn heading", answer(`before\n\n${HEADING}\n\nafter`)],
    ["a bare agent heading", answer("## agent · 2026-07-19T10:20:00Z")],
    ["a turn heading in the note", answer("ordinary", "", HEADING)],
    ["a fenced turn heading", answer(`\`\`\`md\n${HEADING}\n\`\`\``)],
    ["a quoted turn heading", answer(`quoting:\n\n> ${HEADING}`)],
    ["an indented turn heading", answer(`quoting:\n\n    ${HEADING}\n\nand back`)],
    ["a heading masked by a neighbour's fence", answer("```", `${HEADING}\n\`\`\``)],
    ["a delimiter collision", answer("the file moved\n\n**Note:**\n\nmine")],
    ["the blank marker", answer(FORM_ANSWER_BLANK)],
    ["an earlier question's heading", answer("first", "**What happened?**")],
  ])("— %s", (_name, request) => {
    expect(answerFaults(FORM, request).length === 0).toBe(accepted(request));
  });
});
