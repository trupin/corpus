import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HEADING_PATH_SEPARATOR } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { CliError, UsageError } from "../../errors.js";
import { documentSections, selectSection, MAX_LISTED_PATHS } from "./sections.js";

/**
 * The slicing, and the one property every test below is really asserting:
 * **what comes out is a substring of what went in**. `corpus doc patch --old`
 * is matched byte for byte against the same body, so a section that has been
 * trimmed, re-wrapped or ellipsized is not a smaller read — it is a read that
 * cannot be written back, which is precisely what `corpus search`'s snippet
 * turned out to be (CLI-055).
 */

const TITLE = "Mortgage options";

const BODY = [
  "# Mortgage options",
  "",
  "Opening paragraph.",
  "",
  "## Rates",
  "",
  "The rate lock runs 30 days.",
  "",
  "### Fixed",
  "",
  "30-year fixed at 6.1%.",
  "",
  "## Escrow",
  "",
  "The escrow reserve is recalculated annually.",
  "It draws on the impound account,",
  "and the true-up arrives in February.",
  "",
].join("\n");

const paths = (body: string, title = TITLE): readonly string[] =>
  documentSections(body, title).map((section) => section.headingPath);

const sectionText = (body: string, path: string, title = TITLE): string =>
  selectSection(documentSections(body, title), "doc_a1b2c3", path, undefined).text;

/** The refusal a call threw, or a failure naming what it returned instead. */
function refusal(run: () => unknown): CliError {
  try {
    const value = run();
    throw new Error(`expected a refusal, got ${JSON.stringify(value)}`);
  } catch (error) {
    if (error instanceof CliError) return error;
    throw error;
  }
}

describe("documentSections", () => {
  it("addresses every section the way `corpus search --json` addresses a hit", () => {
    expect(paths(BODY)).toEqual([
      "Mortgage options",
      `Mortgage options${HEADING_PATH_SEPARATOR}Rates`,
      `Mortgage options${HEADING_PATH_SEPARATOR}Rates${HEADING_PATH_SEPARATOR}Fixed`,
      `Mortgage options${HEADING_PATH_SEPARATOR}Escrow`,
    ]);
  });

  it("slices bytes, so every section is a substring of the body it came from", () => {
    for (const section of documentSections(BODY, TITLE)) {
      expect(BODY.slice(section.start, section.end)).toBe(section.text);
      expect(BODY).toContain(section.text);
      expect(BODY.indexOf(section.text)).toBe(section.start);
    }
  });

  it("covers the body exactly once, end to end, with no gap and no overlap", () => {
    const sections = documentSections(BODY, TITLE);
    expect(sections.map((section) => section.text).join("")).toBe(BODY);
  });

  it("starts a section at its own heading line and ends it before the next that closes it", () => {
    expect(sectionText(BODY, `Mortgage options${HEADING_PATH_SEPARATOR}Escrow`)).toBe(
      [
        "## Escrow",
        "",
        "The escrow reserve is recalculated annually.",
        "It draws on the impound account,",
        "and the true-up arrives in February.",
        "",
      ].join("\n"),
    );
  });

  it("keeps a multi-line passage's newlines, which is the case the search snippet loses", () => {
    const escrow = sectionText(BODY, `Mortgage options${HEADING_PATH_SEPARATOR}Escrow`);
    expect(escrow).toContain("impound account,\nand the true-up");
    expect(escrow).not.toContain("…");
  });

  it("stops a parent section at its first child rather than swallowing it", () => {
    expect(sectionText(BODY, `Mortgage options${HEADING_PATH_SEPARATOR}Rates`)).toBe(
      // The blank line before `### Fixed` belongs to `## Rates` — it is
      // verbatim, so the boundary is the next heading's first character and
      // nothing is tidied away on the way out.
      ["## Rates", "", "The rate lock runs 30 days.", "", ""].join("\n"),
    );
  });

  it("reports levels, so a caller can see the shape without splitting a path", () => {
    expect(documentSections(BODY, TITLE).map((section) => section.level)).toEqual([1, 2, 3, 2]);
  });

  it("addresses text above the first heading by the document's title", () => {
    const body = "Just a note.\n\n## Rates\n\n6.1%.\n";
    // The title is a *floor* for a passage with no heading above it, never a
    // prefix on one that has: `Rates` is addressed by its own heading alone,
    // exactly as the server's `renderHeadingPath` reports it.
    expect(paths(body)).toEqual([TITLE, "Rates"]);
    expect(sectionText(body, TITLE)).toBe("Just a note.\n\n");
  });

  it("makes a document with no headings one section, the whole body, addressed by its title", () => {
    const body = "30-year fixed at 6.1%.\n";
    expect(paths(body)).toEqual([TITLE]);
    expect(sectionText(body, TITLE)).toBe(body);
  });

  it("drops a blank preamble rather than offering an empty section that collides with the H1", () => {
    // `# Mortgage options` opens the body, so the preamble is "" and its
    // title-derived address would be the same string as the H1's.
    expect(paths(BODY).filter((path) => path === TITLE)).toHaveLength(1);
    expect(paths("\n\n# Mortgage options\n\nText.\n")).toEqual([TITLE]);
  });

  it("has no sections at all for an empty body", () => {
    expect(documentSections("", TITLE)).toEqual([]);
    expect(documentSections("   \n\n", TITLE)).toEqual([]);
  });

  it("reads a `## Rates` inside a fenced block as prose, exactly as the server's scan does", () => {
    const body = ["# Guide", "", "```md", "## Rates", "", "not a heading", "```", ""].join("\n");
    expect(paths(body)).toEqual(["Guide"]);
    expect(sectionText(body, "Guide")).toBe(body);
  });

  it("ignores an indented four-space `#`, which CommonMark makes a code block", () => {
    expect(paths("# Guide\n\n    # Not a heading\n")).toEqual(["Guide"]);
  });

  it("strips a closing sequence, because `## Rates ##` names the same section as `## Rates`", () => {
    expect(paths("## Rates ##\n\n6.1%.\n")).toEqual(["Rates"]);
  });

  it("drops an unnamed heading from the path while still letting it close its level", () => {
    // `##` with nothing after it closes `## Rates` without naming a section of
    // its own, so the text under it is addressed by the document's title.
    expect(paths("## Rates\n\n6.1%.\n\n##\n\nAfterwards.\n")).toEqual(["Rates", TITLE]);
  });

  it("re-opens a level after a deeper one, so a sibling is not nested under its cousin", () => {
    expect(paths("## Rates\n\n### Fixed\n\nx\n\n## Escrow\n\ny\n")).toEqual([
      "Rates",
      `Rates${HEADING_PATH_SEPARATOR}Fixed`,
      "Escrow",
    ]);
  });

  it("addresses a thread turn by its own heading, the way a turn hit is addressed", () => {
    // The server rebuilds a turn hit's address as `<author> · <ts>`, and the
    // body's own heading line says the same thing — so a turn found by search
    // is readable by the path search reported.
    const body = "## agent · 2026-07-28T10:00:00Z\n\nA reply.\n";
    expect(paths(body, "A thread")).toEqual(["agent · 2026-07-28T10:00:00Z"]);
  });
});

