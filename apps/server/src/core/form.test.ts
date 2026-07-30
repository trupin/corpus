import { FORM_ANSWER_LABEL } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { answeredOption, carriesForm, readForm, readThreadForms, type FormTurn } from "./form.js";

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

  it("says nothing at all about a thread with no forms", () => {
    expect(readThreadForms([plain(0), plain(1, "agent")])).toEqual([
      { hasForm: false, answered: null },
      { hasForm: false, answered: null },
    ]);
    expect(readThreadForms([])).toEqual([]);
  });
});
