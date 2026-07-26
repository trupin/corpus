import { describe, expect, it } from "vitest";
import type { TextQuoteSelector } from "@corpus/contract";
import type { AnchorResolver, CheckDocument } from "./check.js";
import { CHECK_CODES, checkCorpus, toCheckDocument } from "./check.js";

/** Stand-in for SERVER-002's engine: enough to prove injection, not the ladder. */
const substringResolver: AnchorResolver = (body, selector) => {
  const start = body.indexOf(selector.exact);
  return start === -1 ? null : { start, end: start + selector.exact.length };
};

type Fields = Record<string, unknown>;

const yaml = (fields: Fields, indent = ""): string =>
  Object.entries(fields)
    .map(([key, value]) => {
      if (value !== null && typeof value === "object" && !Array.isArray(value))
        return `${indent}${key}:\n${yaml(value as Fields, `${indent}  `)}`;
      return `${indent}${key}: ${JSON.stringify(value)}`;
    })
    .join("\n");

const doc = (path: string, fields: Fields, body = "Body.\n"): CheckDocument =>
  toCheckDocument(path, `---\n${yaml(fields)}\n---\n${body}`);

const NOTE: Fields = {
  id: "doc_a1b2c3",
  type: "note",
  title: "Mortgage options",
  created: "2026-07-19T10:00:00Z",
  updated: "2026-07-19T10:42:00Z",
};

const ANCHORED_BODY = "We assume a 30-year fixed at 6.1% which may be stale.\n";
const ANCHOR: Fields = { anc_k4f7: { exact: "assume a 30-year fixed at 6.1%" } };

const THREAD: Fields = {
  id: "th_x9y8",
  type: "thread",
  title: "Re: 30-year fixed assumption",
  created: "2026-07-19T10:05:00Z",
  updated: "2026-07-19T10:07:12Z",
  parent: "doc_a1b2c3",
  anchor: "anc_k4f7",
  agent: "engaged",
};

const THREAD_BODY = `## user · 2026-07-19T10:05:00Z\nIs 6.1% right?\n\n## agent · 2026-07-19T10:07:12Z\nNo, 6.4%.\n`;

/** A corpus that violates nothing: one anchored document and its thread. */
const cleanCorpus = (): CheckDocument[] => [
  doc("data/docs/mortgage.md", { ...NOTE, anchors: ANCHOR }, ANCHORED_BODY),
  doc("data/threads/th_x9y8.md", THREAD, THREAD_BODY),
];

const codes = (findings: readonly { code: string }[]): string[] => findings.map((f) => f.code);

