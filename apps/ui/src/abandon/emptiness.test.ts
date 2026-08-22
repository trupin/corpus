import { describe, expect, it } from "vitest";
import { UNTITLED_DOCUMENT_TITLE } from "../board/useCreateInColumn";
import { isAbandonable, isBlankBody, isBlankTitle, type DocSnapshot } from "./emptiness";

/**
 * SPEC.md §10's emptiness, at its seam.
 *
 * Both branches of every clause are pinned: the conjunction (a title alone and
 * a body alone each save the document), the placeholder (which is not a title),
 * whitespace and the markers the editor leaves behind, and the two guards that
 * keep the rule from destroying content that lives somewhere other than the
 * body.
 */

function snapshot(overrides: Partial<DocSnapshot> = {}): DocSnapshot {
  return {
    type: "note",
    title: "",
    body: "",
    threadCount: 0,
    pristineBody: null,
    hasExtra: false,
    ...overrides,
  };
}

/** What `corpus init`'s shipped `note` template puts in a new document. */
const TEMPLATE = "## Context\n\n## Notes\n\n## Open questions\n";

describe("isBlankTitle", () => {
  it.each([
    ["", true],
    ["   ", true],
    ["\n\t ", true],
    [UNTITLED_DOCUMENT_TITLE, true],
    [`  ${UNTITLED_DOCUMENT_TITLE}  `, true],
    ["Untitled thoughts", false],
    ["untitled", false],
    ["Mortgage options", false],
    ["7", false],
  ])("%j is blank: %s", (title, expected) => {
    expect(isBlankTitle(title)).toBe(expected);
  });
});

describe("isBlankBody", () => {
  it.each([
    ["", true],
    ["   ", true],
    ["\n\n\n", true],
    [" \n\t\n ", true],
    ["#", true],
    ["##  ", true],
    ["###### ", true],
    ["-", true],
    ["*", true],
    ["+", true],
    [">", true],
    ["1.", true],
    ["2)", true],
    ["#\n\n-\n\n", true],
    ["# Heading", false],
    ["- a bullet", false],
    ["text", false],
    ["\n\nrates are 6.4%\n", false],
    ["####### seven hashes is a paragraph", false],
  ])("%j is blank: %s", (body, expected) => {
    expect(isBlankBody(body)).toBe(expected);
  });
});

describe("isAbandonable", () => {
  it("removes a document with neither a title nor a body", () => {
    expect(isAbandonable(snapshot({ title: UNTITLED_DOCUMENT_TITLE, body: "" }))).toBe(true);
  });

  it("keeps a document that has only a title", () => {
    expect(isAbandonable(snapshot({ title: "Quarterly planning", body: "" }))).toBe(false);
  });

  it("keeps a document that has only a body", () => {
    expect(isAbandonable(snapshot({ title: UNTITLED_DOCUMENT_TITLE, body: "a thought" }))).toBe(
      false,
    );
  });

  it("keeps a document that acquired a thread", () => {
    expect(isAbandonable(snapshot({ threadCount: 1 }))).toBe(false);
  });

  it("keeps a document whose content lives in frontmatter the core cannot read", () => {
    expect(isAbandonable(snapshot({ type: "todo", hasExtra: true }))).toBe(false);
  });

  it.each(["thread", "view"])("never removes a %s document", (type) => {
    expect(isAbandonable(snapshot({ type }))).toBe(false);
  });

  it("treats whitespace the editor left behind as no content", () => {
    expect(isAbandonable(snapshot({ title: "  ", body: "#\n\n \n" }))).toBe(true);
  });

  /*
   * SPEC.md §10's "Templates are documents": every workspace `corpus init`
   * creates ships a `note` template, so an untouched new note is never
   * literally blank. Found by the real-app drill.
   */
  it("treats an untouched template prefill as no content", () => {
    expect(
      isAbandonable(snapshot({ title: "Untitled", body: TEMPLATE, pristineBody: TEMPLATE })),
    ).toBe(true);
  });

  it("ignores a whitespace difference the editor's round trip introduced", () => {
    expect(
      isAbandonable(
        snapshot({
          title: "Untitled",
          body: "## Context\n\n## Notes\n\n## Open questions",
          pristineBody: TEMPLATE,
        }),
      ),
    ).toBe(true);
  });

  it("keeps a template the user actually wrote into", () => {
    expect(
      isAbandonable(
        snapshot({
          title: "Untitled",
          body: `${TEMPLATE}\nrates are 6.4%\n`,
          pristineBody: TEMPLATE,
        }),
      ),
    ).toBe(false);
  });

  it("keeps a templated body this session did not create", () => {
    // No pristine body to compare against: the honest answer is "there is
    // content here", not "guess it came from a template".
    expect(isAbandonable(snapshot({ title: "Untitled", body: TEMPLATE }))).toBe(false);
  });
});
