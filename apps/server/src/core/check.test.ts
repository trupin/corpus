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

  it("reports an anchor entry no thread references", () => {
    // §14 lists "every anchor belongs to an existing thread" among the failures;
    // §6 is the invariant behind it — no highlight left on an empty conversation.
    const report = checkCorpus(
      [doc("data/docs/mortgage.md", { ...NOTE, anchors: ANCHOR }, ANCHORED_BODY)],
      { resolveAnchor: substringResolver },
    );
    expect(codes(report.errors)).toEqual([CHECK_CODES.anchorUnused]);
    expect(report.errors[0]?.severity).toBe("error");
    expect(report.errors[0]?.docId).toBe("doc_a1b2c3");
    expect(report.errors[0]?.detail).toContain("anc_k4f7");
    expect(report.warnings).toEqual([]);
  });

  it("reports the anchor as unused even when it also no longer resolves", () => {
    const report = checkCorpus(
      [doc("data/docs/mortgage.md", { ...NOTE, anchors: ANCHOR }, "Rewritten entirely.\n")],
      { resolveAnchor: substringResolver },
    );
    expect(codes(report.errors)).toEqual([CHECK_CODES.anchorUnused]);
    expect(codes(report.warnings)).toEqual([CHECK_CODES.anchorUnresolved]);
  });

  it("does not accuse a document whose claiming thread has invalid frontmatter", () => {
    const report = checkCorpus(
      [
        doc("data/docs/mortgage.md", { ...NOTE, anchors: ANCHOR }, ANCHORED_BODY),
        doc("data/threads/th_x9y8.md", { ...THREAD, agent: "napping" }, THREAD_BODY),
      ],
      { resolveAnchor: substringResolver },
    );
    // The thread's own `frontmatter-invalid` is the finding that needs fixing;
    // cascading `anchor-unused` onto its parent would bury it.
    expect(codes(report.errors)).toEqual([CHECK_CODES.frontmatterInvalid]);
  });
});

/**
 * SERVER-066 — the bug this rule exists for: an agent closed a fence on the same
 * line as the content, so the fence never closed, so `turns.ts` (which excludes
 * fenced regions when locating turn delimiters, deliberately) stopped seeing
 * every heading after it and folded the user's reply into the agent's turn.
 * Nothing reported anything.
 */
