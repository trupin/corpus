// `PluginServerContext.mutateDoc` — the atomic read-modify-write (CONTRACT-019,
// SERVER-034), against a real workspace with a real git repository.
//
// Nothing is stubbed. The claim under test is that the read, the plugin's
// recompute and the write share one pass of the document's lane, and a stubbed
// mutex or a stubbed write path would prove only that the stub was called. So
// every assertion below reads one of the real surfaces: the file on disk,
// `git log`, the projection, or the invalidation bus.
//
// The companion `context.test.ts` covers the pure half (key namespacing).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Actor, Doc, QueryKey } from "@corpus/contract";
import { ACTOR_HEADER, LockedErrorSchema } from "@corpus/contract";
import type { PluginServerContext } from "@corpus/contract/plugin";
import { createDocumentMutex, type DocsWorkspace, type DocumentMutex } from "../docs/index.js";
import {
  AUTH,
  createDoc,
  createWriteWorkspace,
  type WriteWorkspace,
} from "../docs/write-fixture.js";
import { HttpError } from "../errors.js";
import { createAutoCommitter, createGit } from "../git/index.js";
import { silentLogger } from "../logger.js";
import { createPluginContext } from "./context.js";

let ws: WriteWorkspace;
let context: PluginServerContext;
let mutex: DocumentMutex;
let docId: string;
let docPath: string;
let keys: QueryKey[][];
let unsubscribe: () => void;

/**
 * The context as `mountPluginRoutes` builds it, with the *real* lock guard the
 * server wires into `DocsWorkspace` — the refusal parity `mutateDoc` promises is
 * a claim about that guard, so a fixture without it could not test it.
 */
function pluginContext(workspace: WriteWorkspace): {
  context: PluginServerContext;
  mutex: DocumentMutex;
} {
  const workspaceRoot = workspace.server.config.workspaceRoot;
  const guard = workspace.server.lockGuard;
  const docs: DocsWorkspace = {
    workspaceRoot,
    projection: workspace.db,
    git: createAutoCommitter({
      git: createGit(workspaceRoot),
      logger: silentLogger,
      now: () => workspace.clock,
    }),
    selfWrites: workspace.server.selfWrites,
    bus: workspace.server.bus,
    logger: silentLogger,
    now: () => workspace.clock,
    ...(guard === undefined ? {} : { assertWritable: guard.assertWritable.bind(guard) }),
  };
  const documentMutex = createDocumentMutex();
  return {
    context: createPluginContext({
      plugin: "counters",
      workspace: docs,
      mutex: documentMutex,
      logger: silentLogger,
      now: () => workspace.clock,
    }),
    mutex: documentMutex,
  };
}

/** The plugin key this fixture's documents carry, as the file holds it. */
const counterOf = (doc: Doc): number => {
  const value = doc.frontmatter.extra["counter"];
  return typeof value === "number" ? value : 0;
};

const currentCounter = (): number => {
  const match = /^counter: (\d+)$/m.exec(ws.read(docPath));
  return match === undefined || match === null ? 0 : Number(match[1]);
};

const acquire = async (id: string, actor: Actor): Promise<Response> =>
  ws.server.app.request(`/api/locks/${id}`, {
    method: "POST",
    headers: { ...AUTH, [ACTOR_HEADER]: actor },
  });

beforeEach(async () => {
  ws = createWriteWorkspace("plugin-mutate", { sprint: "s014" });
  const created = await createDoc(ws, { type: "note", title: "Tally", extra: { counter: 0 } });
  docId = created.id;
  docPath = created.path;
  ({ context, mutex } = pluginContext(ws));
  keys = [];
  unsubscribe = ws.server.bus.subscribe((frame) => {
    keys.push([...frame]);
  });
});

afterEach(() => {
  unsubscribe();
  ws.close();
});

