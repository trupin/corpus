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
import { docSource, itemsOrEmpty, type TodoItem } from "../items.js";
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
  readonly updates: {
    id: string;
    actor: Actor;
    extra: unknown;
    body: string | undefined;
    /** SPEC.md §7's key, as the patch presented it — `undefined` is a refusal. */
    key: string | undefined;
  }[];
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

/**
 * SPEC.md §7's key, as this fake derives it: 64 lowercase hexadecimal
 * characters over everything the fake actually stores — the body and `extra`
 * together.
 *
 * The real server takes a SHA-256 of the document file's stored bytes
 * (`apps/server/src/docs/key.ts`); nothing here can, because there is no file,
 * and a plugin may not import a hash from outside its allowed surface anyway
 * (`imports.test.ts`). What matters is the property the check rests on and not
 * the algorithm: the key **changes iff the stored document changes**, so a key
 * computed from a document that has since been written no longer matches —
 * which is the only thing the routes under test can be right or wrong about.
 */
function keyOf(body: string, extra: Readonly<Record<string, unknown>>): string {
  const stored = `${JSON.stringify(extra)}\n${body}`;
  let hash = 0x811c9dc5;
  const parts: string[] = [];
  for (let round = 0; round < 8; round += 1) {
    for (let at = 0; at < stored.length; at += 1) {
      hash ^= stored.charCodeAt(at) + round;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    parts.push(hash.toString(16).padStart(8, "0"));
  }
  return parts.join("");
}

/**
 * A todo document, body-backed since PLUGINS-005. `extra` is only ever the
 * *legacy* `items` key — a document that has not been migrated yet — which is
 * why it is a separate, explicit argument rather than the default.
 *
 * It carries a `key` and a `userEditing` flag because **every read of a whole
 * document does** (SPEC.md §7): the key is what a body-replacing write has to
 * present back, and a fixture without one would let this suite pass while the
 * routes wrote blind.
 */
function docFixture(
  id: string,
  body: string,
  options: {
    readonly type?: string;
    readonly legacy?: unknown;
    readonly status?: "open" | "archived";
  } = {},
): Doc {
  const extra: Record<string, unknown> = "legacy" in options ? { items: options.legacy } : {};
  return {
    key: keyOf(body, extra),
    // The advisory signal, never a gate: nothing in these routes reads it, and
    // §11 is explicit that the board is never read-only.
    userEditing: false,
    frontmatter: {
      id,
      type: options.type ?? TODO_DOC_TYPE,
      title: `List ${id}`,
      created: TS,
      updated: TS,
      tags: [],
      status: options.status ?? "open",
      anchors: {},
      due: null,
      reviewed: null,
      evergreen: false,
      origin: null,
      pinned: false,
      order: null,
      query: null,
      column: null,
      extra,
    },
    body,
    path: `data/docs/todos/${id}.md`,
    anchors: [],
  };
}

/** The three-item list every mutation test starts from. */
const WEEK_BODY = [
  "## This week",
  "",
  "- [ ] Renew passport",
  "- [ ] Call plumber (due: 2026-07-01)",
  "- [x] Send lease notice",
  "",
].join("\n");

/** `apps/server`'s RFC 7386 `extra` merge (`docs/update.ts:142-155`), as a fake. */
function mergeExtra(
  current: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === undefined) continue;
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}

interface Harness {
  readonly context: PluginServerContext;
  readonly recorded: Recorded;
  readonly docs: Map<string, Doc>;
}

/** The body an out-of-band write leaves behind, so an assertion can name it. */
const ELSEWHERE_BODY = "## Notes\n\n- [ ] someone else got here first\n";

/**
 * **Another writer lands a change between the read the patch was computed from
 * and the write** — the editor saving, the agent's CLI call, a second browser.
 *
 * The one interleaving a whole-body patch cannot survive on its own, and
 * therefore the one SPEC.md §7's key exists to refuse. Written as an `onWrite`
 * hook because that is the only point inside the lane a test can reach.
 * Idempotent: a batch verb calls it once per document, and a second overwrite
 * would refuse a retry that was never attempted.
 */
