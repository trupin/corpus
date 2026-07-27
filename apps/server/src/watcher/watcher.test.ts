// Real chokidar, real files, a real SQLite projection. The watcher's whole job
// is reacting to the filesystem, so a test that simulated its events would only
// prove the simulation.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryKey } from "@corpus/contract";
import { computeContext } from "../anchors/index.js";
import { createInvalidationBus, type InvalidationBus } from "../events/index.js";
import { createLogger, silentLogger, type LogSink } from "../logger.js";
import { openProjection, populateFromFiles, type ProjectionDb } from "../projection/index.js";
import type { ReadHeadVersion } from "./git-head.js";
import { createSelfWriteRegistry, type SelfWriteRegistry } from "./self-writes.js";
import { startWatcher, type WatcherHandle } from "./watcher.js";

const WAIT = { timeout: 8000, interval: 25 } as const;

// Every assertion here waits on a real filesystem event travelling through
// chokidar's `awaitWriteFinish` window and the watcher's debounce, which is
// comfortably slower than vitest's default 5 s budget.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let root: string;
let workspace: string;
let db: ProjectionDb;
let bus: InvalidationBus;
let selfWrites: SelfWriteRegistry;
let watcher: WatcherHandle;
let batches: QueryKey[][];
let logLines: string[];

/**
 * Boots as the real server does: repopulate the projection from whatever the
 * test seeded on disk, *then* start watching. Skipping the repopulation would
 * make every "an existing document changed" case secretly a "a document
 * appeared" case.
 */
async function startWatching(
  logLevel: "silent" | "info" = "silent",
  readHead?: ReadHeadVersion,
): Promise<void> {
  populateFromFiles(db);
  const sink: LogSink = { write: (line) => logLines.push(line) };
  watcher = startWatcher({
    db,
    bus,
    selfWrites,
    logger: logLevel === "silent" ? silentLogger : createLogger(logLevel, sink),
    debounceMs: 25,
    maxBatchMs: 150,
    ...(readHead === undefined ? {} : { readHead }),
  });
  await watcher.ready;
  // chokidar's `ready` says the initial scan finished, not that every
  // per-directory OS watch is armed; a write in the next few milliseconds can
  // still be missed. Irrelevant to a server that runs for hours, fatal to a
  // test that writes immediately.
  await new Promise((resolve) => setTimeout(resolve, 300));
  batches.length = 0;
  logLines.length = 0;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s007-watch-"));
  workspace = join(root, "ws");
  mkdirSync(join(workspace, "data", "docs"), { recursive: true });
  mkdirSync(join(workspace, "data", "threads"), { recursive: true });
  db = openProjection({ workspaceRoot: workspace, corpusDir: join(workspace, ".corpus") });
  bus = createInvalidationBus();
  selfWrites = createSelfWriteRegistry();
  batches = [];
  logLines = [];
  bus.subscribe((keys) => batches.push([...keys]));
});

afterEach(async () => {
  await watcher.close();
  db.close();
  rmSync(root, { recursive: true, force: true });
});

const abs = (relativePath: string): string => join(workspace, ...relativePath.split("/"));

