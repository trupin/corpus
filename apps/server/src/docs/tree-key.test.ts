// The `["tree"]` invalidation invariant (SPEC.md §9, SERVER-018).
//
// **A mutation's frame carries `["tree"]` exactly when `GET /api/tree`'s
// response actually changed.** Every case below asserts that biconditional by
// reading the route either side of the mutation and comparing the two bodies —
// never by looking for a `TREE_KEY` push in the key list. A test written the
// other way round would have passed while the board's folder badges silently
// desynchronised, which is precisely how the two shipped gaps survived:
// archiving changed the tree and said nothing, and a standalone thread's
// deletion changed nothing and said `["tree"]`.

import { afterEach, describe, expect, it } from "vitest";
import type { QueryKey } from "@corpus/contract";
import { createDoc, createWriteWorkspace, type WriteWorkspace } from "./write-fixture.js";

let ws: WriteWorkspace;

afterEach(() => {
  ws.close();
});

/** The literal `GET /api/tree` body — the thing the invariant is about. */
const treeBody = async (): Promise<string> => (await ws.request("/api/tree")).text();

const hasTreeKey = (keys: QueryKey[]): boolean =>
  keys.some((key) => JSON.stringify(key) === JSON.stringify(["tree"]));

interface Observation {
  readonly before: string;
  readonly after: string;
  readonly changed: boolean;
  readonly frames: QueryKey[][];
  readonly keys: QueryKey[];
  readonly announced: boolean;
}

/**
 * Run one mutation with the tree read either side of it and every frame it
 * broadcast captured, then assert the invariant itself. The individual tests
 * add what is specific to them — which folder count moved, which other keys
 * the frame carried — on top of a claim that is checked for all of them.
 */
async function observe(action: () => Promise<unknown>): Promise<Observation> {
  const frames: QueryKey[][] = [];
  const off = ws.server.bus.subscribe((keys) => frames.push(keys as QueryKey[]));
  const before = await treeBody();
  try {
    await action();
  } finally {
    off();
  }
  const after = await treeBody();
  const keys = frames.flat();
  const observation: Observation = {
    before,
    after,
    changed: before !== after,
    frames,
    keys,
    announced: hasTreeKey(keys),
  };
  expect(observation.announced).toBe(observation.changed);
  return observation;
}

/** `finance`'s direct count in a tree body, or 0 when no such folder exists. */
function countOf(body: string, folder: string): number {
  const tree = JSON.parse(body) as {
    folders: { path: string; count: number }[];
  };
  return tree.folders.find((node) => node.path === folder)?.count ?? 0;
}

const okJson = async (response: Response): Promise<Record<string, unknown>> => {
  const payload = (await response.json()) as Record<string, unknown>;
  if (response.status >= 300) throw new Error(`${response.status}: ${JSON.stringify(payload)}`);
  return payload;
};

/** `POST /api/threads`, returning the new thread's id. */
async function createThread(body: Record<string, unknown>): Promise<string> {
  const payload = await okJson(await ws.post("/api/threads", body));
  return (payload["thread"] as { id: string }).id;
}

/** The turn timestamps of a thread, oldest first. */
async function turnTimes(threadId: string): Promise<string[]> {
  const payload = await okJson(await ws.request(`/api/threads/${threadId}`));
  return (payload["turns"] as { ts: string }[]).map((turn) => turn.ts);
}

async function appendTurn(threadId: string, text: string): Promise<void> {
  ws.advance(60_000);
  await okJson(await ws.post(`/api/threads/${threadId}/turns`, { body: text }));
}

/** A workspace holding one document in `finance`, ready to be commented on. */
async function withDocument(prefix: string): Promise<string> {
  ws = createWriteWorkspace(prefix, { sprint: "s018" });
  ws.reproject();
  const created = await createDoc(ws, {
    type: "note",
    title: "Mortgage options",
    folder: "finance",
    body: "assume a 30-year fixed at 6.1% for the base case\n",
  });
  return created.id;
}

const ANCHOR = { exact: "30-year fixed at 6.1%" };

