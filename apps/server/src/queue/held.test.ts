// What the server reports it is still holding (SPEC.md §7's reconciliation
// bullet, SERVER-061). Every assertion here reads the queue's real directories:
// the set is defined as "what is in `in-progress/`", so a fixture that invented
// the events would be asserting nothing.

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_IN_PROGRESS_REPORTED, QUEUE_EVENT_STATUSES } from "@corpus/contract";
import { NOTHING_HELD, NO_ORIGIN, heldSince, readHeldInProgress, toInProgressSet } from "./held.js";
import { QueueStore, type StoredEvent } from "./store.js";
import { silentLogger, type LogFields, type Logger } from "../logger.js";
import { createWriteWorkspace, createDoc, type WriteWorkspace } from "../docs/write-fixture.js";

let root: string;
let store: QueueStore;

interface LogEntry {
  message: string;
  fields?: LogFields;
}

/**
 * Records what was logged, so "skipped, not quarantined" is provable rather than
 * implied — and, for the unreadable paths, that the skip is not silent.
 *
 * `errors` and `debugs` are kept apart because the *level* is part of what is
 * being asserted: a malformed file is expected residue (`debug`), an unreadable
 * one is a workspace fault an operator has to fix, and only `error` survives a
 * server running at `silent`.
 */
function recordingLogger(): Logger & {
  readonly debugs: LogEntry[];
  readonly errors: LogEntry[];
} {
  const debugs: LogEntry[] = [];
  const errors: LogEntry[] = [];
  const record =
    (into: LogEntry[]) =>
    (message: string, fields?: LogFields): void => {
      into.push(fields === undefined ? { message } : { message, fields });
    };
  return {
    level: "debug",
    info: () => undefined,
    error: record(errors),
    debug: record(debugs),
    debugs,
    errors,
  };
}

const event = (
  id: string,
  claimedAt: string,
  payload: Record<string, unknown> = {},
): StoredEvent => ({
  id,
  type: "comment.created",
  created: "2026-08-06T09:00:00Z",
  source: "cli",
  payload,
  status: "in-progress",
  updated: claimedAt,
});

