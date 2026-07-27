// The per-flush blocking bound (SERVER-022 finding 10, landed in SERVER-020).
//
// `flush()` is synchronous, and reconciling one anchored document runs
// `git show` through `execFileSync` (`git-head.ts`). Before the bound, a batch
// of N anchored files was N sequential blocking subprocess calls: measured on a
// real server, an out-of-band edit to 100 anchored documents held
// `GET /api/health` for 575 ms and to 25 documents for 179 ms — linear in N,
// which is to say unbounded, and a wedged `git` sitting at its 5 s timeout
// multiplied that by the batch size.
//
// **The seam these tests use is `readHead`, not a wedged git.** `git-head.ts`
// already takes its reader as `StartWatcherOptions.readHead`, so the expensive
// call can be made expensive *deliberately and deterministically* — a busy-wait
// of a known duration — instead of by arranging a real repository to hang, which
// would be slow, platform-dependent and untestable in CI.
//
// Two claims are under test, and the second matters more than the first:
//
// 1. one flush stops when its budget is spent, and
// 2. nothing it stopped short of is lost — every deferred path is still
//    reconciled and projected, by a later flush (SPEC.md §6's out-of-band
//    catch-all is not allowed to become best-effort).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryKey } from "@corpus/contract";
import { createInvalidationBus, type InvalidationBus } from "../events/index.js";
import { silentLogger } from "../logger.js";
import { openProjection, populateFromFiles, type ProjectionDb } from "../projection/index.js";
import type { ReadHeadVersion } from "./git-head.js";
import { createSelfWriteRegistry } from "./self-writes.js";
import { startWatcher, type WatcherHandle } from "./watcher.js";

const WAIT = { timeout: 20_000, interval: 25 } as const;

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/** How many anchored documents one batch carries. */
const BATCH_SIZE = 12;
/** How long the injected head reader blocks — the stand-in for `git show`. */
const READ_COST_MS = 25;
/** Two reads fit; the third is checked against an already-expired budget. */
const BUDGET_MS = 40;

let root: string;
let workspace: string;
let db: ProjectionDb;
let bus: InvalidationBus;
let watcher: WatcherHandle;
let frames: QueryKey[][];
let readPaths: string[];

/** Blocks the thread for `ms`, the way `execFileSync` does. */
function block(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    // Spinning is the point: a sleep would yield, and `execFileSync` does not.
  }
}

const slowReadHead: ReadHeadVersion = (_workspaceRoot, relativePath) => {
  readPaths.push(relativePath);
  block(READ_COST_MS);
  // `null` is an ordinary answer — an untracked file — and short-circuits
  // reconciliation, so these tests measure the *read*, not the anchor engine.
  return null;
};

const anchored = (id: string, body: string): string =>
  [
    "---",
    `id: ${id}`,
    "type: note",
    `title: ${id}`,
    "created: 2026-07-27T09:00:00Z",
    "updated: 2026-07-27T09:00:00Z",
    "anchors:",
    "  anc_0000000000000001:",
    "    exact: the quoted sentence",
    '    prefix: ""',
    '    suffix: ""',
    "---",
    "",
    body,
  ].join("\n");

const idAt = (index: number): string => `doc_bulk${String(index).padStart(3, "0")}`;

function write(relativePath: string, content: string): void {
  const abs = join(workspace, ...relativePath.split("/"));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

const seed = (body: string): void => {
  for (let index = 0; index < BATCH_SIZE; index += 1) {
    write(`data/docs/bulk/${idAt(index)}.md`, anchored(idAt(index), `${body} ${index}`));
  }
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s020-budget-"));
  workspace = join(root, "ws");
  mkdirSync(join(workspace, "data", "docs"), { recursive: true });
  mkdirSync(join(workspace, "data", "threads"), { recursive: true });
  db = openProjection({ workspaceRoot: workspace, corpusDir: join(workspace, ".corpus") });
  bus = createInvalidationBus();
  frames = [];
  readPaths = [];
  bus.subscribe((keys) => frames.push(keys.map((key) => [...key])));
});

afterEach(async () => {
  await watcher.close();
  db.close();
  rmSync(root, { recursive: true, force: true });
});

/**
 * Boots as the server does — repopulate, then watch — with the debounce set far
 * enough out that the automatic flush cannot fire while a batch is being
 * assembled. Every flush in these tests is either explicit or the *deferred
 * continuation*, which schedules itself for the next turn regardless.
 */
async function startWatching(): Promise<void> {
  populateFromFiles(db);
  watcher = startWatcher({
    db,
    bus,
    selfWrites: createSelfWriteRegistry(),
    logger: silentLogger,
    debounceMs: 5_000,
    maxBatchMs: 30_000,
    flushBudgetMs: BUDGET_MS,
    readHead: slowReadHead,
  });
  await watcher.ready;
  await new Promise((resolve) => setTimeout(resolve, 300));
  frames.length = 0;
  readPaths.length = 0;
}

