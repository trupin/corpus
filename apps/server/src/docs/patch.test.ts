// SPEC.md §9.2's anchored patch (rider signed 2026-08-12), against a real
// workspace and a real git repository.
//
// The assertions are deliberately split in two. The scan and the splice are
// pure, and are tested as functions — the overlap rule and the
// replacement-contains-`old` termination are properties of the algorithm, not of
// HTTP. Everything downstream of the splice is asserted **through the route**,
// on the three real surfaces (the file, `git log`, the projection), because the
// claim being tested is that the patch reaches the *ordinary* write path: a test
// that called the verb and trusted it would prove nothing about that.

import { PatchDocResponseSchema } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { parseDocument } from "../core/index.js";
import { SQUASH_IDLE_MS } from "../git/index.js";
import { findOccurrences, spliceAt } from "./patch.js";
import { createDoc, createWriteWorkspace, type WriteWorkspace } from "./write-fixture.js";

let ws: WriteWorkspace;

const ANCHOR = "anc_r4te0001";
const QUOTE = "The rate is fixed for five years.";
const BODY = ["Intro paragraph.", "", QUOTE, "", "Closing paragraph."].join("\n");

const ANCHORED_DOC = [
  "---",
  "id: doc_mortgage",
  "type: note",
  "title: Mortgage options",
  "created: 2026-07-01T00:00:00Z",
  "updated: 2026-07-01T00:00:00Z",
  "tags: []",
  "status: open",
  "anchors:",
  `  ${ANCHOR}:`,
  `    exact: ${JSON.stringify(QUOTE)}`,
  `    prefix: ${JSON.stringify("Intro paragraph.\n\n")}`,
  `    suffix: ${JSON.stringify("\n\nClosing paragraph.")}`,
  "due: null",
  "reviewed: null",
  "evergreen: false",
  "---",
  "",
  BODY,
  "",
].join("\n");

const THREAD_DOC = [
  "---",
  "id: th_rate0001",
  "type: thread",
  "title: About the rate",
  "created: 2026-07-01T00:00:00Z",
  "updated: 2026-07-01T00:00:00Z",
  "tags: []",
  "status: open",
  "anchors: {}",
  "due: null",
  "reviewed: null",
  "evergreen: false",
  "parent: doc_mortgage",
  `anchor: ${ANCHOR}`,
  "agent: none",
  "---",
  "",
  "## user · 2026-07-01T00:00:00Z",
  "",
  "Is this right?",
  "",
].join("\n");

const DOC_PATH = "data/docs/inbox/mortgage.md";

/**
 * The anchored document and its thread, seeded through raw git rather than
 * through the API — so no §4 commit window is open and a single patch afterwards
 * is a single commit, with nothing to fold into.
 */
function anchored(name: string): WriteWorkspace {
  ws = createWriteWorkspace(name, { sprint: "s031" });
  ws.write(DOC_PATH, ANCHORED_DOC);
  ws.write("data/threads/th_rate0001.md", THREAD_DOC);
  ws.git("add", "-A", "--", "data");
  ws.git("commit", "-m", "seed the anchored document");
  ws.reproject();
  return ws;
}

/** The exact source lines of the `anchors:` block, for byte-identity assertions. */
const anchorsBlock = (text: string): string =>
  text.slice(text.indexOf("anchors:"), text.indexOf("due:"));

