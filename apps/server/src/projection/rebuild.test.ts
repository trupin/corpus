import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cacheDbPath, openProjection, type ProjectionConfig } from "./db.js";
import { projectDocument } from "./project-document.js";
import { REBUILD_PREFIX, rebuild } from "./rebuild.js";
import { META_REBUILT_AT, PROJECTION_TABLES } from "./schema.js";

let root: string;
let config: ProjectionConfig;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s004-rebuild-"));
  const ws = join(root, "ws");
  mkdirSync(join(ws, "data", "docs"), { recursive: true });
  config = { workspaceRoot: ws, corpusDir: join(ws, ".corpus") };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(relative: string, content: string): string {
  const abs = join(config.workspaceRoot, relative);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
  return abs;
}

const doc = (id: string, body = "Body.\n"): string =>
  `---\nid: ${id}\ntype: note\ntitle: ${id}\ncreated: 2026-01-01T00:00:00Z\nupdated: 2026-01-01T00:00:00Z\n---\n\n${body}`;

/** Every table's rows in a deterministic order — the logical content of a database. */
function dump(path: string): Record<string, unknown[]> {
  const sqlite = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const result: Record<string, unknown[]> = {};
    for (const table of PROJECTION_TABLES) {
      const columns = (
        sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
      ).map((row) => row.name);
      const order = columns.map((name) => `"${name}"`).join(", ");
      result[table] = sqlite.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all();
    }
    // `rebuilt_at` is the one value that is *supposed* to differ between runs.
    result.meta = (result.meta ?? []).filter(
      (row) => (row as { key: string }).key !== META_REBUILT_AT,
    );
    return result;
  } finally {
    sqlite.close();
  }
}

function populateWorkspace(): void {
  write("data/docs/a.md", doc("doc_aaa", "See [[th_ttt]] and [[doc_bbb]].\n"));
  write("data/docs/nested/b.md", doc("doc_bbb"));
  write(
    "data/docs/anchored.md",
    `---\nid: doc_anc\ntype: note\ntitle: Anchored\nanchors:\n  anc_live:\n    exact: "quoted here"\n  anc_gone:\n    exact: "vanished long ago"\n  anc_look:\n    exact: "- bread from the corner bakery"\n---\n\nSome quoted here text.\n\n- milk from the corner bakery\n`,
  );
  write("data/docs/broken.md", `---\nid: doc_x\ntitle: [unclosed\n---\n\nBody.\n`);
  write(
    ".claude/skills/orchestrate/SKILL.md",
    `---\nname: orchestrate\ndescription: Loop.\n---\n\nS.\n`,
  );
  write(".claude/agents/researcher.md", `---\nid: doc_res\ntype: agent-def\ntitle: R\n---\n\nP.\n`);
  write(
    "data/threads/th_ttt.md",
    `---\nid: th_ttt\ntype: thread\ntitle: T\nparent: doc_aaa\n---\n\n## user · 2026-07-03T09:00:00Z\n\nSee [[doc_bbb]].\n\n## agent · 2026-07-04T09:00:00Z\n\nOk.\n\n## user · 2026-07-05T09:00:00Z\n\nThanks.\n`,
  );
  mkdirSync(join(config.corpusDir, "queue", "pending"), { recursive: true });
  for (const id of ["evt_aaa111222333", "evt_bbb444555666"]) {
    writeFileSync(
      join(config.corpusDir, "queue", "pending", `${id}.json`),
      JSON.stringify({
        id,
        type: "comment.created",
        created: "2026-07-06T09:00:00Z",
        source: "cli",
        payload: {},
      }),
      "utf8",
    );
  }
  writeFileSync(join(config.corpusDir, "queue", "pending", ".gitkeep"), "", "utf8");
}