describe("§14 unterminated fenced code blocks", () => {
  /** The reported shape: the closing run shares a line with the content. */
  const SWALLOWING_TURN = [
    "## agent · 2026-07-19T10:07:12Z",
    "",
    "Here is the snippet:",
    "",
    "```",
    "const x = 1;```",
    "",
    "## user · 2026-07-19T10:09:00Z",
    "",
    "Actually, no.",
    "",
  ].join("\n");

  /**
   * The expected line, derived from the raw file rather than counted by hand —
   * an independent answer to the question the rule answers, so a bug in
   * `bodyStartLine`'s arithmetic cannot be encoded into the expectation.
   */
  const fileLineOfFirstFence = (raw: string): number =>
    raw.split("\n").findIndex((line) => line === "```") + 1;

  it("reports the reported shape as an error naming the line the fence opened on", () => {
    const raw = `---\n${yaml(THREAD)}\n---\n${SWALLOWING_TURN}`;
    const report = checkCorpus([toCheckDocument("data/threads/th_x9y8.md", raw)]);
    const finding = report.errors.find((f) => f.code === CHECK_CODES.unterminatedFence);
    expect(finding?.severity).toBe("error");
    expect(finding?.docId).toBe("th_x9y8");
    expect(finding?.path).toBe("data/threads/th_x9y8.md");
    expect(finding?.detail).toContain(`opened at line ${fileLineOfFirstFence(raw)}`);
    // The run is described, not quoted — quoting a backtick run in backticks is
    // the ambiguity this finding exists to report.
    expect(finding?.detail).toContain("a run of 3 backticks");
    expect(finding?.detail).not.toContain("```");
    expect(report.warnings).toEqual([]);
  });

  it("names the turn consequence when the document is a thread", () => {
    const report = checkCorpus([
      doc("data/docs/mortgage.md", { ...NOTE, anchors: ANCHOR }, ANCHORED_BODY),
      doc("data/threads/th_x9y8.md", THREAD, SWALLOWING_TURN),
    ]);
    const finding = report.errors.find((f) => f.code === CHECK_CODES.unterminatedFence);
    expect(finding?.detail).toContain("turn heading");
  });

  it("does not claim turns are lost in an ordinary document", () => {
    const report = checkCorpus([doc("data/docs/notes.md", NOTE, "```\nunclosed\n")]);
    expect(codes(report.errors)).toEqual([CHECK_CODES.unterminatedFence]);
    expect(report.errors[0]?.detail).not.toContain("turn heading");
    expect(report.errors[0]?.detail).toContain("reads as code");
  });

  it("reports nothing for a fence closed on its own line", () => {
    const closed = SWALLOWING_TURN.replace("const x = 1;```", "const x = 1;\n```");
    const report = checkCorpus([
      doc("data/docs/mortgage.md", { ...NOTE, anchors: ANCHOR }, ANCHORED_BODY),
      doc("data/threads/th_x9y8.md", THREAD, closed),
    ]);
    expect(report.errors).toEqual([]);
  });

  it("reports nothing when the closing run is wider than the opening one", () => {
    // AGENT-012's widening means openers vary; a wider close is still a close.
    expect(checkCorpus([doc("data/docs/notes.md", NOTE, "```\ncode\n`````\n")]).errors).toEqual([]);
  });

  it("reports nothing for a closing fence indented up to three spaces", () => {
    expect(checkCorpus([doc("data/docs/notes.md", NOTE, "```\ncode\n  ```\n")]).errors).toEqual([]);
  });

  it("still reports it when the frontmatter is also invalid", () => {
    // The two are independent, and a bad field must not hide a fence that is
    // eating the rest of the document.
    const report = checkCorpus([
      doc("data/docs/notes.md", { ...NOTE, created: 42 }, "```\nunclosed\n"),
    ]);
    expect(codes(report.errors)).toContain(CHECK_CODES.unterminatedFence);
    expect(codes(report.errors)).toContain(CHECK_CODES.frontmatterInvalid);
  });

  /**
   * SERVER-066 review, finding A. The scanner missed a fence opened on a
   * list-bullet line and then read its indented closer as a fresh opener, so
   * this — valid CommonMark — failed the check at *error* severity. A false
   * error on correct content is worse than the silence the rule replaced,
   * because it teaches the reader to ignore the check.
   */
  it("reports nothing for a fence opened inside a list item", () => {
    const body = ["- ```js", "  const x = 1;", "  ```", "", "Prose after the list.", ""].join("\n");
    expect(checkCorpus([doc("data/docs/notes.md", NOTE, body)]).errors).toEqual([]);
  });

  it("reports nothing for a fence opened inside a block quote", () => {
    const body = ["> ```js", "> const x = 1;", "> ```", ""].join("\n");
    expect(checkCorpus([doc("data/docs/notes.md", NOTE, body)]).errors).toEqual([]);
  });

  it("still reports a fence a list item really did leave open", () => {
    const report = checkCorpus([doc("data/docs/notes.md", NOTE, "- ```js\n  const x = 1;```\n")]);
    expect(codes(report.errors)).toEqual([CHECK_CODES.unterminatedFence]);
  });

  it("reports nothing for a document that does not parse at all", () => {
    // There is no body to scan; `frontmatter-unparseable` is the whole story.
    const report = checkCorpus([toCheckDocument("data/docs/broken.md", "```\nunclosed\n")]);
    expect(codes(report.errors)).toEqual([CHECK_CODES.frontmatterUnparseable]);
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

/**
 * `anchor-unused` is the one *error* whose answer a document subset cannot hold,
 * so it is the one that must be unioned with the live corpus (sprint-013
 * SERVER-019 FAIL-1). These pin the union's two directions: a claimant outside
 * the submitted set proves the anchor used; a claimant *inside* it has already
 * spoken through its own bytes and its row is ignored.
 */
describe("the anchorClaimants seam", () => {
  const parentOnly = (): CheckDocument[] => [
    doc("data/docs/mortgage.md", { ...NOTE, anchors: ANCHOR }, ANCHORED_BODY),
  ];

  it("accepts an anchor whose only thread lives outside the submitted set", () => {
    const asked: [string, string][] = [];
    const report = checkCorpus(parentOnly(), {
      resolveAnchor: substringResolver,
      anchorClaimants: (docId, anchorId) => {
        asked.push([docId, anchorId]);
        return ["th_x9y8"];
      },
    });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(asked).toEqual([["doc_a1b2c3", "anc_k4f7"]]);
  });

  it("still reports an anchor no live thread claims", () => {
    const report = checkCorpus(parentOnly(), {
      resolveAnchor: substringResolver,
      anchorClaimants: () => [],
    });
    expect(codes(report.errors)).toEqual([CHECK_CODES.anchorUnused]);
  });

  it("ignores a live claimant that is itself in the submitted set", () => {
    // The staged shape of a genuine orphaning: the thread was passed in and no
    // longer names the anchor, so the caller's stale row must not overrule it.
    const wholeDocumentThread = { ...THREAD };
    delete wholeDocumentThread["anchor"];
    const report = checkCorpus(
      [
        doc("data/docs/mortgage.md", { ...NOTE, anchors: ANCHOR }, ANCHORED_BODY),
        doc("data/threads/th_x9y8.md", wholeDocumentThread, THREAD_BODY),
      ],
      { resolveAnchor: substringResolver, anchorClaimants: () => ["th_x9y8"] },
    );
    expect(codes(report.errors)).toEqual([CHECK_CODES.anchorUnused]);
  });

  it("is never consulted for an anchor a submitted thread already claims", () => {
    let asked = 0;
    const report = checkCorpus(cleanCorpus(), {
      resolveAnchor: substringResolver,
      anchorClaimants: () => {
        asked += 1;
        return [];
      },
    });
    expect(report.errors).toEqual([]);
    expect(asked).toBe(0);
  });

  it("changes nothing when it is not supplied", () => {
    expect(codes(checkCorpus(parentOnly(), { resolveAnchor: substringResolver }).errors)).toEqual([
      CHECK_CODES.anchorUnused,
    ]);
  });
});

/**
 * SERVER-124. §5's waiver under a `.claude/` root has to drop *required-ness* —
 * a hand-written profile has no `id`, no `type`, no `status` — but it used to
 * drop *well-formedness* with it, which made Corpus's whole block unfalsifiable
 * the moment somebody wrote one. Measured against a real server: a hand-authored
 * `.claude/agents/bogus.md` carrying `id: 12345`, `title: []`, `tags: seven` and
 * `status: banana` produced zero findings.
 *
 * Every case here is stated three ways for one field — present-and-malformed,
 * present-and-valid, absent — because those are the three answers the split has
 * to give and only the first one changed.
 */
describe("§5's waiver under a `.claude/` root (SERVER-124)", () => {
  /** Both of Claude Code's fields, so §7's own requirement contributes nothing. */
  const CLAUDE_FIELDS = (name: string): Fields => ({
    name,
    description: "Reach for this when a claim needs its source.",
  });

  const ROOTS = [
    { label: ".claude/agents", path: ".claude/agents/bogus.md", discoveredAs: "bogus" },
    { label: ".claude/skills", path: ".claude/skills/bogus/SKILL.md", discoveredAs: null },
    {
      label: ".claude/skills-archived",
      path: ".claude/skills-archived/bogus/SKILL.md",
      discoveredAs: null,
    },
  ] as const;

  /** The seam `docs/write.ts`'s `claudeCodeRootFor` supplies on a real server. */
  const rootedAt = (root: (typeof ROOTS)[number]) => ({
    claudeCodeRoot: (path: string) =>
      path === root.path ? { discoveredAs: root.discoveredAs } : null,
  });

  /** Only §5's half; `anchors` faults also raise the structural `anchor-malformed`. */
  const blockFindings = (
    root: (typeof ROOTS)[number],
    fields: Fields,
  ): { path: string; detail: string }[] =>
    checkCorpus(
      [doc(root.path, { ...CLAUDE_FIELDS("bogus"), ...fields })],
      rootedAt(root),
    ).errors.filter((finding) => finding.code === CHECK_CODES.frontmatterInvalid);

  /**
   * One row per Corpus field of §7:399's list that has a shape to get wrong. The
   * *valid* value is asserted alongside the malformed one so a test that merely
   * reported everything under these roots could not pass.
   */
  const FIELDS: readonly { field: string; malformed: unknown; valid: unknown }[] = [
    { field: "id", malformed: 12345, valid: "doc_a1b2c3" },
    { field: "title", malformed: [], valid: "Bogus" },
    { field: "tags", malformed: "seven", valid: ["research"] },
    { field: "status", malformed: "banana", valid: "open" },
    { field: "created", malformed: "the day before yesterday", valid: "2026-07-19T10:00:00Z" },
    { field: "updated", malformed: 7, valid: "2026-07-19T10:00:00Z" },
    { field: "evergreen", malformed: "yes", valid: true },
    { field: "due", malformed: "next tuesday", valid: "2026-07-19" },
    { field: "anchors", malformed: { anc_k4f7: { exact: "x", prefix: 5 } }, valid: {} },
  ];

  for (const root of ROOTS) {
    describe(root.label, () => {
      for (const { field, malformed, valid } of FIELDS) {
        it(`reports \`${field}\` when it is present and malformed`, () => {
          const findings = blockFindings(root, { [field]: malformed });
          // The top-level key, so `anchors` matches its own nested issue path.
          expect(findings.map((finding) => finding.detail.split(/[.:]/)[0])).toContain(field);
          expect(findings[0]?.path).toBe(root.path);
        });

        it(`reports nothing for \`${field}\` when it is present and valid`, () => {
          expect(blockFindings(root, { [field]: valid })).toEqual([]);
        });

        it(`reports nothing for \`${field}\` when it is absent`, () => {
          expect(blockFindings(root, {})).toEqual([]);
        });
      }

      // The file the waiver was written for: Claude Code's block and nothing else.
      it("stays clean for a file carrying no Corpus block at all", () => {
        const report = checkCorpus([doc(root.path, CLAUDE_FIELDS("bogus"))], rootedAt(root));
        expect(report.errors).toEqual([]);
        expect(report.warnings).toEqual([]);
      });
    });
  }

  /**
   * The issue's own reproduction, in full. `type` is deliberately absent from
   * the findings: `DocTypeSchema` is an open `z.string().min(1)` so that "plugins
   * declare their own types", which makes `not-a-real-type` a well-formed plugin
   * type here exactly as it is under `data/`.
   */
  it("reports every malformed field of the issue's `bogus.md`", () => {
    const findings = blockFindings(ROOTS[0], {
      id: 12345,
      type: "not-a-real-type",
      title: [],
      tags: "seven",
      status: "banana",
    });
    expect(findings.map((finding) => finding.detail.split(":")[0]).sort()).toEqual([
      "id",
      "status",
      "tags",
      "title",
    ]);
  });

  it("leaves a legal plugin type alone", () => {
    expect(blockFindings(ROOTS[0], { type: "todo" })).toEqual([]);
  });

  it("reports a `type` that is not a non-empty string", () => {
    for (const malformed of [[], "", 3]) {
      expect(blockFindings(ROOTS[0], { type: malformed })[0]?.detail).toMatch(/^type:/);
    }
  });

  /**
   * A key written with nothing after it is YAML's ordinary "not filled in", and
   * it carries exactly what the waiver exists to permit. It also cannot mislead:
   * every projection reader falls back for `null` to what it falls back to for a
   * missing key, so reporting one and not the other would be a finding about a
   * keystroke.
   */
  it("treats a key present but null as absent", () => {
    const nulled = Object.fromEntries(FIELDS.map(({ field }) => [field, null]));
    expect(blockFindings(ROOTS[0], { ...nulled, type: null })).toEqual([]);
  });

  /**
   * `anchors` needs no special case despite its nested shape: presence is asked
   * of the top-level key the author wrote, so a fault at any depth beneath it is
   * a fault in something present. Its structural sibling still fires too — as it
   * always did, and as it does under `data/`.
   */
  it("reports a nested `anchors` fault, alongside the structural finding", () => {
    const report = checkCorpus(
      [
        doc(ROOTS[0].path, {
          ...CLAUDE_FIELDS("bogus"),
          anchors: { anc_k4f7: { exact: "x", prefix: 5 } },
        }),
      ],
      rootedAt(ROOTS[0]),
    );
    expect(codes(report.errors).sort()).toEqual([
      CHECK_CODES.anchorMalformed,
      CHECK_CODES.frontmatterInvalid,
    ]);
    expect(
      report.errors.find((finding) => finding.code === CHECK_CODES.frontmatterInvalid)?.detail,
    ).toMatch(/^anchors\.anc_k4f7\./);
  });

  /**
   * The waiver's other direction is untouched: outside these roots a missing
   * field is still §5's refusal, and the seam is what decides it — not the code
   * and not the path spelling.
   */
  it("still requires the canonical block where no root waives it", () => {
    const findings = checkCorpus([doc("data/docs/bogus.md", CLAUDE_FIELDS("bogus"))]).errors;
    expect(codes(findings)).toEqual(Array<string>(5).fill(CHECK_CODES.frontmatterInvalid));
    expect(findings.map((finding) => finding.detail.split(":")[0]).sort()).toEqual([
      "created",
      "id",
      "title",
      "type",
      "updated",
    ]);
  });

  it("waives nothing at all when no seam is supplied", () => {
    const report = checkCorpus([doc(ROOTS[0].path, CLAUDE_FIELDS("bogus"))]);
    expect(codes(report.errors)).toContain(CHECK_CODES.frontmatterInvalid);
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

  it("records an alias-amplification refusal as an unreadable document", () => {
    const bomb = `---\n${["a0: &a0 laugh"]
      .concat(
        Array.from(
          { length: 9 },
          (_unused, index) =>
            `a${String(index + 1)}: &a${String(index + 1)} [${Array.from(
              { length: 9 },
              () => `*a${String(index)}`,
            ).join(", ")}]`,
        ),
      )
      .join("\n")}\n---\nBody.\n`;
    const entry = toCheckDocument("data/docs/bomb.md", bomb);
    expect(entry.ok).toBe(false);
    if (!entry.ok) expect(entry.error).toContain("aliases expand past the safe limit");
    expect(codes(checkCorpus([entry]).errors)).toEqual([CHECK_CODES.frontmatterUnparseable]);
  });

  it("returns the parsed document on success", () => {
    const entry = doc("data/docs/mortgage.md", NOTE);
    expect(entry.ok).toBe(true);
    if (entry.ok) expect(entry.document.data["id"]).toBe("doc_a1b2c3");
  });
});
