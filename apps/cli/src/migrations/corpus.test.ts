import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseFrontmatter, readWorkspaceCorpus } from "./corpus.js";

/**
 * Real files throughout. What this module does *is* read a directory tree, and a
 * mocked filesystem would test the mock.
 */

const PREFIX = "corpus-cli061-";
const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), PREFIX));
  scratch.push(dir);
  return dir;
}

function write(root: string, relative: string, contents: string): void {
  const absolute = join(root, ...relative.split("/"));
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents, "utf8");
}

describe("readWorkspaceCorpus", () => {
  it("reads every document under data/docs, nested, in path order", async () => {
    const root = tempRoot();
    write(
      root,
      "data/docs/views/attention.md",
      "---\nid: doc_a\ntype: view\ntitle: A\n---\nbody\n",
    );
    write(root, "data/docs/inbox/note.md", "---\nid: doc_n\ntype: note\ntitle: N\n---\n");
    write(root, "data/docs/deep/nested/board.md", "---\nid: doc_b\ntype: board\n---\n");

    const corpus = await readWorkspaceCorpus(root, "data");

    expect(corpus.root).toBe(root);
    expect(corpus.documents.map((document) => document.path)).toEqual([
      "data/docs/deep/nested/board.md",
      "data/docs/inbox/note.md",
      "data/docs/views/attention.md",
    ]);
    expect(corpus.documents.map((document) => document.id)).toEqual(["doc_b", "doc_n", "doc_a"]);
    expect(corpus.documents.map((document) => document.type)).toEqual(["board", "note", "view"]);
  });

  it("honours a non-default dataDir", async () => {
    const root = tempRoot();
    write(root, "corpus-data/docs/x.md", "---\nid: doc_x\ntype: view\n---\n");
    write(root, "data/docs/y.md", "---\nid: doc_y\ntype: view\n---\n");

    expect((await readWorkspaceCorpus(root, "corpus-data")).documents.map((d) => d.id)).toEqual([
      "doc_x",
    ]);
  });

  it("is an empty corpus when there is no docs tree at all", async () => {
    expect((await readWorkspaceCorpus(tempRoot(), "data")).documents).toEqual([]);
  });

  it("ignores files that are not markdown", async () => {
    const root = tempRoot();
    write(root, "data/docs/views/a.md", "---\nid: doc_a\ntype: view\n---\n");
    write(root, "data/docs/views/notes.txt", "---\nid: doc_t\ntype: view\n---\n");

    expect((await readWorkspaceCorpus(root, "data")).documents.map((d) => d.id)).toEqual(["doc_a"]);
  });

  it("skips a file it cannot parse rather than failing the whole read", async () => {
    const root = tempRoot();
    write(root, "data/docs/views/broken.md", "no frontmatter at all\n");
    write(root, "data/docs/views/unterminated.md", "---\nid: doc_u\n");
    write(root, "data/docs/views/bad-yaml.md", "---\nid: [unclosed\n---\n");
    write(root, "data/docs/views/good.md", "---\nid: doc_g\ntype: view\n---\n");

    // The migration report is advice, not validation: `corpus doc check` owns
    // "this file is broken", and an upgrade that refused over an unrelated one
    // would report no migration at the one moment it is asked for it.
    expect((await readWorkspaceCorpus(root, "data")).documents.map((d) => d.id)).toEqual(["doc_g"]);
  });

  it("keeps the frontmatter exactly as written, undefaulted", async () => {
    const root = tempRoot();
    write(
      root,
      "data/docs/views/a.md",
      "---\nid: doc_a\ntype: view\npinned: true\norder: 2\n---\n",
    );

    const [document] = (await readWorkspaceCorpus(root, "data")).documents;
    expect(document?.frontmatter).toEqual({ id: "doc_a", type: "view", pinned: true, order: 2 });
    // No status key on disk means no status key here — never the default.
    expect(document?.frontmatter.status).toBeUndefined();
  });
});

describe("parseFrontmatter", () => {
  it("reads a plain block", async () => {
    expect(await parseFrontmatter("---\na: 1\n---\nbody")).toEqual({ a: 1 });
  });

  it("tolerates a BOM and CRLF line endings", async () => {
    expect(await parseFrontmatter("﻿---\r\na: 1\r\n---\r\nbody")).toEqual({ a: 1 });
  });

  it("reads an empty block as a document with no keys", async () => {
    expect(await parseFrontmatter("---\n---\nbody")).toEqual({});
  });

  it("refuses a file with no leading fence", async () => {
    expect(await parseFrontmatter("a: 1\n---\n")).toBeNull();
  });

  it("refuses an unterminated block", async () => {
    expect(await parseFrontmatter("---\na: 1\n")).toBeNull();
  });

  it("refuses frontmatter that is not a mapping", async () => {
    expect(await parseFrontmatter("---\n- one\n- two\n---\n")).toBeNull();
  });

  it("stops at the first closing fence, so a body's own --- is body", async () => {
    expect(await parseFrontmatter("---\na: 1\n---\nbefore\n---\nafter\n")).toEqual({ a: 1 });
  });
});
