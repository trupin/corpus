import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QUEUE_EVENT_STATUSES, QueueEventSchema } from "@corpus/contract";
import {
  MALFORMED_EVENT_TYPE,
  MAX_SALVAGED_BYTES,
  parseEventFile,
  QueueStore,
  salvageEvent,
  toWireEvent,
  type StoredEvent,
} from "./store.js";

let root: string;
let store: QueueStore;

const event = (overrides: Partial<StoredEvent> = {}): StoredEvent => ({
  id: "evt_aaaaaaaaaaaa",
  type: "comment.created",
  created: "2026-07-19T10:05:01Z",
  source: "ui",
  payload: { threadId: "th_x9y8" },
  status: "pending",
  ...overrides,
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s008-"));
  store = new QueueStore(join(root, ".corpus"));
  store.ensureLayoutSync();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("ensureLayoutSync", () => {
  it("creates the five status directories, and is idempotent", () => {
    store.ensureLayoutSync();
    expect(readdirSync(store.queueDir).sort()).toEqual([...QUEUE_EVENT_STATUSES].sort());
  });
});

describe("writeEvent", () => {
  it("writes the §7 shape at .corpus/queue/<status>/<id>.json", async () => {
    await store.writeEvent("pending", event());

    const raw: unknown = JSON.parse(
      readFileSync(store.pathFor("pending", "evt_aaaaaaaaaaaa"), "utf8"),
    );
    expect(QueueEventSchema.safeParse(raw).success).toBe(true);
    expect(raw).toMatchObject({
      id: "evt_aaaaaaaaaaaa",
      type: "comment.created",
      created: "2026-07-19T10:05:01Z",
      source: "ui",
      payload: { threadId: "th_x9y8" },
      status: "pending",
    });
  });

  it("stamps the status of the directory it writes into, whatever the event says", async () => {
    await store.writeEvent("failed", event({ status: "pending" }));
    const read = await store.readEvent("failed", "evt_aaaaaaaaaaaa");
    expect(read?.ok === true && read.event.status).toBe("failed");
  });

  it("leaves no temp file behind, so a reader never sees a partial write", async () => {
    await Promise.all(
      Array.from({ length: 50 }, (_unused, index) =>
        store.writeEvent("pending", event({ id: `evt_${String(index).padStart(12, "0")}` })),
      ),
    );

    const names = readdirSync(store.dirFor("pending"));
    expect(names.filter((name) => name.startsWith(".tmp-"))).toEqual([]);
    expect(names).toHaveLength(50);
    for (const name of names) {
      expect(() => {
        JSON.parse(readFileSync(join(store.dirFor("pending"), name), "utf8"));
      }).not.toThrow();
    }
  });
});

describe("listIds", () => {
  it("counts evt_*.json only — .gitkeep and temp files are not events", async () => {
    await store.writeEvent("pending", event());
    writeFileSync(join(store.dirFor("pending"), ".gitkeep"), "");
    writeFileSync(join(store.dirFor("pending"), ".tmp-evt_x-1234.json"), "{}");
    writeFileSync(join(store.dirFor("pending"), "notes.md"), "hello");

    expect(await store.listIds("pending")).toEqual(["evt_aaaaaaaaaaaa"]);
    expect(store.listIdsSync("pending")).toEqual(["evt_aaaaaaaaaaaa"]);
    expect(await store.countPending()).toBe(1);
  });

  it("reads a missing directory as empty rather than throwing", async () => {
    const missing = new QueueStore(join(root, "nowhere"));
    expect(await missing.listIds("pending")).toEqual([]);
    expect(missing.listIdsSync("pending")).toEqual([]);
  });
});

describe("readEvent", () => {
  it("is undefined for an id that is not there", async () => {
    expect(await store.readEvent("pending", "evt_missing00000")).toBeUndefined();
    expect(store.readEventSync("pending", "evt_missing00000")).toBeUndefined();
  });

  it("normalizes a hand-written timestamp in memory", async () => {
    writeFileSync(
      store.pathFor("pending", "evt_bbbbbbbbbbbb"),
      JSON.stringify({
        id: "evt_bbbbbbbbbbbb",
        type: "comment.created",
        created: "2026-07-19 10:05+02:00",
        source: "cli",
        payload: {},
      }),
    );

    const read = await store.readEvent("pending", "evt_bbbbbbbbbbbb");
    expect(read?.ok === true && read.event.created).toBe("2026-07-19T08:05:00Z");
  });

  it("addresses by path: the file name wins over a disagreeing id field", () => {
    writeFileSync(
      store.pathFor("processed", "evt_cccccccccccc"),
      JSON.stringify({ ...event(), id: "evt_somethingelse" }),
    );

    const read = store.readEventSync("processed", "evt_cccccccccccc");
    expect(read?.ok === true && read.event.id).toBe("evt_cccccccccccc");
    expect(read?.ok === true && read.event.status).toBe("processed");
  });
});

describe("parseEventFile", () => {
  it.each([
    ["not JSON at all", "{ truncated", /not JSON/],
    ["a JSON array", "[1,2,3]", /not a JSON object/],
    ["a JSON scalar", '"hello"', /not a JSON object/],
    [
      "an event missing type",
      '{"created":"2026-07-19T10:05:01Z","source":"ui","payload":{}}',
      /type/,
    ],
    [
      "an unparseable created",
      '{"type":"x","created":"yesterday","source":"ui","payload":{}}',
      /created/,
    ],
  ])("rejects %s", (_label, text, reason) => {
    const result = parseEventFile(text, "evt_dddddddddddd", "pending");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(reason);
    expect(result.ok === false && result.text).toBe(text);
  });

  it("keeps the transition bookkeeping the server wrote", () => {
    const result = parseEventFile(
      JSON.stringify({ ...event(), attempts: 2, error: "boom", updated: "2026-07-19T11:00:00Z" }),
      "evt_aaaaaaaaaaaa",
      "in-progress",
    );
    expect(result.ok === true && result.event).toMatchObject({
      attempts: 2,
      error: "boom",
      updated: "2026-07-19T11:00:00Z",
      status: "in-progress",
    });
  });
});

describe("salvageEvent", () => {
  it("quarantines the evidence, capped", () => {
    const salvaged = salvageEvent(
      "evt_eeeeeeeeeeee",
      "not JSON",
      "x".repeat(20_000),
      "2026-07-19T10:05:01Z",
    );
    expect(salvaged.type).toBe(MALFORMED_EVENT_TYPE);
    expect(salvaged.status).toBe("failed");
    expect(salvaged.error).toMatch(/malformed event file: not JSON/);
    expect(String(salvaged.payload.raw)).toHaveLength(MAX_SALVAGED_BYTES);
    expect(QueueEventSchema.safeParse(toWireEvent(salvaged)).success).toBe(true);
  });
});

describe("move and locate", () => {
  it("renames between directories and reports where an event lives", async () => {
    await store.writeEvent("pending", event());
    expect(await store.locate("evt_aaaaaaaaaaaa")).toBe("pending");

    expect(await store.move("pending", "in-progress", "evt_aaaaaaaaaaaa")).toBe(true);
    expect(await store.locate("evt_aaaaaaaaaaaa")).toBe("in-progress");
    expect(await store.listIds("pending")).toEqual([]);
  });

  it("reports a lost race as false, not as an error", async () => {
    expect(await store.move("pending", "in-progress", "evt_ffffffffffff")).toBe(false);
    expect(await store.locate("evt_ffffffffffff")).toBeUndefined();
  });

  it("treats a move onto itself as a no-op success", async () => {
    await store.writeEvent("pending", event());
    expect(await store.move("pending", "pending", "evt_aaaaaaaaaaaa")).toBe(true);
    expect(await store.listIds("pending")).toEqual(["evt_aaaaaaaaaaaa"]);
  });
});

describe("lastTouched", () => {
  it("takes the earliest evidence, so neither clock can hide a stuck event", async () => {
    await store.writeEvent("in-progress", event({ status: "in-progress" }));
    const backdated = await store.lastTouched(
      "in-progress",
      event({ status: "in-progress", updated: "2020-01-01T00:00:00Z" }),
    );
    expect(backdated).toBe(Date.parse("2020-01-01T00:00:00Z"));
  });

  it("falls back to the file when the event carries no updated field", async () => {
    await store.writeEvent("in-progress", event({ status: "in-progress" }));
    const touched = await store.lastTouched("in-progress", event({ status: "in-progress" }));
    expect(touched).toBeGreaterThan(Date.now() - 60_000);
  });

  it("is 0 when neither the file nor the field says anything", async () => {
    expect(await store.lastTouched("in-progress", event())).toBe(0);
  });
});

describe("failures that are not a missing file", () => {
  // A regular file where `.corpus/` belongs makes every syscall fail with
  // ENOTDIR: the store must surface those, not read them as "nothing there".
  const brokenStore = (): QueueStore => {
    const path = join(root, "not-a-directory");
    writeFileSync(path, "");
    return new QueueStore(path);
  };

  it("propagates them rather than reporting an empty queue", async () => {
    const broken = brokenStore();

    await expect(broken.listIds("pending")).rejects.toThrow();
    expect(() => broken.listIdsSync("pending")).toThrow();
    await expect(broken.readEvent("pending", "evt_aaaaaaaaaaaa")).rejects.toThrow();
    expect(() => broken.readEventSync("pending", "evt_aaaaaaaaaaaa")).toThrow();
    await expect(broken.writeEvent("pending", event())).rejects.toThrow();
    await expect(broken.move("pending", "failed", "evt_aaaaaaaaaaaa")).rejects.toThrow();
    await expect(broken.locate("evt_aaaaaaaaaaaa")).rejects.toThrow();
    await expect(broken.lastTouched("pending", event())).rejects.toThrow();
  });

  it("propagates them from the halt sentinel too", async () => {
    const broken = brokenStore();

    await expect(broken.isHalted()).rejects.toThrow();
    expect(() => broken.isHaltedSync()).toThrow();
    await expect(broken.writeHalt({ at: "2026-07-19T10:05:01Z" })).rejects.toThrow();
    await expect(broken.clearHalt()).rejects.toThrow();
  });
});

describe("the HALT sentinel", () => {
  it("writes, reports and clears, idempotently", async () => {
    expect(await store.isHalted()).toBe(false);
    expect(store.isHaltedSync()).toBe(false);

    await store.writeHalt({ at: "2026-07-19T10:05:01Z" });
    await store.writeHalt({ at: "2026-07-19T10:06:01Z", reason: "deploying" });
    expect(await store.isHalted()).toBe(true);
    expect(store.isHaltedSync()).toBe(true);
    expect(JSON.parse(readFileSync(store.haltPath, "utf8"))).toEqual({
      at: "2026-07-19T10:06:01Z",
      reason: "deploying",
    });

    await store.clearHalt();
    await store.clearHalt();
    expect(await store.isHalted()).toBe(false);
  });
});
