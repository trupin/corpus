import { describe, expect, it } from "vitest";
import {
  containsFormFence,
  describeFormFailure,
  extractFormSource,
  findFormFence,
  FORM_ANSWER_LABEL,
  FORM_FENCE_INFO_STRING,
  FORM_FIELD_KINDS,
  FORM_RESPOND_EVENT_TYPE,
  FormAnswerRequestSchema,
  FormAnswerResponseSchema,
  FormFieldAnswerSchema,
  FormRespondPayloadSchema,
  FormSchema,
  parseFormRespondPayload,
  validateFormAnswer,
  type Form,
} from "./form.js";
import { CORE_QUEUE_EVENT_TYPES } from "./queue.js";

const fenced = (info: string, yaml: string) => ["```" + info, yaml, "```"].join("\n");

const FORM_YAML = 'prompt: Which rate should the model assume?\noptions:\n  - "6.1%"\n  - "6.4%"';

const RATE = "Which rate should the model assume?";

const form = FormSchema.parse({ prompt: RATE, options: ["6.1%", "6.4%"] });

/** The three-field ask SPEC.md §6's rider is written for: one of each kind. */
const RICH_FORM = FormSchema.parse({
  fields: [
    { question: RATE, kind: "choose one", options: ["6.1%", "6.4%"] },
    { question: "Which sheets did you check?", kind: "choose any", options: ["Q1", "Q2", "Q3"] },
    { question: "Anything else?", kind: "write", optional: true },
  ],
});

describe("the form fence", () => {
  it("names the info string the whole grammar hangs on", () => {
    expect(FORM_FENCE_INFO_STRING).toBe("form");
  });

  /**
   * The writer (the server's form route) and the reader (the UI's answered-form
   * detector) cannot import each other, so the marker is pinned here — a change
   * to it is a change to the turn format, and this is where it has to be made.
   */
  it("names the answered-form marker both the writer and the reader match on", () => {
    expect(FORM_ANSWER_LABEL).toBe("**Answered:**");
    expect(`${FORM_ANSWER_LABEL} 6.4%`.startsWith(FORM_ANSWER_LABEL)).toBe(true);
  });

  it("extracts the YAML of a form fence in an agent turn", () => {
    const body = `Checked the averages.\n\n${fenced("form", FORM_YAML)}\n\nLet me know.`;
    expect(extractFormSource(body)).toBe(FORM_YAML);
    expect(containsFormFence(body)).toBe(true);
  });

  it("finds a fence that opens the body, with no preceding newline", () => {
    expect(extractFormSource(fenced("form", FORM_YAML))).toBe(FORM_YAML);
  });

  /**
   * The distinction the projection's `needs=form` detector has to make: a
   * substring search for "```form" matches every one of these and would put a
   * thread into Attention that is waiting for nothing.
   */
  it.each(["formula", "form-builder", "formatting", "yaml", ""])(
    "does not mistake a ```%s fence for a form",
    (info) => {
      const body = fenced(info, FORM_YAML);
      expect(extractFormSource(body)).toBeUndefined();
      expect(containsFormFence(body)).toBe(false);
    },
  );

  it("tolerates trailing whitespace on both fence lines", () => {
    const body = "```form  \nprompt: Ready?\noptions:\n  - Yes\n```  ";
    expect(extractFormSource(body)).toBe("prompt: Ready?\noptions:\n  - Yes");
  });

  it("returns the first form when a turn carries more than one", () => {
    const body = `${fenced("form", "prompt: A\noptions:\n  - x")}\n\n${fenced("form", "prompt: B\noptions:\n  - y")}`;
    expect(extractFormSource(body)).toBe("prompt: A\noptions:\n  - x");
  });

  it("reports no form in a body that has none", () => {
    expect(containsFormFence("Just a reply, with `code` and a ```ts fence.")).toBe(false);
    expect(extractFormSource("")).toBeUndefined();
  });
});