const hold = async (...events: StoredEvent[]): Promise<void> => {
  for (const held of events) await store.writeEvent("in-progress", held);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s061-held-"));
  store = new QueueStore(join(root, ".corpus"));
  store.ensureLayoutSync();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("readHeldInProgress", () => {
  it("reports exactly what is in in-progress/, and nothing when it is empty", async () => {
    expect(await readHeldInProgress(store, silentLogger)).toEqual(NOTHING_HELD);
    // Never an absent or optional field: nothing held is a real, reported value.
    expect(NOTHING_HELD).toEqual({ events: [], total: 0, truncated: false });

    await hold(event("evt_aaaaaaaaaaaa", "2026-08-06T09:01:00Z"));
    // Events in other directories are not held work and must not appear.
    await store.writeEvent("pending", {
      ...event("evt_pending00000", "2026-08-06T09:09:00Z"),
      status: "pending",
    });
    await store.writeEvent("processed", {
      ...event("evt_done00000000", "2026-08-06T09:09:00Z"),
      status: "processed",
    });

    const held = await readHeldInProgress(store, silentLogger);
    expect(held.events.map((each) => each.id)).toEqual(["evt_aaaaaaaaaaaa"]);
    expect(held.total).toBe(1);
    expect(held.truncated).toBe(false);
    expect(held.events.map((each) => each.id)).toEqual(await store.listIds("in-progress"));
  });

  it("orders most recently claimed first", async () => {
    await hold(
      event("evt_oldest000000", "2026-08-06T09:00:10Z"),
      event("evt_newest000000", "2026-08-06T09:30:00Z"),
      event("evt_middle000000", "2026-08-06T09:15:00Z"),
    );

    const held = await readHeldInProgress(store, silentLogger);
    expect(held.events.map((each) => each.id)).toEqual([
      "evt_newest000000",
      "evt_middle000000",
      "evt_oldest000000",
    ]);
  });

  it("orders a whole batch deterministically when every claim shares one instant", async () => {
    // Instants are canonical to the second (SPEC.md §5), so one claim batch has
    // one timestamp; the order within it must not depend on readdir.
    await hold(
      event("evt_bbbbbbbbbbbb", "2026-08-06T09:20:00Z"),
      event("evt_cccccccccccc", "2026-08-06T09:20:00Z"),
      event("evt_aaaaaaaaaaaa", "2026-08-06T09:20:00Z"),
    );

    const first = await readHeldInProgress(store, silentLogger);
    const second = await readHeldInProgress(store, silentLogger);
    expect(first.events.map((each) => each.id)).toEqual([
      "evt_cccccccccccc",
      "evt_bbbbbbbbbbbb",
      "evt_aaaaaaaaaaaa",
    ]);
    expect(second.events.map((each) => each.id)).toEqual(first.events.map((each) => each.id));
  });

  it("caps the list, keeps the newest, and says the cut happened", async () => {
    const total = MAX_IN_PROGRESS_REPORTED + 5;
    for (let index = 0; index < total; index += 1) {
      const minute = String(index).padStart(2, "0");
      await hold(event(`evt_h${String(index).padStart(11, "0")}`, `2026-08-06T09:${minute}:00Z`));
    }

    const held = await readHeldInProgress(store, silentLogger);
    expect(held.events).toHaveLength(MAX_IN_PROGRESS_REPORTED);
    expect(held.total).toBe(total);
    expect(held.truncated).toBe(true);
    // The newest are the ones an agent can still account for; ancient residue is
    // `reap-stale`'s problem, so it is what ages out of the window.
    expect(held.events[0]?.id).toBe(`evt_h${String(total - 1).padStart(11, "0")}`);
    expect(held.events.at(-1)?.id).toBe(`evt_h${String(5).padStart(11, "0")}`);
    // `total` is the "and N more" the cap owes the caller.
    expect(held.total - held.events.length).toBe(5);
  });

  it("reports total === events.length exactly while it is not truncated", async () => {
    for (let index = 0; index < MAX_IN_PROGRESS_REPORTED; index += 1) {
      await hold(event(`evt_f${String(index).padStart(11, "0")}`, "2026-08-06T09:20:00Z"));
    }

    const held = await readHeldInProgress(store, silentLogger);
    expect(held.truncated).toBe(false);
    expect(held.total).toBe(held.events.length);
  });

  it("skips a malformed file — it does not quarantine it, and does not count it", async () => {
    const logger = recordingLogger();
    await hold(event("evt_good00000000", "2026-08-06T09:05:00Z"));
    writeFileSync(store.pathFor("in-progress", "evt_bad000000000"), "{ truncated");

    const held = await readHeldInProgress(store, logger);
    expect(held.events.map((each) => each.id)).toEqual(["evt_good00000000"]);
    // Excluded from `total` too, so `total === events.length` stays honest.
    expect(held).toMatchObject({ total: 1, truncated: false });
    expect(logger.debugs.map((entry) => entry.message)).toEqual([
      "skipping malformed in-progress event",
    ]);
    // Still exactly where it was: a read path settles nothing (SPEC.md §7).
    expect(readdirSync(store.dirFor("in-progress")).sort()).toEqual([
      "evt_bad000000000.json",
      "evt_good00000000.json",
    ]);
    expect(await store.listIds("failed")).toEqual([]);
  });

  // The report is not the work (PR #25 review, SERVER-061): `claimAll` reads this
  // before it moves anything, so a throw here would cost the agent its whole
  // batch to produce a diagnostic.
  it("skips a file it cannot read at all — not merely one it cannot parse", async () => {
    const logger = recordingLogger();
    await hold(event("evt_good00000000", "2026-08-06T09:05:00Z"));
    // A real unreadable entry, and one no user can read by accident: `readdir`
    // lists it as an event file, every read of it fails with EISDIR. A `chmod`
    // would be bypassed by root and let the test pass without proving anything.
    mkdirSync(store.pathFor("in-progress", "evt_unreadable0"));

    const held = await readHeldInProgress(store, logger);
    expect(held.events.map((each) => each.id)).toEqual(["evt_good00000000"]);
    // Excluded from `total` exactly as a malformed file is, so the contract's
    // invariant still holds: `total === events.length` while not truncated.
    expect(held).toMatchObject({ total: 1, truncated: false });

    // Not silent, and at `error` — a silenced server still has to say this.
    expect(logger.errors).toEqual([
      {
        message: "skipping unreadable in-progress event",
        fields: { id: "evt_unreadable0", reason: expect.stringContaining("EISDIR") as string },
      },
    ]);
    expect(logger.debugs).toEqual([]);
    // And settled nothing, same as every other read path (SPEC.md §7).
    expect(readdirSync(store.dirFor("in-progress")).sort()).toEqual([
      "evt_good00000000.json",
      "evt_unreadable0.json",
    ]);
    expect(await store.listIds("failed")).toEqual([]);
  });

  it("degrades the whole report when in-progress/ cannot be listed at all", async () => {
    const logger = recordingLogger();
    // The one failure with no per-file granularity to be narrow with: there is
    // no list to skip an entry from. `readdir` on a non-directory is ENOTDIR for
    // every user, so this is deterministic rather than permission-dependent.
    rmSync(store.dirFor("in-progress"), { recursive: true, force: true });
    writeFileSync(store.dirFor("in-progress"), "not a directory");

    // Told nothing, rather than told a wrong number — and still not a throw.
    expect(await readHeldInProgress(store, logger)).toEqual(NOTHING_HELD);
    expect(logger.errors.map((entry) => entry.message)).toEqual([
      "cannot list in-progress events; reporting nothing held",
    ]);
  });

  it("moves, settles and creates nothing", async () => {
    await hold(
      event("evt_aaaaaaaaaaaa", "2026-08-06T09:05:00Z"),
      event("evt_bbbbbbbbbbbb", "2026-08-06T09:06:00Z"),
    );
    const before = Object.fromEntries(
      QUEUE_EVENT_STATUSES.map((status) => [status, readdirSync(store.dirFor(status)).sort()]),
    );

    await readHeldInProgress(store, silentLogger);
    await readHeldInProgress(store, silentLogger);

    expect(
      Object.fromEntries(
        QUEUE_EVENT_STATUSES.map((status) => [status, readdirSync(store.dirFor(status)).sort()]),
      ),
    ).toEqual(before);
  });
});

describe("heldSince", () => {
  it("is the claim instant, and falls back to `created` for a hand-dropped file", () => {
    expect(heldSince(event("evt_aaaaaaaaaaaa", "2026-08-06T09:05:00Z"))).toBe(
      "2026-08-06T09:05:00Z",
    );

    const { updated: _dropped, ...withoutUpdated } = event("evt_bbbbbbbbbbbb", "unused");
    expect(heldSince(withoutUpdated)).toBe("2026-08-06T09:00:00Z");
  });

  it("is an instant, not an elapsed duration", async () => {
    await hold(event("evt_aaaaaaaaaaaa", "2026-08-06T09:05:00Z"));
    const set = toInProgressSet(await readHeldInProgress(store, silentLogger), NO_ORIGIN);

    // The value is stable no matter when it is read — which is the whole reason
    // the contract asks for an instant (CONTRACT-033).
    expect(set.events[0]?.heldSince).toBe("2026-08-06T09:05:00Z");
    expect(typeof set.events[0]?.heldSince).toBe("string");
  });
});

describe("toInProgressSet", () => {
  it("carries the cap's numbers through untouched, and resolves each origin", async () => {
    await hold(
      event("evt_aaaaaaaaaaaa", "2026-08-06T09:05:00Z", { docId: "doc_known001" }),
      event("evt_bbbbbbbbbbbb", "2026-08-06T09:06:00Z", {}),
    );

    const set = toInProgressSet(await readHeldInProgress(store, silentLogger), (payload) =>
      payload["docId"] === "doc_known001"
        ? { id: "doc_known001", title: "A known document" }
        : null,
    );

    expect(set).toEqual({
      events: [
        {
          id: "evt_bbbbbbbbbbbb",
          type: "comment.created",
          heldSince: "2026-08-06T09:06:00Z",
          originId: null,
          originTitle: null,
        },
        {
          id: "evt_aaaaaaaaaaaa",
          type: "comment.created",
          heldSince: "2026-08-06T09:05:00Z",
          originId: "doc_known001",
          originTitle: "A known document",
        },
      ],
      total: 2,
      truncated: false,
    });
  });

  it("reports null origins when no projection is wired in", async () => {
    await hold(event("evt_aaaaaaaaaaaa", "2026-08-06T09:05:00Z", { docId: "doc_known001" }));

    const set = toInProgressSet(await readHeldInProgress(store, silentLogger), NO_ORIGIN);
    expect(set.events[0]).toMatchObject({ originId: null, originTitle: null });
  });
});

// The origin rule itself is `jobs/project.ts`'s, and the only way to prove the
// held set uses *that* rule is to ask a real projection about real documents.
describe("origin, through the real projection", () => {
  let ws: WriteWorkspace;

  const claimOverHttp = async (): Promise<{
    events: { id: string; originId: string | null; originTitle: string | null }[];
    total: number;
    truncated: boolean;
  }> => {
    const response = await ws.request("/api/queue/claim-all", {
      method: "POST",
      headers: { Authorization: "Bearer tkn_0123456789abcdef0123456789abcdef" },
    });
    const body = (await response.json()) as {
      inProgress: {
        events: { id: string; originId: string | null; originTitle: string | null }[];
        total: number;
        truncated: boolean;
      };
    };
    return body.inProgress;
  };

  beforeEach(() => {
    ws = createWriteWorkspace("held", { sprint: "s061" });
  });

  afterEach(() => {
    ws.close();
  });

  it("names the first payload key that still resolves, and its current title", async () => {
    const doc = await createDoc(ws, { type: "note", title: "The rate assumption", body: "why" });
    await ws.server.queue.enqueue({
      type: "comment.created",
      source: "cli",
      // `threadId` is preferred, but it names nothing the corpus holds — the
      // rule falls through to the next key rather than stopping at the dead one.
      payload: { threadId: "th_deadbeef", docId: doc.id },
    });
    await claimOverHttp();

    const held = await claimOverHttp();
    expect(held.events).toHaveLength(1);
    expect(held.events[0]).toMatchObject({ originId: doc.id, originTitle: "The rate assumption" });

    // Read at response time, never stored: a rename shows through on the next call.
    expect(
      (await ws.put(`/api/docs/${doc.id}`, { title: "The rate assumption (revised)" })).status,
    ).toBe(200);
    expect((await claimOverHttp()).events[0]).toMatchObject({
      originTitle: "The rate assumption (revised)",
    });
  });

  it("still lists an event whose document is gone, with a null origin", async () => {
    const doomed = await createDoc(ws, { type: "note", title: "Doomed", body: "x" });
    await ws.server.queue.enqueue({
      type: "comment.created",
      source: "cli",
      payload: { docId: doomed.id },
    });
    await claimOverHttp();
    expect((await claimOverHttp()).events[0]).toMatchObject({ originId: doomed.id });

    expect((await ws.del(`/api/docs/${doomed.id}`)).status).toBe(200);

    const held = await claimOverHttp();
    // Listed, because it is still held — and this is exactly the row an agent
    // has to be able to see. Only the origin is gone.
    expect(held.total).toBe(1);
    expect(held.events[0]).toMatchObject({ originId: null, originTitle: null });
  });
});
