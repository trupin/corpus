import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openProjection, type ProjectionConfig, type ProjectionDb } from "./db.js";
import { clearProjection, populateFromFiles } from "./populate.js";
import { projectDocument } from "./project-document.js";
import { UNREADABLE_REASON, writeUnreadableDocument } from "./unreadable-fixture.js";

let root: string;
let config: ProjectionConfig;
let db: ProjectionDb;
/**
 * `silent` deliberately: SERVER-064 asserts the *level* of the skip, and a
 * server run this way is the one where only `error` survives — so a logger that
 * accepted everything could not tell the two faults apart.
 */
let logger: {
  level: "silent";
  info: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s004-populate-"));
  const ws = join(root, "ws");
  mkdirSync(join(ws, "data", "docs"), { recursive: true });
  config = { workspaceRoot: ws, corpusDir: join(ws, ".corpus") };
  logger = { level: "silent", info: vi.fn(), debug: vi.fn(), error: vi.fn() };
  db = openProjection(config, { populate: false, logger });
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

  // SERVER-064. This function runs from `openProjection`, i.e. during boot, so
  // the pre-fix rethrow was not "the projection is degraded": it was `corpus
  // server start` reporting that the server exited during startup, over one
  // ordinary `.md` in `data/`, with no server left to ask why. The docblock
  // above it already promised otherwise; this is what makes the promise true.
  describe("a document it cannot read at all", () => {
    const seedWorkspace = (): string => {
      write("data/docs/a.md", doc("doc_aaa"));
      write("data/docs/z.md", doc("doc_zzz"));
      // Between the two by path order, so the readable document *after* it
      // proves the loop carried on rather than merely surviving the last entry.
      const unreadable = join(config.workspaceRoot, "data", "docs", "m.md");
      writeUnreadableDocument(unreadable);
      return unreadable;
    };

    it("skips it and still populates every other document", () => {
      seedWorkspace();

      const report = populateFromFiles(db);

      expect(report.documents).toBe(2);
      expect(db.prepare("SELECT id FROM documents ORDER BY id").all()).toEqual([
        { id: "doc_aaa" },
        { id: "doc_zzz" },
      ]);
      // Reported rather than swallowed: a caller that cannot see what was
      // skipped reads a partial rebuild as a complete one, which is what
      // `corpus db rebuild` prints and `POST /api/db/rebuild` returns.
      expect(report.skipped).toHaveLength(1);
      expect(report.skipped[0]?.path).toBe("data/docs/m.md");
      expect(report.skipped[0]?.reason).toMatch(UNREADABLE_REASON);
    });

    it("names it, with its reason, at the one level a `silent` server still writes", () => {
      seedWorkspace();

      populateFromFiles(db);

      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith("skipping unreadable document", {
        path: "data/docs/m.md",
        reason: expect.stringMatching(UNREADABLE_REASON) as string,
      });
      // The operator has to find this file by hand, so the line is the whole
      // remedy — and it must not be gated behind `debug` to be seen.
      expect(logger.debug).not.toHaveBeenCalled();
    });

    it("logs a merely malformed document at `debug` instead — expected residue, not a workspace fault", () => {
      write("data/docs/broken.md", `---\nid: doc_x\ntitle: [unclosed\n---\n\nBody.\n`);

      populateFromFiles(db);

      expect(logger.debug).toHaveBeenCalledWith("skipping document", {
        path: "data/docs/broken.md",
        reason: expect.stringContaining("invalid YAML frontmatter") as string,
      });
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("moves nothing, quarantines nothing, writes nothing: boot is a read", () => {
      const unreadable = seedWorkspace();
      const before = statSync(unreadable);

      populateFromFiles(db);

      expect(readdirSync(join(config.workspaceRoot, "data", "docs")).sort()).toEqual([
        "a.md",
        "m.md",
        "z.md",
      ]);
      const after = statSync(unreadable);
      expect([after.size, after.mtimeMs]).toEqual([before.size, before.mtimeMs]);
      // Nor a row describing it as something it is not — no `documents` row, and
      // no `file_hashes` row claiming its bytes were seen.
      expect(
        db.prepare("SELECT COUNT(*) AS n FROM file_hashes WHERE path = ?").get("data/docs/m.md"),
      ).toEqual({ n: 0 });
    });

    it("leaves `projectDocument` itself throwing: the store stays honest, the reader decides", () => {
      const unreadable = seedWorkspace();

      // The write path projects inline before responding, and a save that cannot
      // read its own file back must fail loudly rather than answer 200 over a
      // row nobody derived. Only the boot reader turns that into a skip.
      expect(() => projectDocument(db, unreadable)).toThrow(UNREADABLE_REASON);
    });
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
