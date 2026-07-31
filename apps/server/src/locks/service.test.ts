import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LockSchema, type QueryKey } from "@corpus/contract";
import { createWorkspace, type Workspace } from "../docs/corpus-fixture.js";
import { HttpError } from "../errors.js";
import { createLogger } from "../logger.js";
import { createProjectionQueueMirror } from "../projection/index.js";
import { createQueueService, type QueueService } from "../queue/index.js";
import { createRecordingCommitter, type RecordingCommitter } from "./git-fixture.js";
import {
  TRAILER_LOCK_HOLDER,
  createLockService,
  forceBreakSubject,
  type LockService,
} from "./service.js";
import { StoredLockSchema, type StoredLock } from "./store.js";

const DOC = "doc_a1b2c3";
const OTHER = "doc_other1";
const START = Date.parse("2026-07-27T09:00:00Z");

let ws: Workspace;
let queue: QueueService;
let locks: LockService;
let clock: number;
let git: RecordingCommitter;
let keys: QueryKey[];

const lockFile = (docId: string): string => join(ws.config.corpusDir, "locks", `${docId}.json`);

const readLockFile = (docId: string): StoredLock =>
  StoredLockSchema.parse(JSON.parse(readFileSync(lockFile(docId), "utf8")));

const lockRows = (): unknown[] =>
  ws.db.prepare("SELECT doc_id, holder, acquired, ttl FROM locks ORDER BY doc_id").all();

/**
 * One claimed event, deferred on `docId` — the SERVER-030 shape of "the agent
 * tried the edit, the user holds the lock, the work waits".
 */
const defer = async (docId: string): Promise<{ id: string }> => {
  const event = await queue.enqueue({ type: "comment.created", source: "ui", payload: {} });
  await queue.claimAll();
  return queue.defer(event.id, { blockedOn: docId });
};

const expectHttpError = async (work: Promise<unknown>, status: number): Promise<HttpError> => {
  const error: unknown = await work.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(HttpError);
  const httpError = error as HttpError;
  expect(httpError.status).toBe(status);
  return httpError;
};

beforeEach(() => {
  ws = createWorkspace("s009-locksvc");
  ws.doc({ id: DOC, title: "Mortgage options" });
  ws.doc({ id: OTHER, title: "Other" });
  ws.reproject();

  clock = START;
  git = createRecordingCommitter();
  keys = [];
  queue = createQueueService({
    corpusDir: ws.config.corpusDir,
    mirror: createProjectionQueueMirror(ws.db),
    // The same sink the lock service writes to, as in `app.ts` where both hold
    // the one invalidation bus: a lock release that re-enters deferred work has
    // to produce the lock keys *and* the queue keys, in one observable stream.
    invalidate: (invalidated) => keys.push(...invalidated),
    now: () => clock,
  });
  locks = createLockService({
    corpusDir: ws.config.corpusDir,
    projection: ws.db,
    queue,
    git,
    invalidate: (invalidated) => keys.push(...invalidated),
    now: () => clock,
  });
});

afterEach(() => {
  queue.close();
  ws.close();
});

