import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOC_FOLDER,
  DOCS_ROOT,
  MAX_SLUG_LENGTH,
  PathTraversalError,
  THREADS_ROOT,
  documentPathFor,
  isWorkspaceRelative,
  parseDocumentPath,
  resolveInWorkspace,
  slugifyTitle,
} from "./paths.js";

describe("slugifyTitle", () => {
  it.each([
    ["Mortgage Options — 2026!", "mortgage-options-2026"],
    ["  Leading and trailing  ", "leading-and-trailing"],
    ["Café Münster", "cafe-munster"],
    ["a/b\\c:d", "a-b-c-d"],
    ["___", ""],
    ["🎉", ""],
  ])("slugifies %s", (title, expected) => {
    expect(slugifyTitle(title)).toBe(expected);
  });

  it("caps the slug and never leaves a trailing hyphen", () => {
    const slug = slugifyTitle("word ".repeat(40));
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("documentPathFor", () => {
  it("flattens threads under data/threads regardless of any folder hint", () => {
    const thread = { id: "th_x9y8", type: "thread", title: "Re: assumption" };
    expect(documentPathFor(thread)).toBe(`${THREADS_ROOT}/th_x9y8.md`);
    expect(documentPathFor(thread, { folder: "finance" })).toBe(`${THREADS_ROOT}/th_x9y8.md`);
  });

  it("nests a document under the named folder", () => {
    expect(
      documentPathFor(
        { id: "doc_a1b2c3", type: "note", title: "Mortgage Options — 2026!" },
        { folder: "finance" },
      ),
    ).toBe(`${DOCS_ROOT}/finance/mortgage-options-2026.md`);
  });

  it("accepts a folder already expressed relative to the workspace", () => {
    expect(
      documentPathFor(
        { id: "doc_a1b2c3", type: "note", title: "Note" },
        { folder: "data/docs/finance" },
      ),
    ).toBe(`${DOCS_ROOT}/finance/note.md`);
  });

  it("lands an unspecified folder in the inbox", () => {
    expect(documentPathFor({ id: "doc_a1b2c3", type: "note", title: "Note" })).toBe(
      `${DOCS_ROOT}/${DEFAULT_DOC_FOLDER}/note.md`,
    );
  });

  it("puts a document at the docs root when the folder is the docs root itself", () => {
    for (const folder of ["", "/", DOCS_ROOT]) {
      expect(documentPathFor({ id: "doc_a1b2c3", type: "note", title: "Note" }, { folder })).toBe(
        `${DOCS_ROOT}/note.md`,
      );
    }
  });

  it("falls back to the id when the title slugifies to nothing", () => {
    expect(documentPathFor({ id: "doc_a1b2c3", type: "note", title: "🎉" })).toBe(
      `${DOCS_ROOT}/${DEFAULT_DOC_FOLDER}/doc_a1b2c3.md`,
    );
  });

  it("refuses a folder hint that would escape the workspace", () => {
    expect(() =>
      documentPathFor({ id: "doc_a1b2c3", type: "note", title: "Note" }, { folder: "../../etc" }),
    ).toThrow(PathTraversalError);
  });
});

describe("parseDocumentPath", () => {
  it("decomposes a thread path", () => {
    expect(parseDocumentPath("data/threads/th_x9y8.md")).toEqual({
      root: "threads",
      folder: "",
      filename: "th_x9y8.md",
    });
  });

  it("decomposes a nested document path", () => {
    expect(parseDocumentPath("data/docs/finance/mortgage.md")).toEqual({
      root: "docs",
      folder: "finance",
      filename: "mortgage.md",
    });
  });

  it("decomposes a document at the docs root", () => {
    expect(parseDocumentPath("data/docs/mortgage.md")).toEqual({
      root: "docs",
      folder: "",
      filename: "mortgage.md",
    });
  });

  it.each([
    ["../../etc/passwd"],
    ["/etc/passwd"],
    ["data/docs/../../escape.md"],
    ["C:/windows/system32.md"],
    [""],
    ["data/docs/notes.txt"],
    ["notes.md"],
    ["data/other/notes.md"],
    ["data/threads/nested/th_x9y8.md"],
    ["data/docs/"],
  ])("rejects %s", (path) => {
    expect(parseDocumentPath(path)).toBeNull();
  });

  it("normalizes a harmless `.` segment", () => {
    expect(parseDocumentPath("data/docs/./finance/mortgage.md")?.folder).toBe("finance");
  });
});

describe("isWorkspaceRelative", () => {
  it.each([
    ["data/docs/a.md", true],
    ["data/docs/../threads/a.md", true],
    ["./a.md", true],
    ["..", false],
    ["../a.md", false],
    ["/a.md", false],
    ["C:\\a.md", false],
    ["", false],
  ])("classifies %s as %s", (path, expected) => {
    expect(isWorkspaceRelative(path)).toBe(expected);
  });
});

describe("resolveInWorkspace", () => {
  it("joins a relative path onto the workspace root", () => {
    expect(resolveInWorkspace("/tmp/ws", "data/docs/a.md")).toBe("/tmp/ws/data/docs/a.md");
  });

  it.each([["../escape.md"], ["/etc/passwd"], ["data/../../escape.md"]])(
    "throws for %s",
    (path) => {
      expect(() => resolveInWorkspace("/tmp/ws", path)).toThrow(PathTraversalError);
    },
  );

  it("names the offending path on the error", () => {
    try {
      resolveInWorkspace("/tmp/ws", "/etc/passwd");
      expect.unreachable("expected PathTraversalError");
    } catch (error) {
      expect((error as PathTraversalError).name).toBe("PathTraversalError");
      expect((error as PathTraversalError).path).toBe("/etc/passwd");
    }
  });
});