describe("selectSection", () => {
  const sections = documentSections(BODY, TITLE);

  it("returns the one section a path names", () => {
    expect(
      selectSection(sections, "doc_a1b2c3", `${TITLE}${HEADING_PATH_SEPARATOR}Rates`, undefined)
        .headingPath,
    ).toBe(`${TITLE}${HEADING_PATH_SEPARATOR}Rates`);
  });

  it("refuses a path that names nothing, and never falls back to the whole body", () => {
    const error = refusal(() => selectSection(sections, "doc_a1b2c3", "Rates", undefined));

    expect(error.message).toContain('--section "Rates" names no section of doc_a1b2c3');
    expect(error.message).toContain("nothing was printed");
    // The body is not in the error by any route — not the message, not the
    // hint, not the rendered detail lines. Printing it would be the whole cost
    // this flag removes, arriving as a consolation prize.
    expect(
      `${error.message}${error.hint ?? ""}${(error.detailLines ?? []).join("")}`,
    ).not.toContain("escrow reserve");
  });

  it("lists the paths that do exist, so the recovery costs no second request", () => {
    const error = refusal(() => selectSection(sections, "doc_a1b2c3", "Rates", undefined));

    expect(error.detailLines?.join("\n")).toContain(`    ${TITLE}${HEADING_PATH_SEPARATOR}Escrow`);
    expect(error.details).toMatchObject({
      headingPath: "Rates",
      matches: 0,
      headingPaths: sections.map((section) => section.headingPath),
    });
  });

  it("points at --headings rather than listing hundreds of paths", () => {
    const many = Array.from({ length: MAX_LISTED_PATHS + 5 }, (_, index) =>
      ["## Section " + String(index), "", "text", ""].join("\n"),
    ).join("\n");
    const error = refusal(() =>
      selectSection(documentSections(many, TITLE), "doc_a1b2c3", "nope", undefined),
    );

    const lines = error.detailLines ?? [];
    expect(lines).toHaveLength(MAX_LISTED_PATHS + 1);
    expect(lines.at(-1)).toContain("and 5 more");
    expect(lines.at(-1)).toContain("corpus doc show doc_a1b2c3 --headings");
  });

  it("says plainly when the document has no sections to name", () => {
    const error = refusal(() => selectSection([], "doc_a1b2c3", "Rates", undefined));

    expect(error.hint).toContain("no readable sections");
    expect(error.detailLines).toEqual([]);
  });

  it("refuses a path naming two sections instead of guessing which was meant", () => {
    const repeated = documentSections("## Notes\n\nfirst\n\n## Notes\n\nsecond\n", TITLE);
    const error = refusal(() => selectSection(repeated, "doc_a1b2c3", "Notes", undefined));

    expect(error.message).toContain('--section "Notes" names 2 sections of doc_a1b2c3');
    expect(error.hint).toContain("--nth 1 … --nth 2");
    expect(error.detailLines?.[0]).toContain("--nth 1 · chars 0–");
    expect(error.details).toMatchObject({ headingPath: "Notes", matches: 2 });
  });

  it("chooses between them with --nth, in document order", () => {
    const repeated = documentSections("## Notes\n\nfirst\n\n## Notes\n\nsecond\n", TITLE);

    expect(selectSection(repeated, "doc_a1b2c3", "Notes", 1).text).toBe("## Notes\n\nfirst\n\n");
    expect(selectSection(repeated, "doc_a1b2c3", "Notes", 2).text).toBe("## Notes\n\nsecond\n");
  });

  it("accepts --nth 1 on a path that names only one section", () => {
    expect(
      selectSection(sections, "doc_a1b2c3", `${TITLE}${HEADING_PATH_SEPARATOR}Escrow`, 1).level,
    ).toBe(2);
  });

  it("refuses an --nth past the end, naming the count", () => {
    const error = refusal(() =>
      selectSection(sections, "doc_a1b2c3", `${TITLE}${HEADING_PATH_SEPARATOR}Escrow`, 2),
    );

    expect(error.message).toContain("--nth 2 is out of range");
    expect(error.message).toContain("names 1 section of doc_a1b2c3");
    expect(error.hint).toContain("between 1 and 1");
    // The prose is the human rendering; the count reaches a machine caller
    // through `details` rather than as a JSON dump under the hint.
    expect(error.detailLines).toEqual([]);
    expect(error.details).toMatchObject({ matches: 1, nth: 2 });
  });

  it("matches the whole path exactly, never a suffix and never a near miss", () => {
    // A heading may contain the separator, so a path is a display join that is
    // printed and never split — which is only sound if matching is equality.
    for (const near of ["Escrow", "Mortgage options > Escrow", " Mortgage options › Escrow"]) {
      expect(() => selectSection(sections, "doc_a1b2c3", near, undefined)).toThrow(UsageError);
    }
  });
});