describe("the lost update mutateDoc exists to prevent", () => {
  // PR #11 review, finding 2, verbatim: two requests read the pre-change
  // document because only the *write* serializes, and the second silently
  // reverts the first after it has already answered 200. `getDoc` is
  // synchronous and `updateDoc` returns a pending promise, so this is not a
  // contrived interleaving — it is what two clicks inside one commit window do.
  it("still happens with getDoc + updateDoc, which is why that pair is not equivalent", async () => {
    const first = context.getDoc(docId);
    const writeOne = context.updateDoc("user", docId, { extra: { counter: counterOf(first) + 1 } });
    // Read *now*, exactly as a second request handler would: the first write has
    // not landed, so this sees `counter: 0` again.
    const second = context.getDoc(docId);
    expect(counterOf(second)).toBe(0);
    const writeTwo = context.updateDoc("user", docId, {
      extra: { counter: counterOf(second) + 1 },
    });

    await Promise.all([writeOne, writeTwo]);

    // Two increments, one counted. The file is the proof, not the responses.
    expect(currentCounter()).toBe(1);
  });

  it("does not happen with mutateDoc: the second callback sees the first's result", async () => {
    const seen: number[] = [];
    const bump = (doc: Doc): { extra: Record<string, number> } => {
      seen.push(counterOf(doc));
      return { extra: { counter: counterOf(doc) + 1 } };
    };

    const writeOne = context.mutateDoc("user", docId, bump);
    // Issued while the first is mid-flight — before it has read, recomputed,
    // written or committed anything.
    const writeTwo = context.mutateDoc("user", docId, bump);
    const [one, two] = await Promise.all([writeOne, writeTwo]);

    // The lane is what orders these: the second callback ran only after the
    // first's write completed, so it read `1` rather than `0`.
    expect(seen).toEqual([0, 1]);
    expect(counterOf(one)).toBe(1);
    expect(counterOf(two)).toBe(2);
    expect(currentCounter()).toBe(2);
  });

  it("serializes against a core write on the same document, in issue order", async () => {
    // The lane is the *document's*, not the plugin's: `updateDoc` and
    // `mutateDoc` queue in one line, so a patch computed inside the lane can
    // never be computed against bytes a core save has already replaced.
    const seen: number[] = [];
    const core = context.updateDoc("user", docId, { extra: { counter: 7 } });
    const mutated = context.mutateDoc("user", docId, (doc) => {
      seen.push(counterOf(doc));
      return { extra: { counter: counterOf(doc) * 2 } };
    });
    await Promise.all([core, mutated]);

    expect(seen).toEqual([7]);
    expect(currentCounter()).toBe(14);
  });

  it("does not serialize writes to different documents", async () => {
    const other = await createDoc(ws, { type: "note", title: "Other tally" });
    // Both callbacks are entered before either write finishes, which can only
    // happen if the two lanes are independent — the per-document guarantee.
    let entered = 0;
    const enter = (doc: Doc): { extra: Record<string, number> } => {
      entered += 1;
      return { extra: { counter: entered, seen: counterOf(doc) } };
    };
    await Promise.all([
      context.mutateDoc("user", docId, enter),
      context.mutateDoc("user", other.id, enter),
    ]);
    expect(entered).toBe(2);
  });
});

describe("a callback that throws", () => {
  class PluginError extends Error {
    readonly detail = "the plugin's own error type";
  }

  it("aborts with nothing written, nothing committed, nothing broadcast", async () => {
    const before = ws.read(docPath);
    const head = ws.head();
    keys.length = 0;

    await expect(
      context.mutateDoc("user", docId, () => {
        throw new PluginError("no");
      }),
    ).rejects.toBeInstanceOf(PluginError);

    expect(ws.read(docPath)).toBe(before);
    expect(ws.head()).toBe(head);
    expect(keys).toEqual([]);
  });

  it("propagates unwrapped, so the plugin's own status mapping still applies", async () => {
    const thrown = new PluginError("still mine");
    await expect(
      context.mutateDoc("user", docId, () => {
        throw thrown;
      }),
    ).rejects.toBe(thrown);
  });

  it("releases the lane — the next mutation runs normally", async () => {
    await expect(
      context.mutateDoc("user", docId, () => {
        throw new PluginError("no");
      }),
    ).rejects.toBeInstanceOf(PluginError);

    await context.mutateDoc("user", docId, (doc) => ({ extra: { counter: counterOf(doc) + 1 } }));
    expect(currentCounter()).toBe(1);
  });
});

