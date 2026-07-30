import {
  ACTOR_HEADER,
  UpdateDocRequestSchema,
  type Actor,
  type Doc,
  type DocList,
  type QueryKeySegment,
  type UpdateDocRequest,
} from "@corpus/contract";
import type { PluginServerContext } from "@corpus/contract/plugin";
import { docRowFixture } from "@corpus/kit/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { itemsOrEmpty } from "../items.js";
import { TODO_DOC_TYPE } from "../shared.js";
import routes from "./routes.js";

/**
 * The routes, exercised through a real Hono router over a **fake plugin
 * context** that behaves the way `apps/server`'s real one does: `getDoc`
 * throws the server's HTTP-shaped `not_found`, writes apply `extra` as a
 * shallow merge patch after validating it, `mutateDoc` runs read → recompute →
 * write inside a per-document lane, and `broadcastInvalidate` refuses a core
 * key.
 *
 * A fake rather than a real workspace because the contract under test is *this
 * module's*: that every write goes through the context (never the filesystem),
 * that the right keys are broadcast, and that each refusal answers the right
 * status. That the context itself commits to git and re-projects is
 * `apps/server`'s own tested guarantee, and re-proving it here would be
 * asserting someone else's code through a slower harness. The live proof that
 * the two compose is the E2E run in the issue's log.
 *
 * The two behaviours the fake models *deliberately* rather than incidentally
 * are the lane and the write window (PLUGINS-004): without them a fake
 * serializes everything by accident and the lost update PR #11's finding 2
 * describes could not be reproduced here at all.
 */

const TS = "2026-07-20T09:00:00.000Z";
const NOW = Date.parse("2026-07-21T10:00:00.000Z");

interface Recorded {
  readonly keys: (readonly QueryKeySegment[])[];
  readonly updates: { id: string; actor: Actor; extra: unknown }[];
}

/**
 * A per-document write lane, as the real context has one. Tasks for the same
 * document run one after another; different documents never wait on each other.
 */
function lanes(): <T>(id: string, task: () => Promise<T>) => Promise<T> {
  const tails = new Map<string, Promise<unknown>>();
  return <T>(id: string, task: () => Promise<T>): Promise<T> => {
    const running = (tails.get(id) ?? Promise.resolve()).then(task);
    // The tail must never reject, or a refused write would poison the lane for
    // every request behind it.
    tails.set(
      id,
      running.then(
        () => undefined,
        () => undefined,
      ),
    );
    return running;
  };
}

/**
 * How long a real write is open for — validate, git auto-commit, re-project.
 * A macrotask, so anything already in flight gets to run its whole handler
 * while this write is mid-flight: that window is where the lost update lives.
 */
