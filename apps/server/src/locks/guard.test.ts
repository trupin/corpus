import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ACTOR_HEADER, LockedErrorSchema } from "@corpus/contract";
import { createWorkspace, type Workspace } from "../docs/corpus-fixture.js";
import { HttpError } from "../errors.js";
import { createProjectionQueueMirror } from "../projection/index.js";
import { createQueueService, type QueueService } from "../queue/index.js";
import { createRecordingCommitter } from "./git-fixture.js";
import { actorFromRequest, createLockGuard, createLockGuardMiddleware } from "./guard.js";
import { createLockService, type LockService } from "./service.js";

const DOC = "doc_a1b2c3";
const START = Date.parse("2026-07-27T09:00:00Z");

let ws: Workspace;
let queue: QueueService;
let locks: LockService;
let clock: number;

beforeEach(() => {
  ws = createWorkspace("s009-guard");
  ws.doc({ id: DOC });
  ws.reproject();
  clock = START;
  queue = createQueueService({
    corpusDir: ws.config.corpusDir,
    mirror: createProjectionQueueMirror(ws.db),
    now: () => clock,
  });
  locks = createLockService({
    corpusDir: ws.config.corpusDir,
    projection: ws.db,
    queue,
    git: createRecordingCommitter(),
    now: () => clock,
  });
});

afterEach(() => {
  queue.close();
  ws.close();
});

describe("actorFromRequest", () => {
  it("reads the shipped header and defaults to the user", () => {
    expect(actorFromRequest("agent")).toBe("agent");
    expect(actorFromRequest(" AGENT ")).toBe("agent");
    expect(actorFromRequest("user")).toBe("user");
    expect(actorFromRequest(undefined)).toBe("user");
    // An unrecognised value is not an error: this API rejects no request for the
    // headers it carries, it just reads the default.
    expect(actorFromRequest("robot")).toBe("user");
  });
});

describe("assertWritable", () => {
  it("passes when nothing holds the document", async () => {
    await expect(createLockGuard(locks).assertWritable(DOC, "user")).resolves.toBeUndefined();
  });

  it("passes for the holder's own writes", async () => {
    await locks.acquire(DOC, "agent");

    await expect(createLockGuard(locks).assertWritable(DOC, "agent")).resolves.toBeUndefined();
  });

  it("refuses the other party with a 423 naming the holder and the lease", async () => {
    await locks.acquire(DOC, "agent");

    const thrown: unknown = await createLockGuard(locks)
      .assertWritable(DOC, "user")
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(thrown).toBeInstanceOf(HttpError);
    const error = thrown as HttpError;
    expect(error.status).toBe(423);
    const body = LockedErrorSchema.parse(error.body);
    expect(body.code).toBe("locked");
    expect(body.message).toContain("agent");
    expect(body.lock).toEqual({
      docId: DOC,
      holder: "agent",
      acquired: "2026-07-27T09:00:00Z",
      ttl: 300,
    });
    // The shape carries no `expiresAt`: the contract's `LockedError` declares
    // four fields inside `lock`, and a caller derives the expiry from them.
    expect(Object.keys(body.lock).sort()).toEqual(["acquired", "docId", "holder", "ttl"]);
  });

  it("lets a write through once the lease has expired", async () => {
    await locks.acquire(DOC, "agent", 1);
    clock += 2000;

    await expect(createLockGuard(locks).assertWritable(DOC, "user")).resolves.toBeUndefined();
  });
});

describe("createLockGuardMiddleware", () => {
  const app = (): Hono => {
    const probe = new Hono();
    probe.use("/probe/:id", createLockGuardMiddleware(createLockGuard(locks)));
    probe.put("/probe/:id", (c) => c.json({ wrote: true }, 200));
    probe.put("/probe", (c) => c.json({ wrote: true }, 200));
    return probe;
  };

  it("refuses a write to a document the other party holds", async () => {
    await locks.acquire(DOC, "agent");

    const response = await app().request(`/probe/${DOC}`, {
      method: "PUT",
      headers: { [ACTOR_HEADER]: "user" },
    });

    expect(response.status).toBe(423);
    expect(LockedErrorSchema.parse(await response.json())).toMatchObject({ code: "locked" });
  });

  it("lets the holder through, and defaults an absent actor header to the user", async () => {
    await locks.acquire(DOC, "user");

    const asHolder = await app().request(`/probe/${DOC}`, { method: "PUT" });
    expect(asHolder.status).toBe(200);

    const asAgent = await app().request(`/probe/${DOC}`, {
      method: "PUT",
      headers: { [ACTOR_HEADER]: "agent" },
    });
    expect(asAgent.status).toBe(423);
  });

  it("stays out of the way when the path names no document", async () => {
    await locks.acquire(DOC, "agent");

    // Mounted on a path whose parameter is absent: validation has its own
    // opinion about that, and it is not the guard's to have.
    const guard = createLockGuardMiddleware(createLockGuard(locks), { param: "docId" });
    const probe = new Hono();
    probe.use("/probe/:id", guard);
    probe.put("/probe/:id", (c) => c.json({ wrote: true }, 200));

    const response = await probe.request(`/probe/${DOC}`, { method: "PUT" });

    expect(response.status).toBe(200);
  });
});
