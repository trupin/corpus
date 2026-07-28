// The `["tree"]` invalidation invariant on the **watcher** path (SPEC.md §9,
// SERVER-020).
//
// SERVER-018 made the mutation path lawful: *a frame carries `["tree"]` exactly
// when `GET /api/tree`'s response changed.* The watcher path was not — it picked
// the key from a `structural` boolean (true for add/unlink, false for change),
// which is a statement about the filesystem event, not about the tree, and it
// was wrong in both directions on a real server:
//
// - an out-of-band edit setting `status: archived` emptied a folder and
//   announced only the document keys, so the folder stayed on the board;
// - a skill file appearing under `.claude/skills/` announced `["tree"]` though
//   `folderTree()` counts only `data/docs/**`.
//
// So every case below is written the way `docs/tree-key.test.ts` is written:
// the **HTTP route** is read either side of the change and the two bodies are
// compared, and the biconditional is asserted before anything specific to the
// case. A test that only looked for a `TREE_KEY` push would have passed against
// the broken watcher, which is exactly how both gaps survived.
//
// Real files, a real chokidar watcher and the real Hono app, sharing one
// projection — the production wiring (`attachWatcher`), minus the process.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QueryKey } from "@corpus/contract";
import { createDoc, createWriteWorkspace, type WriteWorkspace } from "../docs/write-fixture.js";
import { createSelfWriteRegistry } from "./self-writes.js";
import { startWatcher, type WatcherHandle } from "./watcher.js";

// Every assertion waits on a real filesystem event travelling through
// chokidar's `awaitWriteFinish` window and the watcher's debounce.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let ws: WriteWorkspace;
let watcher: WatcherHandle | undefined;

afterEach(async () => {
  await watcher?.close();
  watcher = undefined;
  ws.close();
});

/**
 * A workspace with the real app and a real watcher over the same projection.
 * `reproject()` first, so a document seeded here is an *existing* document to
 * the watcher rather than one that appears.
 */
async function boot(prefix: string): Promise<void> {
  ws = createWriteWorkspace(prefix, { sprint: "s020" });
  ws.reproject();
  watcher = startWatcher({
    db: ws.db,
    bus: ws.server.bus,
    selfWrites: createSelfWriteRegistry(),
    debounceMs: 25,
    maxBatchMs: 150,
  });
  await watcher.ready;
  // chokidar's `ready` says the initial scan finished, not that every
  // per-directory OS watch is armed.
  await new Promise((resolve) => setTimeout(resolve, 300));
}

