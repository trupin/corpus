// SERVER-025: the catch-up that closes the boot-scan → watcher-ready window.
//
// A real temp workspace, a real `.corpus/cache.db`, the real `doctor` and the
// real `populateFromFiles`. The only thing stubbed is the seam the watcher
// supplies — `ready` — because the point of every test here is what happens
// *after* it resolves, and chokidar's actual walk duration is not the subject.

import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryKey } from "@corpus/contract";
import { createInvalidationBus, type InvalidationBus } from "../events/index.js";
import { silentLogger } from "../logger.js";
import {
  REBUILD_QUERY_KEYS,
  openProjection,
  type ProjectionConfig,
  type ProjectionDb,
} from "../projection/index.js";
import { writeUnreadableDocument } from "../projection/unreadable-fixture.js";
import { REPAIRABLE_DRIFT_KINDS, catchUpOnWatcherReady } from "./catch-up.js";

let root: string;
let workspaceRoot: string;
let config: ProjectionConfig;
let db: ProjectionDb;
let bus: InvalidationBus;
let batches: QueryKey[][];
let attachMirror: ReturnType<typeof vi.fn>;

const docPath = (name: string): string => join(workspaceRoot, "data", "docs", name);

const document = (id: string, title: string, body = "Body."): string =>
  `---\nid: ${id}\ntype: note\ntitle: ${title}\n---\n\n${body}\n`;

/** Writes a file the way the window does: behind the projection's back. */
function writeBehindTheProjection(name: string, contents: string): void {
  writeFileSync(docPath(name), contents, "utf8");
}

function runCatchUp(options: { cancelled?: () => boolean } = {}): Promise<void> {
  return catchUpOnWatcherReady({
    db,
    bus,
    queue: { attachMirror: attachMirror as never },
    logger: silentLogger,
    ready: Promise.resolve(),
    cancelled: options.cancelled ?? (() => false),
  });
}

const documentIds = (): string[] =>
  (db.prepare("SELECT id FROM documents ORDER BY id").all() as { id: string }[]).map(
    (row) => row.id,
  );

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s025-catchup-"));
  workspaceRoot = join(root, "ws");
  config = { workspaceRoot, corpusDir: join(workspaceRoot, ".corpus") };
  mkdirSync(join(workspaceRoot, "data", "docs"), { recursive: true });
  writeFileSync(docPath("a.md"), document("doc_aaa", "A"), "utf8");
  // The boot scan: exactly what `openWorkspaceProjection` does at :134.
  db = openProjection(config);
  bus = createInvalidationBus();
  batches = [];
  bus.subscribe((keys) => batches.push([...keys]));
  attachMirror = vi.fn();
});

afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

describe("catchUpOnWatcherReady", () => {
  it("projects a file written into the window and announces one coarse frame", async () => {
    expect(documentIds()).toEqual(["doc_aaa"]);
    writeBehindTheProjection("window.md", document("doc_window", "Written in the window"));

    await runCatchUp();

    expect(documentIds()).toEqual(["doc_aaa", "doc_window"]);
    expect(batches).toEqual([REBUILD_QUERY_KEYS]);
    // The queue's reader has the last word on `events` after any repopulate,
    // exactly as at boot and after `POST /api/db/rebuild`.
    expect(attachMirror).toHaveBeenCalledTimes(1);
  });

  it("retires the row of a file deleted in the window", async () => {
    unlinkSync(docPath("a.md"));

    await runCatchUp();

    expect(documentIds()).toEqual([]);
    expect(batches).toEqual([REBUILD_QUERY_KEYS]);
  });

  it("re-reads a file edited in the window", async () => {
    writeBehindTheProjection("a.md", document("doc_aaa", "A", "Edited behind the scan."));

    await runCatchUp();

    const row = db.prepare("SELECT body_excerpt FROM documents WHERE id = ?").get("doc_aaa") as {
      body_excerpt: string;
    };
    expect(row.body_excerpt).toContain("Edited behind the scan.");
    expect(batches).toEqual([REBUILD_QUERY_KEYS]);
  });

  it("does nothing at all when the files and the rows already agree", async () => {
    await runCatchUp();

    expect(documentIds()).toEqual(["doc_aaa"]);
    expect(batches).toEqual([]);
    expect(attachMirror).not.toHaveBeenCalled();
  });

  it("stays silent on drift a repopulate cannot repair", async () => {
    // An unparseable document is a state of the *workspace*: it survives every
    // rebuild, so treating it as a trigger would buy a full re-scan and a coarse
    // invalidate on every boot of this workspace, forever.
    writeFileSync(docPath("broken.md"), "---\nnot: [valid\n---\n\nBody.\n", "utf8");

    await runCatchUp();

    expect(batches).toEqual([]);
    expect(attachMirror).not.toHaveBeenCalled();
    expect(REPAIRABLE_DRIFT_KINDS).not.toContain("unparseable");
    expect(REPAIRABLE_DRIFT_KINDS).not.toContain("duplicate_id");
    expect(REPAIRABLE_DRIFT_KINDS).not.toContain("count_mismatch");
  });

  // SERVER-064. A document the process cannot read is the same kind of state:
  // boot skips it, `doctor` reports it as `unparseable`, and a repopulate would
  // skip it again — so it must not become a per-boot re-scan either.
  it("stays silent on a document it cannot read, which no repopulate can fix", async () => {
    writeUnreadableDocument(docPath("m.md"));

    await runCatchUp();

    expect(batches).toEqual([]);
    expect(attachMirror).not.toHaveBeenCalled();
    expect(documentIds()).toEqual(["doc_aaa"]);
  });

  it("touches nothing once the server has shut down", async () => {
    writeBehindTheProjection("window.md", document("doc_window", "Written in the window"));

    await runCatchUp({ cancelled: () => true });

    expect(documentIds()).toEqual(["doc_aaa"]);
    expect(batches).toEqual([]);
  });

  it("waits for the watcher rather than running at attach time", async () => {
    writeBehindTheProjection("window.md", document("doc_window", "Written in the window"));
    let markReady = (): void => undefined;
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });

    const done = catchUpOnWatcherReady({
      db,
      bus,
      queue: { attachMirror: attachMirror as never },
      logger: silentLogger,
      ready,
      cancelled: () => false,
    });

    // Before the watcher is live the repair must not have happened: a file
    // written *now* would still be lost, which is precisely the window.
    await Promise.resolve();
    expect(documentIds()).toEqual(["doc_aaa"]);

    markReady();
    await done;
    expect(documentIds()).toEqual(["doc_aaa", "doc_window"]);
  });
});
