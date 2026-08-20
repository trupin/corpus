import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QUEUE_EVENT_STATUSES, QueueEventSchema } from "@corpus/contract";
import {
  byQueueOrder,
  MALFORMED_EVENT_TYPE,
  MAX_SALVAGED_BYTES,
  parseEventFile,
  QueueStore,
  salvageEvent,
  toWireEvent,
  withoutDeferral,
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
  it("creates one directory per contract status, and is idempotent", () => {
    store.ensureLayoutSync();
    expect(readdirSync(store.queueDir).sort()).toEqual([...QUEUE_EVENT_STATUSES].sort());
  });

  // CONTRACT-021 added `deferred` to the status list, and a workspace scaffolded
  // before it existed must not need an upgrade step to gain the directory: boot
  // creates whatever is missing, and leaves the events already on disk alone.
  it("adds a status directory a pre-existing workspace never had", async () => {
    store.ensureLayoutSync();
    await store.writeEvent("pending", event());
    rmSync(store.dirFor("deferred"), { recursive: true, force: true });

    store.ensureLayoutSync();

    expect(readdirSync(store.queueDir).sort()).toEqual([...QUEUE_EVENT_STATUSES].sort());
    expect(await store.listIds("pending")).toHaveLength(1);
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

  // SERVER-131: `readdir` order is the filesystem's, and it is what let a claim
  // batch arrive in no particular order. This pins the guarantee rather than
  // reproducing a failure — APFS happens to list these names in order already,
  // so removing the sort leaves this green on a Mac and red wherever it is not.
  // The ordering that actually decides a batch is `byQueueOrder`, below.
  it("returns the ids sorted, whatever order the files were written in", async () => {
    for (const id of ["evt_ccccccccccc2", "evt_aaaaaaaaaaa0", "evt_bbbbbbbbbbb1"]) {
      await store.writeEvent("pending", event({ id }));
    }

    const expected = ["evt_aaaaaaaaaaa0", "evt_bbbbbbbbbbb1", "evt_ccccccccccc2"];
    expect(await store.listIds("pending")).toEqual(expected);
    expect(store.listIdsSync("pending")).toEqual(expected);
  });
});

// SPEC.md §7's conversation order, which a resident works its lane in.
describe("byQueueOrder", () => {
  const at = (created: string, seq?: number, id = "evt_aaaaaaaaaaaa"): StoredEvent =>
    event({ id, created, ...(seq === undefined ? {} : { seq }) });

  it("puts the earlier `created` first", () => {
    const early = at("2026-08-19T21:38:26Z");
    const late = at("2026-08-19T21:38:29Z");
    expect([late, early].sort(byQueueOrder)).toEqual([early, late]);
    expect(byQueueOrder(early, late)).toBeLessThan(0);
    expect(byQueueOrder(late, early)).toBeGreaterThan(0);
  });

  // The measured case (2026-08-19): three replies posted inside one second all
  // carry `2026-08-19T21:38:27Z`, because SPEC.md §5 stamps instants to the
  // second. `created` alone cannot separate them and the id is random — the
  // real drill came back Y, Z, X in exactly this id order.
  it("separates one second's events by `seq`, not by their random ids", () => {
    const first = at("2026-08-19T21:38:27Z", 1_000, "evt_y3blrq32r2n6");
    const second = at("2026-08-19T21:38:27Z", 1_001, "evt_q7yaplbvcjop");
    const third = at("2026-08-19T21:38:27Z", 1_002, "evt_xqr572cqvjf3");

    expect([second, third, first].sort(byQueueOrder)).toEqual([first, second, third]);
    // Sorting by the id alone is the defect, and it points the other way.
    expect([second, third, first].sort(byQueueOrder).map((each) => each.id)).not.toEqual(
      [second, third, first].map((each) => each.id).sort(),
    );
  });

  it("orders an event with no `seq` before one from the same second that has one", () => {
    const legacy = at("2026-08-19T21:38:27Z", undefined, "evt_zzzzzzzzzzzz");
    const stamped = at("2026-08-19T21:38:27Z", 5, "evt_aaaaaaaaaaaa");
    expect([stamped, legacy].sort(byQueueOrder)).toEqual([legacy, stamped]);
  });

  it("falls back to the id so the order is total", () => {
    const left = at("2026-08-19T21:38:27Z", undefined, "evt_aaaaaaaaaaaa");
    const right = at("2026-08-19T21:38:27Z", undefined, "evt_bbbbbbbbbbbb");
    expect(byQueueOrder(left, right)).toBeLessThan(0);
    expect(byQueueOrder(left, left)).toBe(0);
  });

  // A comparator that answers NaN makes `sort` do whatever it likes, which is
  // the class of defect this ordering exists to remove. `created` is validated
  // on the way in, so this is unreachable from disk — and still must not be a
  // reasoning step.
  it("never answers NaN for an instant that does not parse", () => {
    const broken = at("not an instant", undefined, "evt_bbbbbbbbbbbb");
    const good = at("2026-08-19T21:38:27Z", undefined, "evt_aaaaaaaaaaaa");
    expect(Number.isNaN(byQueueOrder(broken, good))).toBe(false);
    expect(byQueueOrder(broken, good)).toBeLessThan(0);
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

  it("keeps the deferral bookkeeping, and drops a blockedOn that is not a document id", () => {
    const good = parseEventFile(
      JSON.stringify({ ...event(), blockedOn: "doc_edited01", deferReason: "user is editing" }),
      "evt_aaaaaaaaaaaa",
      "deferred",
    );
    expect(good.ok === true && good.event).toMatchObject({
      blockedOn: "doc_edited01",
      deferReason: "user is editing",
      status: "deferred",
    });

    // Strict, unlike the projection's reader: this is the copy the *transitions*
    // read, and a deferral that named nothing addressable could never re-enter.
    const bad = parseEventFile(
      JSON.stringify({ ...event(), blockedOn: "nonsense" }),
      "evt_aaaaaaaaaaaa",
      "deferred",
    );
    expect(bad.ok).toBe(false);
    expect(bad.ok === false && bad.reason).toMatch(/blockedOn/);
  });
});

describe("withoutDeferral", () => {
  it("removes both deferral fields and leaves everything else alone", () => {
    const stripped = withoutDeferral(
      event({ status: "deferred", blockedOn: "doc_edited01", deferReason: "waiting", attempts: 2 }),
    );

    expect(stripped).not.toHaveProperty("blockedOn");
    expect(stripped).not.toHaveProperty("deferReason");
    expect(stripped).toMatchObject({ id: "evt_aaaaaaaaaaaa", attempts: 2, status: "deferred" });
    // A copy: the caller's event is what a failed transition would have to keep.
    expect(event({ blockedOn: "doc_edited01" }).blockedOn).toBe("doc_edited01");
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