const excerpts = (): string[] =>
  (
    db.prepare("SELECT body_excerpt FROM documents ORDER BY id").all() as { body_excerpt: string }[]
  ).map((row) => row.body_excerpt.trim());

describe("the watcher's per-flush blocking bound", () => {
  it("stops one flush at its budget and finishes the batch on later turns", async () => {
    seed("Original body");
    await startWatching();
    seed("Edited body");
    await vi.waitFor(() => {
      expect(watcher.pending).toBe(BATCH_SIZE);
    }, WAIT);

    const startedAt = Date.now();
    watcher.flush();
    const elapsed = Date.now() - startedAt;

    // The bound, stated: the budget plus the one entry that was already in
    // flight when it expired. Without it this call would have made 12 reads and
    // blocked for ~300 ms; the pre-fix code had no term that did not grow with
    // the batch.
    expect(elapsed).toBeLessThan(BUDGET_MS + READ_COST_MS * 2);
    expect(readPaths.length).toBeLessThanOrEqual(Math.ceil(BUDGET_MS / READ_COST_MS) + 1);
    // Progress is guaranteed — a bound that can process nothing is a livelock.
    expect(readPaths.length).toBeGreaterThanOrEqual(1);
    expect(watcher.pending).toBeGreaterThan(0);

    // …and the remainder is not dropped: it is reconciled and projected by the
    // continuations the deferral scheduled.
    await vi.waitFor(() => {
      expect(watcher.pending).toBe(0);
      expect(excerpts()).toHaveLength(BATCH_SIZE);
    }, WAIT);
    expect(excerpts().every((text) => text.startsWith("Edited body"))).toBe(true);
    // Every document was read, and deferral re-queues work rather than
    // repeating it: an implementation that put the *whole* batch back on every
    // overrun would read far more than one round. (The count is not pinned to
    // exactly `BATCH_SIZE` because chokidar occasionally delivers a second
    // `change` for the same save — that is the filesystem, not the bound.)
    expect(new Set(readPaths).size).toBe(BATCH_SIZE);
    expect(readPaths.length).toBeLessThan(BATCH_SIZE * 2);
  });

  it("keeps every frame's keys correct across the split", async () => {
    seed("Original body");
    await startWatching();
    seed("Edited body");
    await vi.waitFor(() => {
      expect(watcher.pending).toBe(BATCH_SIZE);
    }, WAIT);

    watcher.flush();
    await vi.waitFor(() => {
      expect(watcher.pending).toBe(0);
      expect(new Set(readPaths).size).toBe(BATCH_SIZE);
    }, WAIT);
    // A little longer, so a stray extra frame would be caught rather than raced.
    await new Promise((resolve) => setTimeout(resolve, 200));

    // The split produced several frames — that is what the bound does — and
    // between them they name every document exactly as one frame would have.
    expect(frames.length).toBeGreaterThan(1);
    const named = new Set(frames.flat().map((key) => JSON.stringify(key)));
    for (let index = 0; index < BATCH_SIZE; index += 1) {
      expect(named).toContain(JSON.stringify(["docs", idAt(index)]));
    }
    // No `["tree"]`: these are body edits, and the folder tree is measured per
    // flush, so a split batch cannot invent a structural change either.
    expect(named).not.toContain(JSON.stringify(["tree"]));
    for (const frame of frames) expect(frame.length).toBeGreaterThan(0);
  });

  it("drains a batch in one flush when the budget is not reached", async () => {
    seed("Original body");
    await startWatching();
    write(`data/docs/bulk/${idAt(0)}.md`, anchored(idAt(0), "Edited body 0"));
    await vi.waitFor(() => {
      expect(watcher.pending).toBe(1);
    }, WAIT);

    watcher.flush();

    // One entry always runs, budget or no budget, and nothing is left over.
    expect(watcher.pending).toBe(0);
    expect(readPaths).toEqual([`data/docs/bulk/${idAt(0)}.md`]);
    expect(frames).toHaveLength(1);
  });

  it("lets a newer event for a deferred path win over the one being put back", async () => {
    seed("Original body");
    await startWatching();
    seed("Edited body");
    await vi.waitFor(() => {
      expect(watcher.pending).toBe(BATCH_SIZE);
    }, WAIT);

    watcher.flush();
    const processed = readPaths.length;
    // Delete a document the flush deferred. The unlink lands in `pending`
    // ahead of the deferred `change` for the same path, and must survive it:
    // re-projecting a file that is gone would resurrect a deleted row.
    const doomed = idAt(BATCH_SIZE - 1);
    rmSync(join(workspace, "data", "docs", "bulk", `${doomed}.md`));

    await vi.waitFor(() => {
      expect(watcher.pending).toBe(0);
      expect(readPaths.length).toBeGreaterThan(processed);
      expect(db.prepare("SELECT id FROM documents WHERE id = ?").get(doomed)).toBeUndefined();
    }, WAIT);
    expect(excerpts()).toHaveLength(BATCH_SIZE - 1);
  });
});
