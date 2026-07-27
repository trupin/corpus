import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openProjection, type ProjectionConfig, type ProjectionDb } from "./db.js";
import { clearProjection, populateFromFiles } from "./populate.js";

let root: string;
let config: ProjectionConfig;
let db: ProjectionDb;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s004-populate-"));
  const ws = join(root, "ws");
  mkdirSync(join(ws, "data", "docs"), { recursive: true });
  config = { workspaceRoot: ws, corpusDir: join(ws, ".corpus") };
  db = openProjection(config, { populate: false });
});

afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

function write(relative: string, content: string): void {
  const abs = join(config.workspaceRoot, relative);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

const doc = (id: string, body = "Body.\n"): string =>
  `---\nid: ${id}\ntype: note\ntitle: ${id}\ncreated: 2026-01-01T00:00:00Z\nupdated: 2026-01-01T00:00:00Z\n---\n\n${body}`;

describe("populateFromFiles", () => {
  it("counts what it wrote and names what it skipped", () => {
    write("data/docs/a.md", doc("doc_aaa", "See [[th_ttt]].\n"));
    write("data/docs/b.md", doc("doc_bbb"));
    write("data/docs/broken.md", `---\nid: doc_x\ntitle: [unclosed\n---\n\nBody.\n`);
    write(
      "data/docs/anchored.md",
      `---\nid: doc_anc\ntype: note\ntitle: Anchored\nanchors:\n  anc_one:\n    exact: "quoted"\n---\n\nSome quoted text.\n`,
    );
    write(
      "data/threads/th_ttt.md",
      `---\nid: th_ttt\ntype: thread\ntitle: T\n---\n\n## user · 2026-07-03T09:00:00Z\n\nHi.\n\n## agent · 2026-07-04T09:00:00Z\n\nHello.\n`,
    );
    mkdirSync(join(config.corpusDir, "queue", "pending"), { recursive: true });
    writeFileSync(
      join(config.corpusDir, "queue", "pending", "evt_abc123def456.json"),
      JSON.stringify({
        id: "evt_abc123def456",
        type: "comment.created",
        created: "2026-07-06T09:00:00Z",
        source: "cli",
        payload: {},
      }),
      "utf8",
    );

    const report = populateFromFiles(db);
    expect(report).toMatchObject({
      documents: 4,
      threads: 1,
      turns: 2,
      anchors: 1,
      links: 1,
      events: 1,
      jobs: 0,
      locks: 0,
      seen: 0,
    });
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]?.path).toBe("data/docs/broken.md");
    expect(report.skipped[0]?.reason).toMatch(/invalid YAML frontmatter/);

    expect(db.prepare("SELECT COUNT(*) AS n FROM documents").get()).toEqual({ n: 4 });
  });

  it("is a replacement, not an accumulation", () => {
    write("data/docs/a.md", doc("doc_aaa"));
    populateFromFiles(db);
    rmSync(join(config.workspaceRoot, "data", "docs", "a.md"));
    write("data/docs/b.md", doc("doc_bbb"));

    expect(populateFromFiles(db).documents).toBe(1);
    expect(db.prepare("SELECT id FROM documents").all()).toEqual([{ id: "doc_bbb" }]);
  });

  it("resolves duplicate ids by path order, identically on every run", () => {
    write("data/docs/a.md", doc("doc_dup"));
    write("data/docs/b.md", doc("doc_dup"));

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const report = populateFromFiles(db);
      expect(db.prepare("SELECT path FROM documents").all()).toEqual([{ path: "data/docs/a.md" }]);
      expect(report.skipped.map((entry) => entry.path)).toEqual(["data/docs/b.md"]);
    }
  });

  it("produces an empty but valid database for an empty workspace", () => {
    const report = populateFromFiles(db);
    expect(report).toMatchObject({ documents: 0, threads: 0, turns: 0, skipped: [] });
    expect(db.prepare("SELECT COUNT(*) AS n FROM documents").get()).toEqual({ n: 0 });
  });
});

describe("clearProjection", () => {
  it("empties every derived table but leaves the schema stamp", () => {
    write("data/docs/a.md", doc("doc_aaa"));
    populateFromFiles(db);
    clearProjection(db);

    for (const table of ["documents", "anchors", "links", "search", "file_hashes"]) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(), table).toEqual({ n: 0 });
    }
    expect(db.prepare("SELECT COUNT(*) AS n FROM meta").get()).toEqual({ n: 1 });
  });
});
