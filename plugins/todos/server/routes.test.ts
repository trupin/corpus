import {
  ACTOR_HEADER,
  type Actor,
  type Doc,
  type DocList,
  type QueryKeySegment,
} from "@corpus/contract";
import type { PluginServerContext } from "@corpus/contract/plugin";
import { docRowFixture } from "@corpus/kit/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { TODO_DOC_TYPE } from "../shared.js";
import routes from "./routes.js";

/**
 * The routes, exercised through a real Hono router over a **fake plugin
 * context** that behaves the way `apps/server`'s real one does: `getDoc`
 * throws the server's HTTP-shaped `not_found`, `updateDoc` applies `extra` as a
 * shallow merge patch, and `broadcastInvalidate` refuses a core key.
 *
 * A fake rather than a real workspace because the contract under test is *this
 * module's*: that every write goes through the context (never the filesystem),
 * that the right keys are broadcast, and that each refusal answers the right
 * status. That the context itself commits to git and re-projects is
 * `apps/server`'s own tested guarantee, and re-proving it here would be
 * asserting someone else's code through a slower harness. The live proof that
 * the two compose is the E2E run in the issue's log.
 */

const TS = "2026-07-20T09:00:00.000Z";
const NOW = Date.parse("2026-07-21T10:00:00.000Z");

interface Recorded {
  readonly keys: (readonly QueryKeySegment[])[];
  readonly updates: { id: string; actor: Actor; extra: unknown }[];
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

function harness(seed: readonly Doc[] = []): Harness {
  const docs = new Map(seed.map((doc) => [doc.frontmatter.id, doc]));
  const recorded: Recorded = { keys: [], updates: [] };

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
    getDoc: (id): Doc => {
      const doc = docs.get(id);
      if (doc === undefined) throw httpish(404, "not_found", `no document with id ${id}`);
      return doc;
    },
    createDoc: () => Promise.reject(new Error("createDoc is not used by these routes")),
    updateDoc: (actor, id, patch) => {
      const doc = docs.get(id);
      if (doc === undefined) throw httpish(404, "not_found", `no document with id ${id}`);
      recorded.updates.push({ id, actor, extra: patch.extra });
      const next: Doc = {
        ...doc,
        frontmatter: {
          ...doc.frontmatter,
          extra: { ...doc.frontmatter.extra, ...(patch.extra ?? {}) },
        },
      };
      docs.set(id, next);
      return Promise.resolve(next);
    },
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
    const locked = harness([docFixture("doc_week", [])]);
    const context: PluginServerContext = {
      ...locked.context,
      updateDoc: () => {
        throw httpish(423, "locked", "doc_week is locked by user");
      },
    };
    const response = await routes(context).request("/doc_week/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "a" }),
    });
    expect(response.status).toBe(423);
    expect(await response.json()).toEqual({
      code: "locked",
      message: "doc_week is locked by user",
    });
  });

  it("never invents a friendly body for a failure it does not own", async () => {
    const boom = harness([docFixture("doc_week", [])]);
    const context: PluginServerContext = {
      ...boom.context,
      updateDoc: () => {
        throw new Error("the disk caught fire");
      },
    };
    const response = await routes(context).request("/doc_week/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "a" }),
    });
    // Re-thrown: the router's own last-resort handler answered, not the
    // plugin's translator. Mounted for real, this is where the server's
    // `onError` logs the genuine 500 it is.
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).not.toContain("application/json");
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