/** The CONTRACT-014 settlement: CommonMark's fence rules, minus three documented restrictions. */
describe("the fence grammar at its edges", () => {
  it("hands a renderer the offsets to split the body around the fence", () => {
    const body = `Before.\n\n${fenced("form", FORM_YAML)}\n\nAfter.`;
    const match = findFormFence(body);
    expect(match).toBeDefined();
    expect(body.slice(0, match?.start)).toBe("Before.\n\n");
    expect(body.slice(match?.end)).toBe("\n\nAfter.");
    expect(match?.source).toBe(FORM_YAML);
  });

  // Restriction 3: the server always closes the fences it writes, so an
  // unterminated one is a mangled file, not a question — even though CommonMark
  // would close it at end of input.
  it("does not treat an unterminated fence as a form", () => {
    expect(containsFormFence(`Q:\n\n\`\`\`form\n${FORM_YAML}\n`)).toBe(false);
    expect(containsFormFence("```form")).toBe(false);
  });

  // CommonMark: a closing fence is a whole line. The old regex accepted this
  // and read a YAML source no renderer would show.
  it("does not accept a mid-line closer, leaving the fence unterminated", () => {
    expect(containsFormFence("```form\nprompt: x```\n")).toBe(false);
  });

  // CommonMark: fences do not nest — content of an open block is content. The
  // old regex claimed the quoted example as a live form.
  it("leaves a form quoted inside an outer example block alone", () => {
    const body = `An example:\n\n\`\`\`\`markdown\n${fenced("form", FORM_YAML)}\n\`\`\`\``;
    expect(containsFormFence(body)).toBe(false);
  });

  it("leaves a form quoted inside a tilde block alone", () => {
    expect(containsFormFence(`~~~\n${fenced("form", FORM_YAML)}\n~~~`)).toBe(false);
  });

  // The inner "```form" line cannot close the ```js block (a closer carries no
  // info string), so the js block swallows everything to the last "```" —
  // exactly CommonMark's reading.
  it("lets an unclosed plain fence shadow a form fence that follows", () => {
    expect(containsFormFence(`\`\`\`js\ncode\n\`\`\`form\n${FORM_YAML}\n\`\`\``)).toBe(false);
  });

  it("finds a form after a closed plain fence", () => {
    const body = `\`\`\`js\ncode()\n\`\`\`\n\n${fenced("form", FORM_YAML)}`;
    expect(extractFormSource(body)).toBe(FORM_YAML);
  });

  // CommonMark: the closer needs at least as many backticks as the opener.
  it.each([
    ["a longer closer on a three-backtick opener", `\`\`\`form\n${FORM_YAML}\n\`\`\`\`\``],
    ["a four-backtick opener with a matching closer", `\`\`\`\`form\n${FORM_YAML}\n\`\`\`\`\``],
  ])("accepts %s", (_name, body) => {
    expect(extractFormSource(body)).toBe(FORM_YAML);
  });

  it("keeps a three-backtick line as content inside a four-backtick form fence", () => {
    expect(extractFormSource(`\`\`\`\`form\n${FORM_YAML}\n\`\`\`\n\`\`\`\``)).toBe(
      `${FORM_YAML}\n\`\`\``,
    );
  });

  // Restriction 2: §6 spells the fence with backticks; a tilde fence opens an
  // ordinary code block. Restriction 1: column 0 only.
  it.each([
    ["a tilde form fence", `~~~form\n${FORM_YAML}\n~~~`],
    ["an indented fence", `  \`\`\`form\n${FORM_YAML}\n  \`\`\``],
    ["a backtick in the info string", `\`\`\`form\`\n${FORM_YAML}\n\`\`\``],
  ])("declines %s, degrading it to an ordinary block", (_name, body) => {
    expect(containsFormFence(body)).toBe(false);
  });

  // CommonMark trims the info string, so leading whitespace before `form` is
  // the same fence — new with the scanner; the old regex declined it.
  it("accepts leading whitespace in the info string, as CommonMark does", () => {
    expect(extractFormSource(`\`\`\` form\n${FORM_YAML}\n\`\`\``)).toBe(FORM_YAML);
  });

  it("reads a CRLF body, normalising the source's line terminators", () => {
    const body = "```form\r\nprompt: Ready?\r\noptions:\r\n  - Yes\r\n```\r\n";
    expect(extractFormSource(body)).toBe("prompt: Ready?\noptions:\n  - Yes");
  });
});