describe("checkCorpus on a clean corpus", () => {
  it("reports no errors and no warnings", () => {
    const report = checkCorpus(cleanCorpus(), { resolveAnchor: substringResolver });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it("reports nothing for an empty corpus", () => {
    expect(checkCorpus([])).toEqual({ errors: [], warnings: [] });
  });
});

describe("§14 hard failures", () => {
  it("reports unparseable frontmatter without throwing", () => {
    const corpus = [
      ...cleanCorpus(),
      toCheckDocument("data/docs/broken.md", "No frontmatter at all.\n"),
    ];
    const report = checkCorpus(corpus);
    expect(codes(report.errors)).toEqual([CHECK_CODES.frontmatterUnparseable]);
    expect(report.errors[0]?.path).toBe("data/docs/broken.md");
    expect(report.errors[0]?.docId).toBeNull();
  });

  it("reports a missing required field, naming it", () => {
    const { title: _title, ...withoutTitle } = NOTE;
    const report = checkCorpus([doc("data/docs/untitled.md", withoutTitle)]);
    expect(codes(report.errors)).toContain(CHECK_CODES.frontmatterInvalid);
    expect(report.errors[0]?.detail).toMatch(/^title:/);
    expect(report.errors[0]?.docId).toBe("doc_a1b2c3");
  });

  it("reports an id prefix that disagrees with the type", () => {
    const report = checkCorpus([
      doc("data/threads/wrong.md", { ...THREAD, id: "doc_x9y8", parent: null, anchor: null }),
    ]);
    expect(codes(report.errors)).toContain(CHECK_CODES.frontmatterInvalid);
  });

  it("reports a non-thread document carrying a th_* id", () => {
    const report = checkCorpus([doc("data/docs/wrong.md", { ...NOTE, id: "th_a1b2c3" })]);
    expect(codes(report.errors)).toEqual([CHECK_CODES.idPrefixMismatch]);
    expect(report.errors[0]?.detail).toContain("doc_*");
  });

  it("reports two documents sharing an id", () => {
    const report = checkCorpus([
      doc("data/docs/one.md", NOTE),
      doc("data/docs/two.md", { ...NOTE, title: "Copy" }),
    ]);
    expect(codes(report.errors)).toEqual([CHECK_CODES.duplicateId]);
    expect(report.errors[0]?.detail).toContain("data/docs/one.md");
  });

  it.each([
    ["a key that is not anc_*", { k4f7: { exact: "x" } }, "not an `anc_*` id"],
    ["an empty exact", { anc_k4f7: { exact: "" } }, "`exact` is empty"],
    ["a missing exact", { anc_k4f7: { prefix: "x" } }, "`exact` is missing"],
    ["a non-string prefix", { anc_k4f7: { exact: "x", prefix: 3 } }, "`prefix` is not a string"],
    ["a non-string suffix", { anc_k4f7: { exact: "x", suffix: 3 } }, "`suffix` is not a string"],
    ["a non-mapping entry", { anc_k4f7: "x" }, "not a mapping"],
  ])("reports a malformed anchor entry: %s", (_name, anchors, detail) => {
    const report = checkCorpus([doc("data/docs/anchored.md", { ...NOTE, anchors })]);
    const finding = report.errors.find((f) => f.code === CHECK_CODES.anchorMalformed);
    expect(finding?.detail).toContain(detail);
  });

  it("reports an `anchors` field that is not a mapping", () => {
    const report = checkCorpus([doc("data/docs/anchored.md", { ...NOTE, anchors: ["anc_k4f7"] })]);
    expect(codes(report.errors)).toContain(CHECK_CODES.anchorMalformed);
  });

  it("reports duplicate anchor ids within one document", () => {
    const raw = `---
id: doc_a1b2c3
type: note
title: Mortgage options
created: 2026-07-19T10:00:00Z
updated: 2026-07-19T10:42:00Z
anchors:
  anc_k4f7:
    exact: "first"
  anc_k4f7:
    exact: "second"
---
Body.
`;
    const report = checkCorpus([toCheckDocument("data/docs/dup.md", raw)]);
    const finding = report.errors.find((f) => f.code === CHECK_CODES.duplicateAnchorId);
    expect(finding?.detail).toContain("anc_k4f7");
  });

  it("reports a thread whose parent does not exist", () => {
    const report = checkCorpus([doc("data/threads/th_x9y8.md", { ...THREAD, anchor: null })]);
    expect(codes(report.errors)).toEqual([CHECK_CODES.threadParentMissing]);
    expect(report.errors[0]?.docId).toBe("th_x9y8");
  });

  it("reports a thread whose anchor is absent from its parent", () => {
    const report = checkCorpus([
      doc("data/docs/mortgage.md", NOTE, ANCHORED_BODY),
      doc("data/threads/th_x9y8.md", THREAD, THREAD_BODY),
    ]);
    const finding = report.errors.find((f) => f.code === CHECK_CODES.threadAnchorMissing);
    expect(finding?.detail).toContain("not declared in doc_a1b2c3");
  });

  it("does not accuse a thread whose parent exists but has invalid frontmatter", () => {
    const report = checkCorpus([
      doc("data/docs/mortgage.md", { ...NOTE, anchors: ANCHOR, status: "pending" }, ANCHORED_BODY),
      doc("data/threads/th_x9y8.md", THREAD, THREAD_BODY),
    ]);
    // The parent's own `frontmatter-invalid` is the finding that needs fixing;
    // cascading parent/anchor errors onto the thread would bury it.
    expect(codes(report.errors)).toEqual([CHECK_CODES.frontmatterInvalid]);
  });

  it("does not warn about a reference to a document that exists but is invalid", () => {
    const report = checkCorpus([
      doc("data/docs/broken.md", { ...NOTE, id: "doc_broken1", status: "pending" }),
      doc("data/docs/notes.md", { ...NOTE, id: "doc_notes001" }, "See [[doc_broken1]].\n"),
    ]);
    expect(report.warnings).toEqual([]);
  });

  it("reports an anchor claimed with no parent at all", () => {
    const report = checkCorpus([doc("data/threads/th_x9y8.md", { ...THREAD, parent: null })]);
    const finding = report.errors.find((f) => f.code === CHECK_CODES.threadAnchorMissing);
    expect(finding?.detail).toContain("names no parent document");
  });

  it("reports two threads claiming the same anchor", () => {
    const report = checkCorpus([
      doc("data/docs/mortgage.md", { ...NOTE, anchors: ANCHOR }, ANCHORED_BODY),
      doc("data/threads/th_x9y8.md", THREAD, THREAD_BODY),
      doc("data/threads/th_other.md", { ...THREAD, id: "th_other" }, THREAD_BODY),
    ]);
    expect(codes(report.errors)).toEqual([CHECK_CODES.anchorClaimedTwice]);
    expect(report.errors[0]?.detail).toContain("th_x9y8");
  });

  it("reports duplicate turn timestamps within one thread", () => {
    const body = `## user · 2026-07-19T10:05:00Z\nOne.\n\n## agent · 2026-07-19T10:05:00Z\nTwo.\n`;
    const report = checkCorpus([
      doc("data/docs/mortgage.md", { ...NOTE, anchors: ANCHOR }, ANCHORED_BODY),
      doc("data/threads/th_x9y8.md", THREAD, body),
    ]);
    expect(codes(report.errors)).toEqual([CHECK_CODES.duplicateTurnTimestamp]);
    expect(report.errors[0]?.detail).toContain("2026-07-19T10:05:00Z");
  });

  it("does not apply the turn rule to non-thread documents", () => {
    const body = `## user · 2026-07-19T10:05:00Z\nOne.\n\n## agent · 2026-07-19T10:05:00Z\nTwo.\n`;
    expect(checkCorpus([doc("data/docs/notes.md", NOTE, body)]).errors).toEqual([]);
  });
});

describe("§14 warnings", () => {
  it("warns — never errors — on an anchor that no longer resolves", () => {
    const corpus = [
      doc("data/docs/mortgage.md", { ...NOTE, anchors: ANCHOR }, "The sentence was rewritten.\n"),
      doc("data/threads/th_x9y8.md", THREAD, THREAD_BODY),
    ];
    const report = checkCorpus(corpus, { resolveAnchor: substringResolver });
    expect(report.errors).toEqual([]);
    expect(codes(report.warnings)).toEqual([CHECK_CODES.anchorUnresolved]);
    expect(report.warnings[0]?.detail).toContain("orphaned");
  });

  it("warns on an anchor entry no thread references", () => {
    const report = checkCorpus(
      [doc("data/docs/mortgage.md", { ...NOTE, anchors: ANCHOR }, ANCHORED_BODY)],
      { resolveAnchor: substringResolver },
    );
    expect(report.errors).toEqual([]);
    expect(codes(report.warnings)).toEqual([CHECK_CODES.anchorUnused]);
  });

  it("warns on a reference to a document that does not exist", () => {
    const report = checkCorpus([doc("data/docs/notes.md", NOTE, "See [[doc_neverCreated]].\n")]);
    expect(report.errors).toEqual([]);
    expect(codes(report.warnings)).toEqual([CHECK_CODES.refUnresolved]);
    expect(report.warnings[0]?.detail).toContain("doc_neverCreated");
  });

  it("does not warn on a reference that resolves, including from a turn body", () => {
    const corpus = [
      doc(
        "data/docs/mortgage.md",
        { ...NOTE, anchors: ANCHOR },
        `${ANCHORED_BODY}See [[th_x9y8]].`,
      ),
      doc("data/threads/th_x9y8.md", THREAD, `${THREAD_BODY}\nAlso [[doc_a1b2c3]].\n`),
    ];
    expect(checkCorpus(corpus).warnings).toEqual([]);
  });

  it("produces no resolution-dependent warning when no resolver is supplied", () => {
    const corpus = [
      doc("data/docs/mortgage.md", { ...NOTE, anchors: ANCHOR }, "The sentence was rewritten.\n"),
      doc("data/threads/th_x9y8.md", THREAD, THREAD_BODY),
    ];
    const report = checkCorpus(corpus);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });
});

describe("resolver injection", () => {
  it("composes with a resolver that declares an optional hint parameter", () => {
    const withHint = (
      body: string,
      selector: TextQuoteSelector,
      hint?: number,
    ): { start: number; end: number } | null => {
      const start = body.indexOf(selector.exact, hint ?? 0);
      return start === -1 ? null : { start, end: start + selector.exact.length };
    };
    const report = checkCorpus(cleanCorpus(), { resolveAnchor: withHint });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it("passes the parent's own body to the resolver", () => {
    const seen: string[] = [];
    checkCorpus(cleanCorpus(), {
      resolveAnchor: (body, selector) => {
        seen.push(body);
        return substringResolver(body, selector);
      },
    });
    expect(seen).toEqual([ANCHORED_BODY]);
  });
});

describe("toCheckDocument", () => {
  it("records a parse failure instead of throwing", () => {
    const entry = toCheckDocument("data/docs/broken.md", "no fence");
    expect(entry.ok).toBe(false);
    if (!entry.ok) expect(entry.error).toContain("data/docs/broken.md:1:");
  });

  it("returns the parsed document on success", () => {
    const entry = doc("data/docs/mortgage.md", NOTE);
    expect(entry.ok).toBe(true);
    if (entry.ok) expect(entry.document.data["id"]).toBe("doc_a1b2c3");
  });
});
