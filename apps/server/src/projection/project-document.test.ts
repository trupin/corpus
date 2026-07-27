import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reconcileAnchors, resolveAnchor } from "../anchors/index.js";
import { openProjection, type ProjectionDb } from "./db.js";
import {
  EXCERPT_LENGTH,
  projectDocument,
  readDocumentIdentity,
  removeDocument,
  syntheticDocumentId,
} from "./project-document.js";
import { DOCUMENT_ROOTS, type DocumentRoot } from "./roots.js";

/** The declared root with this key — `noUncheckedIndexedAccess` makes indexing a poor spelling. */
function rootFor(key: DocumentRoot["key"]): DocumentRoot {
  const found = DOCUMENT_ROOTS.find((entry) => entry.key === key);
  if (found === undefined) throw new Error(`no document root named ${key}`);
  return found;
}

let root: string;
let ws: string;
let db: ProjectionDb;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s004-doc-"));
  ws = join(root, "ws");
  mkdirSync(join(ws, "data", "docs"), { recursive: true });
  db = openProjection({ workspaceRoot: ws, corpusDir: join(ws, ".corpus") });
});

afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

function write(relative: string, content: string): string {
  const abs = join(ws, relative);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
  return abs;
}

/** Writes a document and projects it, returning the absolute path. */
function project(relative: string, content: string): string {
  const abs = write(relative, content);
  const outcome = projectDocument(db, abs);
  expect(outcome.kind, JSON.stringify(outcome)).toBe("projected");
  return abs;
}

const rowFor = (id: string): Record<string, unknown> =>
  db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as Record<string, unknown>;

describe("projectDocument — the documents row", () => {
  it("carries the §9.1 shape", () => {
    const body = `${"lorem ipsum ".repeat(60)}`;
    project(
      "data/docs/finance/mortgage.md",
      `---\nid: doc_a1b2c3\ntype: note\ntitle: Mortgage options\ncreated: 2026-07-01T09:00:00Z\nupdated: 2026-07-20T11:30:00Z\ntags: [finance, urgent]\nstatus: open\ndue: 2026-08-01\nreviewed: 2026-07-15T08:00:00Z\nevergreen: true\n---\n\n${body}\n`,
    );

    const row = rowFor("doc_a1b2c3");
    expect(row).toMatchObject({
      id: "doc_a1b2c3",
      type: "note",
      title: "Mortgage options",
      path: "data/docs/finance/mortgage.md",
      status: "open",
      created: "2026-07-01T09:00:00Z",
      updated: "2026-07-20T11:30:00Z",
      due: "2026-08-01",
      reviewed: "2026-07-15T08:00:00Z",
      evergreen: 1,
    });
    expect(JSON.parse(String(row.tags_json))).toEqual(["finance", "urgent"]);
    expect(String(row.body_excerpt)).toHaveLength(EXCERPT_LENGTH);
    expect(String(row.body_excerpt)).toBe(body.slice(0, EXCERPT_LENGTH));
  });

  it("defaults status, tags, dates and evergreen when the file omits them", () => {
    project("data/docs/bare.md", `---\nid: doc_bare\ntype: note\ntitle: Bare\n---\n\nBody.\n`);
    expect(rowFor("doc_bare")).toMatchObject({
      status: "open",
      tags_json: "[]",
      created: null,
      updated: null,
      due: null,
      reviewed: null,
      evergreen: 0,
      // Only *leading* whitespace is stripped: the excerpt is the first 280
      // characters of the body, not a re-flowed summary of it.
      body_excerpt: "Body.\n",
    });
  });

  it("normalizes hand-written timestamps to canonical UTC", () => {
    project(
      "data/docs/tz.md",
      `---\nid: doc_tz\ntype: note\ntitle: TZ\ncreated: 2026-07-01T11:00:00+02:00\nupdated: 2026-07-01T09:00:00.500Z\n---\n\nBody.\n`,
    );
    expect(rowFor("doc_tz")).toMatchObject({
      created: "2026-07-01T09:00:00Z",
      updated: "2026-07-01T09:00:00Z",
    });
  });

  it("keeps a multi-megabyte document inside the excerpt budget", () => {
    const body = "x".repeat(5 * 1024 * 1024);
    project("data/docs/huge.md", `---\nid: doc_huge\ntype: note\ntitle: Huge\n---\n\n${body}\n`);
    expect(String(rowFor("doc_huge").body_excerpt)).toHaveLength(EXCERPT_LENGTH);
    expect(db.prepare("SELECT ref FROM search WHERE search MATCH 'Huge'").all()).toEqual([
      { ref: "doc_huge" },
    ]);
  });

  it("is visible to a SELECT in the same tick — no polling, nothing async", () => {
    const abs = write(
      "data/docs/sync.md",
      `---\nid: doc_sync\ntype: note\ntitle: Sync\n---\n\nBody.\n`,
    );
    const outcome = projectDocument(db, abs);
    expect(outcome.kind).toBe("projected");
    expect(rowFor("doc_sync")).toMatchObject({ title: "Sync" });
  });
});

