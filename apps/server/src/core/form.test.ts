import { FORM_ANSWER_LABEL, formAnswerRecords, formatFormAnswerBody } from "@corpus/contract";
import type { Form, FormAnswerRequest } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { isFormAnswered, readForm, readThreadForms, type FormTurn } from "./form.js";

/**
 * What the projection stores in `turns.has_form`, asked of one body. It used to
 * be a `carriesForm` export that nothing but this file called — and whose
 * docblock claimed to be the projection's own reader, which it had not been
 * since `readThreadForms` took that job (wave-3 audit CLEAN 41). The question is
 * still worth asking body-by-body, so it stays here as the test's own helper.
 */
const carriesForm = (body: string): boolean => readForm(body).ok;

const YAML_BODY = "prompt: Ship it?\noptions:\n  - Yes\n  - No";
const fenced = (info: string, source: string): string =>
  `Some prose.\n\n\`\`\`${info}\n${source}\n\`\`\`\n\nMore prose.\n`;

const MULTI_YAML = [
  "fields:",
  '  - question: "Which rate?"',
  '    kind: "choose one"',
  "    options:",
  '      - "6.1% fixed"',
  '      - "5.4% variable"',
  '  - question: "Which risks apply?"',
  '    kind: "choose any"',
  "    options:",
  '      - "Rate rise"',
  '      - "Currency"',
  '  - question: "Anything to flag?"',
  '    kind: "write"',
  "    optional: true",
].join("\n");

describe("readForm", () => {
  it("reads a well-formed fence", () => {
    const reading = readForm(fenced("form", YAML_BODY));
    expect(reading.ok).toBe(true);
    // The short spelling normalises into the field list at the parse boundary
    // (CONTRACT-038), so exactly one shape reaches this module.
    expect(reading.ok && reading.form).toEqual({
      fields: [
        { question: "Ship it?", kind: "choose one", options: ["Yes", "No"], optional: false },
      ],
    });
  });

  it("reads the multi-field grammar, through the contract's schema and nowhere else", () => {
    const reading = readForm(fenced("form", MULTI_YAML));
    expect(reading.ok && reading.form).toEqual({
      fields: [
        {
          question: "Which rate?",
          kind: "choose one",
          options: ["6.1% fixed", "5.4% variable"],
          optional: false,
        },
        {
          question: "Which risks apply?",
          kind: "choose any",
          options: ["Rate rise", "Currency"],
          optional: false,
        },
        { question: "Anything to flag?", kind: "write", optional: true },
      ],
    });
  });

  it.each([
    ["a fourth kind", 'fields:\n  - question: "Q"\n    kind: "pick a date"'],
    ["two fields asking the same question", 'fields:\n  - question: "Q"\n    kind: "write"\n  - question: "Q"\n    kind: "write"'], // prettier-ignore
    ["a `write` field carrying options", 'fields:\n  - question: "Q"\n    kind: "write"\n    options:\n      - "a"'], // prettier-ignore
    ["a `choose one` with no options", 'fields:\n  - question: "Q"\n    kind: "choose one"'],
    ["an empty field list", "fields: []"],
    ["a misspelled `optional`", 'fields:\n  - question: "Q"\n    kind: "write"\n    optionnal: true'], // prettier-ignore
  ])("never half-reads %s", (_label, yaml) => {
    expect(readForm(fenced("form", yaml))).toMatchObject({ ok: false, reason: "not-a-form" });
  });

  it("reads a fence that opens the body", () => {
    expect(carriesForm("```form\n" + YAML_BODY + "\n```")).toBe(true);
  });

  // The two shapes PR #10 finding 8 named, plus the third of the same class.
  // Each was a *disagreement* before SERVER-029: the projection's SQL substring
  // search and the answer route's regex reached opposite answers about them.
  it.each([
    // A trailing space after the info string still opens a form fence — the
    // projection used to require a newline immediately after `form`, so this was
    // answerable by the route and never surfaced by `needs=form`.
    ["a trailing space in the info string", "Q:\n\n```form  \n" + YAML_BODY + "\n```\n", true],
    ["a trailing tab in the info string", "Q:\n\n```form\t\n" + YAML_BODY + "\n```\n", true],
    // An unterminated fence is not a form: the projection listed it forever and
    // the answer route 404ed it.
    ["an unterminated fence", "Q:\n\n```form\n" + YAML_BODY + "\n", false],
    // A fence whose contents are not a form is likewise not answerable.
    ["unparseable YAML", fenced("form", ": : :\n  - ["), false],
    ["YAML that is not a form", fenced("form", "title: not a form"), false],
    ["an empty fence", "```form\n```\n", false],
    // Prefix matches were already excluded, and must stay excluded.
    ["```formula", fenced("formula", YAML_BODY), false],
    ["```form-builder", fenced("form-builder", YAML_BODY), false],
    ["an uppercase info string", fenced("FORM", YAML_BODY), false],
    ["no fence at all", "Just a reply mentioning a form.", false],
  ])("%s: carriesForm -> %s", (_label, body, expected) => {
    expect(carriesForm(body)).toBe(expected);
  });

  it("distinguishes why there is no form, for the route's four messages", () => {
    expect(readForm("no fence here")).toMatchObject({ ok: false, reason: "no-fence" });
    expect(readForm(fenced("form", ": : :\n  - ["))).toMatchObject({
      ok: false,
      reason: "not-yaml",
    });
    expect(readForm(fenced("form", "title: not a form"))).toMatchObject({
      ok: false,
      reason: "not-a-form",
    });
  });

  it("rejects a form whose options repeat, since an answer names one by its text", () => {
    const reading = readForm(fenced("form", "prompt: Pick\noptions:\n  - A\n  - A"));
    expect(reading).toMatchObject({ ok: false, reason: "not-a-form" });
    expect(reading.ok === false && reading.detail).toContain("distinct");
  });
});

