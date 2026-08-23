import { describe, expect, it } from "vitest";
import { countWords, gloss, MAX_GLOSS_WORDS } from "./gloss.js";
import { registry } from "./registry/index.js";
import { GLOBAL_FLAGS } from "./registry/globals.js";
import type { ArgSpec, CommandSpec, FlagSpec } from "./registry/types.js";

describe("gloss", () => {
  it.each([
    ["a plain sentence", "Replace the title. Everything else is left alone.", "Replace the title."],
    ["the whole string when nothing terminates it", "Comma-separated tags", "Comma-separated tags"],
    ["one sentence when that is all there is", "Actually delete.", "Actually delete."],
    ["a question", "Whether to keep it? The default is no.", "Whether to keep it?"],
  ])("takes %s", (_label, description, expected) => {
    expect(gloss(description)).toBe(expected);
  });

  it("ignores a full stop inside a code span", () => {
    expect(gloss("Documents under `data/docs/x.md`. Nothing else.")).toBe(
      "Documents under `data/docs/x.md`.",
    );
    expect(gloss("Reads `a.b.c` and stops here. Then more.")).toBe("Reads `a.b.c` and stops here.");
  });

  it("ignores a full stop that is part of a reference or a number", () => {
    expect(gloss("Set per SPEC.md §9.2 and no further. More prose.")).toBe(
      "Set per SPEC.md §9.2 and no further.",
    );
    expect(gloss("A ratio of 1.5 at most. More prose.")).toBe("A ratio of 1.5 at most.");
  });

  it("ignores a full stop that ends an abbreviation", () => {
    expect(gloss("A type, e.g. `note`, that this workspace uses. More prose.")).toBe(
      "A type, e.g. `note`, that this workspace uses.",
    );
  });

  it("carries closing markup across the terminator", () => {
    // Registry prose is markdown, and a bolded opening sentence puts the full
    // stop *inside* the emphasis: `…scope.**`. Stopping at the `.` would leave
    // an unclosed `**`, and refusing to stop there ran the gloss into the next
    // three paragraphs — which is what the pre-fix measurement showed.
    expect(gloss("**A view's stored query.** Repeatable `key=value` pairs.")).toBe(
      "**A view's stored query.**",
    );
    expect(gloss("The root (SPEC.md §7 gives it one). And then more.")).toBe(
      "The root (SPEC.md §7 gives it one).",
    );
  });

  it("stops at a blank line even mid-sentence", () => {
    expect(gloss("An unterminated opener\n\nA second paragraph.")).toBe("An unterminated opener");
  });

  it("trims surrounding whitespace", () => {
    expect(gloss("  Padded. More.  ")).toBe("Padded.");
  });
});

describe("countWords", () => {
  it.each([
    ["", 0],
    ["   ", 0],
    ["one", 1],
    [" two  words \n here ", 3],
  ])("counts %j as %i", (text, expected) => {
    expect(countWords(text)).toBe(expected);
  });
});

/**
 * CLI-056's acceptance criterion, over the real surface: every flag and every
 * argument the tool ships renders a gloss, and none of them renders a paragraph
 * pretending to be one. `registry/validate.ts` enforces this at module load, so
 * this test is the readable statement of what that enforcement buys.
 */
describe("the shipped registry", () => {
  const commands: readonly (readonly [string, CommandSpec])[] = [
    ...registry.commands.map((command) => [`corpus ${command.name}`, command] as const),
    ...registry.topics.flatMap((topic) =>
      topic.commands.map((command) => [`corpus ${topic.name} ${command.name}`, command] as const),
    ),
  ];

  const declarations: readonly (readonly [string, ArgSpec | FlagSpec])[] = [
    ...GLOBAL_FLAGS.map((flag) => [`global --${flag.name}`, flag] as const),
    ...commands.flatMap(([path, command]) => [
      ...command.args.map((arg) => [`${path} <${arg.name}>`, arg] as const),
      ...command.flags.map((flag) => [`${path} --${flag.name}`, flag] as const),
    ]),
  ];

  it("declares something to gloss", () => {
    expect(declarations.length).toBeGreaterThan(150);
  });

  it.each(declarations)("glosses %s in one short sentence", (_label, declaration) => {
    const line = gloss(declaration.description);
    expect(line).not.toBe("");
    expect(countWords(line)).toBeLessThanOrEqual(MAX_GLOSS_WORDS);
  });
});
