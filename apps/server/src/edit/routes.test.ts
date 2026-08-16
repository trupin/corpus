// `GET /api/docs/{id}/diff` against a real workspace and a real git repository
// (SPEC.md §4's rider, CONTRACT-028). Nothing here fakes git: the range
// resolution, the path scoping and the truncation are all statements about what
// the workspace's own history contains.

import { afterEach, describe, expect, it } from "vitest";
import { DOC_DIFF_MAX_CHARS, EMPTY_TREE_OBJECT_ID, type DocDiff } from "@corpus/contract";
import {
  createDoc,
  createWriteWorkspace,
  type WriteWorkspace,
  putDoc,
} from "../docs/write-fixture.js";

const workspaces: WriteWorkspace[] = [];

function workspace(prefix: string, options: { git?: boolean } = {}): WriteWorkspace {
  const ws = createWriteWorkspace(prefix, { sprint: "s011", ...options });
  workspaces.push(ws);
  return ws;
}

afterEach(async () => {
  for (const ws of workspaces.splice(0)) {
    await ws.server.close();
    ws.close();
  }
});

async function diff(
  ws: WriteWorkspace,
  id: string,
  query = "",
): Promise<{ status: number; body: DocDiff & { code?: string; issues?: { path: string }[] } }> {
  const response = await ws.request(`/api/docs/${id}/diff${query}`);
  return { status: response.status, body: (await response.json()) as never };
}