function writeWindow(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** `apps/server`'s `HttpError`, as the plugin recognises it: `{status, body}`. */
function httpish(status: number, code: string, message: string): unknown {
  return Object.assign(new Error(message), { status, body: { code, message } });
}

function docFixture(id: string, items: unknown, type = TODO_DOC_TYPE): Doc {
  return {
    frontmatter: {
      id,
      type,
      title: `List ${id}`,
      created: TS,
      updated: TS,
      tags: [],
      status: "open",
      anchors: {},
      due: null,
      reviewed: null,
      evergreen: false,
      pinned: false,
      order: null,
      query: null,
      column: null,
      extra: items === undefined ? {} : { items },
    },
    body: "## Notes\n",
    path: `data/docs/todos/${id}.md`,
    anchors: [],
  };
}

interface Harness {
  readonly context: PluginServerContext;
  readonly recorded: Recorded;
  readonly docs: Map<string, Doc>;
}

interface HarnessOptions {
  /**
   * Fails the write. Invoked inside the lane, *after* any mutation callback
   * has run — where the real context's edit-lock refusal happens, which is why
   * the seam requires the callback to be a pure recompute.
   */
  readonly onWrite?: () => void;
}

function harness(seed: readonly Doc[] = [], options: HarnessOptions = {}): Harness {
  const docs = new Map(seed.map((doc) => [doc.frontmatter.id, doc]));
  const recorded: Recorded = { keys: [], updates: [] };
  const lane = lanes();

  const read = (id: string): Doc => {
    const doc = docs.get(id);
    if (doc === undefined) throw httpish(404, "not_found", `no document with id ${id}`);
    return doc;
  };

  /** The write half of both write verbs — the lane is the caller's business. */
  const write = async (actor: Actor, id: string, patch: UpdateDocRequest): Promise<Doc> => {
    const doc = read(id);
    options.onWrite?.();
    await writeWindow();
    recorded.updates.push({ id, actor, extra: patch.extra });
    const next: Doc = {
      ...doc,
      frontmatter: {
        ...doc.frontmatter,
        extra: { ...doc.frontmatter.extra, ...(patch.extra ?? {}) },
      },
    };
    docs.set(id, next);
    return next;
  };

  /** As the real context does: a patch is parsed, whoever produced it. */
  const parsePatch = (patch: UpdateDocRequest): UpdateDocRequest => {
    const parsed = UpdateDocRequestSchema.safeParse(patch);
    if (!parsed.success) {
      throw httpish(
        400,
        "bad_request",
        `plugin doc update failed validation: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  };

  const context: PluginServerContext = {
    plugin: "todos",
    logger: { info: () => undefined, debug: () => undefined, error: () => undefined },
    now: () => NOW,
    listDocs: (query): DocList => ({
      items: [...docs.values()]
        .filter((doc) => query.type === undefined || doc.frontmatter.type === query.type)
        .map((doc) =>
          docRowFixture({
            id: doc.frontmatter.id,
            type: doc.frontmatter.type,
            title: doc.frontmatter.title,
            path: doc.path,
            extra: doc.frontmatter.extra,
          }),
        ),
      page: { total: docs.size, limit: 50, offset: 0 },
    }),
    getDoc: read,
    createDoc: () => Promise.reject(new Error("createDoc is not used by these routes")),
    updateDoc: (actor, id, patch) => lane(id, () => write(actor, id, parsePatch(patch))),
    mutateDoc: (actor, id, mutate) =>
      lane(id, async () => {
        // Read inside the lane, and hand the callback that document — the whole
        // reason this verb exists. A throw from the callback propagates
        // unwrapped and writes nothing.
        const patch = parsePatch(mutate(read(id)));
        return await write(actor, id, patch);
      }),
    broadcastInvalidate: (keys) => {
      for (const key of keys) {
        // The real context refuses a core root outright; mirroring that here is
        // what makes "the plugin never names one" an assertion, not a hope.
        if (key[0] === "docs" || key[0] === "x") {
          throw new Error(`plugin todos may not invalidate "${String(key[0])}"`);
        }
        recorded.keys.push(key);
      }
    },
  };

  return { context, recorded, docs };
}

async function call(
  h: Harness,
  method: string,
  path: string,
  body?: unknown,
  actor = "user",
): Promise<Response> {
  return await routes(h.context).request(path, {
    method,
    headers: {
      [ACTOR_HEADER]: actor,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

let h: Harness;

beforeEach(() => {
  h = harness([
    docFixture("doc_week", [
      { text: "Renew passport", done: false, ts: TS },
      { text: "Call plumber", done: false, ts: TS, due: "2026-07-01" },
      { text: "Send lease notice", done: true, ts: TS },
    ]),
    docFixture("doc_empty", undefined),
    docFixture("doc_note", undefined, "note"),
  ]);
});

describe("GET /lists", () => {
  it("reports every todo list with its items and counts", async () => {
    const response = await call(h, "GET", "/lists");
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { lists: { docId: string; open: number }[] };
    expect(payload.lists.map((list) => list.docId)).toEqual(["doc_week", "doc_empty"]);
    expect(payload.lists[0]).toMatchObject({ open: 2, done: 1, title: "List doc_week" });
    // Absent `items` is an empty list, not a missing one.
    expect(payload.lists[1]).toMatchObject({ open: 0, done: 0, items: [] });
  });
});

describe("GET /lists/:docId", () => {
  it("reports one list", async () => {
    const payload = (await (await call(h, "GET", "/lists/doc_week")).json()) as { open: number };
    expect(payload).toMatchObject({ docId: "doc_week", open: 2, done: 1 });
  });

  it("404s an unknown document, with the server's own message", async () => {
    const response = await call(h, "GET", "/lists/doc_gone");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: "not_found",
      message: "no document with id doc_gone",
    });
  });

  it("400s a document of another type", async () => {
    const response = await call(h, "GET", "/lists/doc_note");
    expect(response.status).toBe(400);
    expect(((await response.json()) as { message: string }).message).toContain("not a todo list");
  });
});

describe("POST /:docId/items", () => {
  it("appends an open item stamped with the context's clock", async () => {
    const response = await call(h, "POST", "/doc_week/items", { text: "Book dentist" });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      docId: "doc_week",
      index: 3,
      item: { text: "Book dentist", done: false, ts: new Date(NOW).toISOString() },
    });
  });

  it("writes through the context, never the filesystem, and attributes the actor", async () => {
    await call(h, "POST", "/doc_week/items", { text: "Book dentist" }, "agent");
    expect(h.recorded.updates).toHaveLength(1);
    expect(h.recorded.updates[0]?.actor).toBe("agent");
    expect(h.recorded.updates[0]?.id).toBe("doc_week");
    expect((h.recorded.updates[0]?.extra as { items: unknown[] }).items).toHaveLength(4);
  });

  it("broadcasts only the plugin's own namespaced keys", async () => {
    await call(h, "POST", "/doc_week/items", { text: "Book dentist" });
    // The context prefixes these to ["x","todos",…]; naming a core root throws,
    // because the core write path already broadcast ["docs"] itself.
    expect(h.recorded.keys).toEqual([["lists"], ["lists", "doc_week"]]);
  });

  it("appends to a document with no `items` key at all", async () => {
    const response = await call(h, "POST", "/doc_empty/items", { text: "first" });
    expect(response.status).toBe(201);
    expect((await response.json()) as { index: number }).toMatchObject({ index: 0 });
  });

  it("carries an optional due date", async () => {
    const response = await call(h, "POST", "/doc_empty/items", {
      text: "first",
      due: "2026-08-01",
    });
    expect(((await response.json()) as { item: { due: string } }).item.due).toBe("2026-08-01");
  });

  it("400s empty text, a missing body and a malformed due date, writing nothing", async () => {
    expect((await call(h, "POST", "/doc_week/items", { text: "" })).status).toBe(400);
    expect((await call(h, "POST", "/doc_week/items")).status).toBe(400);
    expect((await call(h, "POST", "/doc_week/items", { text: "a", due: "Friday" })).status).toBe(
      400,
    );
    expect(h.recorded.updates).toEqual([]);
  });

  it("404s an unknown document", async () => {
    expect((await call(h, "POST", "/doc_gone/items", { text: "a" })).status).toBe(404);
  });
});

describe("PUT /:docId/items/:index", () => {
  it("flips `done` and leaves `ts` byte-identical", async () => {
    const response = await call(h, "PUT", "/doc_week/items/0", { done: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      docId: "doc_week",
      index: 0,
      item: { text: "Renew passport", done: true, ts: TS },
    });
    const back = await call(h, "PUT", "/doc_week/items/0", { done: false });
    expect(((await back.json()) as { item: { ts: string } }).item.ts).toBe(TS);
  });

  it("renames an item", async () => {
    const response = await call(h, "PUT", "/doc_week/items/0", { text: "Renew the passport" });
    expect(((await response.json()) as { item: { text: string } }).item.text).toBe(
      "Renew the passport",
    );
  });

  it("409s and writes nothing when the expected text no longer matches", async () => {
    const response = await call(h, "PUT", "/doc_week/items/0", {
      done: true,
      expectedText: "something else",
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "conflict" });
    expect(h.recorded.updates).toEqual([]);
    expect(h.recorded.keys).toEqual([]);
  });

  it("400s an out-of-range index and a non-numeric one", async () => {
    expect((await call(h, "PUT", "/doc_week/items/9", { done: true })).status).toBe(400);
    expect((await call(h, "PUT", "/doc_week/items/two", { done: true })).status).toBe(400);
    expect(h.recorded.updates).toEqual([]);
  });

  it("400s a body whose fields are the wrong type", async () => {
    expect((await call(h, "PUT", "/doc_week/items/0", { done: "yes" })).status).toBe(400);
  });

  it("404s an unknown document", async () => {
    expect((await call(h, "PUT", "/doc_gone/items/0", { done: true })).status).toBe(404);
  });
});

describe("DELETE /:docId/items/:index", () => {
  it("removes exactly one item, keeping the others verbatim", async () => {
    const response = await call(h, "DELETE", "/doc_week/items/1");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      docId: "doc_week",
      index: 1,
      removed: { text: "Call plumber" },
    });
    const remaining = (h.recorded.updates[0]?.extra as { items: { text: string }[] }).items;
    expect(remaining.map((entry) => entry.text)).toEqual(["Renew passport", "Send lease notice"]);
  });

  it("honours the concurrency guard", async () => {
    const response = await call(h, "DELETE", "/doc_week/items/1", {
      expectedText: "Renew passport",
    });
    expect(response.status).toBe(409);
    expect(h.recorded.updates).toEqual([]);
  });

  it("400s an out-of-range index and a malformed body", async () => {
    expect((await call(h, "DELETE", "/doc_week/items/9")).status).toBe(400);
    expect((await call(h, "DELETE", "/doc_week/items/0", { expectedText: 7 })).status).toBe(400);
  });
});

describe("malformed items", () => {
  it("refuses every mutation rather than overwriting what it could not read", async () => {
    const broken = harness([docFixture("doc_bad", "not a list")]);
    for (const [method, path, body] of [
      ["POST", "/doc_bad/items", { text: "a" }],
      ["PUT", "/doc_bad/items/0", { done: true }],
      ["DELETE", "/doc_bad/items/0", undefined],
    ] as const) {
      const response = await call(broken, method, path, body);
      expect(response.status).toBe(400);
      expect(((await response.json()) as { message: string }).message).toContain("malformed items");
    }
    expect(broken.recorded.updates).toEqual([]);
  });

  it("still lists a malformed document, degraded to no items", async () => {
    const broken = harness([docFixture("doc_bad", "not a list")]);
    const payload = (await (await call(broken, "GET", "/lists")).json()) as {
      lists: { items: unknown[] }[];
    };
    expect(payload.lists[0]?.items).toEqual([]);
  });
});

describe("failures the plugin does not own", () => {
  it("passes a locked document's 423 through with its body intact", async () => {
    // The refusal lands after the mutation callback ran, exactly where the real
    // context's lock guard is — and nothing must be written or broadcast.
    const locked = harness([docFixture("doc_week", [])], {
      onWrite: () => {
        throw httpish(423, "locked", "doc_week is locked by user");
      },
    });
    const response = await call(locked, "POST", "/doc_week/items", { text: "a" });
    expect(response.status).toBe(423);
    expect(await response.json()).toEqual({
      code: "locked",
      message: "doc_week is locked by user",
    });
    expect(locked.recorded.keys).toEqual([]);
  });

  it("never invents a friendly body for a failure it does not own", async () => {
    const boom = harness([docFixture("doc_week", [])], {
      onWrite: () => {
        throw new Error("the disk caught fire");
      },
    });
    const response = await call(boom, "POST", "/doc_week/items", { text: "a" });
    // Re-thrown: the router's own last-resort handler answered, not the
    // plugin's translator. Mounted for real, this is where the server's
    // `onError` logs the genuine 500 it is.
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).not.toContain("application/json");
  });

  it("refuses to answer 200 for a context that resolved without mutating", async () => {
    const inert = harness([docFixture("doc_week", [])]);
    const context: PluginServerContext = {
      ...inert.context,
      // A context that never runs the callback breaks the seam's contract. The
      // plugin has no item to report, and inventing one would be worse than
      // failing: this is the 500 it is.
      mutateDoc: (_actor, id) => Promise.resolve(docFixture(id, [])),
    };
    const response = await routes(context).request("/doc_week/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "a" }),
    });
    expect(response.status).toBe(500);
    expect(inert.recorded.keys).toEqual([]);
  });
});

/**
 * PR #11 review, finding 2 — the lost update this issue closes.
 *
 * Every mutation here writes the *whole* recomputed `items` array, so a read
 * taken before the lane is a stale basis for the write that follows. The fake
 * context models the two things that make that reachable in production: writes
 * to one document serialize, and a write stays open across a macrotask (the
 * git-commit window). Both requests below are dispatched before either write
 * lands, which is precisely two quick browser clicks, or an agent CLI call
 * arriving while the board is mid-write.
 *
 * Against the pre-fix `getDoc` → `updateDoc` pair every one of these fails: the
 * second request reads the pre-change list, passes its per-item `expectedText`
 * guard — it never touched the index the first one changed — and reverts the
 * first after it already answered 200.
 */
describe("interleaved mutations of one list", () => {
  const doneFlags = (h: Harness, id: string): readonly boolean[] =>
    itemsOrEmpty(h.docs.get(id)?.frontmatter).map((item) => item.done);

  const texts = (h: Harness, id: string): readonly string[] =>
    itemsOrEmpty(h.docs.get(id)?.frontmatter).map((item) => item.text);

  it("keeps both toggles when a second dispatches inside the first's write window", async () => {
    const [first, second] = await Promise.all([
      call(h, "PUT", "/doc_week/items/0", { done: true, expectedText: "Renew passport" }),
      call(h, "PUT", "/doc_week/items/1", { done: true, expectedText: "Call plumber" }),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(doneFlags(h, "doc_week")).toEqual([true, true, true]);
  });

  it("lands every one of four concurrent appends, each at its own index", async () => {
    const responses = await Promise.all(
      ["a1", "a2", "a3", "a4"].map((text) => call(h, "POST", "/doc_empty/items", { text })),
    );
    expect(responses.map((response) => response.status)).toEqual([201, 201, 201, 201]);
    const reported = await Promise.all(
      responses.map(async (response) => ((await response.json()) as { index: number }).index),
    );
    // Two responses claiming the same index is the lost update's signature.
    expect([...reported].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    expect(texts(h, "doc_empty")).toHaveLength(4);
  });

  it("never resurrects a deleted item through a toggle that raced the delete", async () => {
    const [removed, toggled] = await Promise.all([
      call(h, "DELETE", "/doc_week/items/0", { expectedText: "Renew passport" }),
      call(h, "PUT", "/doc_week/items/1", { done: true, expectedText: "Call plumber" }),
    ]);
    // The guard fires only because the toggle read *post-delete* state: index 1
    // now holds a different item than the caller was looking at. Reading before
    // the lane, it would have passed the guard and written back a three-item
    // list — bringing “Renew passport” back from the dead.
    expect([removed.status, toggled.status]).toEqual([200, 409]);
    expect(texts(h, "doc_week")).toEqual(["Call plumber", "Send lease notice"]);
    expect(doneFlags(h, "doc_week")).toEqual([false, true]);
  });

  it("keeps concurrent mutations of two different lists independent", async () => {
    const [week, empty] = await Promise.all([
      call(h, "POST", "/doc_week/items", { text: "later" }),
      call(h, "POST", "/doc_empty/items", { text: "elsewhere" }),
    ]);
    expect([week.status, empty.status]).toEqual([201, 201]);
    expect(texts(h, "doc_week")).toHaveLength(4);
    expect(texts(h, "doc_empty")).toEqual(["elsewhere"]);
  });
});

describe("the plugin never reaches past its context", () => {
  it("has no filesystem import anywhere under server/", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const dir = import.meta.dirname;
    const sources = readdirSync(dir).filter(
      (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
    );
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      expect(
        readFileSync(`${dir}/${file}`, "utf8"),
        `${file} reaches the filesystem — a plugin route writes through its context or not at all`,
      ).not.toContain("node:fs");
    }
  });
});
