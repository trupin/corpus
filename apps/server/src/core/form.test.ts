import { FORM_ANSWER_LABEL } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { answeredOption, readForm, readThreadForms, type FormTurn } from "./form.js";

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

describe("readForm", () => {
  it("reads a well-formed fence", () => {
    const reading = readForm(fenced("form", YAML_BODY));
    expect(reading.ok).toBe(true);
    expect(reading.ok && reading.form).toEqual({ prompt: "Ship it?", options: ["Yes", "No"] });
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

describe("answeredOption", () => {
  it("reads the option off the label, and nothing else", () => {
    expect(answeredOption(`${FORM_ANSWER_LABEL} 6.4%`)).toBe("6.4%");
    expect(answeredOption(`${FORM_ANSWER_LABEL} Yes\n\nwith caveats`)).toBe("Yes");
    expect(answeredOption(`${FORM_ANSWER_LABEL}`)).toBeUndefined();
    expect(answeredOption(`${FORM_ANSWER_LABEL}   `)).toBeUndefined();
    expect(answeredOption("Answered: Yes")).toBeUndefined();
    expect(answeredOption(`prose\n${FORM_ANSWER_LABEL} Yes`)).toBeUndefined();
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

    // The one place this reader is deliberately wider than the renderer's
    // `mapFormAnswers`, which `continue`s past its own registration on such a
    // turn and so leaves the form live forever. Pinned so the divergence is a
    // decision rather than a surprise; the UI follow-up converges on this side,
    // because §11's reasons have to be clearable (SERVER-022 finding 3).
    it("diverges from the renderer, which would leave that form unanswerable", () => {
      const turns = [form(0, 1), answeringForm(1, "F1-yes", 2), answer(2, "F2-no")];
      expect(readThreadForms(turns)[1]).toEqual({ hasForm: true, answered: true });
    });
  });

  // The evaluator's FINDING-3 on SERVER-032, kept as a test because it is the
  // documented *limit* of order-based attribution rather than a defect to fix
  // here: an exact pairing needs the form's `ts` in the answer turn's wire
  // format, which is SPEC §6's grammar and the renderer's reader as much as it
  // is this module (see the docblock; filed as a P3).
  it("mis-attributes a repeated answer when two open forms share an option string", () => {
    const shared = ["same", "other"];
    const turns = [form(0, 1, shared), form(1, 2, ["same", "other2"]), answer(2, "same")];
    expect(unanswered(turns)).toEqual([stamp(1)]);
    // Answering form 1 a second time retires form 2, which nobody answered.
    expect(unanswered([...turns, answer(3, "same")])).toEqual([]);
  });

  it("says nothing at all about a thread with no forms", () => {
    expect(readThreadForms([plain(0), plain(1, "agent")])).toEqual([
      { hasForm: false, answered: null },
      { hasForm: false, answered: null },
    ]);
    expect(readThreadForms([])).toEqual([]);
  });
});