describe("acquire", () => {
  it("writes the file, projects the row and announces the document's key", async () => {
    const lock = await locks.acquire(DOC, "agent");

    expect(lock).toEqual({
      docId: DOC,
      holder: "agent",
      acquired: "2026-07-27T09:00:00Z",
      ttl: 300,
    });
    expect(LockSchema.parse(lock)).toEqual(lock);
    expect(readLockFile(DOC)).toEqual(lock);
    expect(lockRows()).toEqual([
      { doc_id: DOC, holder: "agent", acquired: "2026-07-27T09:00:00Z", ttl: 300 },
    ]);
    // The document's own key too, so the banner appears everywhere it is visible.
    expect(keys).toEqual([["locks"], ["locks", DOC], ["docs", DOC]]);
  });

  it("renews rather than conflicting when the same party asks again", async () => {
    await locks.acquire(DOC, "agent");
    clock += 120_000;

    const renewed = await locks.acquire(DOC, "agent");

    expect(renewed.acquired).toBe("2026-07-27T09:02:00Z");
    expect(readLockFile(DOC).acquired).toBe("2026-07-27T09:02:00Z");
  });

  it("refuses the other party with a 409 that carries the live lock", async () => {
    await locks.acquire(DOC, "agent");

    const error = await expectHttpError(locks.acquire(DOC, "user"), 409);

    expect(error.body).toMatchObject({ code: "conflict", lock: { docId: DOC, holder: "agent" } });
    // The loser did not steal the lease.
    expect(readLockFile(DOC).holder).toBe("agent");
  });

  it("treats an expired lease as absent, without waiting for the reaper", async () => {
    await locks.acquire(DOC, "agent", 1);
    clock += 2000;

    const taken = await locks.acquire(DOC, "user");

    expect(taken.holder).toBe("user");
  });

  it("clamps a lease longer than the maximum and honours a short one", async () => {
    expect((await locks.acquire(DOC, "agent", 86_400)).ttl).toBe(1800);
    expect((await locks.acquire(OTHER, "agent", 30)).ttl).toBe(30);
  });

  it("refuses a document the projection does not know", async () => {
    const error = await expectHttpError(locks.acquire("doc_zzzzzzzz", "agent"), 404);

    expect(error.body.code).toBe("not_found");
    expect(existsSync(lockFile("doc_zzzzzzzz"))).toBe(false);
  });

  it("produces exactly one winner when two parties race, every round", async () => {
    for (let round = 0; round < 20; round += 1) {
      const docId = round % 2 === 0 ? DOC : OTHER;
      await locks.release(docId, "agent").catch(() => undefined);
      await locks.release(docId, "user").catch(() => undefined);

      const outcomes = await Promise.allSettled([
        locks.acquire(docId, "agent"),
        locks.acquire(docId, "user"),
      ]);
      const winners = outcomes.filter((outcome) => outcome.status === "fulfilled");

      expect(winners).toHaveLength(1);
      const winner = winners[0];
      const holder =
        winner !== undefined && winner.status === "fulfilled" ? winner.value.holder : undefined;
      expect(readLockFile(docId).holder).toBe(holder);
    }
  });

  it("leaves work deferred on the document alone: a lock that is still held clears nothing", async () => {
    // The predecessor of this test asserted that a lock *file* carried the
    // deferred event across a renewal (`deferredEventId`, retired by
    // SERVER-030). The deferral now lives on the event, so the property worth
    // pinning is the one that matters: acquiring or renewing a lock — user or
    // agent — never re-enters deferred work. Only clearing it does.
    const event = await defer(DOC);

    await locks.acquire(DOC, "user", 1);
    expect(await queue.store.locate(event.id)).toBe("deferred");

    await locks.acquire(DOC, "user");
    expect(await queue.store.locate(event.id)).toBe("deferred");

    clock += 400_000;
    await locks.acquire(DOC, "agent");
    expect(await queue.store.locate(event.id)).toBe("deferred");
  });
});

describe("list and liveLock", () => {
  it("reports live locks only", async () => {
    await locks.acquire(DOC, "agent", 1);
    await locks.acquire(OTHER, "user");
    clock += 2000;

    const listed = await locks.list();

    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual({
      docId: OTHER,
      holder: "user",
      acquired: "2026-07-27T09:00:00Z",
      ttl: 300,
    });
    // The expired file is still there; the list simply does not believe it.
    expect(existsSync(lockFile(DOC))).toBe(true);
    // And the row it left behind is gone: a lease expires by the passage of
    // time, so nothing else would ever retire it.
    expect(lockRows()).toEqual([
      { doc_id: OTHER, holder: "user", acquired: "2026-07-27T09:00:00Z", ttl: 300 },
    ]);
    expect(await locks.liveLock(DOC)).toBeUndefined();
    expect(await locks.liveLock(OTHER)).toMatchObject({ holder: "user" });
  });
});