describe("the ['tree'] invalidation key", () => {
  describe("thread deletion", () => {
    it("announces the tree when a parented thread's deletion moves its parent's count", async () => {
      const parent = await withDocument("tree-key-parented-delete");
      const thread = await createThread({ parent, selector: ANCHOR, body: "still right?" });
      ws.advance(60_000);

      const deletion = await observe(() => ws.del(`/api/docs/${thread}`));

      expect(countOf(deletion.before, "finance")).toBe(2);
      expect(countOf(deletion.after, "finance")).toBe(1);
      expect(deletion.announced).toBe(true);
      // The rest of the frame is unchanged by SERVER-018: the collection, the
      // thread as a document, the thread itself, and the parent it un-anchored.
      expect(deletion.keys.map((key) => JSON.stringify(key))).toEqual([
        '["docs"]',
        `["docs","${thread}"]`,
        `["threads","${thread}"]`,
        `["docs","${parent}"]`,
        '["tree"]',
      ]);
    });

    it("stays silent about the tree when a standalone thread is deleted", async () => {
      ws = createWriteWorkspace("tree-key-standalone-delete", { sprint: "s018" });
      ws.reproject();
      const thread = await createThread({ body: "a note to self" });
      ws.advance(60_000);

      const deletion = await observe(() => ws.del(`/api/docs/${thread}`));

      // A thread with no parent is counted in no folder (`docs/tree.ts`), so
      // its deletion cannot move a badge — and the frame must not claim it did.
      expect(deletion.after).toBe(deletion.before);
      expect(deletion.announced).toBe(false);
      expect(deletion.keys.map((key) => JSON.stringify(key))).toEqual([
        '["docs"]',
        `["docs","${thread}"]`,
        `["threads","${thread}"]`,
      ]);
    });

    it("treats creation and deletion symmetrically, for both parented and standalone", async () => {
      const parent = await withDocument("tree-key-symmetry");

      let parented = "";
      const parentedCreate = await observe(async () => {
        parented = await createThread({ parent, selector: ANCHOR, body: "anchored" });
      });
      ws.advance(60_000);
      const parentedDelete = await observe(() => ws.del(`/api/docs/${parented}`));

      let standalone = "";
      const standaloneCreate = await observe(async () => {
        standalone = await createThread({ body: "unanchored" });
      });
      ws.advance(60_000);
      const standaloneDelete = await observe(() => ws.del(`/api/docs/${standalone}`));

      expect([parentedCreate.announced, parentedDelete.announced]).toEqual([true, true]);
      expect([standaloneCreate.announced, standaloneDelete.announced]).toEqual([false, false]);
      // Whatever creation says about the tree, deletion says.
      expect(parentedDelete.announced).toBe(parentedCreate.announced);
      expect(standaloneDelete.announced).toBe(standaloneCreate.announced);
      // And the round trip leaves the tree where it started.
      expect(parentedDelete.after).toBe(parentedCreate.before);
      expect(standaloneDelete.after).toBe(standaloneCreate.before);
    });

    it("announces the tree for the last-turn cascade, which is a thread deletion", async () => {
      const parent = await withDocument("tree-key-cascade");
      const thread = await createThread({ parent, selector: ANCHOR, body: "one turn only" });
      const [only] = await turnTimes(thread);
      ws.advance(60_000);

      const cascade = await observe(() => ws.del(`/api/threads/${thread}/turns/${only ?? ""}`));

      expect(countOf(cascade.before, "finance")).toBe(2);
      expect(countOf(cascade.after, "finance")).toBe(1);
      expect(cascade.announced).toBe(true);
    });

    it("stays silent for a standalone thread's cascade", async () => {
      ws = createWriteWorkspace("tree-key-standalone-cascade", { sprint: "s018" });
      ws.reproject();
      const thread = await createThread({ body: "one turn, no parent" });
      const [only] = await turnTimes(thread);
      ws.advance(60_000);

      const cascade = await observe(() => ws.del(`/api/threads/${thread}/turns/${only ?? ""}`));

      expect(cascade.after).toBe(cascade.before);
      expect(cascade.announced).toBe(false);
    });

    it("stays silent when a middle turn is deleted and the thread survives", async () => {
      const parent = await withDocument("tree-key-middle-turn");
      const thread = await createThread({ parent, selector: ANCHOR, body: "turn one" });
      await appendTurn(thread, "turn two");
      await appendTurn(thread, "turn three");
      const [, middle] = await turnTimes(thread);
      ws.advance(60_000);

      const deletion = await observe(() => ws.del(`/api/threads/${thread}/turns/${middle ?? ""}`));

      expect(await turnTimes(thread)).toHaveLength(2);
      expect(deletion.after).toBe(deletion.before);
      expect(deletion.announced).toBe(false);
    });
  });

  describe("archive and unarchive", () => {
    it("announces the tree on both halves of a document's round trip", async () => {
      const doc = await withDocument("tree-key-archive-doc");
      ws.advance(60_000);

      const archived = await observe(() => ws.post(`/api/docs/${doc}/archive`, {}));
      ws.advance(60_000);
      const restored = await observe(() => ws.post(`/api/docs/${doc}/unarchive`, {}));

      // Archived documents are excluded from every folder count, so the badge
      // moves down and back up.
      expect(countOf(archived.before, "finance")).toBe(1);
      expect(countOf(archived.after, "finance")).toBe(0);
      expect(countOf(restored.after, "finance")).toBe(1);
      expect([archived.announced, restored.announced]).toEqual([true, true]);
    });

    it("announces the tree when a parented thread is archived and restored", async () => {
      const parent = await withDocument("tree-key-archive-thread");
      const thread = await createThread({ parent, selector: ANCHOR, body: "to be archived" });
      ws.advance(60_000);

      const archived = await observe(() => ws.post(`/api/docs/${thread}/archive`, {}));
      ws.advance(60_000);
      const restored = await observe(() => ws.post(`/api/docs/${thread}/unarchive`, {}));

      expect(countOf(archived.before, "finance")).toBe(2);
      expect(countOf(archived.after, "finance")).toBe(1);
      expect(countOf(restored.after, "finance")).toBe(2);
      expect([archived.announced, restored.announced]).toEqual([true, true]);
    });

    it("stays silent for a skill, whose folders live outside data/docs", async () => {
      ws = createWriteWorkspace("tree-key-archive-skill", { sprint: "s018" });
      ws.write(
        ".claude/skills/demo/SKILL.md",
        "---\nname: demo\ndescription: A demo.\n---\n\nDo.\n",
      );
      ws.git("add", "-A", "--", ".claude");
      ws.git("commit", "-m", "seed the skill");
      ws.reproject();
      const skill = (
        ws.db.prepare("SELECT id FROM documents WHERE type = 'skill'").get() as {
          id: string;
        }
      ).id;
      ws.advance(60_000);

      const archived = await observe(() => ws.post(`/api/docs/${skill}/archive`, {}));

      expect(ws.exists(".claude/skills-archived/demo/SKILL.md")).toBe(true);
      expect(archived.after).toBe(archived.before);
      expect(archived.announced).toBe(false);
    });

    it("announces the tree when a PUT carries the status that archives a document", async () => {
      const doc = await withDocument("tree-key-put-status");
      ws.advance(60_000);

      const archived = await observe(() => ws.put(`/api/docs/${doc}`, { status: "archived" }));
      ws.advance(60_000);
      // Back out through the unarchive route, because that is now the only way
      // out: `PUT { status: "open" }` on an archived document is refused
      // (SERVER-039), since for a skill it would restore the frontmatter and
      // leave the folder disabled.
      const restored = await observe(() => ws.post(`/api/docs/${doc}/unarchive`, {}));
      ws.advance(60_000);
      const edited = await observe(() =>
        ws.put(`/api/docs/${doc}`, { body: "a rewritten body\n" }),
      );
      ws.advance(60_000);
      const resolved = await observe(() => ws.put(`/api/docs/${doc}`, { status: "resolved" }));

      // `PUT` reaches the same `status` field `POST /archive` does.
      expect(countOf(archived.after, "finance")).toBe(0);
      expect(countOf(restored.after, "finance")).toBe(1);
      expect([archived.announced, restored.announced]).toEqual([true, true]);
      // A body edit — the autosave path — moves nothing, and neither does a
      // status the tree does not filter on.
      expect(edited.after).toBe(edited.before);
      expect(edited.announced).toBe(false);
      expect(resolved.after).toBe(resolved.before);
      expect(resolved.announced).toBe(false);
    });
  });

  describe("the mutations that already announced it", () => {
    it("announces a document's creation, and its deletion together with its threads", async () => {
      const doc = await withDocument("tree-key-doc-lifecycle");
      const thread = await createThread({ parent: doc, selector: ANCHOR, body: "a comment" });
      ws.advance(60_000);

      const deletion = await observe(() => ws.del(`/api/docs/${doc}`));

      // Both counts go: the document itself, and the thread that counted in the
      // document's folder and now hangs from nothing.
      expect(countOf(deletion.before, "finance")).toBe(2);
      expect(countOf(deletion.after, "finance")).toBe(0);
      expect(deletion.announced).toBe(true);
      // The thread itself survives its parent — it is orphaned, not deleted.
      expect((await ws.request(`/api/docs/${thread}`)).status).toBe(200);
    });

    it("stays silent when an archived, thread-less document is deleted or moved", async () => {
      const doc = await withDocument("tree-key-archived-nomove");
      ws.advance(60_000);
      await okJson(await ws.post(`/api/docs/${doc}/archive`, {}));
      ws.advance(60_000);

      // An archived document is counted in no folder, so relocating it moves no
      // badge — and neither does removing it.
      const moved = await observe(() => ws.post(`/api/docs/${doc}/move`, { folder: "legal" }));
      ws.advance(60_000);
      const deleted = await observe(() => ws.del(`/api/docs/${doc}`));

      expect(moved.after).toBe(moved.before);
      expect(moved.announced).toBe(false);
      expect(deleted.after).toBe(deleted.before);
      expect(deleted.announced).toBe(false);
    });

    it("announces a live document's move, which moves a count between folders", async () => {
      const doc = await withDocument("tree-key-move");
      ws.advance(60_000);

      const moved = await observe(() => ws.post(`/api/docs/${doc}/move`, { folder: "legal" }));

      expect(countOf(moved.before, "finance")).toBe(1);
      expect(countOf(moved.after, "finance")).toBe(0);
      expect(countOf(moved.after, "legal")).toBe(1);
      expect(moved.announced).toBe(true);
    });

    it("announces a capture, which files a document and its thread under data/docs", async () => {
      ws = createWriteWorkspace("tree-key-capture", { sprint: "s018" });
      ws.reproject();

      // `POST /api/capture` takes the composer's multipart form, not JSON.
      const form = new FormData();
      form.append("text", "file this for me");
      const capture = await observe(async () =>
        okJson(
          await ws.server.app.request("/api/capture", {
            method: "POST",
            headers: { Authorization: `Bearer ${ws.server.config.token}` },
            body: form,
          }),
        ),
      );

      expect(capture.announced).toBe(true);
    });
  });

  it("introduces no new key name: every frame stays inside the published vocabulary", async () => {
    const parent = await withDocument("tree-key-vocabulary");
    const frames: QueryKey[][] = [];
    const off = ws.server.bus.subscribe((keys) => frames.push(keys as QueryKey[]));

    const thread = await createThread({ parent, selector: ANCHOR, body: "a comment" });
    ws.advance(60_000);
    await ws.post(`/api/docs/${parent}/archive`, {});
    ws.advance(60_000);
    await ws.post(`/api/docs/${parent}/unarchive`, {});
    ws.advance(60_000);
    await ws.del(`/api/docs/${thread}`);
    off();

    // The nine shapes of `packages/contract/src/query-keys.ts`, by their first
    // segment. SERVER-018 changed when `["tree"]` is emitted, never what the
    // emitted names are.
    const names = new Set(frames.flat().map((key) => key[0]));
    expect([...names].sort()).toEqual(["docs", "threads", "tree"]);
    for (const key of frames.flat()) {
      expect(key.every((segment) => typeof segment === "string")).toBe(true);
      expect(key.length).toBeLessThanOrEqual(2);
    }
  });
});
