import { describe, expect, it } from "vitest";
import { carriesForm, readForm } from "./form.js";

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