function overwriteFromElsewhere(
  id: string,
  docs: Map<string, Doc>,
  only?: ReadonlySet<string>,
): void {
  if (only !== undefined && !only.has(id)) return;
  const current = docs.get(id);
  if (current === undefined || current.body === ELSEWHERE_BODY) return;
  docs.set(id, {
    ...current,
    body: ELSEWHERE_BODY,
    key: keyOf(ELSEWHERE_BODY, current.frontmatter.extra),
  });
}

interface HarnessOptions {
  /**
   * Runs inside the lane, *after* any mutation callback has run and *before*
   * the write — where the real context's own refusals land, which is why the
   * seam requires the callback to be a pure recompute. It is handed the
   * document id so a batch verb can be driven past a failure on **one** of the
   * documents it walks.
   *
   * Throwing fails the write. Writing into the store it is handed is the other
   * use: it is the one way a test can move the document out from under a patch
   * that has already been computed, which is what makes SPEC.md §7's stale-key
   * refusal reachable at all.
   */
  readonly onWrite?: (id: string, docs: Map<string, Doc>) => void;
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

  /**
   * The write half of both write verbs — the lane is the caller's business.
   *
   * §7's key check sits here, against the document *as the write is about to
   * overwrite it*, exactly like `assertDocumentKey` in `apps/server`: comparing
   * against a copy read earlier would refuse nothing. The missing-key half of
   * the check is {@link parsePatch}'s, because the contract's own refinement
   * answers it before any of this runs.
   */
  const write = async (actor: Actor, id: string, patch: UpdateDocRequest): Promise<Doc> => {
    options.onWrite?.(id, docs);
    const doc = read(id);
    if (patch.key !== undefined && patch.key !== doc.key) {
      throw httpish(
        409,
        "stale_key",
        `the key presented for ${id} names a version this document no longer is`,
      );
    }
    await writeWindow();
    recorded.updates.push({ id, actor, extra: patch.extra, body: patch.body, key: patch.key });
    const body = patch.body ?? doc.body;
    const extra = mergeExtra(doc.frontmatter.extra, patch.extra);
    const next: Doc = {
      ...doc,
      body,
      // Every write that lands hands out a fresh key for the next one (§7).
      key: keyOf(body, extra),
      frontmatter: { ...doc.frontmatter, extra },
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
    listDocs: (query): DocList => {
      // Paged for real: both walks page to the end, and a fake that ignored
      // `offset` would hand them the first page forever.
      //
      // `includeArchived` is honoured for real too (TEST-24). It is the whole
      // difference between the two walks — the aggregate inherits core's
      // archived exclusion, migration deliberately lifts it — and a fake that
      // ignored it would let either of them claim the other's behaviour.
      const matched = [...docs.values()].filter((doc) => {
        if (query.type !== undefined && doc.frontmatter.type !== query.type) return false;
        return query.includeArchived === true || doc.frontmatter.status !== "archived";
      });
      return {
        items: matched.slice(query.offset, query.offset + query.limit).map((doc) =>
          docRowFixture({
            id: doc.frontmatter.id,
            type: doc.frontmatter.type,
            title: doc.frontmatter.title,
            path: doc.path,
            status: doc.frontmatter.status,
            extra: doc.frontmatter.extra,
          }),
        ),
        page: { total: matched.length, limit: query.limit, offset: query.offset },
      };
    },
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
    docFixture("doc_week", WEEK_BODY),
    docFixture("doc_empty", "## Notes\n"),
    docFixture("doc_note", "## Notes\n", { type: "note" }),
  ]);
});