describe("release", () => {
  it("lets only the holder release, and 403s everybody else", async () => {
    await locks.acquire(DOC, "agent");

    const error = await expectHttpError(locks.release(DOC, "user"), 403);
    expect(error.body.code).toBe("forbidden");
    expect(readLockFile(DOC).holder).toBe("agent");

    expect(await locks.release(DOC, "agent")).toBe("agent");
    expect(existsSync(lockFile(DOC))).toBe(false);
    expect(lockRows()).toEqual([]);
  });

  it("404s an absent lock rather than pretending to release one", async () => {
    const error = await expectHttpError(locks.release(DOC, "agent"), 404);

    expect(error.body.code).toBe("not_found");
  });

  it("releases an expired lease it still holds the file for", async () => {
    await locks.acquire(DOC, "agent", 1);
    clock += 2000;

    expect(await locks.release(DOC, "agent")).toBe("agent");
    expect(existsSync(lockFile(DOC))).toBe(false);
  });

  it("re-enters the work deferred on the document, with no retry call", async () => {
    // SPEC.md §7: deferred work "applies when the lock clears" — automatically,
    // which is the property that retires the interim fail-and-retry protocol.
    const event = await defer(DOC);
    const elsewhere = await defer(OTHER);
    await locks.acquire(DOC, "user");
    keys.length = 0;

    expect(await locks.release(DOC, "user")).toBe("user");

    expect(await queue.store.locate(event.id)).toBe("pending");
    expect(await queue.store.locate(elsewhere.id)).toBe("deferred");
    // Both halves of the frame set: the lock keys the release itself touches,
    // and the queue/jobs/docs keys the re-entry does.
    expect(keys).toEqual([["locks"], ["locks", DOC], ["docs", DOC], ["queue"], ["jobs"], ["docs"]]);
  });

  it("announces nothing extra when there is no deferred work behind the lock", async () => {
    await locks.acquire(DOC, "user");
    keys.length = 0;

    await locks.release(DOC, "user");

    expect(keys).toEqual([["locks"], ["locks", DOC], ["docs", DOC]]);
  });
});