/**
 * The scan is a copy of `apps/server/src/core/headings.ts`, which `apps/cli`
 * cannot import: it depends on `@corpus/contract` alone, and that module is not
 * on the server's published surface. A copy drifts, and a drifted copy here
 * means `--section` reads a different section from the one `corpus search`
 * addressed — the two verbs stop composing, silently.
 *
 * So the copy is asserted against its original. This test fails on either side
 * moving, and the fix is never to update one of the two literals: it is to make
 * both match, or to move the scan into `@corpus/contract` beside the
 * `splitLines`/`fencedCodeRanges` primitives it already builds on, which is the
 * end state this duplication is standing in for.
 */
describe("the heading scan is the server's, not a second opinion", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const read = (path: string): Promise<string> => readFile(join(here, path), "utf8");

  it("shares the ATX grammar, the closing sequence and the fence mask, character for character", async () => {
    const [mine, theirs] = await Promise.all([
      read("./sections.ts"),
      read("../../../../server/src/core/headings.ts"),
    ]);

    for (const shared of [
      "const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \\t]+(.*))?$/;",
      "const CLOSING_SEQUENCE = /[ \\t]+#+[ \\t]*$/;",
      "if (overlapsRange(fenced, line.start, line.contentEnd)) continue;",
      "while ((stack[stack.length - 1]?.level ?? 0) >= level) stack.pop();",
      'headings = stack.map((heading) => heading.text).filter((heading) => heading !== "");',
    ]) {
      expect(theirs, `apps/server/src/core/headings.ts no longer contains: ${shared}`).toContain(
        shared,
      );
      expect(mine, `doc/sections.ts no longer contains: ${shared}`).toContain(shared);
    }
  });

  it("joins a path the way the server's chunker does, from the contract's own separator", async () => {
    const chunker = await read("../../../../server/src/semantic/chunker.ts");

    expect(chunker).toContain(
      "headings.length === 0 ? title : headings.join(HEADING_PATH_SEPARATOR)",
    );
    expect(await read("./sections.ts")).toContain(
      "headings.length === 0 ? title : headings.join(HEADING_PATH_SEPARATOR)",
    );
  });
});