describe("GET /lists", () => {
  it("reports every todo list with its items and counts", async () => {
    const response = await call(h, "GET", "/lists");
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { lists: { docId: string; open: number }[] };
    expect(payload.lists.map((list) => list.docId)).toEqual(["doc_week", "doc_empty"]);
    expect(payload.lists[0]).toMatchObject({ open: 2, done: 1, title: "List doc_week" });
    // A body with no task lines is an empty list, not a missing one.
    expect(payload.lists[1]).toMatchObject({ open: 0, done: 0, items: [] });
  });

  /**
   * PLUGINS-007: the board addresses the same aggregate through a cache
   * generation it computes from `(id, updated)`, so a **core** body edit —
   * which broadcasts `["docs"]` and nothing under `x/todos` — still changes the
   * query key and refetches. The segment is deliberately unread here.
   */
  it("answers the same aggregate under any fingerprint segment", async () => {
    const plain = (await (await call(h, "GET", "/lists")).json()) as unknown;
    for (const fingerprint of ["abc123", "0", "zzzzzzzz"]) {
      const response = await call(h, "GET", `/lists/at/${fingerprint}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(plain);
    }
  });

  it("does not mistake a fingerprint for a document id", async () => {
    // `/lists/:docId` is a different route with a different arity; a workspace
    // whose document is literally called `at` would still resolve.
    expect((await call(h, "GET", "/lists/at")).status).toBe(404);
  });

  /**
   * FIX 2. `GET /lists` used to ask the collection query once and inherit the
   * contract's default `limit` of 50 — so a workspace's fifty-first todo
   * document vanished from the CLI's `list`, from every todo row's preview and
   * from the aggregate column at once, with nothing anywhere saying it had.
   */
  it("pages past the contract's default limit, however many lists there are", async () => {
    const many = harness(
      Array.from({ length: 137 }, (_entry, at) =>
        docFixture(`doc_${String(at).padStart(3, "0")}`, `- [ ] item ${String(at)}\n`),
      ),
    );
    const payload = (await (await call(many, "GET", "/lists")).json()) as {
      lists: { docId: string }[];
    };
    expect(payload.lists).toHaveLength(137);
    expect(payload.lists.at(-1)?.docId).toBe("doc_136");
  });

  it("excludes archived lists, as core's default result set does", async () => {
    const mixed = harness([
      docFixture("doc_open", "- [ ] a\n"),
      docFixture("doc_archived", "- [ ] b\n", { status: "archived" }),
    ]);
    const payload = (await (await call(mixed, "GET", "/lists")).json()) as {
      lists: { docId: string }[];
    };
    expect(payload.lists.map((list) => list.docId)).toEqual(["doc_open"]);
  });

  it("reads a migrated and a not-yet-migrated document side by side", async () => {
    // TEST-488: the mixed state a real workspace is in for as long as the
    // chosen policy takes to converge. Both appear, neither duplicated.
    const mixed = harness([
      docFixture("doc_body", "- [ ] from the body\n"),
      docFixture("doc_legacy", "## Notes\n", {
        legacy: [{ text: "from frontmatter", done: false, ts: TS }],
      }),
    ]);
    const payload = (await (await call(mixed, "GET", "/lists")).json()) as {
      lists: { docId: string; open: number; items: { text: string }[] }[];
    };
    expect(payload.lists.map((list) => list.items.map((entry) => entry.text))).toEqual([
      ["from the body"],
      ["from frontmatter"],
    ]);
    expect(payload.lists.every((list) => list.open === 1)).toBe(true);
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
  it("appends an open item at the end of the body's list", async () => {
    const response = await call(h, "POST", "/doc_week/items", { text: "Book dentist" });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      docId: "doc_week",
      index: 3,
      item: { text: "Book dentist", done: false },
    });
    expect(h.docs.get("doc_week")?.body).toBe(
      WEEK_BODY.replace(
        "- [x] Send lease notice\n",
        "- [x] Send lease notice\n- [ ] Book dentist\n",
      ),
    );
  });

  it("writes through the context, never the filesystem, and attributes the actor", async () => {
    await call(h, "POST", "/doc_week/items", { text: "Book dentist" }, "agent");
    expect(h.recorded.updates).toHaveLength(1);
    expect(h.recorded.updates[0]?.actor).toBe("agent");
    expect(h.recorded.updates[0]?.id).toBe("doc_week");
    // A body patch, and no `extra` at all: the document has no legacy key.
    expect(h.recorded.updates[0]?.body).toContain("- [ ] Book dentist");
    expect(h.recorded.updates[0]?.extra).toBeUndefined();
  });

  it("broadcasts only the plugin's own namespaced key", async () => {
    await call(h, "POST", "/doc_week/items", { text: "Book dentist" });
    // The context prefixes this to ["x","todos","lists"]; naming a core root
    // throws, because the core write path already broadcast ["docs"] itself.
    // One key and not two: a ["lists", docId] key would match no registered
    // query — the aggregate's key is ["x","todos","lists","at",…] — so it was
    // precision that invalidated nothing (CLEAN 43).
    expect(h.recorded.keys).toEqual([["lists"]]);
  });

  it("appends to a document with no list in its body at all", async () => {
    const response = await call(h, "POST", "/doc_empty/items", { text: "first" });
    expect(response.status).toBe(201);
    expect((await response.json()) as { index: number }).toMatchObject({ index: 0 });
    expect(h.docs.get("doc_empty")?.body).toBe("## Notes\n\n- [ ] first\n");
  });

  it("leaves prose, headings and a fenced lookalike byte-identical", async () => {
    // TEST-476, at the route: the plugin shares the body with the user now.
    const rich = [
      "Some prose.",
      "",
      "- [ ] Book the passport appointment",
      "",
      "## Later",
      "",
      "```sh",
      "- [ ] not an item",
      "```",
      "",
      "Trailing prose.",
      "",
    ].join("\n");
    const shared = harness([docFixture("doc_rich", rich)]);
    await call(shared, "PUT", "/doc_rich/items/0", { done: true });
    const after = String(shared.docs.get("doc_rich")?.body);
    expect(after).toBe(rich.replace("- [ ] Book", "- [x] Book"));
    const changed = after.split("\n").filter((line, at) => line !== rich.split("\n")[at]);
    expect(changed).toEqual(["- [x] Book the passport appointment"]);
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

  it("400s a document of another type, inside the lane, writing nothing", async () => {
    // The read that decides this happens *in* the mutation callback, so the
    // refusal is a throw that aborts the write rather than a check taken
    // outside it against a document that may since have changed type.
    const response = await call(h, "POST", "/doc_note/items", { text: "a" });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { message: string }).message).toContain("not a todo list");
    expect(h.recorded.updates).toEqual([]);
    expect(h.recorded.keys).toEqual([]);
  });
});

describe("PUT /:docId/items/:index", () => {
  it("flips `done` and leaves the body otherwise byte-identical", async () => {
    const response = await call(h, "PUT", "/doc_week/items/0", { done: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      docId: "doc_week",
      index: 0,
      item: { text: "Renew passport", done: true },
    });
    // TEST-481: a check/uncheck cycle restores the document exactly, so the
    // list's order cannot drift across any number of them.
    const back = await call(h, "PUT", "/doc_week/items/0", { done: false });
    expect(back.status).toBe(200);
    expect(h.docs.get("doc_week")?.body).toBe(WEEK_BODY);
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
      removed: { text: "Call plumber", due: "2026-07-01" },
    });
    expect(h.docs.get("doc_week")?.body).toBe(
      WEEK_BODY.replace("- [ ] Call plumber (due: 2026-07-01)\n", ""),
    );
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

describe("a document nothing can write safely", () => {
  it("refuses every mutation rather than overwriting a legacy key it could not read", async () => {
    const broken = harness([docFixture("doc_bad", "## Notes\n", { legacy: "not a list" })]);
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

  it("refuses a document carrying items in both places, naming the fix", async () => {
    const both = harness([
      docFixture("doc_both", "- [ ] in the body\n", {
        legacy: [{ text: "in frontmatter", done: false, ts: TS }],
      }),
    ]);
    const response = await call(both, "PUT", "/doc_both/items/0", { done: true });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { message: string }).message).toContain(
      "remove whichever list is stale",
    );
    expect(both.recorded.updates).toEqual([]);
  });

  it("still lists a malformed document, degraded to no items", async () => {
    const broken = harness([docFixture("doc_bad", "## Notes\n", { legacy: "not a list" })]);
    const payload = (await (await call(broken, "GET", "/lists")).json()) as {
      lists: { items: unknown[] }[];
    };
    expect(payload.lists[0]?.items).toEqual([]);
  });
});

/**
 * The migration, both halves (PLUGINS-005's chosen policy):
 *
 * - **on first write**, so no document is ever left in a state where the two
 *   representations can disagree — the fold and the write are one patch, hence
 *   one commit;
 * - **`POST /migrate`**, so a list nobody writes to again still converges, which
 *   matters because the document view renders the body and would otherwise show
 *   an empty list for a document full of items.
 */
describe("migration", () => {
  const legacyDocs = (): Harness =>
    harness([
      docFixture("doc_legacy", "## Notes\n", {
        legacy: [
          { text: "a", done: false, ts: TS, due: "2026-08-01" },
          { text: "b", done: true, ts: TS },
        ],
      }),
      docFixture("doc_body", "- [ ] already migrated\n"),
      docFixture("doc_bad", "## Notes\n", { legacy: 7 }),
    ]);

  it("folds the legacy key into the body on the first write, and clears it", async () => {
    const m = legacyDocs();
    const response = await call(m, "POST", "/doc_legacy/items", { text: "c" });
    expect(response.status).toBe(201);
    expect((await response.json()) as { index: number }).toMatchObject({ index: 2 });
    const doc = m.docs.get("doc_legacy");
    expect(doc?.body).toBe("## Notes\n\n- [ ] a (due: 2026-08-01)\n- [x] b\n- [ ] c\n");
    // TEST-489: a migrated document does not carry both representations.
    expect(doc?.frontmatter.extra).toEqual({});
    expect(m.recorded.updates[0]?.extra).toEqual({ items: null });
  });

  interface Report {
    dryRun: boolean;
    migrated: { docId: string; title: string; items: number }[];
    conflicts: { docId: string; title: string; reason: string }[];
    unchanged: number;
  }

  const migrateWith = async (m: Harness, query = ""): Promise<Report> =>
    (await (await call(m, "POST", `/migrate${query}`)).json()) as Report;

  it("converts every remaining document, reports what it changed, and is idempotent", async () => {
    const m = legacyDocs();
    const first = await migrateWith(m);
    expect(first.migrated).toEqual([{ docId: "doc_legacy", title: "List doc_legacy", items: 2 }]);
    expect(first.conflicts[0]?.docId).toBe("doc_bad");
    expect(first.conflicts[0]?.reason).toContain("malformed items");
    expect(first.unchanged).toBe(1);
    expect(first.dryRun).toBe(false);
    expect(m.docs.get("doc_legacy")?.body).toBe("## Notes\n\n- [ ] a (due: 2026-08-01)\n- [x] b\n");
    expect(m.docs.get("doc_body")?.body).toBe("- [ ] already migrated\n");

    const second = await migrateWith(m);
    expect(second.migrated).toEqual([]);
    expect(second.unchanged).toBe(2);
    // The unconvertible document is reported every time, never written.
    expect(m.recorded.updates.filter((entry) => entry.id === "doc_bad")).toEqual([]);
  });

  it("broadcasts once for the run, and nothing when it changed nothing", async () => {
    const m = legacyDocs();
    await call(m, "POST", "/migrate");
    expect(m.recorded.keys).toEqual([["lists"]]);
    m.recorded.keys.length = 0;
    await call(m, "POST", "/migrate");
    expect(m.recorded.keys).toEqual([]);
  });

  it("attributes the migration to the actor that asked for it", async () => {
    const m = legacyDocs();
    await call(m, "POST", "/migrate", undefined, "agent");
    expect(m.recorded.updates[0]).toMatchObject({ id: "doc_legacy", actor: "agent" });
  });

  it("includes archived lists, unlike every read surface", async () => {
    // A document left unmigrated because it happened to be archived is a
    // document that breaks the day someone unarchives it.
    const m = harness([
      docFixture("doc_shelved", "## Notes\n", {
        status: "archived",
        legacy: [{ text: "a", done: false, ts: TS }],
      }),
    ]);
    const report = await migrateWith(m);
    expect(report.migrated.map((entry) => entry.docId)).toEqual(["doc_shelved"]);
  });

  it("walks past one page of documents", async () => {
    const m = harness(
      Array.from({ length: 213 }, (_entry, at) =>
        docFixture(`doc_${String(at).padStart(3, "0")}`, "## Notes\n", {
          legacy: [{ text: `item ${String(at)}`, done: false }],
        }),
      ),
    );
    const report = await migrateWith(m);
    expect(report.migrated).toHaveLength(213);
    expect(m.docs.get("doc_212")?.body).toBe("## Notes\n\n- [ ] item 212\n");
  });

  it("says so plainly for a workspace with no todo documents at all", async () => {
    // TEST-23's other half: the loop's zero-iteration case must still answer a
    // well-formed report rather than nothing.
    expect(await migrateWith(harness([]))).toEqual({
      dryRun: false,
      migrated: [],
      conflicts: [],
      unchanged: 0,
    });
  });

  /**
   * FIX 4. `parseBodyItems(plan.body).length` counted every item in the
   * resulting body, so clearing a stale empty `items:` key off a document that
   * already had three body items reported "3 items moved into the body" — a
   * number that is true of nothing that happened.
   */
  it("counts what moved, not what the body ended up holding", async () => {
    const m = harness([docFixture("doc_stale", "- [ ] a\n- [ ] b\n- [ ] c\n", { legacy: [] })]);
    const report = await migrateWith(m);
    expect(report.migrated).toEqual([{ docId: "doc_stale", title: "List doc_stale", items: 0 }]);
    expect(m.docs.get("doc_stale")?.body).toBe("- [ ] a\n- [ ] b\n- [ ] c\n");
    expect(m.docs.get("doc_stale")?.frontmatter.extra).toEqual({});
  });
});

/**
 * FIX 3. Only `TodoItemError` used to be caught, so the first document whose
 * write failed for any other reason — a §7 stale-key refusal, a document
 * deleted between the listing and the write, a git failure — aborted the whole
 * run: the successes already on disk were never named, never broadcast, and the
 * user was given no way to tell how far it got. A migration is a batch, and a
 * batch reports per item.
 */
describe("migrate past a failure it does not own", () => {
  /**
   * A run in which the named documents are written by someone else between the
   * migration's read and its write — the ordinary way one document of a batch
   * is refused now that §7's key is what stops a blind overwrite.
   */
  const withRefusal = (refused: ReadonlySet<string>): Harness =>
    harness(
      [
        docFixture("doc_a", "## Notes\n", { legacy: [{ text: "a", done: false }] }),
        docFixture("doc_held", "## Notes\n", { legacy: [{ text: "held", done: false }] }),
        docFixture("doc_c", "## Notes\n", { legacy: [{ text: "c", done: false }] }),
      ],
      { onWrite: (id, docs) => overwriteFromElsewhere(id, docs, refused) },
    );

  it("records the refused document as a conflict and converts the rest", async () => {
    const m = withRefusal(new Set(["doc_held"]));
    const report = (await (await call(m, "POST", "/migrate")).json()) as {
      migrated: { docId: string }[];
      conflicts: { docId: string; title: string; reason: string }[];
    };
    expect(report.migrated.map((entry) => entry.docId)).toEqual(["doc_a", "doc_c"]);
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0]).toMatchObject({ docId: "doc_held", title: "List doc_held" });
    // The write path's own sentence, not "[object Object]" and not a friendly
    // message this plugin invented for a refusal it does not own.
    expect(report.conflicts[0]?.reason).toContain("names a version this document no longer is");
    // And the two that did convert are on disk, not merely reported.
    expect(m.docs.get("doc_c")?.body).toBe("## Notes\n\n- [ ] c\n");
    // The refused one still has its items where they were: nothing was written.
    expect(m.docs.get("doc_held")?.frontmatter.extra).toEqual({
      items: [{ text: "held", done: false }],
    });
  });

  it("still broadcasts the documents that did convert", async () => {
    const m = withRefusal(new Set(["doc_held"]));
    await call(m, "POST", "/migrate");
    expect(m.recorded.keys).toEqual([["lists"]]);
  });

  it("reports an unexpected failure against the document it belongs to", async () => {
    const boom = harness(
      [
        docFixture("doc_a", "## Notes\n", { legacy: [{ text: "a", done: false }] }),
        docFixture("doc_b", "## Notes\n", { legacy: [{ text: "b", done: false }] }),
      ],
      {
        onWrite: (id) => {
          if (id === "doc_a") throw new Error("the disk caught fire");
        },
      },
    );
    const report = (await (await call(boom, "POST", "/migrate")).json()) as {
      migrated: { docId: string }[];
      conflicts: { docId: string; reason: string }[];
    };
    // A batch verb that dies on document one tells the user nothing about
    // documents two through fifty — including which of them are already done.
    expect(report.conflicts).toEqual([
      { docId: "doc_a", title: "List doc_a", reason: "the disk caught fire" },
    ]);
    expect(report.migrated.map((entry) => entry.docId)).toEqual(["doc_b"]);
  });

  it("still names the document when something threw a value that is not an error", async () => {
    const odd = harness(
      [docFixture("doc_a", "## Notes\n", { legacy: [{ text: "a", done: false }] })],
      {
        // A throw with no `message` at all: an `Error` subclass someone built
        // badly, a rejected string from a library. A batch verb must survive
        // any shape of failure with the document still named.
        onWrite: () => {
          throw new Error("");
        },
      },
    );
    const report = (await (await call(odd, "POST", "/migrate")).json()) as {
      conflicts: { reason: string }[];
    };
    expect(report.conflicts[0]?.reason).toBe("doc_a could not be migrated");
  });
});

/**
 * CLEAN 47. The route already computed every number a preview needs; what it
 * lacked was a way to ask for them without writing. The prediction goes through
 * `planWrite` — the same function that refuses a real write — so a document the
 * dry run calls a conflict is a document a real run refuses.
 */
describe("POST /migrate?dryRun=true", () => {
  const previewable = (): Harness =>
    harness([
      docFixture("doc_legacy", "## Notes\n", {
        legacy: [
          { text: "a", done: false, ts: TS },
          { text: "b", done: true, ts: TS },
        ],
      }),
      docFixture("doc_body", "- [ ] already migrated\n"),
      docFixture("doc_both", "- [ ] in the body\n", { legacy: [{ text: "in fm", done: false }] }),
    ]);

  it("answers exactly what a real run then does, and writes nothing", async () => {
    const m = previewable();
    const preview = (await (await call(m, "POST", "/migrate?dryRun=true")).json()) as Record<
      string,
      unknown
    >;
    expect(preview["dryRun"]).toBe(true);
    expect(preview["migrated"]).toEqual([
      { docId: "doc_legacy", title: "List doc_legacy", items: 2 },
    ]);
    expect(preview["unchanged"]).toBe(1);
    expect((preview["conflicts"] as { docId: string }[]).map((entry) => entry.docId)).toEqual([
      "doc_both",
    ]);
    // Nothing written, nothing broadcast — the whole point of asking first.
    expect(m.recorded.updates).toEqual([]);
    expect(m.recorded.keys).toEqual([]);
    expect(m.docs.get("doc_legacy")?.body).toBe("## Notes\n");

    const real = (await (await call(m, "POST", "/migrate")).json()) as Record<string, unknown>;
    expect({ ...real, dryRun: true }).toEqual(preview);
    expect(m.recorded.keys).toEqual([["lists"]]);
  });

  it("treats any other value of the parameter as a real run", async () => {
    const m = previewable();
    const report = (await (await call(m, "POST", "/migrate?dryRun=yes")).json()) as {
      dryRun: boolean;
    };
    expect(report.dryRun).toBe(false);
    expect(m.recorded.updates).toHaveLength(1);
  });
});

describe("failures the plugin does not own", () => {
  it("passes the write path's own refusal through with its body intact", async () => {
    // The refusal lands after the mutation callback ran, which is exactly why
    // the seam requires that callback to be a pure recompute — and nothing must
    // be written or broadcast.
    const refused = harness([docFixture("doc_week", "## Notes\n")], {
      onWrite: () => {
        throw httpish(507, "internal_error", "the disk is full");
      },
    });
    const response = await call(refused, "POST", "/doc_week/items", { text: "a" });
    expect(response.status).toBe(507);
    expect(await response.json()).toEqual({
      code: "internal_error",
      message: "the disk is full",
    });
    expect(refused.recorded.keys).toEqual([]);
  });

  it("never invents a friendly body for a failure it does not own", async () => {
    const boom = harness([docFixture("doc_week", "## Notes\n")], {
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
    const inert = harness([docFixture("doc_week", "## Notes\n")]);
    const context: PluginServerContext = {
      ...inert.context,
      // A context that never runs the callback breaks the seam's contract. The
      // plugin has no item to report, and inventing one would be worse than
      // failing: this is the 500 it is.
      mutateDoc: (_actor, id) => Promise.resolve(docFixture(id, "## Notes\n")),
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
 * SPEC.md §7 "A key, not a lock" — PLUGINS-017.
 *
 * Every write in this plugin replaces the document's whole body, which is
 * exactly the write §7 refuses to let anyone make blind. The plugin was already
 * *correct* — `mutateDoc` hands the callback the document read inside the lane,
 * so the version it recomputes from is by construction the version it
 * overwrites — but nothing checked it, and "correct because of where the read
 * happens" is a property that survives only until someone moves the read.
 *
 * So the patch presents `doc.key`, and these tests are what makes the guarantee
 * an assertion instead of a coincidence: the key presented is the one the
 * callback was handed (not one re-derived just before writing, which would name
 * a version nobody read), and a patch whose key has gone stale is refused with
 * nothing written.
 */
describe("§7's key on every body write", () => {
  const currentKey = (subject: Harness, id: string): string | undefined =>
    subject.docs.get(id)?.key;

  /** Every route that rewrites a body — which here is every route that writes. */
  const bodyWrites = [
    { verb: "append", method: "POST", path: "/doc_week/items", body: { text: "Book dentist" } },
    {
      verb: "update",
      method: "PUT",
      path: "/doc_week/items/0",
      body: { done: true, expectedText: "Renew passport" },
    },
    {
      verb: "delete",
      method: "DELETE",
      path: "/doc_week/items/0",
      body: { expectedText: "Renew passport" },
    },
  ];

  it.each(bodyWrites)(
    "presents the key of the document the callback was handed ($verb)",
    async ({ method, path, body }) => {
      const before = currentKey(h, "doc_week");
      const response = await call(h, method, path, body);
      expect(response.status).toBeLessThan(300);
      expect(h.recorded.updates).toHaveLength(1);
      expect(h.recorded.updates[0]?.key).toBe(before);
      // And the write handed out a fresh one, as §7 requires of every write that
      // lands — so the pre-write key is not still valid afterwards.
      expect(currentKey(h, "doc_week")).not.toBe(before);
    },
  );

  it("presents a key on the migration's write too", async () => {
    const m = harness([
      docFixture("doc_legacy", "## Notes\n", { legacy: [{ text: "old", done: false }] }),
    ]);
    const before = currentKey(m, "doc_legacy");
    expect((await call(m, "POST", "/migrate")).status).toBe(200);
    expect(m.recorded.updates[0]?.key).toBe(before);
  });

  /**
   * The refusal this issue exists for: the document is written by someone else
   * between the read the patch was computed from and the write itself. Nothing
   * in the plugin can prevent that interleaving — the key is what turns it from
   * a silent overwrite into a refusal the caller is told about.
   */
  it("is refused when the document changed under a patch already computed", async () => {
    const raced = harness([docFixture("doc_week", WEEK_BODY)], {
      onWrite: (id, docs) => {
        overwriteFromElsewhere(id, docs);
      },
    });
    const response = await call(raced, "POST", "/doc_week/items", { text: "Book dentist" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "stale_key" });
    // Nothing written: the other writer's body stands, untouched, and the item
    // the caller tried to add is theirs to resend.
    expect(raced.docs.get("doc_week")?.body).toBe(ELSEWHERE_BODY);
    expect(raced.recorded.updates).toEqual([]);
    expect(raced.recorded.keys).toEqual([]);
  });

  it("is refused on the migration's write for the same reason", async () => {
    const raced = harness(
      [docFixture("doc_legacy", "## Notes\n", { legacy: [{ text: "old", done: false }] })],
      {
        onWrite: (id, docs) => {
          overwriteFromElsewhere(id, docs);
        },
      },
    );
    const report = (await (await call(raced, "POST", "/migrate")).json()) as {
      migrated: unknown[];
      conflicts: { reason: string }[];
    };
    expect(report.migrated).toEqual([]);
    expect(report.conflicts[0]?.reason).toContain("names a version this document no longer is");
    // The legacy key survives, because the migration that would have cleared it
    // never happened.
    expect(raced.docs.get("doc_legacy")?.frontmatter.extra).toEqual({
      items: [{ text: "old", done: false }],
    });
  });

  it("lands a second write, because the first handed out a fresh key", async () => {
    expect((await call(h, "POST", "/doc_week/items", { text: "one" })).status).toBe(201);
    expect((await call(h, "POST", "/doc_week/items", { text: "two" })).status).toBe(201);
    const keys = h.recorded.updates.map((entry) => entry.key);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys.every((key) => key !== undefined)).toBe(true);
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
  const items = (h: Harness, id: string): readonly TodoItem[] => {
    const doc = h.docs.get(id);
    return doc === undefined ? [] : itemsOrEmpty(docSource(doc));
  };

  const doneFlags = (h: Harness, id: string): readonly boolean[] =>
    items(h, id).map((item) => item.done);

  const texts = (h: Harness, id: string): readonly string[] =>
    items(h, id).map((item) => item.text);

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