const patch = async (
  id: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<Response> => ws.post(`/api/docs/${id}/patch`, body, headers);

const conflictBody = async (
  response: Response,
): Promise<{ code: string; reason: string; matches: number; message: string }> =>
  (await response.json()) as { code: string; reason: string; matches: number; message: string };

describe("findOccurrences", () => {
  it("scans left to right and never overlaps", () => {
    expect(findOccurrences("aaa", "aa")).toEqual([0]);
    expect(findOccurrences("aaaa", "aa")).toEqual([0, 2]);
    expect(findOccurrences("abcabcabc", "abc")).toEqual([0, 3, 6]);
    expect(findOccurrences("nothing here", "xyz")).toEqual([]);
  });

  it("is byte-exact: no trimming, no case folding, no collapsing", () => {
    expect(findOccurrences("The Cat", "the cat")).toEqual([]);
    expect(findOccurrences(" cat ", "cat ")).toEqual([1]);
    expect(findOccurrences("one  two", "one two")).toEqual([]);
    expect(findOccurrences("a\r\nb", "a\nb")).toEqual([]);
  });

  it("advances even on a degenerate needle, so no scan can hang", () => {
    expect(findOccurrences("abc", "")).toEqual([0, 1, 2, 3]);
  });
});

describe("spliceAt", () => {
  it("carries every character outside the replaced ranges through unchanged", () => {
    expect(spliceAt("one two one", [0, 8], 3, "ONE")).toBe("ONE two ONE");
    expect(spliceAt("keep me", [], 3, "X")).toBe("keep me");
  });

  it("terminates when the replacement contains the text it replaced", () => {
    // The offsets are taken from the body *as read*, so the "cat" this splice
    // inserts is never a site the scan can find: three sites in, three out.
    const source = "cat cat cat";
    const offsets = findOccurrences(source, "cat");
    expect(offsets).toEqual([0, 4, 8]);
    expect(spliceAt(source, offsets, 3, "the cat sat")).toBe("the cat sat the cat sat the cat sat");
  });
});

describe("POST /api/docs/{id}/patch", () => {
  // Scoped to this block: the scan and the splice above open no workspace.
  afterEach(() => {
    ws.close();
  });

  it("replaces a unique match and leaves the rest of the body byte-identical", async () => {
    anchored("patch-unique");
    const head = ws.head();
    const bodyBefore = parseDocument(ws.read(DOC_PATH)).body;

    const response = await patch("doc_mortgage", { old: "Closing", new: "Final" });
    expect(response.status).toBe(200);
    const payload = PatchDocResponseSchema.parse(await response.json());
    expect(payload.replaced).toBe(1);
    // The whole criterion in one comparison: the quoted range became `new`, and
    // every other character of the body is where it was.
    const expected = bodyBefore.replace("Closing", "Final");
    expect(payload.doc.body).toBe(expected);
    expect(parseDocument(ws.read(DOC_PATH)).body).toBe(expected);

    // One attributed commit (§4), and the projection re-read (read-your-write).
    const commits = ws.git("log", "--format=%H", `${head}..HEAD`).trim().split("\n");
    expect(commits).toHaveLength(1);
    expect(ws.log("%an|%s")[0]).toBe("user|doc edit: Mortgage options (doc_mortgage) by user");
    const row = ws.db
      .prepare("SELECT body_excerpt FROM documents WHERE id = 'doc_mortgage'")
      .get() as { body_excerpt: string };
    expect(row.body_excerpt).toContain("Final paragraph.");
  });

  it("attributes the commit to the acting party", async () => {
    anchored("patch-agent");

    const response = await patch(
      "doc_mortgage",
      { old: "Intro", new: "Opening" },
      {
        "x-corpus-author": "agent",
      },
    );
    expect(response.status).toBe(200);
    expect(ws.log("%an|%s")[0]).toBe("agent|doc edit: Mortgage options (doc_mortgage) by agent");
  });

  it("refuses a patch whose text is not in the body, naming a count of zero", async () => {
    anchored("patch-no-match");
    const head = ws.head();
    const before = ws.read(DOC_PATH);

    const response = await patch("doc_mortgage", { old: "a phrase never written", new: "x" });
    expect(response.status).toBe(409);
    const body = await conflictBody(response);
    expect(body.code).toBe("conflict");
    expect(body.reason).toBe("no-match");
    expect(body.matches).toBe(0);
    expect(body.message).toContain("doc_mortgage");

    expect(ws.read(DOC_PATH)).toBe(before);
    expect(ws.head()).toBe(head);
  });

  it("refuses an ambiguous patch, naming how many times the text occurs", async () => {
    anchored("patch-ambiguous");
    const head = ws.head();
    const before = ws.read(DOC_PATH);

    const response = await patch("doc_mortgage", { old: " paragraph.", new: " para." });
    expect(response.status).toBe(409);
    const body = await conflictBody(response);
    expect(body.reason).toBe("multiple-matches");
    // "Intro paragraph." and "Closing paragraph." — the count the caller must be
    // told, because the recovery is to quote more context rather than re-read.
    expect(body.matches).toBe(2);
    expect(body.message).toContain("2 times");

    expect(ws.read(DOC_PATH)).toBe(before);
    expect(ws.head()).toBe(head);
  });

  it("replaces every occurrence left to right when `all` is set", async () => {
    anchored("patch-all");

    const response = await patch("doc_mortgage", { old: " paragraph.", new: " para.", all: true });
    expect(response.status).toBe(200);
    const payload = PatchDocResponseSchema.parse(await response.json());
    expect(payload.replaced).toBe(2);

    const after = ws.read(DOC_PATH);
    expect(after).toContain("Intro para.");
    expect(after).toContain("Closing para.");
    expect(after).not.toContain(" paragraph.");
  });

  it("still refuses a zero-match patch when `all` is set", async () => {
    anchored("patch-all-no-match");

    const response = await patch("doc_mortgage", { old: "absent", new: "x", all: true });
    expect(response.status).toBe(409);
    const body = await conflictBody(response);
    expect(body.reason).toBe("no-match");
    expect(body.matches).toBe(0);
  });

  it("does not loop when the replacement contains the text it replaces", async () => {
    ws = createWriteWorkspace("patch-self-containing", { sprint: "s031" });
    ws.reproject();
    const created = await createDoc(ws, { type: "note", title: "Cats", body: "cat cat cat" });
    ws.advance(SQUASH_IDLE_MS * 2);

    const response = await patch(created.id, { old: "cat", new: "the cat sat", all: true });
    expect(response.status).toBe(200);
    const payload = PatchDocResponseSchema.parse(await response.json());
    expect(payload.replaced).toBe(3);
    expect(payload.doc.body).toBe("the cat sat the cat sat the cat sat");
  });

  it("deletes the quoted text when `new` is empty", async () => {
    anchored("patch-delete");

    const response = await patch("doc_mortgage", { old: "\n\nClosing paragraph.", new: "" });
    expect(response.status).toBe(200);
    const payload = PatchDocResponseSchema.parse(await response.json());
    expect(payload.replaced).toBe(1);
    expect(ws.read(DOC_PATH)).not.toContain("Closing paragraph.");
  });

  it("writes nothing when the result is the body it started as", async () => {
    anchored("patch-noop");
    const head = ws.head();
    const before = ws.read(DOC_PATH);

    const response = await patch("doc_mortgage", { old: "Intro", new: "Intro" });
    expect(response.status).toBe(200);
    const payload = PatchDocResponseSchema.parse(await response.json());
    // It covered its occurrence, and changed nothing: no file write, no commit,
    // no `updated` bump — the save path's own "only a real change" comparison.
    expect(payload.replaced).toBe(1);
    expect(payload.warnings).toEqual([]);
    expect(ws.read(DOC_PATH)).toBe(before);
    expect(ws.head()).toBe(head);
  });

  it("cannot match across the frontmatter boundary — the body excludes it", async () => {
    anchored("patch-frontmatter");
    const before = ws.read(DOC_PATH);

    for (const quoted of ["title: Mortgage options", "status: open", "---\n\nIntro"]) {
      const response = await patch("doc_mortgage", { old: quoted, new: "tampered" });
      expect(response.status).toBe(409);
      expect((await conflictBody(response)).reason).toBe("no-match");
    }
    expect(ws.read(DOC_PATH)).toBe(before);
  });

  it("reconciles anchors exactly as the equivalent PUT does: a remap", async () => {
    anchored("patch-remap");
    const head = ws.head();

    const response = await patch("doc_mortgage", {
      old: "Intro paragraph.",
      new: "A much longer introductory paragraph.",
    });
    expect(response.status).toBe(200);
    const payload = PatchDocResponseSchema.parse(await response.json());
    expect(payload.anchors.remapped).toEqual([ANCHOR]);
    expect(payload.anchors.orphaned).toEqual([]);

    // Body and anchors in the *same* commit (§6), as a save guarantees.
    const commits = ws.git("log", "--format=%H", `${head}..HEAD`).trim().split("\n");
    expect(commits).toHaveLength(1);
    const diff = ws.git("show", "HEAD");
    expect(diff).toContain("introductory paragraph");
    expect(diff).toContain("prefix:");

    const read = await ws.request("/api/docs/doc_mortgage");
    const doc = (await read.json()) as { anchors: { orphaned: boolean }[] };
    expect(doc.anchors[0]?.orphaned).toBe(false);
  });

  it("reconciles anchors exactly as the equivalent PUT does: an orphan", async () => {
    anchored("patch-orphan");
    const before = anchorsBlock(ws.read(DOC_PATH));

    // Deleting the anchored paragraph outright, which is the shape §6 orphans on
    // — an in-place rewrite of the same range remaps instead, as it does under
    // `PUT`, and this route adds nothing to that judgment either way.
    const response = await patch("doc_mortgage", { old: `${QUOTE}\n\n`, new: "" });
    expect(response.status).toBe(200);
    const payload = PatchDocResponseSchema.parse(await response.json());
    expect(payload.anchors.orphaned).toEqual([ANCHOR]);
    expect(payload.anchors.remapped).toEqual([]);
    // §6: an orphaned selector is preserved byte-for-byte.
    expect(anchorsBlock(ws.read(DOC_PATH))).toBe(before);
    expect(ws.read("data/threads/th_rate0001.md")).toBe(THREAD_DOC);
  });

  it("reconciles once over one new body when `all` moves several occurrences", async () => {
    anchored("patch-all-anchors");
    const head = ws.head();

    // Both occurrences of " paragraph." move, one above the anchored range and
    // one below it: reconciliation sees a single old→new pair with two changed
    // regions, which is what the equivalent whole-body PUT would hand it.
    const response = await patch("doc_mortgage", {
      old: " paragraph.",
      new: " paragraph, rewritten at some length.",
      all: true,
    });
    expect(response.status).toBe(200);
    const payload = PatchDocResponseSchema.parse(await response.json());
    expect(payload.replaced).toBe(2);
    expect(payload.anchors.remapped).toEqual([ANCHOR]);
    expect(payload.anchors.orphaned).toEqual([]);

    const commits = ws.git("log", "--format=%H", `${head}..HEAD`).trim().split("\n");
    expect(commits).toHaveLength(1);
    const anchors = parseDocument(ws.read(DOC_PATH)).data["anchors"] as Record<
      string,
      { exact: string }
    >;
    expect(anchors[ANCHOR]?.exact).toBe(QUOTE);
  });

  it("surfaces §11's warnings from the write it delegates to", async () => {
    anchored("patch-warnings");

    const response = await patch("doc_mortgage", {
      old: "Closing paragraph.",
      new: "Closing paragraph, see [[doc_nosuchdoc]].",
    });
    expect(response.status).toBe(200);
    const payload = PatchDocResponseSchema.parse(await response.json());
    expect(payload.warnings.map((warning) => warning.code)).toContain("unresolved_ref");
    // A §11 warning never fails a write: the patch landed anyway.
    expect(ws.read(DOC_PATH)).toContain("[[doc_nosuchdoc]]");
  });

  it("matches and writes atomically: a racing patch is refused, never misplaced", async () => {
    ws = createWriteWorkspace("patch-race", { sprint: "s031" });
    ws.reproject();
    const created = await createDoc(ws, { type: "note", title: "Race", body: "alpha" });
    ws.advance(SQUASH_IDLE_MS * 2);

    const [first, second] = await Promise.all([
      patch(created.id, { old: "alpha", new: "beta" }),
      patch(created.id, { old: "alpha", new: "gamma" }),
    ]);
    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    // The loser is told *which* text is gone — the lane is what makes the
    // refusal this clean rather than a stale-key surprise from the save path.
    const loser = first.status === 409 ? first : second;
    expect((await conflictBody(loser)).reason).toBe("no-match");

    const body = parseDocument(ws.read(created.path)).body.trim();
    expect(["beta", "gamma"]).toContain(body);
  });

  it("is a 404 for a document that does not exist", async () => {
    ws = createWriteWorkspace("patch-missing", { sprint: "s031" });
    ws.reproject();

    const response = await patch("doc_aaaaaaaa", { old: "x", new: "y" });
    expect(response.status).toBe(404);
  });

  it("refuses a key: the request has no such field (SPEC.md §7)", async () => {
    anchored("patch-strict");

    const response = await patch("doc_mortgage", {
      old: "Intro",
      new: "Opening",
      key: "a".repeat(64),
    });
    expect(response.status).toBe(400);
    expect(ws.read(DOC_PATH)).toBe(ANCHORED_DOC);
  });
});
