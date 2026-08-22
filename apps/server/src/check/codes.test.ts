// The drift guard between the validator's vocabulary and the wire's
// (sprint-013 Adjudication 23).
//
// The dependency direction runs `packages/contract` ← `apps/server`, so the
// contract cannot import the validator: its `CHECK_CODES` is a *transcription* of
// `core/check.ts`'s, and a transcription is a copy that can go stale. This is the
// test that makes the copy load-bearing — it lives on the server side because the
// server is the half that may not drift, and it lives beside `POST /api/check`
// because that route is where the two vocabularies meet the wire.
//
// The two constants have deliberately different shapes: the server's is a keyed
// object (`{frontmatterUnparseable: "frontmatter-unparseable", …}`) so call sites
// read as names rather than as string literals; the contract's is a string tuple
// so `z.enum` can close it. The assertions normalise between the shapes; they do
// **not** restate a literal list, which would just be a third copy to keep in
// sync.

import { describe, expect, it } from "vitest";
import { CHECK_CODES as WIRE_CODES, CHECK_WARNING_CODES } from "@corpus/contract";
import { CHECK_CODES, checkCorpus, toCheckDocument } from "../core/index.js";
import { resolveAnchorExact } from "../anchors/index.js";

const STAMPS = "created: 2026-01-01T00:00:00Z\nupdated: 2026-01-01T00:00:00Z";

const document = (frontmatter: string, body = "Body.\n"): string =>
  `---\n${frontmatter}\n${STAMPS}\n---\n\n${body}`;

describe("the validator's codes and the wire's", () => {
  it("are the same fourteen, member for member, in declaration order", () => {
    expect(Object.values(CHECK_CODES)).toEqual([...WIRE_CODES]);
  });

  it("are fourteen — a count neither side states, so a paired addition still shows", () => {
    expect(Object.values(CHECK_CODES)).toHaveLength(14);
  });

  it("carry no duplicate value on the server side", () => {
    expect(new Set(Object.values(CHECK_CODES)).size).toBe(Object.values(CHECK_CODES).length);
  });
});

/**
 * The severity split is §11's, and it is the half a rename would silently
 * invert — a code moved between the two families keeps the drift guard above
 * green while changing what fails a check. So it is asserted from *behaviour*:
 * a corpus is built that produces both warning kinds and several error kinds,
 * and the partition of the report is compared with the contract's tuple.
 */
describe("the warning/error split", () => {
  const corpus = [
    // An anchor whose quote no longer resolves, claimed by a thread that exists:
    // §6's orphaned thread, §11's first warning.
    toCheckDocument(
      "data/docs/note.md",
      document(
        [
          "id: doc_note01",
          "type: note",
          "title: Note",
          "anchors:",
          "  anc_aaaaaa:",
          "    exact: text that is not in the body",
        ].join("\n"),
        "A body that quotes nothing in particular. See [[doc_missing]].\n",
      ),
    ),
    toCheckDocument(
      "data/threads/th_aaaaaa.md",
      document(
        [
          "id: th_aaaaaa",
          "type: thread",
          "title: Thread",
          "parent: doc_note01",
          "anchor: anc_aaaaaa",
          "status: open",
        ].join("\n"),
        "**user** · 2026-01-01T00:00:00Z\n\nHello.\n",
      ),
    ),
    // A second document claiming the first one's id, and a thread naming a
    // parent nobody wrote: two of the twelve error codes.
    toCheckDocument("data/docs/dupe.md", document("id: doc_note01\ntype: note\ntitle: Dupe")),
    toCheckDocument(
      "data/threads/th_bbbbbb.md",
      document("id: th_bbbbbb\ntype: thread\ntitle: Orphan\nparent: doc_nobody\nstatus: open"),
    ),
  ];

  const report = checkCorpus(corpus, { resolveAnchor: resolveAnchorExact });

  it("emits exactly the contract's two warning codes and nothing else as a warning", () => {
    expect([...new Set(report.warnings.map((finding) => finding.code))].sort()).toEqual(
      [...CHECK_WARNING_CODES].sort(),
    );
  });

  it("never reports a warning code as an error", () => {
    const warningCodes = new Set<string>(CHECK_WARNING_CODES);
    expect(report.errors.filter((finding) => warningCodes.has(finding.code))).toEqual([]);
    expect(report.errors.length).toBeGreaterThan(0);
  });

  it("never reports an error code as a warning", () => {
    const warningCodes = new Set<string>(CHECK_WARNING_CODES);
    expect(report.warnings.every((finding) => warningCodes.has(finding.code))).toBe(true);
  });

  it("marks every finding with the severity its family implies", () => {
    expect(report.errors.every((finding) => finding.severity === "error")).toBe(true);
    expect(report.warnings.every((finding) => finding.severity === "warning")).toBe(true);
  });
});