/** The literal `GET /api/tree` body — the thing the invariant is about. */
const treeBody = async (): Promise<string> => (await ws.request("/api/tree")).text();

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Writes out of band: no self-write registration, so the watcher must see it. */
function edit(relativePath: string, content: string): void {
  const abs = join(ws.root, ...relativePath.split("/"));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

const remove = (relativePath: string): void => {
  rmSync(join(ws.root, ...relativePath.split("/")), { force: true });
};

/** Waits until nothing is pending and no new frame has arrived for ~400 ms. */
async function quiesce(frames: QueryKey[][]): Promise<void> {
  const deadline = Date.now() + 20_000;
  let seen = -1;
  let stable = 0;
  while (Date.now() < deadline) {
    await sleep(100);
    if (watcher?.pending === 0 && frames.length === seen) {
      stable += 1;
      if (stable >= 4) return;
    } else {
      stable = 0;
      seen = frames.length;
    }
  }
  throw new Error("the watcher never went quiet");
}

const hasTreeKey = (keys: QueryKey[]): boolean =>
  keys.some((key) => JSON.stringify(key) === JSON.stringify(["tree"]));

interface Observation {
  readonly before: string;
  readonly after: string;
  readonly changed: boolean;
  readonly frames: QueryKey[][];
  readonly keys: string[];
  readonly announced: boolean;
}

/**
 * Runs one out-of-band change with the tree read either side of it and every
 * frame it broadcast captured, then asserts the invariant itself. Each test
 * adds what is specific to it on top of a claim checked for all of them.
 */
async function observe(mutate: () => void): Promise<Observation> {
  const frames: QueryKey[][] = [];
  const off = ws.server.bus.subscribe((keys) => frames.push(keys.map((key) => [...key])));
  const before = await treeBody();
  try {
    mutate();
    await quiesce(frames);
  } finally {
    off();
  }
  const after = await treeBody();
  const flat = frames.flat();
  const observation: Observation = {
    before,
    after,
    changed: before !== after,
    frames,
    keys: flat.map((key) => JSON.stringify(key)),
    announced: hasTreeKey(flat),
  };
  expect(observation.announced).toBe(observation.changed);
  return observation;
}

/** A folder's direct count in a tree body, or `null` when no such folder exists. */
function countOf(body: string, folder: string): number | null {
  const tree = JSON.parse(body) as { folders: { path: string; count: number }[] };
  return tree.folders.find((node) => node.path === folder)?.count ?? null;
}

const withStatus = (source: string, status: string): string =>
  source.replace(/^status: .*$/m, `status: ${status}`);

const SKILL = [
  "---",
  "name: probe",
  "description: A skill that is not a corpus document.",
  "---",
  "",
  "# Probe",
  "",
  "Body.",
].join("\n");

const threadFile = (id: string, parent: string | null): string =>
  [
    "---",
    `id: ${id}`,
    "type: thread",
    `title: 'Re: something'`,
    "created: 2026-07-27T09:00:00Z",
    "updated: 2026-07-27T09:00:00Z",
    "tags: []",
    "status: open",
    `parent: ${parent ?? "null"}`,
    "agent: none",
    "---",
    "",
    "## user · 2026-07-27T09:00:00Z",
    "",
    "Anchored elsewhere.",
  ].join("\n");

/** One document, alone in `finance/`, so archiving it empties the folder. */
async function seedLoneDocument(prefix: string): Promise<{ path: string; id: string }> {
  await boot(prefix);
  const created = await createDoc(ws, {
    type: "note",
    title: "Mortgage options",
    folder: "finance",
    body: "assume a 30-year fixed at 6.1% for the base case\n",
  });
  return { path: created.path, id: created.id };
}

describe("the watcher's ['tree'] invalidation key", () => {
  describe("a status edit made outside Corpus", () => {
    it("announces the tree when an on-disk archive empties a folder", async () => {
      const doc = await seedLoneDocument("tree-archive");

      const observation = await observe(() => {
        edit(doc.path, withStatus(ws.read(doc.path), "archived"));
      });

      // The reproduced direction (i): the folder is gone from the route's
      // answer, and the pre-fix watcher said nothing about it.
      expect(countOf(observation.before, "finance")).toBe(1);
      expect(countOf(observation.after, "finance")).toBeNull();
      expect(observation.announced).toBe(true);
      expect(observation.keys).toContain(JSON.stringify(["docs", doc.id]));
    });

    it("announces it again when the archive is undone on disk", async () => {
      const doc = await seedLoneDocument("tree-unarchive");
      edit(doc.path, withStatus(ws.read(doc.path), "archived"));
      await observe(() => {});

      const observation = await observe(() => {
        edit(doc.path, withStatus(ws.read(doc.path), "open"));
      });

      // Symmetry was sprint-007's Open Conflict 13 on the mutation path; the
      // watcher path must not reintroduce the asymmetry.
      expect(countOf(observation.before, "finance")).toBeNull();
      expect(countOf(observation.after, "finance")).toBe(1);
      expect(observation.announced).toBe(true);
    });
  });

  describe("a file appearing where the tree does not look", () => {
    it("says nothing about the tree when a skill file appears", async () => {
      await boot("tree-skill");

      const observation = await observe(() => {
        edit(".claude/skills/probe/SKILL.md", SKILL);
      });

      // The reproduced direction (ii): `.claude/skills` is a full document root
      // and the file *is* projected — but `folderTree()` counts only
      // `data/docs/**`, so the route's answer is byte-identical.
      expect(observation.after).toBe(observation.before);
      expect(observation.announced).toBe(false);
      expect(
        ws.db.prepare("SELECT COUNT(*) AS n FROM documents WHERE type = 'skill'").get(),
      ).toEqual({ n: 1 });
      // The document keys are still announced: the fix must not cost the frame
      // its other keys.
      expect(observation.keys).toContain(JSON.stringify(["docs"]));
    });

    it("says nothing about the tree when a standalone thread appears, and does for a parented one", async () => {
      const doc = await seedLoneDocument("tree-threads");

      const standalone = await observe(() => {
        edit("data/threads/th_standalone.md", threadFile("th_standalone", null));
      });
      expect(standalone.after).toBe(standalone.before);
      expect(standalone.announced).toBe(false);
      expect(standalone.keys).toContain(JSON.stringify(["threads", "th_standalone"]));

      const parented = await observe(() => {
        edit("data/threads/th_parented.md", threadFile("th_parented", doc.id));
      });
      // §9.2: a thread counts in its *parent's* folder; a standalone one
      // (`parent: null`) is placed nowhere and contributes nothing.
      expect(countOf(parented.before, "finance")).toBe(1);
      expect(countOf(parented.after, "finance")).toBe(2);
      expect(parented.announced).toBe(true);
    });
  });

  describe("edits that move nothing", () => {
    it("keeps the document keys and drops the tree key for a body-only edit", async () => {
      const doc = await seedLoneDocument("tree-body");

      const observation = await observe(() => {
        edit(doc.path, `${ws.read(doc.path)}\nmore text\n`);
      });

      expect(observation.after).toBe(observation.before);
      expect(observation.announced).toBe(false);
      expect(observation.keys).toContain(JSON.stringify(["docs"]));
      expect(observation.keys).toContain(JSON.stringify(["docs", doc.id]));
    });

    it("says nothing at all about an unparseable file or one outside every root", async () => {
      await boot("tree-junk");
      const rowsBefore = ws.db.prepare("SELECT COUNT(*) AS n FROM documents").get();

      const observation = await observe(() => {
        edit("data/docs/broken.md", "---\nid: [unclosed\n---\n\nBody.\n");
        edit("notes.txt", "not a document at all\n");
      });

      expect(observation.after).toBe(observation.before);
      expect(observation.announced).toBe(false);
      // No phantom document keys either: nothing was projected, so nothing is
      // named.
      expect(observation.frames).toEqual([]);
      expect(ws.db.prepare("SELECT COUNT(*) AS n FROM documents").get()).toEqual(rowsBefore);
    });
  });

  describe("changes that really do move the tree", () => {
    it("announces a new folder appearing and the same folder disappearing", async () => {
      await boot("tree-appear-vanish");
      const file = "data/docs/research/paper.md";
      const document = [
        "---",
        "id: doc_paper00",
        "type: note",
        "title: Paper",
        "created: 2026-07-27T09:00:00Z",
        "updated: 2026-07-27T09:00:00Z",
        "tags: []",
        "status: open",
        "---",
        "",
        "Body.",
      ].join("\n");

      const appeared = await observe(() => {
        edit(file, document);
      });
      expect(countOf(appeared.before, "research")).toBeNull();
      expect(countOf(appeared.after, "research")).toBe(1);
      expect(appeared.announced).toBe(true);

      const vanished = await observe(() => {
        remove(file);
      });
      expect(countOf(vanished.after, "research")).toBeNull();
      expect(vanished.announced).toBe(true);
      // Measuring must not become a way to *miss* a real structural change.
    });

    it("names the tree once for a batch mixing one structural edit with three body edits", async () => {
      await boot("tree-batch");
      const ids: string[] = [];
      const paths: string[] = [];
      for (const title of ["Alpha", "Beta", "Gamma", "Delta"]) {
        const created = await createDoc(ws, {
          type: "note",
          title,
          folder: "finance",
          body: `Body of ${title}.\n`,
        });
        ids.push(created.id);
        paths.push(created.path);
      }

      const observation = await observe(() => {
        // One archive (structural) and three body edits, inside one window.
        edit(paths[0] as string, withStatus(ws.read(paths[0] as string), "archived"));
        for (const path of paths.slice(1)) edit(path, `${ws.read(path)}\nappended\n`);
      });

      expect(countOf(observation.before, "finance")).toBe(4);
      expect(countOf(observation.after, "finance")).toBe(3);
      expect(observation.announced).toBe(true);
      // Exactly once across the whole observation: the bus dedupes within a
      // frame, and the measurement is per batch rather than per member.
      expect(observation.keys.filter((key) => key === JSON.stringify(["tree"]))).toHaveLength(1);
      for (const id of ids) expect(observation.keys).toContain(JSON.stringify(["docs", id]));
    });
  });
});