describe("the form grammar", () => {
  it("names the three kinds, and only three (SPEC.md §6)", () => {
    expect(FORM_FIELD_KINDS).toEqual(["choose one", "choose any", "write"]);
  });

  it("parses one field of each kind, required by default", () => {
    expect(RICH_FORM.fields.map((field) => [field.kind, field.optional])).toEqual([
      ["choose one", false],
      ["choose any", false],
      ["write", true],
    ]);
  });

  /**
   * The whole backwards-compatibility claim, asserted as a *behaviour* rather
   * than as a tolerated input: the shorthand every form already on disk is
   * written in parses to a value indistinguishable from the same form written
   * the long way, so no consumer downstream ever asks "is this an old form?".
   * The input is the exact shape the repo's own fixtures carry — `FORM_YAML`
   * above, and `apps/server`'s and `apps/ui`'s form fixtures.
   */
  it("parses a bare prompt + options as one required choose-one field", () => {
    const longhand: Form = {
      fields: [{ question: RATE, kind: "choose one", options: ["6.1%", "6.4%"], optional: false }],
    };
    expect(form).toEqual(longhand);
    expect(FormSchema.parse(longhand)).toEqual(form);
  });

  it("takes a write field with no options at all", () => {
    expect(
      FormSchema.parse({ fields: [{ question: "What changed?", kind: "write" }] }).fields[0],
    ).toEqual({ question: "What changed?", kind: "write", optional: false });
  });

  /** A form with one non-choose-one field is a normal form, not a shorthand. */
  it("takes a one-field form that is not a choose one", () => {
    const single = FormSchema.parse({
      fields: [{ question: "Which sheets?", kind: "choose any", options: ["Q1", "Q2"] }],
    });
    expect(single.fields).toHaveLength(1);
    expect(single.fields[0]?.kind).toBe("choose any");
  });

  it.each([
    ["a fourth kind", { fields: [{ question: "When?", kind: "date" }] }],
    ["a near-miss spelling of a kind", { fields: [{ question: "Go?", kind: "choose-one" }] }],
    ["a kind that is not a string", { fields: [{ question: "Go?", kind: true }] }],
    ["no kind at all", { fields: [{ question: "Go?", options: ["Yes"] }] }],
  ])("rejects %s", (_name, value) => {
    expect(FormSchema.safeParse(value).success).toBe(false);
  });

  it.each([
    ["a choose-one carrying no options", { fields: [{ question: "Go?", kind: "choose one" }] }],
    [
      "a write field carrying options",
      { fields: [{ question: "Go?", kind: "write", options: ["Yes"] }] },
    ],
    [
      "an empty options list",
      { fields: [{ question: "Go?", kind: "choose any", options: [] as string[] }] },
    ],
  ])("rejects %s rather than coercing it", (_name, value) => {
    expect(FormSchema.safeParse(value).success).toBe(false);
  });

  it.each([
    ["a form with no fields", { fields: [] as unknown[] }],
    ["a blank question", { fields: [{ question: "   ", kind: "write" }] }],
    [
      "a blank option",
      { fields: [{ question: "Go?", kind: "choose one", options: ["Yes", " "] }] },
    ],
    ["an empty prompt", { prompt: "", options: ["Yes"] }],
    ["a missing prompt", { options: ["Yes"] }],
    ["a missing options list", { prompt: "Ready?" }],
    ["both spellings at once", { prompt: "Go?", options: ["Yes"], fields: [] as unknown[] }],
    ["an unknown key on the form", { fields: [{ question: "Go?", kind: "write" }], title: "x" }],
    [
      "a misspelled optional marker",
      { fields: [{ question: "Go?", kind: "write", optionnal: true }] },
    ],
  ])("rejects %s", (_name, value) => {
    expect(FormSchema.safeParse(value).success).toBe(false);
  });

  /** An answer names an option by its text, so duplicates make it ambiguous. */
  it("rejects duplicate options within a field", () => {
    const parsed = FormSchema.safeParse({ prompt: "Ready?", options: ["Yes", "Yes"] });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("distinct");
  });

  /** The same rule one level up: an answer names a field by its question. */
  it("rejects two fields asking the same thing", () => {
    const parsed = FormSchema.safeParse({
      fields: [
        { question: "Ready?", kind: "write" },
        { question: "Ready?", kind: "choose one", options: ["Yes"] },
      ],
    });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("distinct");
  });

  /**
   * Distinctness is compared on the string as written. Two questions differing
   * only by Unicode normalisation form are two questions — pinned as the chosen
   * behaviour rather than left to be discovered: an answer matches verbatim, so
   * folding them here would accept an answer naming a string the fence does not
   * contain.
   */
  it("treats questions differing only by Unicode normalisation as distinct", () => {
    const composed = "caf\u00E9?";
    const decomposed = "cafe\u0301?";
    expect(composed).not.toBe(decomposed);
    const parsed = FormSchema.safeParse({
      fields: [
        { question: composed, kind: "write" },
        { question: decomposed, kind: "write" },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  /** Options are the same string, kept as written — no trimming, no folding. */
  it("keeps question and option text exactly as written", () => {
    const parsed = FormSchema.parse({
      fields: [{ question: " Ready? ", kind: "choose one", options: [" Yes"] }],
    });
    expect(parsed.fields[0]?.question).toBe(" Ready? ");
  });
});

/**
 * PR #28 finding 1. A newline in a question or an option used to be a documented
 * precondition of the answer prose that **nothing checked**, and its violation
 * was silent all the way through: the form posted, the answer posted, and only
 * the read-back failed — leaving the thread in Attention as "awaiting your
 * answer" with no answer able to clear it, which is exactly what §10 forbids.
 *
 * These cases pin the enforcement where it makes the failure inert rather than
 * silent: a form that could not be answered does not parse, so it is refused at
 * write time on the agent's turn and is not a form to any consumer that meets it
 * some other way.
 */
describe("a form that could not be answered", () => {
  const rejected = (value: unknown): string => {
    const parsed = FormSchema.safeParse(value);
    expect(parsed.success).toBe(false);
    return (parsed.success ? null : describeFormFailure(parsed.error)) ?? "";
  };

  it.each([
    ["a question carrying a newline", { fields: [{ question: "Which\nquote?", kind: "write" }] }],
    [
      "an option carrying a newline",
      { fields: [{ question: "Which?", kind: "choose one", options: ["a\nb", "c"] }] },
    ],
    [
      "an option carrying a carriage return",
      { fields: [{ question: "Which?", kind: "choose any", options: ["a\r\nb"] }] },
    ],
    ["a short-spelling prompt carrying a newline", { prompt: "Which\nquote?", options: ["a"] }],
  ])("rejects %s, because the answer turn writes it on one line", (_name, value) => {
    expect(rejected(value)).toContain("single line");
  });

  /**
   * The answer writes a chosen option on a line of its own, where three
   * spellings mean something else: this form's own question headings, the note
   * heading, and the blank marker.
   */
  it.each([
    [
      "one of this form's questions in bold",
      { fields: [{ question: "Ready?", kind: "choose one", options: ["**Ready?**", "No"] }] },
      "heading for `Ready?`",
    ],
    [
      "the note heading",
      { fields: [{ question: "Ready?", kind: "choose one", options: ["**Note:**", "No"] }] },
      "note heading",
    ],
    [
      "the blank marker",
      { prompt: "Ready?", options: ["_(left blank)_", "No"] },
      "field left blank",
    ],
  ])("rejects an option spelled like %s", (_name, value, expected) => {
    const message = rejected(value);
    expect(message).toContain("cannot be an option");
    expect(message).toContain(expected);
  });

  /**
   * The rule is narrow on purpose: a bold line only delimits when its text names
   * a question of *this* form or the note, so an ordinary emphasised option is
   * not collateral damage.
   */
  it("accepts a bold option that names neither a question nor the note", () => {
    const parsed = FormSchema.safeParse({
      fields: [{ question: "Ready?", kind: "choose one", options: ["**Yes**", "No"] }],
    });
    expect(parsed.success).toBe(true);
  });
});

/**
 * PR #28 finding 6. Every rejection above is worth nothing to the person or the
 * agent who has to fix the fence unless it says *what* is wrong: `FormSchema` is
 * a union, so `issues[0].message` is the union's own "Invalid input" for
 * essentially all of them, and both the answer route's `404` and the board's
 * broken-form warning used to show exactly that string.
 *
 * These cases are the same values the grammar's rejection tests use, asserted
 * for their *explanation* rather than for their falsity — because the explainer
 * lives here precisely so `apps/server` and `apps/ui` cannot disagree about it.
 */
describe("why a form was rejected", () => {
  const why = (value: unknown): string => {
    const parsed = FormSchema.safeParse(value);
    expect(parsed.success).toBe(false);
    return (parsed.success ? null : describeFormFailure(parsed.error)) ?? "";
  };

  /** The reviewer's own example: a fourth field kind said "Invalid input". */
  it("names the offending field and the kinds it could have been", () => {
    const message = why({ fields: [{ question: "When?", kind: "date" }] });
    expect(message).toContain("fields.0.kind");
    expect(message).toContain("choose one");
    expect(message).toContain("choose any");
    expect(message).toContain("write");
    expect(message).not.toBe("Invalid input");
  });

  it.each([
    [
      "a misspelled key",
      { fields: [{ question: "Go?", kind: "write", optionnal: true }] },
      ["fields.0", "optionnal"],
    ],
    [
      "a write field carrying options",
      {
        fields: [{ question: "Go?", kind: "write", options: ["Yes"] }],
      },
      ["fields.0", "options"],
    ],
    [
      "a choose-one carrying none",
      { fields: [{ question: "Go?", kind: "choose one" }] },
      ["fields.0.options"],
    ],
    [
      "a blank question",
      { fields: [{ question: "   ", kind: "write" }] },
      ["fields.0.question", "must not be blank"],
    ],
    ["repeated options", { prompt: "Ready?", options: ["Yes", "Yes"] }, ["options", "distinct"]],
    ["a form with no fields", { fields: [] as unknown[] }, ["fields"]],
    ["something that is not a form at all", { title: "not a form" }, ["fields"]],
    ["a scalar", 42, ["expected object"]],
  ])("explains %s", (_name, value, expected) => {
    const message = why(value);
    for (const fragment of expected) expect(message).toContain(fragment);
    expect(message).not.toBe("Invalid input");
  });

  /**
   * The narrowing walks to the deepest issue and prints its path **once**: paths
   * are absolute at every level of the union's tree, so a wrapper's path is a
   * prefix of the one below it and printing both would read
   * `fields.0: fields.0.kind: …`.
   */
  it("names the place once, not once per level of the union", () => {
    const message = why({ fields: [{ question: "When?", kind: "date" }] });
    expect(message.match(/fields\.0/g)).toHaveLength(1);
  });

  /** No issues at all is not a sentence — each surface words its own fallback. */
  it("says nothing rather than inventing a reason for an empty error", () => {
    expect(describeFormFailure({ issues: [] })).toBeNull();
  });
});

describe("answering a form", () => {
  const SHEETS = "Which sheets did you check?";
  const ELSE = "Anything else?";

  /** Every required field answered, one entry per field, in the form's order. */
  const fullAnswer = {
    answers: [
      { question: RATE, option: "6.4%" },
      { question: SHEETS, options: ["Q1", "Q3"] },
      { question: ELSE, text: "nothing" },
    ],
  };

  it("round-trips an answer with a note", () => {
    const answer = { answers: [{ question: RATE, option: "6.1%" }], note: "matches the Q2 sheet" };
    expect(FormAnswerRequestSchema.parse(answer)).toEqual(answer);
  });

  it("leaves the note out entirely rather than defaulting it", () => {
    const answer = { answers: [{ question: RATE, option: "6.1%" }] };
    expect(FormAnswerRequestSchema.parse(answer)).toEqual(answer);
  });

  /**
   * A form whose fields are all optional is still unanswered until it is
   * submitted, so the empty submit has to be expressible (SPEC.md §6).
   */
  it("accepts an empty answers list, which is a legal submit", () => {
    expect(FormAnswerRequestSchema.parse({ answers: [] })).toEqual({ answers: [] });
  });

  it.each([
    ["a missing answers list", { note: "hmm" }],
    ["an empty note", { answers: [], note: "" }],
    ["an unknown top-level key", { answers: [], option: "6.1%" }],
  ])("rejects %s", (_name, value) => {
    expect(FormAnswerRequestSchema.safeParse(value).success).toBe(false);
  });

  /**
   * Absence is the one spelling of "nothing was given", so an entry that names
   * a question and gives nothing — or gives two things — is not an answer.
   */
  it.each([
    ["an entry giving nothing", { question: RATE }],
    ["an entry giving two things", { question: RATE, option: "6.1%", text: "hmm" }],
    ["an empty selection list", { question: SHEETS, options: [] as string[] }],
    ["a blank option", { question: RATE, option: " " }],
    ["a blank text", { question: ELSE, text: "\n" }],
    ["a blank question", { question: "  ", text: "hmm" }],
    ["an unknown key", { question: RATE, option: "6.1%", kind: "choose one" }],
  ])("rejects %s", (_name, value) => {
    expect(FormFieldAnswerSchema.safeParse(value).success).toBe(false);
  });

  it("passes an answer that fits the form, one entry per field", () => {
    expect(validateFormAnswer(RICH_FORM, fullAnswer)).toBeUndefined();
  });

  it("passes the shorthand form's single field", () => {
    expect(
      validateFormAnswer(form, { answers: [{ question: RATE, option: "6.4%" }] }),
    ).toBeUndefined();
  });

  /** The optional write field may be left out; the two required ones may not. */
  it("passes an answer that omits only the optional field", () => {
    expect(
      validateFormAnswer(RICH_FORM, { answers: fullAnswer.answers.slice(0, 2) }),
    ).toBeUndefined();
  });

  it("rejects an option the field does not offer, naming the field and the choices", () => {
    const rejection = validateFormAnswer(form, { answers: [{ question: RATE, option: "5.0%" }] });
    expect(rejection?.code).toBe("bad_request");
    expect(rejection?.issues).toHaveLength(1);
    expect(rejection?.issues[0]?.path).toBe("body.answers[0].option");
    expect(rejection?.issues[0]?.message).toContain("`6.1%`");
    expect(rejection?.issues[0]?.message).toContain("`6.4%`");
  });

  it("names the offending selection in a choose any, by position", () => {
    const rejection = validateFormAnswer(RICH_FORM, {
      answers: [{ question: SHEETS, options: ["Q1", "Q9"] }],
    });
    expect(rejection?.issues[0]?.path).toBe("body.answers[0].options[1]");
    expect(rejection?.issues[0]?.message).toContain("`Q9`");
  });

  it("rejects the same option named twice in one choose any", () => {
    const rejection = validateFormAnswer(RICH_FORM, {
      answers: [{ question: SHEETS, options: ["Q1", "Q1"] }],
    });
    const paths = rejection?.issues.map((issue) => issue.path);
    expect(paths).toContain("body.answers[0].options");
  });

  it("rejects an answer to a field the form does not ask, listing what it does", () => {
    const rejection = validateFormAnswer(RICH_FORM, {
      answers: [{ question: "When is it due?", text: "Friday" }],
    });
    expect(rejection?.issues[0]?.path).toBe("body.answers[0].question");
    expect(rejection?.issues[0]?.message).toContain("does not ask");
    expect(rejection?.issues[0]?.message).toContain(RATE);
  });

  it("rejects the same question answered twice", () => {
    const rejection = validateFormAnswer(form, {
      answers: [
        { question: RATE, option: "6.1%" },
        { question: RATE, option: "6.4%" },
      ],
    });
    expect(rejection?.issues[0]?.path).toBe("body.answers[1].question");
    expect(rejection?.issues[0]?.message).toContain("more than once");
  });

  it("rejects a required field with no answer, against `answers` as a whole", () => {
    const rejection = validateFormAnswer(RICH_FORM, { answers: [] });
    expect(rejection?.issues.map((issue) => issue.path)).toEqual(["body.answers", "body.answers"]);
    expect(JSON.stringify(rejection?.issues)).toContain("is required and has no answer");
  });

  /** Nothing selected is an omitted entry, which a required choose any refuses. */
  it("says a required choose any needs at least one option", () => {
    const rejection = validateFormAnswer(RICH_FORM, {
      answers: [{ question: RATE, option: "6.1%" }],
    });
    expect(rejection?.issues).toHaveLength(1);
    expect(rejection?.issues[0]?.message).toContain("at least one option");
  });

  /** …and an optional choose any left blank is simply a legal omission. */
  it("lets an optional choose any be left unselected", () => {
    const optionalPick = FormSchema.parse({
      fields: [{ question: SHEETS, kind: "choose any", options: ["Q1", "Q2"], optional: true }],
    });
    expect(validateFormAnswer(optionalPick, { answers: [] })).toBeUndefined();
  });

  it.each([
    ["text where a choose one belongs", { question: RATE, text: "6.1%" }, "body.answers[0].text"],
    [
      "a list where a choose one belongs",
      { question: RATE, options: ["6.1%"] },
      "body.answers[0].options",
    ],
    [
      "a single option where a choose any belongs",
      { question: SHEETS, option: "Q1" },
      "body.answers[0].option",
    ],
    ["an option where a write belongs", { question: ELSE, option: "Q1" }, "body.answers[0].option"],
  ])("rejects %s, naming the key it belongs under", (_name, entry, path) => {
    const rejection = validateFormAnswer(RICH_FORM, { answers: [entry] });
    expect(rejection?.issues[0]?.path).toBe(path);
    expect(rejection?.issues[0]?.message).toContain("belongs under");
  });

  /** Every problem at once: a submit should not take four round trips to fix. */
  it("reports every problem it finds rather than the first", () => {
    const rejection = validateFormAnswer(RICH_FORM, {
      answers: [
        { question: RATE, option: "5.0%" },
        { question: "Not asked", text: "x" },
      ],
    });
    expect(rejection?.issues.map((issue) => issue.path)).toEqual([
      "body.answers[0].option",
      "body.answers[1].question",
      "body.answers",
    ]);
  });

  /** Matching is verbatim: a near miss is a rejection, not a fuzzy accept. */
  it.each(["6.1", " 6.1%", "6.1% ", "6.1%\n", "6.4%%"])("rejects the near miss %j", (option) => {
    expect(validateFormAnswer(form, { answers: [{ question: RATE, option }] })).toBeDefined();
  });

  /** The question is matched verbatim too — it is the field's whole identity. */
  it("rejects a near miss on the question itself", () => {
    const rejection = validateFormAnswer(form, {
      answers: [{ question: `${RATE} `, option: "6.4%" }],
    });
    expect(rejection?.issues[0]?.path).toBe("body.answers[0].question");
  });

  it("carries the answer through the response shape, with the enqueued event", () => {
    const response = {
      thread: {
        id: "th_x9y8",
        title: "Re: rates",
        status: "open" as const,
        parent: "doc_a1b2c3",
        anchor: "anc_k4f7",
        agent: "engaged" as const,
        resident: null,
        created: "2026-07-19T10:05:00Z",
        updated: "2026-07-19T10:09:00Z",
        turnCount: 3,
        lastAuthor: "user" as const,
        lastTs: "2026-07-19T10:09:00Z",
      },
      turn: { author: "user" as const, ts: "2026-07-19T10:09:00Z", body: "6.4%", model: null },
      eventId: "evt_7c1d",
      warnings: [],
    };
    expect(FormAnswerResponseSchema.parse(response)).toEqual(response);
  });

  /**
   * A thread the agent is not `engaged` in enqueues nothing, so null is legal
   * (SPEC.md §8). **The fixture used to be a `resolved` thread**, which
   * SERVER-062 turned into the opposite case: a person's answer reopens it and
   * does enqueue, so an example built that way would have taught a reader the
   * one wrong thing (CONTRACT-034).
   */
  it("accepts a null event id but never a missing one", () => {
    const base = FormAnswerResponseSchema.parse({
      thread: {
        id: "th_x9y8",
        title: "Re: rates",
        status: "open" as const,
        parent: null,
        anchor: null,
        agent: "none" as const,
        resident: null,
        created: "2026-07-19T10:05:00Z",
        updated: "2026-07-19T10:09:00Z",
        turnCount: 3,
        lastAuthor: "user" as const,
        lastTs: "2026-07-19T10:09:00Z",
      },
      turn: { author: "user" as const, ts: "2026-07-19T10:09:00Z", body: "6.4%", model: null },
      eventId: null,
      warnings: [],
    });
    expect(base.eventId).toBeNull();

    const { eventId: _dropped, ...missing } = base;
    expect(FormAnswerResponseSchema.safeParse(missing).success).toBe(false);
  });
});

describe("the form.respond payload", () => {
  const chosen = {
    question: "Which rate should the model assume?",
    kind: "choose one",
    option: "6.4%",
    options: null,
    text: null,
  };
  const blank = {
    question: "Anything else?",
    kind: "write",
    option: null,
    options: null,
    text: null,
  };
  const payload = {
    threadId: "th_x9y8",
    formTs: "2026-07-19T10:07:12Z",
    answers: [chosen, blank],
    note: null,
  };

  it("is one of the core event types SPEC.md §7 names", () => {
    expect(CORE_QUEUE_EVENT_TYPES).toContain(FORM_RESPOND_EVENT_TYPE);
  });

  it("round-trips, naming the thread, the answered form and every field", () => {
    expect(FormRespondPayloadSchema.parse(payload)).toEqual(payload);
    expect(FormRespondPayloadSchema.parse({ ...payload, note: "a note" }).note).toBe("a note");
  });

  /**
   * The asymmetry §7 exists to make: the request may omit an optional field, the
   * payload may not. "They declined" and "it was never asked" must never be the
   * same bytes — so a blank field is present with every value key null, and the
   * agent never has to guess whether a question went unanswered or unasked.
   */
  it("keeps a blank optional field present and marked, never omitted", () => {
    const parsed = FormRespondPayloadSchema.parse(payload);
    expect(parsed.answers).toHaveLength(2);
    expect(parsed.answers[1]).toEqual(blank);
  });

  it("carries a choose any's several selections", () => {
    const several = {
      ...payload,
      answers: [
        {
          question: "Which sheets did you check?",
          kind: "choose any",
          option: null,
          options: ["Q1", "Q3"],
          text: null,
        },
      ],
    };
    expect(FormRespondPayloadSchema.parse(several)).toEqual(several);
  });

  it.each([
    ["a document id where a thread belongs", { ...payload, threadId: "doc_a1b2c3" }],
    ["a timestamp that is not an instant", { ...payload, formTs: "yesterday" }],
    ["no answers at all, though a form has at least one field", { ...payload, answers: [] }],
    ["an omitted answers list", { threadId: "th_x9y8", formTs: payload.formTs, note: null }],
    [
      "an omitted note rather than a null one",
      { threadId: "th_x9y8", formTs: payload.formTs, answers: [chosen] },
    ],
    ["a fourth kind", { ...payload, answers: [{ ...blank, kind: "date" }] }],
    [
      "an entry omitting a value key rather than nulling it",
      { ...payload, answers: [{ question: "Q", kind: "write" }] },
    ],
    [
      "an empty selection list",
      { ...payload, answers: [{ ...blank, kind: "choose any", options: [] }] },
    ],
  ])("rejects %s", (_name, value) => {
    expect(FormRespondPayloadSchema.safeParse(value).success).toBe(false);
  });

  /**
   * A record that could say two things at once would be worse than none: the
   * value lives under the key the field's `kind` names, and nowhere else.
   */
  it("rejects a value under a key the field's kind does not name", () => {
    expect(
      FormRespondPayloadSchema.safeParse({
        ...payload,
        answers: [{ ...blank, text: "hmm", option: "6.4%" }],
      }).success,
    ).toBe(false);
  });

  it("narrows a matching queue event", () => {
    expect(parseFormRespondPayload({ type: "form.respond", payload })).toEqual(payload);
  });

  it("declines an event of another type, core or unrecognised", () => {
    expect(parseFormRespondPayload({ type: "comment.created", payload })).toBeUndefined();
    expect(parseFormRespondPayload({ type: "ledger.reconciled", payload })).toBeUndefined();
  });

  /** Events come off disk: one written by an older server is skipped, not thrown on. */
  it("declines a form.respond whose payload does not match", () => {
    expect(parseFormRespondPayload({ type: "form.respond", payload: {} })).toBeUndefined();
    expect(parseFormRespondPayload({ type: "form.respond", payload: null })).toBeUndefined();
  });

  /**
   * The pre-CONTRACT-038 payload, which some workspace may still hold under
   * `.corpus/queue/`. It is skipped rather than thrown on — queue events are
   * runtime state, not corpus content, which is exactly what made widening this
   * payload cheap where widening the *turn format* would not have been.
   */
  it("skips a payload written by an older server rather than crashing", () => {
    const legacy = {
      threadId: "th_x9y8",
      formTs: "2026-07-19T10:07:12Z",
      option: "6.4%",
      note: null,
    };
    expect(parseFormRespondPayload({ type: "form.respond", payload: legacy })).toBeUndefined();
  });
});