describe("projectDocument — roots and typing (§7)", () => {
  it("types each root's documents and forces the archived skill's status", () => {
    project("data/docs/a.md", `---\nid: doc_a\ntype: note\ntitle: A\n---\n\nA.\n`);
    project(
      "data/threads/th_x9y8.md",
      `---\nid: th_x9y8\ntype: thread\ntitle: T\n---\n\n## user · 2026-07-03T09:00:00Z\n\nHi.\n`,
    );
    project(
      ".claude/skills/orchestrate/SKILL.md",
      `---\nid: doc_sk\ntype: skill\ntitle: Orchestrate\nstatus: open\n---\n\nS.\n`,
    );
    project(
      ".claude/skills-archived/legacy/SKILL.md",
      `---\nid: doc_old\ntype: skill\ntitle: Legacy\nstatus: open\n---\n\nS.\n`,
    );
    project(
      ".claude/agents/researcher.md",
      `---\nid: doc_ag\ntype: agent-def\ntitle: Researcher\n---\n\nP.\n`,
    );

    expect(db.prepare("SELECT type, status, path FROM documents ORDER BY path").all()).toEqual([
      { type: "agent-def", status: "open", path: ".claude/agents/researcher.md" },
      { type: "skill", status: "archived", path: ".claude/skills-archived/legacy/SKILL.md" },
      { type: "skill", status: "open", path: ".claude/skills/orchestrate/SKILL.md" },
      { type: "note", status: "open", path: "data/docs/a.md" },
      { type: "thread", status: "open", path: "data/threads/th_x9y8.md" },
    ]);
  });

  it("indexes a SKILL.md carrying both Claude Code's and Corpus's frontmatter", () => {
    project(
      ".claude/skills/comment/SKILL.md",
      `---\nname: comment\ndescription: Handle a comment.\nid: doc_skillcomment\ntype: skill\ntitle: Comment\ntags: [core]\nstatus: open\nanchors: {}\n---\n\nBody.\n`,
    );
    expect(rowFor("doc_skillcomment")).toMatchObject({
      title: "Comment",
      type: "skill",
      tags_json: '["core"]',
    });
  });

  it("gives a skill with no Corpus id a stable synthetic id and never writes to the file", () => {
    const relative = ".claude/skills/notes/SKILL.md";
    const content = `---\nname: notes\ndescription: Take notes.\n---\n\nBody.\n`;
    const abs = write(relative, content);
    const before = statSync(abs);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const outcome = projectDocument(db, abs);
      expect(outcome).toMatchObject({
        kind: "projected",
        id: syntheticDocumentId(rootFor("skills"), relative),
      });
    }

    const row = db.prepare("SELECT id, title, type FROM documents").get() as {
      id: string;
      title: string;
      type: string;
    };
    // Title falls back to Claude Code's `name`, and the id is contract-shaped.
    expect(row.title).toBe("notes");
    expect(row.type).toBe("skill");
    expect(row.id).toMatch(/^doc_[A-Za-z0-9]+$/);

    const after = statSync(abs);
    expect(readFileSync(abs, "utf8")).toBe(content);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it("falls back to the folder name for a skill with no title at all", () => {
    project(".claude/skills/triage/SKILL.md", `---\nstatus: open\n---\n\nBody.\n`);
    expect(db.prepare("SELECT title FROM documents").get()).toEqual({ title: "triage" });
  });

  it("falls back to the filename for an agent definition with no title", () => {
    project(".claude/agents/researcher.md", `---\nstatus: open\n---\n\nBody.\n`);
    expect(db.prepare("SELECT title FROM documents").get()).toEqual({ title: "researcher" });
  });

  it("ignores anything outside a document root", () => {
    const abs = write("README.md", `---\nid: doc_readme\ntype: note\ntitle: R\n---\n\nR.\n`);
    expect(projectDocument(db, abs)).toEqual({ kind: "ignored", path: "README.md" });
    expect(projectDocument(db, join(root, "elsewhere.md"))).toMatchObject({ kind: "ignored" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM documents").get()).toEqual({ n: 0 });
  });

  it("skips a document root file whose frontmatter declares no valid id", () => {
    const abs = write("data/docs/noid.md", `---\ntype: note\ntitle: No id\n---\n\nBody.\n`);
    expect(projectDocument(db, abs)).toMatchObject({ kind: "skipped", reason: /no valid `id`/ });
    expect(db.prepare("SELECT COUNT(*) AS n FROM documents").get()).toEqual({ n: 0 });
  });
});

describe("projectDocument — threads and turns", () => {
  const THREAD = `---\nid: th_x9y8\ntype: thread\ntitle: Rate assumptions\ncreated: 2026-07-03T09:00:00Z\nupdated: 2026-07-05T09:00:00Z\nstatus: open\nparent: doc_a1b2c3\nanchor: anc_k4f7\nagent: engaged\n---\n\nPreamble.\n\n## user · 2026-07-03T09:00:00Z\n\nFirst.\n\n## agent · 2026-07-04T09:00:00Z\n\nSecond.\n\n## user · 2026-07-05T09:00:00Z\n\nThird.\n`;

  it("projects the thread row and its turns in document order", () => {
    project("data/threads/th_x9y8.md", THREAD);

    expect(db.prepare("SELECT * FROM threads").get()).toEqual({
      id: "th_x9y8",
      parent_id: "doc_a1b2c3",
      status: "open",
      agent: "engaged",
      anchor_id: "anc_k4f7",
      title: "Rate assumptions",
      created: "2026-07-03T09:00:00Z",
      updated: "2026-07-05T09:00:00Z",
      turn_count: 3,
      last_author: "user",
      last_ts: "2026-07-05T09:00:00Z",
    });

    expect(db.prepare("SELECT idx, author, ts, body_md FROM turns ORDER BY idx").all()).toEqual([
      { idx: 0, author: "user", ts: "2026-07-03T09:00:00Z", body_md: "First." },
      { idx: 1, author: "agent", ts: "2026-07-04T09:00:00Z", body_md: "Second." },
      { idx: 2, author: "user", ts: "2026-07-05T09:00:00Z", body_md: "Third." },
    ]);
  });

  it("defaults parent, anchor and agent when the frontmatter omits or mangles them", () => {
    project(
      "data/threads/th_bare.md",
      `---\nid: th_bare\ntype: thread\ntitle: Bare\nparent: not-an-id\nanchor: nope\n---\n\nNo turns yet.\n`,
    );
    expect(db.prepare("SELECT * FROM threads").get()).toMatchObject({
      parent_id: null,
      anchor_id: null,
      agent: "none",
      turn_count: 0,
      last_author: null,
      last_ts: null,
    });
  });

  it("keeps the first of two turns sharing a timestamp rather than failing the document", () => {
    project(
      "data/threads/th_dupe.md",
      `---\nid: th_dupe\ntype: thread\ntitle: Dupe\n---\n\n## user · 2026-07-03T09:00:00Z\n\nFirst.\n\n## agent · 2026-07-03T09:00:00Z\n\nSecond.\n`,
    );
    expect(db.prepare("SELECT author, body_md FROM turns").all()).toEqual([
      { author: "user", body_md: "First." },
    ]);
    expect(db.prepare("SELECT turn_count FROM threads").get()).toEqual({ turn_count: 2 });
  });
});

describe("projectDocument — links", () => {
  it("extracts refs from document bodies and turn bodies, never from code fences", () => {
    project(
      "data/docs/note.md",
      `---\nid: doc_note\ntype: note\ntitle: Note\n---\n\nSee [[th_x9y8]].\n\n\`\`\`\n[[doc_never]]\n\`\`\`\n\nAlso \`[[doc_inline]]\`.\n`,
    );
    project(
      "data/threads/th_x9y8.md",
      `---\nid: th_x9y8\ntype: thread\ntitle: T\n---\n\n## user · 2026-07-03T09:00:00Z\n\nSee [[doc_a1b2c3]].\n`,
    );

    expect(db.prepare("SELECT from_id, to_id FROM links ORDER BY from_id, to_id").all()).toEqual([
      { from_id: "doc_note", to_id: "th_x9y8" },
      { from_id: "th_x9y8", to_id: "doc_a1b2c3" },
    ]);
  });

  it("records one row per distinct target however often it is referenced", () => {
    project(
      "data/docs/note.md",
      `---\nid: doc_note\ntype: note\ntitle: Note\n---\n\n[[th_a]] and [[th_a|again]] and [[th_a]].\n`,
    );
    expect(db.prepare("SELECT COUNT(*) AS n FROM links").get()).toEqual({ n: 1 });
  });
});

describe("projectDocument — anchors (Sprint-003 Adjudication 1: exact-only)", () => {
  it("resolves a live anchor to an offset that slices back to its quoted text", () => {
    const body = "\nLet us assume a 30-year fixed at 6.1% for the base case.\n";
    project(
      "data/docs/mortgage.md",
      `---\nid: doc_a1b2c3\ntype: note\ntitle: M\nanchors:\n  anc_k4f7:\n    exact: "assume a 30-year fixed at 6.1%"\n    prefix: "Let us "\n    suffix: " for the base case."\n---\n${body}`,
    );

    const row = db.prepare("SELECT * FROM anchors WHERE anchor_id = 'anc_k4f7'").get() as {
      resolved_offset: number;
      exact_text: string;
      prefix: string;
      suffix: string;
    };
    expect(Number.isInteger(row.resolved_offset)).toBe(true);
    expect(body.slice(row.resolved_offset, row.resolved_offset + row.exact_text.length)).toBe(
      "assume a 30-year fixed at 6.1%",
    );
    expect(row.prefix).toBe("Let us ");
    expect(row.suffix).toBe(" for the base case.");
  });

  it("projects NULL for a selector with no counterpart in the body", () => {
    project(
      "data/docs/gone.md",
      `---\nid: doc_gone\ntype: note\ntitle: G\nanchors:\n  anc_gone:\n    exact: "a clause deleted long ago"\n    prefix: ""\n    suffix: ""\n---\n\nNothing like it here.\n`,
    );
    expect(db.prepare("SELECT resolved_offset FROM anchors").get()).toEqual({
      resolved_offset: null,
    });
  });

  it("never lands the orphaned bread bullet on the milk bullet", () => {
    // The edit runs through the real reconciliation path, so the selector on
    // disk is whatever §6 step 5 preserved — not a hand-made fixture.
    const before =
      "\nGroceries:\n\n- bread from the corner bakery\n- milk from the corner bakery\n";
    const after = "\nGroceries:\n\n- milk from the corner bakery\n";
    const { anchors, report } = reconcileAnchors(before, after, {
      anc_bread: {
        exact: "- bread from the corner bakery",
        prefix: "Groceries:\n\n",
        suffix: "\n- milk from the corner bakery",
      },
    });
    expect(report.orphaned).toEqual(["anc_bread"]);

    project(
      "data/docs/groceries.md",
      `---\nid: doc_groc\ntype: note\ntitle: Groceries\nanchors: ${JSON.stringify(anchors)}\n---\n${after}`,
    );

    const row = db.prepare("SELECT resolved_offset FROM anchors").get() as {
      resolved_offset: number | null;
    };
    expect(row.resolved_offset).toBeNull();
    expect(row.resolved_offset).not.toBe(after.indexOf("- milk from the corner bakery"));
  });

  it("does not let fuzzy similarity produce an offset at projection time", () => {
    const selector = {
      exact: "assume a 30-year fixed at 6.1%",
      prefix: "Let us ",
      suffix: " for the base case.",
    };
    // Edited out of band: no reconciliation has run, so the selector still
    // quotes the old rate while the body carries the new one.
    const body = "\nLet us assume a 30-year fixed at 6.4% for the base case.\n";
    // The full §6 ladder *would* find it — which is exactly why projection must
    // not run the full ladder.
    expect(resolveAnchor(body, selector)).not.toBeNull();

    project(
      "data/docs/rate.md",
      `---\nid: doc_rate\ntype: note\ntitle: R\nanchors: ${JSON.stringify({ anc_r: selector })}\n---\n${body}`,
    );
    expect(db.prepare("SELECT resolved_offset FROM anchors").get()).toEqual({
      resolved_offset: null,
    });
  });

  it("re-attaches an exact-only match when the deleted text is restored verbatim", () => {
    const restored =
      "\nGroceries:\n\n- bread from the corner bakery\n- milk from the corner bakery\n";
    const selector = {
      exact: "- bread from the corner bakery",
      prefix: "Groceries:\n\n",
      suffix: "\n- milk from the corner bakery",
    };
    project(
      "data/docs/groceries.md",
      `---\nid: doc_groc\ntype: note\ntitle: G\nanchors: ${JSON.stringify({ anc_bread: selector })}\n---\n${restored}`,
    );
    const row = db.prepare("SELECT resolved_offset FROM anchors").get() as {
      resolved_offset: number;
    };
    expect(row.resolved_offset).toBe(restored.indexOf("- bread from the corner bakery"));
  });

  it("keeps the valid anchors of a map that carries one malformed entry", () => {
    project(
      "data/docs/mixed.md",
      `---\nid: doc_mixed\ntype: note\ntitle: M\nanchors:\n  anc_ok:\n    exact: "keep me"\n  not_an_anchor_id:\n    exact: "ignored"\n  anc_bad: "not an object"\n---\n\nPlease keep me here.\n`,
    );
    expect(db.prepare("SELECT anchor_id FROM anchors").all()).toEqual([{ anchor_id: "anc_ok" }]);
  });

  it("ignores an anchors key that is not a mapping at all", () => {
    project(
      "data/docs/weird.md",
      `---\nid: doc_weird\ntype: note\ntitle: W\nanchors: [1, 2]\n---\n\nBody.\n`,
    );
    expect(db.prepare("SELECT COUNT(*) AS n FROM anchors").get()).toEqual({ n: 0 });
  });
});

describe("projectDocument — full-text search", () => {
  it("finds documents by title, by body, and by turn body", () => {
    project(
      "data/docs/titled.md",
      `---\nid: doc_titled\ntype: note\ntitle: Mortgage options\n---\n\nNothing relevant here.\n`,
    );
    project(
      "data/docs/bodied.md",
      `---\nid: doc_bodied\ntype: note\ntitle: Rates\n---\n\nThe mortgage is the interesting part.\n`,
    );
    project(
      "data/threads/th_x9y8.md",
      `---\nid: th_x9y8\ntype: thread\ntitle: Rates thread\n---\n\nPreamble.\n\n## user · 2026-07-03T09:00:00Z\n\nAbout the mortgage.\n`,
    );

    const hits = db
      .prepare(
        "SELECT ref, kind, doc_id, snippet(search, 4, '[', ']', '…', 8) AS snip FROM search WHERE search MATCH 'mortgage' ORDER BY ref",
      )
      .all() as { ref: string; kind: string; doc_id: string; snip: string }[];

    expect(hits.map((hit) => [hit.ref, hit.kind, hit.doc_id])).toEqual([
      ["doc_bodied", "doc", "doc_bodied"],
      ["doc_titled", "doc", "doc_titled"],
      ["th_x9y8#2026-07-03T09:00:00Z", "turn", "th_x9y8"],
    ]);
    for (const hit of hits) expect(hit.snip).not.toBe("");
  });

  it("honours the declared tokenizer's diacritic folding", () => {
    project("data/docs/cafe.md", `---\nid: doc_cafe\ntype: note\ntitle: T\n---\n\nAu café.\n`);
    expect(db.prepare("SELECT ref FROM search WHERE search MATCH 'cafe'").all()).toEqual([
      { ref: "doc_cafe" },
    ]);
  });
});

describe("projectDocument — replacement and removal", () => {
  const DOC = `---\nid: doc_aaa\ntype: note\ntitle: A\nanchors:\n  anc_a:\n    exact: "anchored"\n---\n\nSee [[th_zzz]] — anchored here.\n`;

  it("leaves no stale rows after removeDocument", () => {
    const abs = project("data/docs/a.md", DOC);
    project(
      "data/threads/th_zzz.md",
      `---\nid: th_zzz\ntype: thread\ntitle: T\n---\n\n## user · 2026-07-03T09:00:00Z\n\nHi.\n`,
    );

    rmSync(abs);
    expect(removeDocument(db, abs)).toEqual({ kind: "removed", path: "data/docs/a.md" });

    for (const sql of [
      "SELECT COUNT(*) AS n FROM documents WHERE id = 'doc_aaa'",
      "SELECT COUNT(*) AS n FROM documents WHERE path = 'data/docs/a.md'",
      "SELECT COUNT(*) AS n FROM anchors WHERE doc_id = 'doc_aaa'",
      "SELECT COUNT(*) AS n FROM links WHERE from_id = 'doc_aaa'",
      "SELECT COUNT(*) AS n FROM search WHERE doc_id = 'doc_aaa'",
      "SELECT COUNT(*) AS n FROM file_hashes WHERE path = 'data/docs/a.md'",
    ]) {
      expect(db.prepare(sql).get(), sql).toEqual({ n: 0 });
    }
    // The unrelated thread is untouched.
    expect(db.prepare("SELECT COUNT(*) AS n FROM turns").get()).toEqual({ n: 1 });
  });

  it("re-identifies a path whose document was replaced by a different id", () => {
    project("data/docs/a.md", DOC);
    project("data/docs/a.md", `---\nid: doc_bbb\ntype: note\ntitle: B\n---\n\nFresh.\n`);

    expect(db.prepare("SELECT id FROM documents WHERE path = 'data/docs/a.md'").all()).toEqual([
      { id: "doc_bbb" },
    ]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM documents").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM anchors").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM links").get()).toEqual({ n: 0 });
  });

  it("removeDocument on an unknown or outside path is a no-op", () => {
    expect(removeDocument(db, join(ws, "data", "docs", "never.md"))).toEqual({
      kind: "removed",
      path: "data/docs/never.md",
    });
    expect(removeDocument(db, join(root, "outside.md"))).toMatchObject({ kind: "ignored" });
  });

  it("treats a file that vanished before its read as a removal, not an error", () => {
    const abs = project("data/docs/a.md", DOC);
    rmSync(abs);
    expect(projectDocument(db, abs)).toEqual({ kind: "removed", path: "data/docs/a.md" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM documents").get()).toEqual({ n: 0 });
  });

  it("skips unparseable frontmatter without inserting anything", () => {
    const abs = write(
      "data/docs/broken.md",
      `---\nid: doc_broken\ntitle: [unclosed\n---\n\nBody.\n`,
    );
    const outcome = projectDocument(db, abs);
    expect(outcome).toMatchObject({ kind: "skipped", path: "data/docs/broken.md" });
    expect(outcome.kind === "skipped" && outcome.reason).toMatch(/invalid YAML frontmatter/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM documents").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM file_hashes").get()).toEqual({ n: 0 });
  });
});

describe("projectDocument — duplicate ids", () => {
  const dup = (title: string): string =>
    `---\nid: doc_dup\ntype: note\ntitle: ${title}\n---\n\nBody.\n`;

  it("keeps the first file by path order and reports the rest", () => {
    project("data/docs/a.md", dup("A"));
    const second = write("data/docs/b.md", dup("B"));
    expect(projectDocument(db, second)).toMatchObject({
      kind: "skipped",
      path: "data/docs/b.md",
      reason: /duplicate id doc_dup, already projected from data\/docs\/a\.md/,
    });
    expect(db.prepare("SELECT path FROM documents").all()).toEqual([{ path: "data/docs/a.md" }]);
  });

  it("takes the id over when the incoming path sorts first", () => {
    project("data/docs/b.md", dup("B"));
    project("data/docs/a.md", dup("A"));
    expect(db.prepare("SELECT path, title FROM documents").all()).toEqual([
      { path: "data/docs/a.md", title: "A" },
    ]);
  });
});

describe("readDocumentIdentity", () => {
  const docsRoot = rootFor("docs");

  it("reports the id a file would be projected under", () => {
    expect(
      readDocumentIdentity(
        docsRoot,
        "data/docs/a.md",
        `---\nid: doc_aaa\ntype: note\ntitle: A\n---\n\nBody.\n`,
      ),
    ).toEqual({ kind: "id", id: "doc_aaa" });
  });

  it("reports unparseable frontmatter", () => {
    expect(
      readDocumentIdentity(docsRoot, "data/docs/a.md", `no frontmatter at all\n`),
    ).toMatchObject({ kind: "unparseable" });
  });

  it("reports a document root file with no usable id", () => {
    expect(
      readDocumentIdentity(docsRoot, "data/docs/a.md", `---\ntype: note\ntitle: A\n---\n\nBody.\n`),
    ).toMatchObject({ kind: "no-id" });
  });
});

describe("syntheticDocumentId", () => {
  it("is deterministic, path-derived, and shaped like a contract document id", () => {
    const skills = rootFor("skills");
    const id = syntheticDocumentId(skills, ".claude/skills/notes/SKILL.md");
    expect(id).toBe(syntheticDocumentId(skills, ".claude/skills/notes/SKILL.md"));
    expect(id).not.toBe(syntheticDocumentId(skills, ".claude/skills/other/SKILL.md"));
    expect(id).toMatch(/^doc_[A-Za-z0-9]+$/);
  });
});