function write(relativePath: string, content: string): string {
  const path = abs(relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  return path;
}

const doc = (id: string, title: string, body: string): string =>
  `---\nid: ${id}\ntype: note\ntitle: ${title}\n---\n\n${body}\n`;

const flat = (): string[] => batches.flat().map((key) => JSON.stringify(key));

/** Waits for an invalidation naming `key`. */
async function waitForKey(key: QueryKey): Promise<void> {
  await vi.waitFor(() => {
    expect(flat()).toContain(JSON.stringify(key));
  }, WAIT);
}

const rows = <T>(sql: string, ...params: unknown[]): T[] => db.prepare(sql).all(...params) as T[];

describe("the watcher — documents", () => {
  it("projects a document created out of band and names it", async () => {
    await startWatching();

    write("data/docs/finance/mortgage.md", doc("doc_mortgage", "Mortgage", "Rate is 6.1%."));

    await waitForKey(["docs", "doc_mortgage"]);
    expect(rows("SELECT id, path FROM documents")).toEqual([
      { id: "doc_mortgage", path: "data/docs/finance/mortgage.md" },
    ]);
    // A file appearing changes the folder tree; a body edit below does not.
    expect(flat()).toContain(JSON.stringify(["tree"]));
  });

  it("upserts an edit instead of failing against a missing row", async () => {
    write("data/docs/mortgage.md", doc("doc_mortgage", "Mortgage", "Rate is 6.1%."));
    await startWatching();
    write("data/docs/mortgage.md", doc("doc_mortgage", "Mortgage", "Rate is 6.4%."));

    await vi.waitFor(() => {
      expect(
        rows<{ body_excerpt: string }>("SELECT body_excerpt FROM documents").map((row) =>
          row.body_excerpt.trim(),
        ),
      ).toEqual(["Rate is 6.4%."]);
    }, WAIT);
    expect(rows("SELECT id FROM documents")).toHaveLength(1);
    expect(flat()).not.toContain(JSON.stringify(["tree"]));
  });

  it("deletes a document's rows on unlink and leaves its threads as orphaned records", async () => {
    write("data/docs/mortgage.md", doc("doc_mortgage", "Mortgage", "Rate is 6.1%."));
    write(
      "data/threads/th_aaa111.md",
      `---\nid: th_aaa111\ntype: thread\ntitle: Q\nparent: doc_mortgage\n---\n\n### user — 2026-07-19T10:00:00Z\n\nWhy?\n`,
    );
    await startWatching();

    unlinkSync(abs("data/docs/mortgage.md"));

    await waitForKey(["docs", "doc_mortgage"]);
    await vi.waitFor(() => {
      expect(rows("SELECT id FROM documents WHERE id = 'doc_mortgage'")).toEqual([]);
    }, WAIT);
    expect(rows("SELECT anchors.doc_id FROM anchors WHERE doc_id = 'doc_mortgage'")).toEqual([]);
    // §9.2: the thread survives with its `parent` intact.
    expect(rows("SELECT id, parent_id FROM threads")).toEqual([
      { id: "th_aaa111", parent_id: "doc_mortgage" },
    ]);
  });

  it("keeps ids stable across a directory rename", async () => {
    for (const name of ["a", "b", "c"]) {
      write(`data/docs/finance/${name}.md`, doc(`doc_${name}`, name.toUpperCase(), `Body ${name}`));
    }
    await startWatching();

    renameSync(abs("data/docs/finance"), abs("data/docs/money"));

    await vi.waitFor(() => {
      expect(
        rows<{ id: string; path: string }>("SELECT id, path FROM documents ORDER BY id"),
      ).toEqual([
        { id: "doc_a", path: "data/docs/money/a.md" },
        { id: "doc_b", path: "data/docs/money/b.md" },
        { id: "doc_c", path: "data/docs/money/c.md" },
      ]);
    }, WAIT);
  });

  it("names a thread's own key when a thread document changes", async () => {
    write(
      "data/threads/th_aaa111.md",
      `---\nid: th_aaa111\ntype: thread\ntitle: Q\nparent: null\n---\n\n### user — 2026-07-19T10:00:00Z\n\nWhy?\n`,
    );
    await startWatching();
    write(
      "data/threads/th_aaa111.md",
      `---\nid: th_aaa111\ntype: thread\ntitle: Q\nparent: null\n---\n\n### user — 2026-07-19T10:00:00Z\n\nWhy not?\n`,
    );

    await waitForKey(["threads", "th_aaa111"]);
    expect(flat()).toContain(JSON.stringify(["docs", "th_aaa111"]));
  });

  it("reports a document it cannot project without crashing, and recovers on the next save", async () => {
    await startWatching("info");

    write("data/docs/broken.md", "no frontmatter at all\n");
    await vi.waitFor(() => {
      expect(logLines.join("\n")).toContain("watcher skipped a document");
    }, WAIT);
    expect(rows("SELECT id FROM documents")).toEqual([]);

    write("data/docs/broken.md", doc("doc_fixed", "Fixed", "Now valid."));
    await waitForKey(["docs", "doc_fixed"]);
  });

  it("projects the file as written when reconciliation itself fails", async () => {
    await startWatching("info", () => {
      throw new Error("git is unavailable");
    });

    // Anchored, so reconciliation actually reaches for the committed version.
    write(
      "data/docs/mortgage.md",
      [
        "---",
        "id: doc_mortgage",
        "type: note",
        "title: Mortgage",
        "anchors:",
        "  anc_k4f7:",
        '    exact: "6.1%"',
        "---",
        "",
        "Rate is 6.1%.",
        "",
      ].join("\n"),
    );

    // A repair that cannot run must not also cost the document its rows.
    await waitForKey(["docs", "doc_mortgage"]);
    expect(rows("SELECT id FROM documents")).toEqual([{ id: "doc_mortgage" }]);
    expect(logLines.join("\n")).toContain("anchor reconciliation failed");
  });

  it("re-homes a document whose rename halves arrived separately", async () => {
    write("data/docs/old.md", doc("doc_moved", "Moved", "Body."));
    await startWatching();

    // The unlink is suppressed, so the add lands while the projection still
    // holds a row for a path that no longer exists — the shape a rename takes
    // when its halves fall into different batches.
    selfWrites.record(abs("data/docs/old.md"), null);
    unlinkSync(abs("data/docs/old.md"));
    write("data/docs/new.md", doc("doc_moved", "Moved", "Body."));

    await waitForKey(["docs", "doc_moved"]);
    await vi.waitFor(() => {
      expect(rows("SELECT id, path FROM documents")).toEqual([
        { id: "doc_moved", path: "data/docs/new.md" },
      ]);
    }, WAIT);
  });
});

describe("the watcher — lifecycle", () => {
  it("flushes on demand and drops pending work when closed", async () => {
    await startWatching();

    // Nothing pending: flushing is a no-op, not an empty broadcast.
    watcher.flush();
    expect(batches).toEqual([]);

    write("data/docs/a.md", doc("doc_a", "A", "Body."));
    await vi.waitFor(() => expect(watcher.pending).toBeGreaterThan(0), WAIT);
    watcher.flush();
    expect(watcher.pending).toBe(0);
    expect(batches.flat().map((key) => JSON.stringify(key))).toContain(
      JSON.stringify(["docs", "doc_a"]),
    );

    await watcher.close();
    const settled = batches.length;
    write("data/docs/b.md", doc("doc_b", "B", "Body."));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(batches.length).toBe(settled);
  });
});

describe("the watcher — ignores", () => {
  it("says nothing about editor debris and non-corpus files", async () => {
    await startWatching();

    write("data/docs/.mortgage.md.swp", "swap");
    write("data/docs/#mortgage.md#", "autosave");
    write("data/docs/mortgage.md~", "backup");
    write("data/docs/.DS_Store", "finder");
    write("data/docs/notes.txt", "not a document");
    write(".corpus/queue/pending/.gitkeep", "");

    // An atomic-rename save of a real document, so the ignore list is not
    // proved by over-ignoring: this one *must* land.
    write("data/docs/.tmp-atomic.md", doc("doc_real", "Real", "Saved atomically."));
    renameSync(abs("data/docs/.tmp-atomic.md"), abs("data/docs/mortgage.md"));

    await waitForKey(["docs", "doc_real"]);
    expect(rows("SELECT id FROM documents")).toEqual([{ id: "doc_real" }]);
    // Only the real save produced keys — nothing named a swap file or a .txt.
    expect(new Set(flat())).toEqual(
      new Set([
        JSON.stringify(["docs"]),
        JSON.stringify(["docs", "doc_real"]),
        JSON.stringify(["tree"]),
      ]),
    );
  });
});

describe("the watcher — batching", () => {
  it("coalesces a burst of writes into a handful of invalidations", async () => {
    await startWatching();

    for (let index = 0; index < 40; index += 1) {
      const id = `doc_burst${String(index).padStart(3, "0")}`;
      write(`data/docs/burst/${id}.md`, doc(id, `Burst ${index}`, `Body ${index}`));
    }

    await vi.waitFor(() => {
      expect(rows<{ n: number }>("SELECT COUNT(*) AS n FROM documents")[0]?.n).toBe(40);
    }, WAIT);
    // One coalesced batch plus stragglers from the debounce window — never 40.
    expect(batches.length).toBeLessThanOrEqual(10);
    const named = new Set(flat());
    for (let index = 0; index < 40; index += 1) {
      expect(named).toContain(
        JSON.stringify(["docs", `doc_burst${String(index).padStart(3, "0")}`]),
      );
    }
  });
});

describe("the watcher — runtime roots", () => {
  const EVENT = {
    id: "evt_seed00000000",
    type: "comment.created",
    created: "2026-07-19T10:05:00Z",
    source: "cli",
    payload: {},
  };

  it("projects an evt_*.json dropped into pending/ without a restart", async () => {
    await startWatching();

    write(".corpus/queue/pending/evt_seed00000000.json", JSON.stringify(EVENT));

    await waitForKey(["queue"]);
    expect(rows("SELECT id, status FROM events")).toEqual([
      { id: "evt_seed00000000", status: "pending" },
    ]);
    expect(flat()).toContain(JSON.stringify(["jobs"]));
  });

  it("follows an event moved between status directories out of band", async () => {
    write(".corpus/queue/pending/evt_seed00000000.json", JSON.stringify(EVENT));
    mkdirSync(abs(".corpus/queue/processed"), { recursive: true });
    await startWatching();

    renameSync(
      abs(".corpus/queue/pending/evt_seed00000000.json"),
      abs(".corpus/queue/processed/evt_seed00000000.json"),
    );

    await vi.waitFor(() => {
      expect(rows("SELECT id, status FROM events")).toEqual([
        { id: "evt_seed00000000", status: "processed" },
      ]);
    }, WAIT);
  });

  it("removes an event row when its file is deleted", async () => {
    write(".corpus/queue/pending/evt_seed00000000.json", JSON.stringify(EVENT));
    await startWatching();

    unlinkSync(abs(".corpus/queue/pending/evt_seed00000000.json"));

    await vi.waitFor(() => {
      expect(rows("SELECT id FROM events")).toEqual([]);
    }, WAIT);
  });

  it("projects a lock appearing and disappearing", async () => {
    await startWatching();

    write(
      ".corpus/locks/doc_mortgage.json",
      JSON.stringify({
        docId: "doc_mortgage",
        holder: "user",
        acquired: "2026-07-19T10:05:00Z",
        ttl: 300,
      }),
    );

    await waitForKey(["locks", "doc_mortgage"]);
    expect(rows("SELECT doc_id, holder FROM locks")).toEqual([
      { doc_id: "doc_mortgage", holder: "user" },
    ]);

    unlinkSync(abs(".corpus/locks/doc_mortgage.json"));
    await vi.waitFor(() => {
      expect(rows("SELECT doc_id FROM locks")).toEqual([]);
    }, WAIT);
  });

  it("summarizes a job log as it grows", async () => {
    await startWatching();

    write(
      ".corpus/jobs/evt_seed00000000.jsonl",
      `${JSON.stringify({ ts: "2026-07-19T10:05:00Z", line: "started" })}\n`,
    );

    await waitForKey(["jobs", "evt_seed00000000"]);
    await vi.waitFor(() => {
      expect(rows("SELECT event_id, last_line FROM jobs")).toEqual([
        { event_id: "evt_seed00000000", last_line: "started" },
      ]);
    }, WAIT);
  });
});

describe("the watcher — self-write suppression", () => {
  it("says nothing about a write the server registered", async () => {
    await startWatching();
    const content = doc("doc_ours", "Ours", "Written by the server.");

    selfWrites.record(abs("data/docs/ours.md"), content);
    write("data/docs/ours.md", content);

    // A sentinel the watcher *must* report proves it was alive the whole time.
    write("data/docs/sentinel.md", doc("doc_sentinel", "Sentinel", "External."));
    await waitForKey(["docs", "doc_sentinel"]);

    expect(flat()).not.toContain(JSON.stringify(["docs", "doc_ours"]));
    expect(rows("SELECT id FROM documents WHERE id = 'doc_ours'")).toEqual([]);
  });

  it("processes an external write of different bytes to the same path", async () => {
    await startWatching();

    selfWrites.record(abs("data/docs/contested.md"), doc("doc_ours", "Ours", "Server bytes."));
    write("data/docs/contested.md", doc("doc_theirs", "Theirs", "Editor bytes."));

    await waitForKey(["docs", "doc_theirs"]);
    expect(
      rows<{ id: string; body_excerpt: string }>("SELECT id, body_excerpt FROM documents").map(
        (row) => [row.id, row.body_excerpt.trim()],
      ),
    ).toEqual([["doc_theirs", "Editor bytes."]]);
  });
});

describe("the watcher — out-of-band anchor reconciliation", () => {
  const EXACT = "assume a 30-year fixed at 6.1%";
  const BODY = "\n# Mortgage\n\nThe model we assume a 30-year fixed at 6.1% which may be stale.\n";

  function anchored(body: string, exact: string): string {
    const start = body.indexOf(exact);
    const { prefix, suffix } = computeContext(body, start, start + exact.length);
    return [
      "---",
      "id: doc_mortgage",
      "type: note",
      "title: Mortgage",
      "anchors:",
      "  anc_k4f7:",
      `    exact: ${JSON.stringify(exact)}`,
      `    prefix: ${JSON.stringify(prefix)}`,
      `    suffix: ${JSON.stringify(suffix)}`,
      "---",
      body,
    ].join("\n");
  }

  function git(...args: string[]): void {
    execFileSync("git", args, { cwd: workspace, stdio: ["ignore", "ignore", "ignore"] });
  }

  it("remaps the selector on disk, then projects the reconciled file — once", async () => {
    write("data/docs/mortgage.md", anchored(BODY, EXACT));
    git("init", "-q");
    git("add", "-A");
    git(
      "-c",
      "user.email=test@corpus.local",
      "-c",
      "user.name=Corpus Test",
      "commit",
      "-q",
      "-m",
      "seed",
    );
    await startWatching();

    write("data/docs/mortgage.md", anchored(BODY, EXACT).replace("6.1% which", "6.4% which"));

    await vi.waitFor(() => {
      const anchors = rows<{ exact_text: string; resolved_offset: number | null }>(
        "SELECT exact_text, resolved_offset FROM anchors",
      );
      expect(anchors.map((anchor) => anchor.exact_text)).toEqual([
        "assume a 30-year fixed at 6.4%",
      ]);
      // Non-NULL: the remapped selector resolves in the edited body, so the
      // thread is attached rather than orphaned (§9.1).
      expect(anchors[0]?.resolved_offset).toBeTypeOf("number");
    }, WAIT);

    // The write-back must not send the watcher round again: it is registered as
    // a self-write, so the file reaches a fixed point.
    const settled = batches.length;
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(batches.length).toBe(settled);
    expect(settled).toBeLessThanOrEqual(3);
  });

  it("projects a brand-new anchored document with no committed version, without throwing", async () => {
    write("data/docs/seed.md", doc("doc_seed", "Seed", "Seeded."));
    git("init", "-q");
    await startWatching("info");

    write("data/docs/fresh.md", anchored(BODY, EXACT).replace("doc_mortgage", "doc_fresh"));

    await waitForKey(["docs", "doc_fresh"]);
    expect(rows("SELECT doc_id FROM anchors")).toEqual([{ doc_id: "doc_fresh" }]);
    expect(logLines.join("\n")).not.toContain('"level":"error"');
  });
});