describe("rebuild", () => {
  it("reports what it did", () => {
    populateWorkspace();
    const report = rebuild(config);

    expect(report).toMatchObject({
      documents: 6,
      threads: 1,
      turns: 3,
      anchors: 3,
      events: 2,
      path: cacheDbPath(config),
    });
    expect(report.links).toBe(3);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(report.skipped.map((entry) => entry.path)).toEqual(["data/docs/broken.md"]);
    expect(report.skipped[0]?.reason).toMatch(/invalid YAML frontmatter/);

    const dumped = dump(report.path);
    expect(dumped.documents).toHaveLength(report.documents);
    expect(dumped.turns).toHaveLength(report.turns);
    expect(dumped.anchors).toHaveLength(report.anchors);
    expect(dumped.links).toHaveLength(report.links);
    expect(dumped.events).toHaveLength(report.events);
  });

  it("is idempotent — two rebuilds produce identical content", () => {
    populateWorkspace();
    const first = rebuild(config, { into: join(root, "a.db") });
    const second = rebuild(config, { into: join(root, "b.db") });

    expect(first.path).toBe(join(root, "a.db"));
    expect(second.path).toBe(join(root, "b.db"));
    expect(dump(first.path)).toEqual(dump(second.path));
  });

  it("agrees with incremental projection, byte for byte", () => {
    populateWorkspace();

    // Incremental: open an empty projection and project each file by hand, in
    // an order a watcher might have produced rather than the rebuild's.
    const db = openProjection(config, { populate: false });
    const paths = [
      "data/threads/th_ttt.md",
      "data/docs/anchored.md",
      ".claude/agents/researcher.md",
      "data/docs/a.md",
      ".claude/skills/orchestrate/SKILL.md",
      "data/docs/nested/b.md",
      "data/docs/broken.md",
    ];
    for (const relative of paths) projectDocument(db, join(config.workspaceRoot, relative));
    db.close();

    const rebuilt = rebuild(config, { into: join(root, "fresh.db") });
    const incremental = dump(cacheDbPath(config));
    const fromFiles = dump(rebuilt.path);

    const anchorsOf = (rows: unknown[]): unknown[] =>
      rows.map((row) => {
        const anchor = row as Record<string, unknown>;
        return [anchor.doc_id, anchor.anchor_id, anchor.exact_text, anchor.resolved_offset];
      });
    expect(anchorsOf(incremental.anchors ?? [])).toEqual(anchorsOf(fromFiles.anchors ?? []));
    expect(incremental.documents).toEqual(fromFiles.documents);
    expect(incremental.threads).toEqual(fromFiles.threads);
    expect(incremental.turns).toEqual(fromFiles.turns);
    expect(incremental.links).toEqual(fromFiles.links);
  });

  it("replaces cache.db atomically and leaves no temp file behind", () => {
    populateWorkspace();
    openProjection(config).close();
    const before = dump(cacheDbPath(config));

    write("data/docs/c.md", doc("doc_ccc"));
    rebuild(config);

    // Asserted before anything reopens the database: the previous database's
    // WAL must not survive the rename, or SQLite would try to recover it into a
    // file it does not describe.
    expect(existsSync(`${cacheDbPath(config)}-wal`)).toBe(false);
    expect(existsSync(`${cacheDbPath(config)}-shm`)).toBe(false);
    expect(readdirSync(config.corpusDir).filter((name) => name.startsWith(REBUILD_PREFIX))).toEqual(
      [],
    );
    expect(dump(cacheDbPath(config)).documents).toHaveLength((before.documents ?? []).length + 1);
  });

  it("leaves the previous database intact when a rebuild never reaches its rename", () => {
    populateWorkspace();
    rebuild(config);
    const good = dump(cacheDbPath(config));

    // What an interrupted rebuild leaves on disk: a temp file, no rename.
    const leftover = join(config.corpusDir, `${REBUILD_PREFIX}999999`);
    writeFileSync(leftover, "half written", "utf8");
    expect(dump(cacheDbPath(config))).toEqual(good);

    rebuild(config);
    expect(existsSync(leftover)).toBe(false);
    expect(dump(cacheDbPath(config))).toEqual(good);
  });

  it("stamps meta.rebuilt_at", () => {
    const report = rebuild(config);
    const sqlite = new Database(report.path, { readonly: true });
    try {
      const row = sqlite.prepare("SELECT value FROM meta WHERE key = ?").get(META_REBUILT_AT) as {
        value: string;
      };
      expect(Number.isNaN(Date.parse(row.value))).toBe(false);
    } finally {
      sqlite.close();
    }
  });

  it("builds an empty but valid database for an empty workspace", () => {
    const report = rebuild(config);
    expect(report).toMatchObject({ documents: 0, threads: 0, turns: 0, events: 0, skipped: [] });
    const dumped = dump(report.path);
    for (const table of PROJECTION_TABLES) expect(dumped).toHaveProperty(table);
  });
});
