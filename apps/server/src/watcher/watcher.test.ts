// Real chokidar, real files, a real SQLite projection. The watcher's whole job
// is reacting to the filesystem, so a test that simulated its events would only
// prove the simulation.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryKey } from "@corpus/contract";
import { computeContext } from "../anchors/index.js";
import { createInvalidationBus, type InvalidationBus } from "../events/index.js";
import { disableAutoMaintenance } from "../git/index.js";
import { createLogger, silentLogger, type LogSink } from "../logger.js";
import {
  openProjection,
  populateFromFiles,
  projectDocument,
  type ProjectionDb,
} from "../projection/index.js";
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

  /**
   * SPEC.md §9.1's `last_actor`, and §4 decides it: a change that reached the
   * watcher came from outside the server, so nobody attributed it to the agent,
   * so it is a person's. §7's reflection reads this column, and it must not be
   * told that a hand-edited file is the agent's own output.
   */
  it("records an out-of-band change as the person's, whatever the row said before", async () => {
    write("data/docs/mortgage.md", doc("doc_mortgage", "Mortgage", "Rate is 6.1%."));
    await startWatching();
    db.prepare("UPDATE documents SET last_actor = 'agent' WHERE id = 'doc_mortgage'").run();

    write("data/docs/mortgage.md", doc("doc_mortgage", "Mortgage", "Rate is 6.4%."));

    await vi.waitFor(() => {
      expect(rows("SELECT last_actor FROM documents WHERE id = 'doc_mortgage'")).toEqual([
        { last_actor: "user" },
      ]);
    }, WAIT);
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
    // And no `["tree"]`: the document landed at the *root* of `data/docs/`,
    // which belongs to no folder node, so `GET /api/tree` is byte-identical
    // either side of it. The `structural` heuristic used to announce the key
    // here purely because a file had appeared (SERVER-020).
    expect(new Set(flat())).toEqual(
      new Set([
        JSON.stringify(["docs"]),
        JSON.stringify(["docs", "doc_real"]),
        JSON.stringify(["reflect"]),
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
    // The same table the queue service announces (`QUEUE_QUERY_KEYS`): the
    // `failed-job` needs reason reads `events.status`, so the document
    // collection ages with the queue (SERVER-028).
    expect(flat()).toContain(JSON.stringify(["docs"]));
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
    // A transition is exactly the case SERVER-028 was filed for: moving an
    // event into (or out of) `failed/` changes what `GET /api/docs?needs=me`
    // answers, so the frame must name the document collection even though no
    // document file was touched.
    expect(flat()).toContain(JSON.stringify(["docs"]));
  });

  it("removes an event row when its file is deleted", async () => {
    write(".corpus/queue/pending/evt_seed00000000.json", JSON.stringify(EVENT));
    await startWatching();

    unlinkSync(abs(".corpus/queue/pending/evt_seed00000000.json"));

    await vi.waitFor(() => {
      expect(rows("SELECT id FROM events")).toEqual([]);
    }, WAIT);
  });

  it("ignores a `.corpus/locks/` an upgraded workspace left behind (SERVER-099)", async () => {
    // SPEC.md §7 replaced the edit lock with a key, so the directory is neither
    // removed nor watched — it is inert. Proved by ordering rather than by a
    // sleep: the lease is written *first*, then a real queue event, so once the
    // event's key has arrived the lease's chance to announce anything is over.
    await startWatching();

    write(
      ".corpus/locks/doc_mortgage.json",
      JSON.stringify({
        docId: "doc_mortgage",
        holder: "user",
        acquired: `${new Date().toISOString().slice(0, 19)}Z`,
        ttl: 300,
      }),
    );
    write(
      ".corpus/queue/pending/evt_after0000000.json",
      JSON.stringify({
        id: "evt_after0000000",
        type: "comment.created",
        created: "2026-07-19T10:00:00Z",
        source: "cli",
        payload: {},
      }),
    );

    await waitForKey(["queue"]);
    expect(flat().filter((key) => key.includes("lock"))).toEqual([]);
    // And the table it used to project is gone from the schema entirely.
    expect(() => rows("SELECT * FROM locks")).toThrow(/no such table/);
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

  // `.corpus/seen.json` is a bare file directly under `.corpus/`, which no root
  // covers — the directory also holds `cache.db` and the config, which must not
  // be watched. SERVER-006 follows the single file, closing the sprint-004
  // evaluator's note that read state needed a restart to re-project.
  it("re-projects read state edited out of band, with no restart", async () => {
    write(".corpus/seen.json", JSON.stringify({ th_a1b2c3d4: "2026-07-19T10:05:00Z" }));
    await startWatching();

    write(
      ".corpus/seen.json",
      JSON.stringify({
        th_a1b2c3d4: "2026-07-19T10:05:00Z",
        th_e5f6h7j8: "2026-07-19T11:00:00Z",
      }),
    );

    await waitForKey(["docs"]);
    await vi.waitFor(() => {
      expect(rows("SELECT thread_id, last_seen_ts FROM seen ORDER BY thread_id")).toEqual([
        { thread_id: "th_a1b2c3d4", last_seen_ts: "2026-07-19T10:05:00Z" },
        { thread_id: "th_e5f6h7j8", last_seen_ts: "2026-07-19T11:00:00Z" },
      ]);
    }, WAIT);
  });

  // The condition a real server boots in, and the one a seeded fixture hides:
  // `.corpus/seen.json` does not exist yet, so chokidar can only notice it by
  // watching `.corpus` — a dot-prefixed directory the ignore predicate rejects
  // unless it is exempted. Without the exemption the first mark-seen is
  // invisible until a restart, which is exactly the gap this closes.
  it("notices read state appearing for the first time", async () => {
    await startWatching();
    expect(existsSync(abs(".corpus/seen.json"))).toBe(false);

    write(".corpus/seen.json", JSON.stringify({ th_a1b2c3d4: "2026-07-19T10:05:00Z" }));

    await waitForKey(["docs"]);
    await vi.waitFor(() => {
      expect(rows("SELECT thread_id FROM seen")).toEqual([{ thread_id: "th_a1b2c3d4" }]);
    }, WAIT);

    // …and keeps following it once it is there.
    write(
      ".corpus/seen.json",
      JSON.stringify({
        th_a1b2c3d4: "2026-07-19T10:05:00Z",
        th_e5f6h7j8: "2026-07-19T11:00:00Z",
      }),
    );
    await vi.waitFor(() => {
      expect(rows("SELECT thread_id FROM seen")).toHaveLength(2);
    }, WAIT);
  });

  it("empties the `seen` table when read state is deleted out of band", async () => {
    write(".corpus/seen.json", JSON.stringify({ th_a1b2c3d4: "2026-07-19T10:05:00Z" }));
    await startWatching();

    unlinkSync(abs(".corpus/seen.json"));

    await vi.waitFor(() => {
      expect(rows("SELECT thread_id FROM seen")).toEqual([]);
    }, WAIT);
  });
});

/**
 * SERVER-115: the out-of-band half of §7's roster.
 *
 * A lane row is computed at read time, so a change that never mentions an agent
 * still changes what `GET /api/agents` answers — and the watcher is the emitter
 * for every such change the server did not make itself. Three of the seven sites
 * this issue fixed live in this file: the queue-event case (which held a second,
 * silently diverging copy of `QUEUE_QUERY_KEYS`), the job case, and the document
 * path.
 *
 * Whole frames are asserted, never "a key was somewhere in the batch": the
 * defect survived because the existing assertions asked whether a key was
 * present rather than what the frame was.
 */
describe("the watcher — §7's roster", () => {
  const LANE = "th_resident1";
  /**
   * Deliberately carries **no `id:`**. An agent-def under `.claude/agents/` gets
   * a *synthetic* id derived from its path when the file declares none — which
   * is precisely what makes renaming one change its document id, and therefore
   * what a roster row's `resident.docId` resolves to.
   */
  const AGENT_DEF = "---\nname: researcher\ndescription: digs.\n---\nBody.\n";

  const designatedThread = (title: string): string =>
    [
      "---",
      `id: ${LANE}`,
      "type: thread",
      `title: ${title}`,
      "created: 2026-08-16T09:00:00Z",
      "updated: 2026-08-16T09:00:00Z",
      "status: open",
      "agent: none",
      "resident:",
      "  name: researcher",
      "  docId: doc_researcher",
      "---",
      "",
      "## user · 2026-08-16T09:00:00Z",
      "",
      "Let us review the claims.",
      "",
    ].join("\n");

  const event = (status: string): string =>
    JSON.stringify({
      id: "evt_lane0000000a",
      type: "comment.created",
      created: "2026-08-16T09:00:00Z",
      source: "cli",
      payload: { threadId: LANE },
      status,
      updated: "2026-08-16T09:00:00Z",
      lane: LANE,
    });

  /** Seeds a designated lane and its agent-def, before the watcher starts. */
  function seedLane(title = "Claims review"): void {
    write(".claude/agents/researcher.md", AGENT_DEF);
    write(`data/threads/${LANE}.md`, designatedThread(title));
  }

  it("names the roster when an event leaves in-progress out of band", async () => {
    seedLane();
    write(".corpus/queue/in-progress/evt_lane0000000a.json", event("in-progress"));
    mkdirSync(abs(".corpus/queue/processed"), { recursive: true });
    await startWatching();

    renameSync(
      abs(".corpus/queue/in-progress/evt_lane0000000a.json"),
      abs(".corpus/queue/processed/evt_lane0000000a.json"),
    );

    // The previous status is the projection's to remember: a move arrives as two
    // independent events and neither carries where the file came from, so
    // without that read this is indistinguishable from an arrival.
    await vi.waitFor(() => {
      expect(batches).toContainEqual([["queue"], ["jobs"], ["docs"], ["agents"], ["reflect"]]);
    }, WAIT);
  });

  /**
   * The watcher measures the roster signature rather than deciding per verb, so
   * this reverses on its own once `pending` is in that signature (SERVER-155) —
   * which is what makes the measured scheme worth having: an out-of-band file
   * drop is announced correctly without anybody remembering to add a key.
   *
   * A pending event is held by nobody, which is why this used to name no roster.
   * A lane's row now says how much is *waiting* on it as well as what it holds,
   * and since SPEC.md §7's rider removed the fallback, that count is what tells
   * the orchestrator to start a listener.
   */
  it("names it for an event dropped straight into pending/, because a count moved", async () => {
    seedLane();
    await startWatching();

    write(".corpus/queue/pending/evt_lane0000000a.json", event("pending"));

    await waitForKey(["queue"]);
    expect(batches).toContainEqual([["queue"], ["jobs"], ["docs"], ["agents"], ["reflect"]]);
  });

  it("names it for a log line appended to the job a lane is holding", async () => {
    seedLane();
    write(".corpus/queue/in-progress/evt_lane0000000a.json", event("in-progress"));
    await startWatching();

    write(".corpus/jobs/evt_lane0000000a.jsonl", '{"line":"reading the claims table","at":1}\n');

    await vi.waitFor(() => {
      expect(batches).toContainEqual([["jobs"], ["jobs", "evt_lane0000000a"], ["agents"]]);
    }, WAIT);
  });

  it("does not name it for a log line on a job nobody is holding", async () => {
    seedLane();
    write(".corpus/queue/processed/evt_lane0000000a.json", event("processed"));
    await startWatching();

    write(".corpus/jobs/evt_lane0000000a.jsonl", '{"line":"after the fact","at":1}\n');

    await vi.waitFor(() => {
      expect(batches).toContainEqual([["jobs"], ["jobs", "evt_lane0000000a"]]);
    }, WAIT);
    expect(flat()).not.toContain(JSON.stringify(["agents"]));
  });

  it("names it when a designated conversation is retitled on disk", async () => {
    seedLane("Claims review");
    await startWatching();

    write(`data/threads/${LANE}.md`, designatedThread("Claims review, out of band"));

    await vi.waitFor(() => {
      expect(batches).toContainEqual([
        ["docs"],
        ["docs", LANE],
        ["threads", LANE],
        ["agents"],
        ["reflect"],
      ]);
    }, WAIT);
  });

  /**
   * The eighth emitter, which the issue's table did not list and CONTRACT-055
   * suspected: `resident.docId` is re-resolved against `agent-def` documents on
   * every roster response, and an agent-def under `.claude/agents/` carries a
   * *synthetic* id derived from its path. So renaming the file gives the same
   * agent a different id, and a roster held from before the rename points at a
   * document the workspace no longer has.
   */
  it("names it when the resident's agent-def is renamed on disk", async () => {
    seedLane();
    await startWatching();
    const before = rows<{ resident: string }>(
      "SELECT resident_doc_id AS resident FROM threads WHERE id = ?",
      LANE,
    );
    const idOf = (path: string): unknown =>
      rows("SELECT id FROM documents WHERE path = ?", path)[0];
    const wasResolvedTo = idOf(".claude/agents/researcher.md");
    expect(wasResolvedTo).toBeDefined();

    renameSync(abs(".claude/agents/researcher.md"), abs(".claude/agents/researcher-senior.md"));

    await vi.waitFor(() => {
      expect(flat()).toContain(JSON.stringify(["agents"]));
    }, WAIT);
    // The id the name now resolves to is a different one, while the *stored*
    // designation is untouched — it is the resolution that moved, which is
    // exactly why no per-path heuristic could have caught this.
    expect(idOf(".claude/agents/researcher-senior.md")).not.toEqual(wasResolvedTo);
    expect(rows("SELECT resident_doc_id AS resident FROM threads WHERE id = ?", LANE)).toEqual(
      before,
    );
  });

  it("leaves an unrelated document's frame alone", async () => {
    seedLane();
    write("data/docs/note.md", doc("doc_note", "Note", "Nothing to do with a lane."));
    await startWatching();

    write("data/docs/note.md", doc("doc_note", "Note", "Still nothing to do with a lane."));

    await waitForKey(["docs", "doc_note"]);
    expect(batches).toContainEqual([["docs"], ["docs", "doc_note"], ["reflect"]]);
    expect(flat()).not.toContain(JSON.stringify(["agents"]));
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
    disableAutoMaintenance(git);
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
    disableAutoMaintenance(git);
    await startWatching("info");

    write("data/docs/fresh.md", anchored(BODY, EXACT).replace("doc_mortgage", "doc_fresh"));

    await waitForKey(["docs", "doc_fresh"]);
    expect(rows("SELECT doc_id FROM anchors")).toEqual([{ doc_id: "doc_fresh" }]);
    expect(logLines.join("\n")).not.toContain('"level":"error"');
  });
});

/**
 * A directory renamed to another case on a case-insensitive filesystem
 * (SERVER-136). chokidar keeps watching **both** spellings for the life of the
 * process, so every later write to a file under it arrives twice — once under
 * the name the directory used to have and once under the name it has.
 *
 * The server's own `POST /api/folders/rename` moves the rows itself, in the same
 * pass as the write; what this pins is that the watcher's later events do not
 * move them back.
 */
describe("the watcher — a folder renamed to another case", () => {
  it("keys later writes on the spelling the filesystem has, not the one it had", async () => {
    write("data/docs/Finance/deed.md", doc("doc_deed", "Deed", "the deed"));
    await startWatching();

    // The rename, and then the row correction the write path performs for it.
    renameSync(abs("data/docs/Finance"), abs("data/docs/.tmp-rename"));
    renameSync(abs("data/docs/.tmp-rename"), abs("data/docs/finance"));
    db.prepare("DELETE FROM documents WHERE id = 'doc_deed'").run();
    projectDocument(db, abs("data/docs/finance/deed.md"));
    await new Promise((resolve) => setTimeout(resolve, 400));
    batches.length = 0;

    write("data/docs/finance/deed.md", doc("doc_deed", "Deed", "the deed, revised"));

    await waitForKey(["docs", "doc_deed"]);
    // One row, at the path the file is really at. Before the correction the
    // stale spelling arrived as its own event and moved the row to a path
    // nothing is at, which `db doctor` reports as `orphan_row`.
    expect(rows("SELECT id, path FROM documents")).toEqual([
      { id: "doc_deed", path: "data/docs/finance/deed.md" },
    ]);
  });
});
