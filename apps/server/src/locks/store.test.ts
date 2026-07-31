import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LOCK_TTL_SECONDS, LockSchema } from "@corpus/contract";
import {
  LockStore,
  MAX_LOCK_TTL_SECONDS,
  StoredLockSchema,
  clampTtl,
  expiresAtMs,
  isExpired,
  toWireLock,
  type StoredLock,
} from "./store.js";

let root: string;
let corpusDir: string;
let store: LockStore;

const ACQUIRED = "2026-07-27T09:00:00Z";
const AT = Date.parse(ACQUIRED);

const lock = (overrides: Partial<StoredLock> = {}): StoredLock => ({
  docId: "doc_a1b2c3",
  holder: "agent",
  acquired: ACQUIRED,
  ttl: 300,
  ...overrides,
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s009-lockstore-"));
  corpusDir = join(root, ".corpus");
  store = new LockStore(corpusDir);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("clampTtl", () => {
  it("defaults to the contract's documented lease", () => {
    expect(clampTtl(undefined)).toBe(DEFAULT_LOCK_TTL_SECONDS);
    expect(DEFAULT_LOCK_TTL_SECONDS).toBe(300);
  });

  it("honours a shorter lease and clamps an unbounded one", () => {
    // No lower clamp: `AcquireLockRequestSchema`'s `.min(1)` is the floor, and a
    // deliberately short lease is a legitimate ask (a test, a probe, a handoff).
    expect(clampTtl(1)).toBe(1);
    expect(clampTtl(30)).toBe(30);
    expect(clampTtl(MAX_LOCK_TTL_SECONDS)).toBe(MAX_LOCK_TTL_SECONDS);
    expect(clampTtl(86_400)).toBe(MAX_LOCK_TTL_SECONDS);
  });
});

describe("expiry", () => {
  it("is evaluated against the lease, exclusive of its final instant", () => {
    expect(isExpired(lock(), AT)).toBe(false);
    expect(isExpired(lock(), AT + 299_999)).toBe(false);
    expect(isExpired(lock(), AT + 300_000)).toBe(true);
    expect(expiresAtMs(lock())).toBe(AT + 300_000);
  });

  it("reads an undateable lease as expired rather than eternal", () => {
    // Reachable only for a hand-written file; the safe answer is the one that
    // cannot wedge a document.
    expect(isExpired(lock({ acquired: "whenever" }), AT)).toBe(true);
  });
});

describe("toWireLock", () => {
  it("names the four contract fields, so nothing server-internal can ride out", () => {
    // Spelled field by field rather than spread, which is what keeps a future
    // runtime-only field off every response by construction — the property the
    // retired `deferredEventId` used to exercise (SERVER-030).
    const wire = toWireLock(lock());

    expect(Object.keys(wire).sort()).toEqual(["acquired", "docId", "holder", "ttl"]);
    expect(LockSchema.parse(wire)).toEqual(wire);
  });
});

describe("LockStore", () => {
  it("writes atomically and leaves no temp file behind", async () => {
    await store.write(lock());

    const path = join(corpusDir, "locks", "doc_a1b2c3.json");
    expect(StoredLockSchema.parse(JSON.parse(readFileSync(path, "utf8")))).toEqual(lock());
    expect(readdirSync(join(corpusDir, "locks"))).toEqual(["doc_a1b2c3.json"]);
  });

  it("reads a lock file left behind by an older build, dropping the retired field", async () => {
    // `deferredEventId` was the pre-SERVER-030 way of remembering a deferred
    // edit; the deferral now lives on the event (`blockedOn`). A workspace that
    // was running the old build still has such files on disk, and they must
    // keep working: the key is dropped, never a reason to refuse the lock.
    store.ensureLayoutSync();
    writeFileSync(
      join(corpusDir, "locks", "doc_a1b2c3.json"),
      JSON.stringify({ ...lock(), deferredEventId: "evt_7c1d" }),
      "utf8",
    );

    const stored = await store.read("doc_a1b2c3");

    expect(stored).toEqual(lock());
    expect(stored).not.toHaveProperty("deferredEventId");
    expect(toWireLock(stored as StoredLock)).toEqual(lock());
  });

  it("reads an absent, unparseable or malformed lock as no lock at all", async () => {
    expect(await store.read("doc_a1b2c3")).toBeUndefined();

    store.ensureLayoutSync();
    writeFileSync(join(corpusDir, "locks", "doc_a1b2c3.json"), "{oops", "utf8");
    expect(await store.read("doc_a1b2c3")).toBeUndefined();

    writeFileSync(join(corpusDir, "locks", "doc_a1b2c3.json"), '{"holder":"nobody"}', "utf8");
    expect(await store.read("doc_a1b2c3")).toBeUndefined();
  });

  it("corrects a docId that disagrees with the filename", async () => {
    store.ensureLayoutSync();
    writeFileSync(
      join(corpusDir, "locks", "doc_a1b2c3.json"),
      JSON.stringify(lock({ docId: "doc_somethingelse" })),
      "utf8",
    );

    // The path is the addressing the API uses; a file that claims otherwise is
    // read as its path says, never as its field claims.
    expect((await store.read("doc_a1b2c3"))?.docId).toBe("doc_a1b2c3");
  });

  it("hides an expired lease from `readLive` without touching the file", async () => {
    await store.write(lock({ ttl: 1 }));

    expect(await store.readLive("doc_a1b2c3", AT)).toMatchObject({ holder: "agent" });
    expect(await store.readLive("doc_a1b2c3", AT + 2000)).toBeUndefined();
    expect(await store.read("doc_a1b2c3")).toBeDefined();
  });

  it("removes idempotently", async () => {
    await store.write(lock());

    expect(await store.remove("doc_a1b2c3")).toBe(true);
    expect(await store.remove("doc_a1b2c3")).toBe(false);
  });

  it("lists only `<documentId>.json`, and nothing when the directory is absent", async () => {
    expect(await store.listAll()).toEqual([]);

    await store.write(lock());
    await store.write(lock({ docId: "th_x9y8", holder: "user" }));
    writeFileSync(join(corpusDir, "locks", "notes.json"), "{}", "utf8");
    writeFileSync(join(corpusDir, "locks", "doc_bad.txt"), "{}", "utf8");

    expect((await store.listAll()).map((entry) => entry.docId)).toEqual(["doc_a1b2c3", "th_x9y8"]);
  });

  it("registers the bytes it is about to write, and the removal, with the observer", async () => {
    const observed: [string, string | null][] = [];
    const observing = new LockStore(corpusDir, (path, content) => {
      observed.push([path, content]);
    });

    await observing.write(lock());
    await observing.remove("doc_a1b2c3");

    const path = join(corpusDir, "locks", "doc_a1b2c3.json");
    expect(observed.map(([target]) => target)).toEqual([path, path]);
    // Registered *before* the rename, so the watcher cannot see the file first.
    expect(observed[0]?.[1]).toContain('"holder": "agent"');
    expect(observed[1]?.[1]).toBeNull();
  });
});
