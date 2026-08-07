import {
  FORM_ANSWER_LABEL,
  formAnswerRecords,
  formatFormAnswerBody,
  FormSchema,
  type Form,
  type FormAnswerRequest,
  type FormFieldRecord,
} from "@corpus/contract";
import { describe, expect, it } from "vitest";
import {
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

/** The three-kind grammar CONTRACT-038 added, as an agent would write it. */
const THREE_KIND_FENCE = [
  "```form",
  "fields:",
  "  - question: Which quote should I file?",
  "    kind: choose one",
  "    options:",
  "      - Lemonade — $1,840/yr",
  "      - State Farm — $1,975/yr",
  "  - question: Which riders do you want?",
  "    kind: choose any",
  "    options:",
  "      - Water backup",
  "      - Extended replacement",
  "  - question: Anything I should know?",
  "    kind: write",
  "    optional: true",
  "```",
].join("\n");

const formOf = (body: string): Form => {
  const parsed = parseFormBlock(body);
  if (parsed.status !== "ok") throw new Error(`expected a form, got ${parsed.status}`);
  return parsed.form;
};

describe("parseFormBlock", () => {
  it("parses a well-formed fence with the contract's schema", () => {
    const parsed = parseFormBlock(FENCE);
    expect(parsed.status).toBe("ok");
    if (parsed.status !== "ok") return;
    expect(parsed.form.fields).toEqual([
      {
        question: "Which quote should I file?",
        kind: "choose one",
        options: ["Lemonade — $1,840/yr", "State Farm — $1,975/yr"],
        optional: false,
      },
    ]);
  });

  /**
   * The short spelling **is** a one-field choose-one form (SPEC.md §6), not a
   * second shape this component has to recognise: the two parse to values that
   * are equal, which is what makes "no consumer asks whether this is an old
   * form" testable rather than asserted.
   */
  it("normalises the legacy spelling into the field list", () => {
    const long = [
      "```form",
      "fields:",
      "  - question: Which quote should I file?",
      "    kind: choose one",
      "    options:",
      "      - Lemonade — $1,840/yr",
      "      - State Farm — $1,975/yr",
      "```",
    ].join("\n");
    expect(formOf(long)).toEqual(formOf(FENCE));
  });

  it("parses all three kinds, with required the default", () => {
    const fields = formOf(THREE_KIND_FENCE).fields;
    expect(fields.map((field) => field.kind)).toEqual(["choose one", "choose any", "write"]);
    expect(fields.map((field) => field.optional)).toEqual([false, false, true]);
  });

  /** The contract matches the info string whole (`schemas/form.ts`). */
  it.each(["formula", "form-builder", "yaml"])("does not treat ```%s as a form", (info) => {
    const body = ["```" + info, "prompt: x", "options:", "  - a", "```"].join("\n");
    expect(parseFormBlock(body).status).toBe("none");
  });

  /**
   * §11: a form the app cannot read renders as the broken block it is, **never**
   * as a partial set of controls. Each failure mode gets its own case, because
   * the tempting implementation fails differently for each: unparseable YAML
   * throws, a fourth kind falls through a `switch`, and an unknown key is
   * silently dropped by a non-strict object.
   */
  describe("a form the app cannot read is never half-read", () => {
    const invalid = (body: string): string => {
      const parsed = parseFormBlock(body);
      expect(parsed.status).toBe("invalid");
      return parsed.status === "invalid" ? parsed.reason : "";
    };

    /**
     * The `yaml` library throws on this, and the reason has to be *its* message
     * rather than the schema's: the fence never reached `FormSchema` at all, so
     * a reason that named a field path would be describing a value nobody built.
     * Asserted on the substance — the line it broke on and what it wanted — and
     * not merely on "some string came back", which is true of every outcome.
     */
    it("degrades unparseable YAML rather than throwing, and says where it broke", () => {
      const reason = invalid(["```form", "prompt: [unclosed", "```"].join("\n"));
      expect(reason).toContain("]");
      expect(reason).toContain("line 1");
      expect(reason).not.toContain("fields");
    });

    /**
     * PR #28 finding 6. The warning is shown *instead of* the form, so it is the
     * only thing a reader has to go on: "This form could not be read — Invalid
     * input" tells them nothing they could not already see. `FormSchema` is a
     * union, so `issues[0].message` is that string for every structural failure
     * here — which is why the reason comes from the contract's
     * `describeFormFailure`, the same sentence the answer route's `404` carries.
     */
    it.each([
      [
        "a fourth kind",
        ["  - question: How much?", "    kind: number"],
        ["fields.0.kind", "write"],
      ],
      [
        "a misspelled optional marker",
        ["  - question: Anything?", "    kind: write", "    optionnal: true"],
        ["fields.0", "optionnal"],
      ],
      [
        "a choose-one with no options",
        ["  - question: Which?", "    kind: choose one"],
        ["fields.0.options"],
      ],
      [
        "two fields asking the same question",
        ["  - question: Which?", "    kind: write", "  - question: Which?", "    kind: write"],
        ["fields", "distinct"],
      ],
    ])("says what is wrong with %s, not just that something is", (_name, fields, expected) => {
      const reason = invalid(["```form", "fields:", ...fields, "```"].join("\n"));
      for (const fragment of expected) expect(reason).toContain(fragment);
      expect(reason).not.toBe("Invalid input");
    });

    /*
     * The four cases that used to stand here — a fourth kind, a misspelled
     * `optional`, a duplicate question, a `choose one` with no `options` — are
     * the table above, and each asserted only `not.toBe("")` against a helper
     * that already asserts `status === "invalid"` and can never return `""`.
     * An assertion that cannot fail is worse than none, because it reads as
     * coverage (PR #28 re-review, MINOR). What remains here is what the table
     * does not cover, asserted on the substance of the sentence.
     */

    /**
     * A `write` field carrying options: the branch it comes closest to is
     * `write`, whose object has no `options` key at all, so the sentence has to
     * name the key it does **not** recognise rather than one that is missing.
     */
    it("refuses a write field carrying options, naming the key it does not know", () => {
      const reason = invalid(
        [
          "```form",
          "fields:",
          "  - question: Anything?",
          "    kind: write",
          "    options:",
          "      - a",
          "```",
        ].join("\n"),
      );
      expect(reason).toContain("fields.0");
      expect(reason).toContain("options");
    });

    /**
     * The legacy `prompt` + `options` spelling fails on its own terms — it never
     * becomes a `fields` list to fail as — so the sentence names `options` and
     * not `fields.0.options`. A form offering nothing to choose is unanswerable,
     * and §11 wants it visibly broken rather than rendered as an empty group.
     */
    it("rejects a legacy form offering no options, on the legacy key", () => {
      const reason = invalid(["```form", "prompt: pick", "options: []", "```"].join("\n"));
      expect(reason).toContain("options");
      expect(reason).not.toContain("fields");
    });
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
  /** Written the way the server writes them — the contract's own formatter. */
  const answerBody = (form: Form, answers: FormAnswerRequest["answers"], note?: string): string =>
    formatFormAnswerBody({
      answers: formAnswerRecords(form, { answers, ...(note === undefined ? {} : { note }) }),
      note: note ?? null,
    });

  it("reads back what was given for every field, blanks included", () => {
    const form = formOf(THREE_KIND_FENCE);
    const body = answerBody(
      form,
      [
        { question: "Which quote should I file?", option: "Lemonade — $1,840/yr" },
        { question: "Which riders do you want?", options: ["Water backup"] },
      ],
      "cheapest one",
    );

    const answers = mapFormAnswers([
      { author: "agent", ts: "1", body: THREE_KIND_FENCE },
      { author: "user", ts: "2", body },
    ]);

    expect(answers.get("1")).toEqual({
      answers: [
        {
          question: "Which quote should I file?",
          kind: "choose one",
          option: "Lemonade — $1,840/yr",
          options: null,
          text: null,
        },
        {
          question: "Which riders do you want?",
          kind: "choose any",
          option: null,
          options: ["Water backup"],
          text: null,
        },
        {
          question: "Anything I should know?",
          kind: "write",
          option: null,
          options: null,
          text: null,
        },
      ],
      note: "cheapest one",
    });
  });

  /**
   * The reload case, which is the whole reason the format and its reader are a
   * pair in the contract: nothing of the submit survives, so the turn's prose
   * has to carry the record on its own.
   */
  it("recovers a multi-line written answer and a multi-option selection", () => {
    const form = formOf(THREE_KIND_FENCE);
    const text = "Two things:\n\n- the roof is new\n- the survey is from 2019";
    const body = answerBody(form, [
      { question: "Which quote should I file?", option: "State Farm — $1,975/yr" },
      { question: "Which riders do you want?", options: ["Water backup", "Extended replacement"] },
      { question: "Anything I should know?", text },
    ]);
    const record = mapFormAnswers([
      { author: "agent", ts: "1", body: THREE_KIND_FENCE },
      { author: "user", ts: "2", body },
    ]).get("1");
    expect(record?.answers[1]?.options).toEqual(["Water backup", "Extended replacement"]);
    expect(record?.answers[2]?.text).toBe(text);
  });

  it("still reads the short spelling every workspace already has on disk", () => {
    const answers = mapFormAnswers([
      { author: "agent", ts: "1", body: FENCE },
      { author: "user", ts: "2", body: `${FORM_ANSWER_LABEL} Lemonade — $1,840/yr\n\nfine by me` },
    ]);
    expect(answers.get("1")?.answers[0]?.option).toBe("Lemonade — $1,840/yr");
    expect(answers.get("1")?.note).toBe("fine by me");
  });

  /**
   * `onAnswered` fires only on a `201`, so the server has already written the
   * turn: the only thing outstanding is this client's refetch. A live submit
   * during that window is one the server answers with a `409`.
   */
  it("treats a form this session answered as answered before its turn comes back", () => {
    const answer = {
      answers: [
        {
          question: "Which quote should I file?",
          kind: "choose one" as const,
          option: "Lemonade — $1,840/yr",
          options: null,
          text: null,
        },
      ],
      note: null,
    };
    const answers = mapFormAnswers(
      [{ author: "agent", ts: "1", body: FENCE }],
      [{ formTs: "1", answer }],
    );
    expect(answers.get("1")).toEqual(answer);
  });

  it("invents nothing for a pairing whose form this thread does not carry", () => {
    const answers = mapFormAnswers(
      [{ author: "agent", ts: "1", body: FENCE }],
      [
        {
          formTs: "elsewhere",
          answer: { answers: [], note: null },
        },
      ],
    );
    expect(answers.has("elsewhere")).toBe(false);
  });

  it("does not let an unrelated turn answer a form", () => {
    const answers = mapFormAnswers([
      { author: "agent", ts: "1", body: FENCE },
      { author: "user", ts: "2", body: `${FORM_ANSWER_LABEL} something else entirely` },
    ]);
    expect(answers.size).toBe(0);
  });

  it("does not let an answer to one form close a differently-shaped one", () => {
    const other = FormSchema.parse({ prompt: "Ship it?", options: ["Yes", "No"] });
    const answers = mapFormAnswers([
      { author: "agent", ts: "1", body: THREE_KIND_FENCE },
      {
        author: "user",
        ts: "2",
        body: answerBody(other, [{ question: "Ship it?", option: "Yes" }]),
      },
    ]);
    expect(answers.size).toBe(0);
  });

  /**
   * Two forms open at once (PR #10 finding 12). A single "current form" slot
   * let the second evict the first, so the first could never be answered and an
   * option both of them offer went to the wrong one.
   */
  describe("two unanswered forms", () => {
    const fence = (prompt: string, options: readonly string[]): string =>
      ["```form", `prompt: ${prompt}`, "options:", ...options.map((o) => `  - ${o}`), "```"].join(
        "\n",
      );

    const AMBIGUOUS = [
      { author: "agent", ts: "1", body: fence("Same?", ["Yes", "No"]) },
      { author: "agent", ts: "2", body: fence("Same?", ["Yes", "Later"]) },
      { author: "user", ts: "3", body: `${FORM_ANSWER_LABEL} Yes` },
    ];

    const chose = (
      option: string,
      question = "Same?",
    ): { answers: readonly FormFieldRecord[] } => ({
      answers: [{ question, kind: "choose one", option, options: null, text: null }],
    });

    it("falls back to the earlier one when nothing knows better", () => {
      const answers = mapFormAnswers(AMBIGUOUS);
      expect(answers.get("1")?.answers[0]?.option).toBe("Yes");
      expect(answers.has("2")).toBe(false);
    });

    /**
     * The half the prose cannot supply. `POST …/turns/{ts}/form` addressed a
     * form by its `ts`; the turn it wrote back names only the questions and what
     * was given, which two forms asking the same question share.
     */
    it("credits the form the session actually answered, not the earlier one", () => {
      const answers = mapFormAnswers(AMBIGUOUS, [
        { formTs: "2", answer: { ...chose("Yes"), note: null } },
      ]);
      expect(answers.get("2")?.answers[0]?.option).toBe("Yes");
      expect(answers.has("1")).toBe(false);
    });

    it("leaves a known pairing's form alone when a later answer could also fit it", () => {
      const answers = mapFormAnswers(
        [...AMBIGUOUS, { author: "user", ts: "4", body: `${FORM_ANSWER_LABEL} No` }],
        [{ formTs: "2", answer: { ...chose("Yes"), note: null } }],
      );
      expect(answers.get("2")?.answers[0]?.option).toBe("Yes");
      expect(answers.get("1")?.answers[0]?.option).toBe("No");
    });

    it("ignores a pairing for a form this thread does not carry", () => {
      const answers = mapFormAnswers(AMBIGUOUS, [
        { formTs: "999", answer: { ...chose("Yes"), note: null } },
      ]);
      expect(answers.get("1")?.answers[0]?.option).toBe("Yes");
    });

    /**
     * Pairing is by **content** now: an answer naming "Second?" cannot land on
     * the form asking "First?", whatever the order — which is the drift the
     * option-slicing reader could not see.
     */
    it("pairs by question rather than by order when the questions differ", () => {
      const first = fence("First?", ["Yes", "No"]);
      const second = fence("Second?", ["Yes", "No"]);
      const answers = mapFormAnswers([
        { author: "agent", ts: "1", body: first },
        { author: "agent", ts: "2", body: second },
        {
          author: "user",
          ts: "3",
          body: answerBody(formOf(second), [{ question: "Second?", option: "Yes" }]),
        },
      ]);
      expect(answers.has("1")).toBe(false);
      expect(answers.get("2")?.answers[0]?.option).toBe("Yes");
    });

    it("still answers the earlier one after the later one has been answered", () => {
      const answers = mapFormAnswers([
        { author: "agent", ts: "1", body: fence("Same?", ["Yes", "No"]) },
        { author: "agent", ts: "2", body: fence("Same?", ["Later"]) },
        { author: "user", ts: "3", body: `${FORM_ANSWER_LABEL} Later` },
        { author: "user", ts: "4", body: `${FORM_ANSWER_LABEL} No` },
      ]);
      expect(answers.get("2")?.answers[0]?.option).toBe("Later");
      expect(answers.get("1")?.answers[0]?.option).toBe("No");
    });

    it("keys every answer by the carrying turn's ts, never by the option's prose", () => {
      const answers = mapFormAnswers([
        { author: "agent", ts: "2026-07-28T10:00:00.000Z", body: fence("Pick", ["Yes"]) },
        { author: "user", ts: "2026-07-28T10:01:00.000Z", body: `${FORM_ANSWER_LABEL} Yes` },
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
    const fence = (label: number, options: readonly string[]): string =>
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
      body: fence(label, [`F${String(label)}-yes`, `F${String(label)}-no`]),
    });

    /** An agent turn whose first line answers `option` and whose body carries form `label`. */
    const answeringForm = (index: number, option: string, label: number): AnswerableTurn => ({
      author: "agent",
      ts: stamp(index),
      body: `${FORM_ANSWER_LABEL} ${option}\n\n${fence(label, [`F${String(label)}-yes`, `F${String(label)}-no`])}`,
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
      expect(mapFormAnswers(turns).get(stamp(0))?.answers[0]?.option).toBe("F1-yes");
      expect(liveForms(turns)).toEqual([stamp(1)]);
    });

    it("can then be answered like any other form, so the reason clears", () => {
      const turns = [formTurn(0, 1), answeringForm(1, "F1-yes", 2), answer(2, "F2-no")];
      const answers = mapFormAnswers(turns);
      expect(answers.get(stamp(0))?.answers[0]?.option).toBe("F1-yes");
      expect(answers.get(stamp(1))?.answers[0]?.option).toBe("F2-no");
      expect(liveForms(turns)).toEqual([]);
    });

    it("never answers itself, however its own options read", () => {
      // Its option is one of the form it carries — it must still be the
      // *earlier* form that closes, and its own must stay open.
      const turns = [formTurn(0, 2), answeringForm(1, "F2-no", 2)];
      expect(mapFormAnswers(turns).get(stamp(0))?.answers[0]?.option).toBe("F2-no");
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