describe("GET /api/docs/{id}/diff", () => {
  it("defaults to the newest commit that touched the document, and the one before it", async () => {
    const ws = workspace("diff-default");
    const doc = await createDoc(ws, { type: "note", title: "Rates", body: "one\n" });
    ws.advance(60_000);
    await putDoc(ws, doc.id, { body: "one\ntwo\n" }, { "x-corpus-author": "user" });

    const { status, body } = await diff(ws, doc.id);
    expect(status).toBe(200);
    expect(body.id).toBe(doc.id);
    expect(body.path).toBe(doc.path);
    expect(body.to).toBe(ws.head());
    expect(body.from).toBe(ws.git("rev-parse", `${ws.head()}^`).trim());
    expect(body.truncated).toBe(false);
    expect(body.totalChars).toBe(body.diff.length);
    expect(body.diff).toContain("+two");
    expect(body.stats.commits).toBe(1);
    expect(body.stats.insertions).toBeGreaterThan(0);
  });

  it("defaults `from` to the previous commit that touched this document, skipping a neighbour's", async () => {
    // SERVER-113, the twin of SERVER-097's acknowledgment defect. §4's commit
    // window belongs to a **party**, not to a document, so the commit sitting
    // immediately before this document's newest one is routinely whatever the
    // *other* party last did — to whichever document. `parentOf(to)` names it
    // anyway, and the range then claims a provenance the document never had.
    const ws = workspace("diff-default-skips-neighbour");
    const doc = await createDoc(ws, { type: "note", title: "Estate", body: "one\n" });
    ws.advance(60_000);
    // The interloper: a different party, a different document. It closes the
    // user's window and opens its own, so it is a commit of its own between this
    // document's two revisions.
    await createDoc(ws, { type: "note", title: "Comment", body: "unrelated\n" }, "agent");
    ws.advance(60_000);
    await putDoc(ws, doc.id, { body: "one\ntwo\n" }, { "x-corpus-author": "user" });

    const { status, body } = await diff(ws, doc.id);
    expect(status).toBe(200);
    // Shas are read *after* the request: the last save's window was still open
    // when it arrived, and the read closes it, which amends that commit
    // (SERVER-091). Positions are stable across that rewrite; shas are not.
    const created = ws.git("rev-parse", "HEAD~2").trim();
    const interloper = ws.git("rev-parse", "HEAD~1").trim();
    // The fixture really did build the divergence this test is about.
    expect(ws.git("show", "--name-only", "--format=", interloper).trim()).not.toContain(doc.path);
    expect(ws.git("show", "--name-only", "--format=", created).trim()).toContain(doc.path);

    expect(body.from).not.toBe(interloper);
    expect(body.from).toBe(created);
    expect(body.diff).toContain("+two");
    expect(body.diff).not.toContain("unrelated");
    // And nothing the range *reports* moves: the commit skipped over left this
    // file byte-identical, and both readers are path-scoped, so the old base
    // answers the same stats and the same bytes. What changed is the claim.
    const fromOldBase = await diff(ws, doc.id, `?from=${interloper}&to=${body.to ?? ""}`);
    expect(fromOldBase.body.stats).toEqual(body.stats);
    expect(fromOldBase.body.diff).toBe(body.diff);
  });

  it("defaults to git's empty tree when nothing before this document's only commit touched it", async () => {
    // The honest base for a document whose first commit is its only one:
    // "nothing before this touched it", which is what the acknowledgment path
    // publishes for the same shape (SERVER-097). `parentOf` named some earlier
    // commit about another document instead — a base at which this file did not
    // exist, described as though it did.
    const ws = workspace("diff-default-first-commit");
    await createDoc(ws, { type: "note", title: "Estate", body: "one\n" });
    ws.advance(60_000);
    const fresh = await createDoc(
      ws,
      { type: "note", title: "Comment", body: "unrelated\n" },
      "agent",
    );

    const { status, body } = await diff(ws, fresh.id);
    expect(status).toBe(200);
    expect(body.from).toBe(EMPTY_TREE_OBJECT_ID);
    expect(body.to).toBe(ws.head());
    // The bytes are the same either way — a file absent at the old base and a
    // file absent from the empty tree produce the same whole-file-added diff —
    // so what changed is the claim alone.
    expect(body.diff).toContain("new file mode");
    expect(body.diff).toContain("+unrelated");
    expect(body.stats.commits).toBe(1);
    expect(body.stats.deletions).toBe(0);
  });

  it("leaves an explicitly named base alone, however unrelated the commit it names", async () => {
    // The default is what SERVER-113 changed. A caller that names a range still
    // gets exactly that range back — including one starting at a commit that
    // never touched this document, which is precisely what a client quoting an
    // older `doc.edited` range does.
    const ws = workspace("diff-explicit-base-kept");
    const doc = await createDoc(ws, { type: "note", title: "Estate", body: "one\n" });
    ws.advance(60_000);
    await createDoc(ws, { type: "note", title: "Comment", body: "unrelated\n" }, "agent");
    ws.advance(60_000);
    await putDoc(ws, doc.id, { body: "one\ntwo\n" }, { "x-corpus-author": "user" });
    ws.advance(60_000);
    // A fourth commit, so the range's ends both name windows that have closed.
    await createDoc(ws, { type: "note", title: "Ledger", body: "ledger\n" });
    const interloper = ws.git("rev-parse", "HEAD~2").trim();
    const edited = ws.git("rev-parse", "HEAD~1").trim();

    const { body } = await diff(ws, doc.id, `?from=${interloper}&to=${edited}`);
    expect(body.from).toBe(interloper);
    expect(body.to).toBe(edited);
    expect(body.diff).toContain("+two");
  });

  it("reads the range it is given, and reports it back resolved", async () => {
    const ws = workspace("diff-range");
    const doc = await createDoc(ws, { type: "note", title: "Ledger", body: "a\n" });
    ws.advance(60_000);
    await putDoc(ws, doc.id, { body: "a\nb\n" }, { "x-corpus-author": "user" });
    ws.advance(60_000);
    await putDoc(ws, doc.id, { body: "a\nb\nc\n" }, { "x-corpus-author": "user" });
    ws.advance(60_000);
    await putDoc(ws, doc.id, { body: "a\nb\nc\nd\n" }, { "x-corpus-author": "user" });
    // Both ends are named only once their own windows have closed. A commit
    // window is amendable while it is open — that is §4's whole mechanism — so a
    // sha read off an open window is rewritten under the reader, and a range
    // starting there counts the rewrite as one more commit (SERVER-091). Only
    // the fourth save's window is still open here, and neither end is it.
    const created = ws.git("rev-parse", "HEAD~3").trim();
    const settled = ws.git("rev-parse", "HEAD~1").trim();

    const { body } = await diff(ws, doc.id, `?from=${created.slice(0, 10)}&to=${settled}`);
    // Abbreviated in, full sha out: a caller that omitted or shortened a half
    // must be able to say exactly what it read.
    expect(body.from).toBe(created);
    expect(body.to).toBe(settled);
    expect(body.stats.commits).toBe(2);
    expect(body.diff).toContain("+b");
    expect(body.diff).toContain("+c");
    // And nothing outside the range: the fourth save is past `to`.
    expect(body.diff).not.toContain("+d");
  });

  it("accepts git's empty tree as the base, which is what a doc.edited carries for a new document", async () => {
    const ws = workspace("diff-empty-tree");
    const doc = await createDoc(ws, { type: "note", title: "Fresh", body: "hello\n" });

    const { status, body } = await diff(
      ws,
      doc.id,
      `?from=${EMPTY_TREE_OBJECT_ID}&to=${ws.head()}`,
    );
    expect(status).toBe(200);
    expect(body.from).toBe(EMPTY_TREE_OBJECT_ID);
    expect(body.diff).toContain("new file mode");
    expect(body.stats.deletions).toBe(0);
  });

  it("scopes the diff and the stats to this document's file alone", async () => {
    const ws = workspace("diff-scope");
    const one = await createDoc(ws, { type: "note", title: "One", body: "one\n" });
    // Past §4's idle window each time: the second creation is the *other* commit
    // this range is meant to span, not a fold into the first one's window
    // (SERVER-091 scoped the window to the party, so neighbours fold too). The
    // third exists only so both ends of the range name windows that have already
    // closed — a sha read off an open one is rewritten by the read itself
    // (SERVER-093).
    ws.advance(60_000);
    await createDoc(ws, { type: "note", title: "Two", body: "two\n" });
    ws.advance(60_000);
    await createDoc(ws, { type: "note", title: "Three", body: "three\n" });
    const base = ws.git("rev-parse", "HEAD~2").trim();
    const neighbour = ws.git("rev-parse", "HEAD~1").trim();

    const { body } = await diff(ws, one.id, `?from=${base}&to=${neighbour}`);
    expect(body.diff).toBe("");
    expect(body.stats).toEqual({ commits: 0, insertions: 0, deletions: 0 });
  });

  it("closes the open commit window before it reads, so the diff names the change it was asked about", async () => {
    // SPEC.md §4's read-back rule (SERVER-093). The save below leaves a window
    // open, which means HEAD is a commit the server intends to keep amending:
    // its boundary and its sha are both provisional until the window closes.
    const ws = workspace("diff-open-window");
    const doc = await createDoc(ws, { type: "note", title: "Live", body: "one\n" });
    ws.advance(60_000);
    await putDoc(ws, doc.id, { body: "one\ntwo\n" }, { "x-corpus-author": "user" });
    const commitsBefore = ws.log("%H").length;

    // No clock advance: the window is wide open at this instant.
    const { status, body } = await diff(ws, doc.id);
    expect(status).toBe(200);
    expect(body.diff).toContain("+two");
    // The close adds no commit — the window's content has been in git since its
    // first save — it only stops later saves folding in.
    expect(ws.log("%H").length).toBe(commitsBefore);
    // …and the sha it published is one the branch holds, after the relabel.
    expect(body.to).toBe(ws.head());
    expect(ws.log("%H")).toContain(body.to);
    // The window really closed, two ways: its commit was relabelled as the
    // editing session it was, and the next save opens a fresh commit instead of
    // amending this one.
    expect(ws.log("%s")[0]).toBe("editing session: 1 document by user");
    await putDoc(ws, doc.id, { body: "one\ntwo\nthree\n" }, { "x-corpus-author": "user" });
    expect(ws.log("%H").length).toBe(commitsBefore + 1);
  });

  it("gives each document its own diff where several share one window commit", async () => {
    // New under §4's party-scoped window: one commit now holds everything its
    // party touched while it was open, so "the diff of this commit" and "the
    // diff of this document" are no longer the same bytes. Every reader that
    // answers about a document has to be path-scoped or it answers about its
    // neighbours too.
    const ws = workspace("diff-shared-window");
    const seeded = ws.log("%H").length;
    const one = await createDoc(ws, { type: "note", title: "Alpha", body: "alpha body\n" });
    // No advance: same party, inside the idle window, so this folds into the
    // very same commit.
    const two = await createDoc(ws, { type: "note", title: "Beta", body: "beta body\n" });
    expect(ws.log("%H").length).toBe(seeded + 1);

    const alpha = await diff(ws, one.id);
    const beta = await diff(ws, two.id);

    // Both name the same commit — there is only one — and each shows only its
    // own document.
    expect(alpha.body.to).toBe(beta.body.to);
    expect(alpha.body.to).toBe(ws.head());
    expect(alpha.body.path).toBe(one.path);
    expect(beta.body.path).toBe(two.path);
    expect(alpha.body.diff).toContain("alpha body");
    expect(alpha.body.diff).not.toContain("beta body");
    expect(beta.body.diff).toContain("beta body");
    expect(beta.body.diff).not.toContain("alpha body");
    // And the stats describe the document, not the whole commit: the shared
    // commit's two files would double every count.
    expect(alpha.body.stats).toEqual(beta.body.stats);
    expect(alpha.body.stats.commits).toBe(1);
    expect(alpha.body.stats.deletions).toBe(0);
    const ownLines = ws.read(one.path).split("\n").length - 1;
    expect(alpha.body.stats.insertions).toBe(ownLines);
  });

  it("leaves the window open for reads that do not touch git history", async () => {
    // §4's second list: a projection query, a document read, a tree read and a
    // search close nothing and cost no git. Proven by what does *not* move —
    // HEAD keeps both its sha and the save's own subject, and the next save
    // still folds into it.
    const ws = workspace("diff-untouched-reads");
    const doc = await createDoc(ws, { type: "note", title: "Untouched", body: "one\n" });
    ws.advance(60_000);
    await putDoc(ws, doc.id, { body: "one\ntwo\n" }, { "x-corpus-author": "user" });
    const head = ws.head();
    const subject = ws.log("%s")[0];
    const commits = ws.log("%H").length;

    for (const path of [
      `/api/docs/${doc.id}`,
      "/api/docs",
      "/api/tree",
      "/api/search?q=two",
      `/api/docs/${doc.id}/related`,
    ]) {
      expect((await ws.request(path)).status).toBe(200);
    }

    expect(ws.head()).toBe(head);
    expect(ws.log("%s")[0]).toBe(subject);
    // Still foldable: the next save amends rather than committing afresh.
    await putDoc(ws, doc.id, { body: "one\ntwo\nthree\n" }, { "x-corpus-author": "user" });
    expect(ws.log("%H").length).toBe(commits);
    expect(ws.head()).not.toBe(head);
  });

  it("answers a null range for a document with no committed history", async () => {
    const ws = workspace("diff-no-git", { git: false });
    const doc = await createDoc(ws, { type: "note", title: "Uncommitted", body: "x\n" });

    const { status, body } = await diff(ws, doc.id);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      from: null,
      to: null,
      diff: "",
      truncated: false,
      totalChars: 0,
      stats: { commits: 0, insertions: 0, deletions: 0 },
    });
  });

  it("refuses a named revision before a git process exists", async () => {
    const ws = workspace("diff-dsl");
    const doc = await createDoc(ws, { type: "note", title: "Guarded", body: "x\n" });

    for (const [parameter, value] of [
      ["from", "HEAD~1"],
      ["to", "v1.0.0"],
      ["from", "--output=/tmp/x"],
      ["to", "-C/etc"],
    ] as const) {
      const { status, body } = await diff(ws, doc.id, `?${parameter}=${encodeURIComponent(value)}`);
      expect(status).toBe(400);
      expect(body.code).toBe("bad_request");
      expect(body.issues?.[0]?.path).toBe(`query.${parameter}`);
    }
  });

  it("refuses a well-formed sha this workspace does not contain, naming the parameter", async () => {
    const ws = workspace("diff-unknown-sha");
    const doc = await createDoc(ws, { type: "note", title: "Unknown", body: "x\n" });
    const absent = "0123456789abcdef0123456789abcdef01234567";

    const from = await diff(ws, doc.id, `?from=${absent}`);
    expect(from.status).toBe(400);
    expect(from.body.issues?.[0]?.path).toBe("query.from");

    const to = await diff(ws, doc.id, `?to=${absent}`);
    expect(to.status).toBe(400);
    expect(to.body.issues?.[0]?.path).toBe("query.to");
  });

  it("refuses the empty tree as the head of the range — `to` is a commit", async () => {
    const ws = workspace("diff-empty-tree-head");
    const doc = await createDoc(ws, { type: "note", title: "Head", body: "x\n" });

    const { status, body } = await diff(ws, doc.id, `?to=${EMPTY_TREE_OBJECT_ID}`);
    expect(status).toBe(400);
    expect(body.issues?.[0]?.path).toBe("query.to");
  });

  it("404s for an unknown document — never for an unknown revision", async () => {
    const ws = workspace("diff-unknown-doc");
    const { status, body } = await diff(ws, "doc_zzzzzzzz");
    expect(status).toBe(404);
    expect(body.code).toBe("not_found");
  });

  it("truncates a large change at a hunk boundary and says by how much", async () => {
    const ws = workspace("diff-truncate");
    const doc = await createDoc(ws, { type: "note", title: "Long", body: "seed\n" });
    ws.advance(60_000);
    // Distinct paragraphs separated by unchanged spacers, so git emits many
    // hunks rather than one enormous one.
    const long = Array.from(
      { length: 400 },
      (_, index) => `paragraph ${String(index)} ${"filler ".repeat(12)}`,
    ).join("\n\n");
    await putDoc(ws, doc.id, { body: `${long}\n` }, { "x-corpus-author": "user" });

    const { status, body } = await diff(ws, doc.id);
    expect(status).toBe(200);
    expect(body.truncated).toBe(true);
    expect(body.diff.length).toBeLessThanOrEqual(DOC_DIFF_MAX_CHARS);
    expect(body.totalChars).toBeGreaterThan(DOC_DIFF_MAX_CHARS);
    // Still a diff: it starts with the file header and ends on a line boundary.
    expect(body.diff.startsWith("diff --git ")).toBe(true);
    expect(body.diff.endsWith("\n")).toBe(true);
    // The stats describe the whole change, not the part that fitted.
    expect(body.stats.insertions).toBeGreaterThan(400);
  });

  it("requires the workspace token like every other route", async () => {
    const ws = workspace("diff-auth");
    const doc = await createDoc(ws, { type: "note", title: "Guarded", body: "x\n" });
    const response = await ws.server.app.request(`/api/docs/${doc.id}/diff`, { headers: {} });
    expect(response.status).toBe(401);
  });
});