describe("forceBreak", () => {
  it("is user-only", async () => {
    await locks.acquire(DOC, "user");

    const error = await expectHttpError(locks.forceBreak(DOC, "agent"), 403);

    expect(error.body.code).toBe("forbidden");
    expect(existsSync(lockFile(DOC))).toBe(true);
    expect(git.commits).toEqual([]);
  });

  it("clears any holder and records the break in the audit trail", async () => {
    await locks.acquire(DOC, "agent");

    const result = await locks.forceBreak(DOC, "user");

    expect(result).toEqual({ holder: "agent", requeuedEventIds: [] });
    expect(existsSync(lockFile(DOC))).toBe(false);
    expect(lockRows()).toEqual([]);
    // `.corpus/` is gitignored, so the entry stages nothing and has to be an
    // explicit empty commit — and it is its own event, never folded into the
    // editing session that preceded it.
    expect(git.commits).toEqual([
      {
        docId: DOC,
        actor: "user",
        subject: forceBreakSubject(DOC, "agent"),
        paths: [],
        trailers: [`${TRAILER_LOCK_HOLDER}: agent`],
        allowEmpty: true,
        squash: false,
      },
    ]);
  });

  it("404s an absent lock and makes no empty commit", async () => {
    const error = await expectHttpError(locks.forceBreak(DOC, "user"), 404);

    expect(error.body.code).toBe("not_found");
    expect(git.commits).toEqual([]);
  });

  it("re-enqueues the deferred edit rather than losing it", async () => {
    const event = await defer(DOC);
    expect(await queue.store.locate(event.id)).toBe("deferred");
    await locks.acquire(DOC, "agent");

    const result = await locks.forceBreak(DOC, "user");

    expect(result.requeuedEventIds).toEqual([event.id]);
    expect(await queue.store.locate(event.id)).toBe("pending");
    expect((await queue.status()).pending).toBe(1);
  });

  it("still breaks when nothing was deferred behind the lock", async () => {
    await locks.acquire(DOC, "agent");

    const result = await locks.forceBreak(DOC, "user");

    expect(result).toEqual({ holder: "agent", requeuedEventIds: [] });
    expect(existsSync(lockFile(DOC))).toBe(false);
  });

  it("breaks the lock even when the audit commit cannot be made", async () => {
    git.setOutcome({ kind: "skipped", reason: "the workspace is not a git repository" });
    await locks.acquire(DOC, "agent");

    // The lock is already gone by the time git is asked; a workspace without a
    // repository stays fully usable, and only the audit entry is lost.
    expect(await locks.forceBreak(DOC, "user")).toMatchObject({ holder: "agent" });
    expect(existsSync(lockFile(DOC))).toBe(false);
  });

  it("reports a refused audit commit loudly, with what git said", async () => {
    const lines: string[] = [];
    const loud = createLockService({
      corpusDir: ws.config.corpusDir,
      projection: ws.db,
      queue,
      git,
      logger: createLogger("silent", { write: (line) => lines.push(line) }),
      now: () => clock,
    });
    git.setOutcome({ kind: "failed", reason: "git commit failed", output: "hook said no" });
    await loud.acquire(DOC, "agent");

    await loud.forceBreak(DOC, "user");

    // SPEC.md §14: the failure surfaces, the break stands.
    expect(existsSync(lockFile(DOC))).toBe(false);
    const entry = lines.map((line) => JSON.parse(line) as Record<string, unknown>).at(-1);
    expect(entry).toMatchObject({
      level: "error",
      docId: DOC,
      previousHolder: "agent",
      reason: "git commit failed",
      output: "hook said no",
    });
  });
});

describe("reap", () => {
  it("removes expired leases only, and reports which documents were freed", async () => {
    await locks.acquire(DOC, "agent", 1);
    await locks.acquire(OTHER, "user", 600);
    clock += 2000;
    keys.length = 0;

    expect(await locks.reap()).toEqual([DOC]);
    expect(existsSync(lockFile(DOC))).toBe(false);
    expect(existsSync(lockFile(OTHER))).toBe(true);
    expect(keys).toEqual([["locks"], ["locks", DOC], ["docs", DOC]]);

    // A second reap has nothing to do, and says so without a broadcast.
    keys.length = 0;
    expect(await locks.reap()).toEqual([]);
    expect(keys).toEqual([]);
  });

  it("re-enters work deferred on a lease it reaps — the crashed-editor path", async () => {
    const event = await defer(DOC);
    const elsewhere = await defer(OTHER);
    await locks.acquire(DOC, "user", 1);
    await locks.acquire(OTHER, "user", 600);
    clock += 2000;

    expect(await locks.reap()).toEqual([DOC]);

    // Nobody released this lock and nobody broke it; it simply ran out. §7 asks
    // for automatic re-entry on all three ways a lock can clear.
    expect(await queue.store.locate(event.id)).toBe("pending");
    expect(await queue.store.locate(elsewhere.id)).toBe("deferred");
  });

  it("re-enters each event exactly once across a release and a later reap", async () => {
    const first = await defer(DOC);
    const second = await defer(DOC);
    await locks.acquire(DOC, "user", 1);

    await locks.release(DOC, "user");
    clock += 2000;
    await locks.reap();

    expect(await queue.store.listIds("pending")).toHaveLength(2);
    expect(await queue.store.listIds("deferred")).toEqual([]);
    expect(await queue.store.locate(first.id)).toBe("pending");
    expect(await queue.store.locate(second.id)).toBe("pending");
  });
});