describe("parity with updateDoc", () => {
  it("refuses with 423 when the other party holds the edit lock", async () => {
    expect((await acquire(docId, "agent")).status).toBe(201);
    const before = ws.read(docPath);
    const head = ws.head();
    let ran = 0;

    const refused = await context
      .mutateDoc("user", docId, (doc) => {
        ran += 1;
        return { extra: { counter: counterOf(doc) + 1 } };
      })
      .catch((error: unknown) => error);

    // The refusal is the write's, so the recompute may already have happened —
    // which is exactly why the contract requires the callback to be pure.
    expect(ran).toBe(1);
    expect(refused).toBeInstanceOf(HttpError);
    const error = refused as HttpError;
    expect(error.status).toBe(423);
    // The body is the same `LockedError` a `PUT` is refused with, so a plugin
    // route that lets it through answers exactly what a core route answers.
    expect(LockedErrorSchema.parse(error.body).lock.holder).toBe("agent");
    expect(ws.read(docPath)).toBe(before);
    expect(ws.head()).toBe(head);
  });

  it("lets the lock's own holder through", async () => {
    expect((await acquire(docId, "agent")).status).toBe(201);
    await context.mutateDoc("agent", docId, (doc) => ({
      extra: { counter: counterOf(doc) + 1 },
    }));
    expect(currentCounter()).toBe(1);
  });

  it("refuses a patch the update schema rejects, the way updateDoc refuses one", async () => {
    await expect(
      // A core key smuggled through `extra` — `updateDoc`'s own 400.
      context.mutateDoc("user", docId, () => ({ extra: { id: "doc_hijack" } })),
    ).rejects.toMatchObject({ status: 400 });
    expect(currentCounter()).toBe(0);
  });

  it("raises the not-found getDoc raises, from inside the lane", async () => {
    await expect(context.mutateDoc("user", "doc_missing", () => ({}))).rejects.toMatchObject({
      status: 404,
    });
  });

  it("takes the commit-skip path for a no-op patch, like updateDoc with the same payload", async () => {
    const head = ws.head();
    keys.length = 0;
    const doc = await context.mutateDoc("user", docId, (current) => ({
      extra: { counter: counterOf(current) },
    }));
    expect(counterOf(doc)).toBe(0);
    expect(ws.head()).toBe(head);
    expect(keys).toEqual([]);
  });

  it("goes through the core write path — commit, projection, core keys", async () => {
    keys.length = 0;
    ws.advance(600_000); // past §4's squash window, so the write gets its own commit
    const doc = await context.mutateDoc("agent", docId, (current) => ({
      body: "recomputed by the plugin",
      // SPEC.md §7: a body-replacing write presents the key of the version it
      // recomputed from — here, the document the lane just handed the callback,
      // which is by construction the one this write is about to overwrite.
      key: current.key,
      extra: { counter: counterOf(current) + 41 },
    }));

    expect(counterOf(doc)).toBe(41);
    expect(ws.read(docPath)).toContain("recomputed by the plugin");
    expect(ws.log("%an %s")[0]).toContain("agent");
    expect(ws.log("%an %s")[0]).toContain(`doc edit: Tally (${docId})`);
    // Re-projected before resolving: the collection query sees it immediately.
    const listed = await ws.request(`/api/docs/${docId}`, { headers: AUTH });
    expect(((await listed.json()) as { body: string }).body).toBe("recomputed by the plugin");
    // Core keys only — a plugin's own keys stay the plugin's to broadcast.
    expect(keys).toEqual([[["docs"], ["docs", docId]]]);
  });
});

describe("the lane it takes is the document's own", () => {
  it("is the very lane a core write uses — a mutation queued behind one waits", async () => {
    // Held directly, so the ordering is decided by the test rather than by
    // timing: nothing else can enter `docId`'s lane until `release` is called.
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    void mutex.run(docId, () => held);

    let entered = false;
    const mutated = context.mutateDoc("user", docId, (doc) => {
      entered = true;
      return { extra: { counter: counterOf(doc) + 1 } };
    });

    // Several turns of the microtask queue: if the read were outside the lane it
    // would have happened by now.
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
    expect(entered).toBe(false);

    release();
    await mutated;
    expect(entered).toBe(true);
    expect(currentCounter()).toBe(1);
  });
});
