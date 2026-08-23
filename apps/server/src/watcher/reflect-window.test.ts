// SPEC.md §7's quiet window, on the out-of-band path (SERVER-137).
//
// An external editor's save does not go through `finishMutation`, so it needs
// its own line to the scheduler — and it is always a person's write (§4 authors
// an out-of-band commit `user`, §9.1 reads an unattributed change as a
// person's). Real chokidar and a real projection, for `watcher.test.ts`'s
// reason: a simulated event would prove only the simulation.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInvalidationBus, type InvalidationBus } from "../events/index.js";
import { silentLogger } from "../logger.js";
import { openProjection, populateFromFiles, type ProjectionDb } from "../projection/index.js";
import { createSelfWriteRegistry, type SelfWriteRegistry } from "./self-writes.js";
import { startWatcher, type WatcherHandle } from "./watcher.js";

const WAIT = { timeout: 8000, interval: 25 } as const;

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let root: string;
let workspace: string;
let db: ProjectionDb;
let bus: InvalidationBus;
let selfWrites: SelfWriteRegistry;
let watcher: WatcherHandle | undefined;
let observed: number;

const doc = (id: string, title: string): string =>
  `---\nid: ${id}\ntype: note\ntitle: ${title}\nstatus: open\ntags: []\n---\n\nA body.\n`;

const write = (relativePath: string, content: string): void => {
  const abs = join(workspace, relativePath);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content, "utf8");
};

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "corpus-s137-watch-"));
  workspace = join(root, "ws");
  mkdirSync(join(workspace, "data", "docs"), { recursive: true });
  mkdirSync(join(workspace, "data", "threads"), { recursive: true });
  db = openProjection({ workspaceRoot: workspace, corpusDir: join(workspace, ".corpus") });
  bus = createInvalidationBus();
  selfWrites = createSelfWriteRegistry();
  observed = 0;

  populateFromFiles(db);
  watcher = startWatcher({
    db,
    bus,
    selfWrites,
    logger: silentLogger,
    debounceMs: 25,
    maxBatchMs: 150,
    observeOutOfBandWrite: () => {
      observed += 1;
    },
  });
  await watcher.ready;
  // chokidar's `ready` says the scan finished, not that every per-directory
  // watch is armed.
  await new Promise((resolve) => setTimeout(resolve, 300));
  observed = 0;
});

afterEach(async () => {
  await watcher?.close();
  watcher = undefined;
  db.close();
  rmSync(root, { recursive: true, force: true });
});

describe("an out-of-band edit restarts the quiet window", () => {
  it("reports a document a person changed behind the server's back", async () => {
    write("data/docs/note.md", doc("doc_aaa", "Edited outside"));

    await vi.waitFor(() => {
      expect(observed).toBe(1);
    }, WAIT);
  });

  /**
   * Once per batch, not once per file: a person saving several documents from an
   * editor is one burst of activity, and the window is a debounce over activity
   * rather than a count of it.
   */
  it("reports one burst once, however many files it carried", async () => {
    write("data/docs/a.md", doc("doc_aaa", "One"));
    write("data/docs/b.md", doc("doc_bbb", "Two"));
    write("data/docs/c.md", doc("doc_ccc", "Three"));

    await vi.waitFor(() => {
      expect(db.prepare("SELECT COUNT(*) AS n FROM documents").get()).toEqual({ n: 3 });
    }, WAIT);
    expect(observed).toBeGreaterThanOrEqual(1);
    expect(observed).toBeLessThanOrEqual(3);
  });

  /**
   * The other half, and the one a heuristic would get wrong: a queue event or a
   * job log landing in `.corpus/` is not somebody editing the corpus, so it must
   * not hold a reflection off for another window.
   */
  it("says nothing for a batch that touched no document", async () => {
    write(
      ".corpus/queue/pending/evt_000000000000.json",
      JSON.stringify({
        id: "evt_000000000000",
        type: "comment.created",
        created: "2026-08-22T09:00:00Z",
        source: "cli",
        payload: {},
      }),
    );

    // Waited on the frame the queue entry does produce, so this is "it did not
    // report" rather than "nothing has happened yet".
    await vi.waitFor(() => {
      expect(db.prepare("SELECT COUNT(*) AS n FROM events").get()).toEqual({ n: 1 });
    }, WAIT);
    expect(observed).toBe(0);
  });
});
