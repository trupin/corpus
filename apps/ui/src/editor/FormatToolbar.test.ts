import type { Editor } from "@tiptap/react";
import { describe, expect, it } from "vitest";
import { alignValue, headingValue, indentValue, roleValue } from "./FormatToolbar.js";

/**
 * The four readers that make the toolbar **report state** — the half of SPEC
 * §10's rider a toolbar that only wrote would skip.
 *
 * They are tested against a stand-in rather than a mounted editor because what
 * is being checked is the mapping from "what the editor says is active" to "what
 * the control shows", and a real editor would only make that mapping harder to
 * see. The commands themselves are exercised in the browser
 * (`apps/ui/e2e/format-toolbar.spec.ts`), where a wrong one shows up in the
 * saved file.
 */
function stub(options: {
  active?: readonly (readonly [string, Record<string, unknown> | undefined])[];
  attrs?: Readonly<Record<string, Record<string, unknown>>>;
}): Editor {
  const active = options.active ?? [];
  return {
    isActive: (name: string, attrs?: Record<string, unknown>) =>
      active.some(
        ([activeName, activeAttrs]) =>
          activeName === name &&
          (attrs === undefined ||
            Object.entries(attrs).every(([key, value]) => activeAttrs?.[key] === value)),
      ),
    getAttributes: (name: string) => options.attrs?.[name] ?? {},
  } as unknown as Editor;
}

describe("headingValue", () => {
  it("names the level the caret is in", () => {
    expect(headingValue(stub({ active: [["heading", { level: 2 }]] }))).toBe("2");
    expect(headingValue(stub({ active: [["heading", { level: 6 }]] }))).toBe("6");
  });

  it("says Text when the caret is in no heading", () => {
    expect(headingValue(stub({}))).toBe("0");
    expect(headingValue(stub({ active: [["paragraph", undefined]] }))).toBe("0");
  });
});

describe("roleValue", () => {
  it("reports a named role", () => {
    expect(roleValue(stub({ attrs: { styleSpan: { color: "warning" } } }))).toBe("warning");
  });

  it("reports nothing for a span carrying no colour, or one carrying a colour §5 never named", () => {
    expect(roleValue(stub({ attrs: { styleSpan: { color: null } } }))).toBe("");
    expect(roleValue(stub({ attrs: { styleSpan: { color: "chartreuse" } } }))).toBe("");
    expect(roleValue(stub({}))).toBe("");
  });
});

describe("alignValue and indentValue", () => {
  it("report the styled block's layout", () => {
    const editor = stub({ attrs: { styledBlock: { align: "center", indent: 2 } } });
    expect(alignValue(editor)).toBe("center");
    expect(indentValue(editor)).toBe("2");
  });

  it("report nothing when the caret is in no styled block", () => {
    expect(alignValue(stub({}))).toBe("");
    expect(indentValue(stub({}))).toBe("");
  });

  it("report each property independently, because a block may carry only one", () => {
    const aligned = stub({ attrs: { styledBlock: { align: "right", indent: null } } });
    expect(alignValue(aligned)).toBe("right");
    expect(indentValue(aligned)).toBe("");
    const indented = stub({ attrs: { styledBlock: { align: null, indent: 3 } } });
    expect(alignValue(indented)).toBe("");
    expect(indentValue(indented)).toBe("3");
  });
});