// SERVER-032. Each form is answered on its own terms (SPEC.md §6: a form "is
// identified by the timestamp of the turn carrying it… and answering a form
// addresses the turn that carries it"), so a thread's forms have independent
// states and `needs=form` counts them rather than asking who spoke last.
describe("readThreadForms", () => {
  /** Turn timestamps are the turns' identity (§6) and are unique per thread. */
  const stamp = (index: number): string => `2026-07-30T10:0${index}:00Z`;

  const form = (index: number, label: number, options?: readonly string[]): FormTurn => ({
    author: "agent",
    ts: stamp(index),
    body:
      `Question ${label}\n\n\`\`\`form\nprompt: Pick ${label}\noptions:\n` +
      (options ?? [`F${label}-yes`, `F${label}-no`]).map((option) => `  - "${option}"`).join("\n") +
      "\n```\n",
  });

  const answer = (index: number, option: string, author = "user"): FormTurn => ({
    author,
    ts: stamp(index),
    body: `${FORM_ANSWER_LABEL} ${option}`,
  });

  const plain = (index: number, author = "user"): FormTurn => ({
    author,
    ts: stamp(index),
    body: "Just talking.",
  });

  const unanswered = (turns: readonly FormTurn[]): string[] =>
    readThreadForms(turns)
      .map((state, index) => (state.answered === false ? turns[index]?.ts : undefined))
      .filter((ts): ts is string => ts !== undefined);

  it("keeps the other form open when one of two is answered", () => {
    const turns = [plain(0), form(1, 1), form(2, 2), answer(3, "F1-yes")];
    expect(readThreadForms(turns)).toEqual([
      { hasForm: false, answered: null },
      { hasForm: true, answered: true },
      { hasForm: true, answered: false },
      { hasForm: false, answered: null },
    ]);
    expect(unanswered(turns)).toEqual([stamp(2)]);
  });

  it("clears once the last form is answered", () => {
    const turns = [form(0, 1), form(1, 2), answer(2, "F1-yes"), answer(3, "F2-no")];
    expect(unanswered(turns)).toEqual([]);
  });

  it("does not care in which order the forms are answered", () => {
    const turns = [form(0, 1), form(1, 2), answer(2, "F2-no")];
    expect(unanswered(turns)).toEqual([stamp(0)]);
    expect(unanswered([...turns, answer(3, "F1-yes")])).toEqual([]);
  });

  // The trap a bare count of answers falls into: §6 defines no once-only rule,
  // so a second answer to an already-answered form is an ordinary turn — and it
  // must not be allowed to close a *different* form that nobody answered.
  it("leaves an answer that no open form offers alone", () => {
    const turns = [form(0, 1), form(1, 2), answer(2, "F1-yes"), answer(3, "F1-yes")];
    expect(unanswered(turns)).toEqual([stamp(1)]);
    expect(unanswered([form(0, 1), answer(1, "not an option at all")])).toEqual([stamp(0)]);
  });

  // Same rule the renderer applies when it has no session pairing to go on.
  it("closes the earliest open form that offers the answered option", () => {
    const shared = ["Yes", "No"];
    const turns = [form(0, 1, shared), form(1, 2, shared), answer(2, "Yes")];
    expect(unanswered(turns)).toEqual([stamp(1)]);
  });

  it("gives a user turn quoting a fence no answered state", () => {
    const quoted: FormTurn = { ...form(0, 1), author: "user" };
    expect(readThreadForms([quoted])).toEqual([{ hasForm: true, answered: null }]);
  });

  it("treats an agent turn that answers its own form as the answer", () => {
    const turns = [form(0, 1), answer(1, "F1-yes", "agent")];
    expect(unanswered(turns)).toEqual([]);
  });

  // Wave-3 audit FIX 10. Only a hand-edited file produces this turn — the
  // answer route writes the label and the note and nothing else — but
  // `POST …/turns/{ts}/form` accepts an answer for it all the same (it asks
  // only whether an agent turn's body parses as a form), so a state of `null`
  // here meant the server advertised no question it was perfectly willing to
  // answer.
  describe("a turn that both answers a form and carries one", () => {
    /** An agent turn whose first line answers `option` and whose body carries form `label`. */
    const answeringForm = (index: number, option: string, label: number): FormTurn => ({
      author: "agent",
      ts: stamp(index),
      body: `${FORM_ANSWER_LABEL} ${option}\n\n${form(index, label).body}`,
    });

    it("closes the earlier form and opens its own", () => {
      const turns = [form(0, 1), answeringForm(1, "F1-yes", 2)];
      expect(readThreadForms(turns)).toEqual([
        { hasForm: true, answered: true },
        { hasForm: true, answered: false },
      ]);
      expect(unanswered(turns)).toEqual([stamp(1)]);
    });

    it("can then be answered like any other form, so the reason clears", () => {
      const turns = [form(0, 1), answeringForm(1, "F1-yes", 2), answer(2, "F2-no")];
      expect(unanswered(turns)).toEqual([]);
    });

    it("never answers itself, however its own options read", () => {
      // The turn's option is one of the form it carries — it must still be the
      // *earlier* form that closes, and its own must stay open.
      const turns = [form(0, 2), answeringForm(1, "F2-no", 2)];
      expect(unanswered(turns)).toEqual([stamp(1)]);
    });

    it("opens its form even when its answer matches nothing", () => {
      const turns = [answeringForm(0, "nothing offers this", 1)];
      expect(unanswered(turns)).toEqual([stamp(0)]);
    });

    // Pinned as the *agreement* it now is: the renderer's `mapFormAnswers`
    // used to `continue` past its own registration on such a turn and leave the
    // form live forever, and UI-021 converged it on this side, because §10's
    // reasons have to be clearable (SERVER-022 finding 3). Its paired block —
    // `apps/ui/src/thread/parseFormBlock.test.ts`, same name, same four cases —
    // is what keeps the two readers from drifting apart again.
    it("agrees with the renderer, which now clears that form too", () => {
      const turns = [form(0, 1), answeringForm(1, "F1-yes", 2), answer(2, "F2-no")];
      expect(readThreadForms(turns)[1]).toEqual({ hasForm: true, answered: true });
    });
  });

  // The evaluator's FINDING-3 on SERVER-032. It survives only for the **short**
  // spelling, which names an option and no question at all — there is nothing
  // else in those bytes to pair on. Every answer the server writes now names its
  // questions, so the case below is reachable only for turns committed before
  // SERVER-068 (see the block after this one).
  it("mis-attributes a repeated short answer when two open forms share an option string", () => {
    const shared = ["same", "other"];
    const turns = [form(0, 1, shared), form(1, 2, ["same", "other2"]), answer(2, "same")];
    expect(unanswered(turns)).toEqual([stamp(1)]);
    // Answering form 1 a second time retires form 2, which nobody answered.
    expect(unanswered([...turns, answer(3, "same")])).toEqual([]);
  });

  // SERVER-068. The answer names, for every field the form asked, the question
  // and what was given for it — so pairing is a content question, and the
  // failures the order rule had are not reachable through it.
  describe("pairing by content", () => {
    const rich = (index: number, label: number): FormTurn => ({
      author: "agent",
      ts: stamp(index),
      body: `Question ${label}\n\n\`\`\`form\nfields:\n  - question: "Pick ${label}"\n    kind: "choose one"\n    options:\n      - "same"\n      - "other"\n\`\`\`\n`, // prettier-ignore
    });

    const formOf = (turn: FormTurn): Form => {
      const reading = readForm(turn.body);
      if (!reading.ok) throw new Error("fixture is not a form");
      return reading.form;
    };

    const answering = (index: number, target: FormTurn, request: FormAnswerRequest): FormTurn => ({
      author: "user",
      ts: stamp(index),
      body: formatFormAnswerBody({
        answers: formAnswerRecords(formOf(target), request),
        note: request.note ?? null,
      }),
    });

    it("closes the form whose questions the answer names, not the earliest", () => {
      const first = rich(0, 1);
      const second = rich(1, 2);
      const turns = [
        first,
        second,
        answering(2, second, { answers: [{ question: "Pick 2", option: "same" }] }),
      ];
      // Both forms offer `same`; the order rule would have closed the first.
      expect(unanswered(turns)).toEqual([stamp(0)]);
    });

    it("leaves both open when the answer names a question neither asks", () => {
      const other = rich(9, 3);
      const turns = [
        rich(0, 1),
        rich(1, 2),
        answering(2, other, { answers: [{ question: "Pick 3", option: "same" }] }),
      ];
      expect(unanswered(turns)).toEqual([stamp(0), stamp(1)]);
    });

    it("does not let a repeated answer close a form nobody answered", () => {
      const first = rich(0, 1);
      const turns = [
        first,
        rich(1, 2),
        answering(2, first, { answers: [{ question: "Pick 1", option: "same" }] }),
        answering(3, first, { answers: [{ question: "Pick 1", option: "other" }] }),
      ];
      expect(unanswered(turns)).toEqual([stamp(1)]);
    });

    it("still mis-attributes two open forms asking a literally identical question", () => {
      // The residual §6 accepts: with no form id in the prose, identical
      // questions are indistinguishable. Documented, not closed.
      const twin = rich(0, 1);
      const turns = [
        twin,
        { ...rich(1, 1), ts: stamp(1) },
        answering(2, twin, { answers: [{ question: "Pick 1", option: "same" }] }),
      ];
      expect(unanswered(turns)).toEqual([stamp(1)]);
    });

    it("reads a mixed thread: a legacy form and answer beside a multi-field pair", () => {
      const legacy = form(0, 1);
      const modern = rich(1, 2);
      const turns = [
        legacy,
        modern,
        answer(2, "F1-yes"),
        answering(3, modern, { answers: [{ question: "Pick 2", option: "other" }] }),
      ];
      expect(unanswered(turns)).toEqual([]);
    });
  });

  describe("isFormAnswered", () => {
    it("answers per form, by the turn that carries it", () => {
      const turns = [form(0, 1), form(1, 2), answer(2, "F1-yes")];
      expect(isFormAnswered(turns, stamp(0))).toBe(true);
      expect(isFormAnswered(turns, stamp(1))).toBe(false);
    });

    it("is false for a turn that carries no form, and for a stamp nothing carries", () => {
      const turns = [plain(0), form(1, 1)];
      expect(isFormAnswered(turns, stamp(0))).toBe(false);
      expect(isFormAnswered(turns, "2026-07-30T23:59:00Z")).toBe(false);
    });
  });

  it("says nothing at all about a thread with no forms", () => {
    expect(readThreadForms([plain(0), plain(1, "agent")])).toEqual([
      { hasForm: false, answered: null },
      { hasForm: false, answered: null },
    ]);
    expect(readThreadForms([])).toEqual([]);
  });
});
