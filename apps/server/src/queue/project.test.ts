import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DOCS_KEY, JOBS_KEY, QUEUE_KEY } from "../events/index.js";
import { QUEUE_QUERY_KEYS, scanQueueSync } from "./project.js";
import { QueueStore, type StoredEvent } from "./store.js";

describe("the queue's invalidation key table", () => {
  it("names the queue, the job list and the document collection", () => {
    // Pinned by value, not by symbol: every call site imports the constant, so
    // only a literal assertion can catch a key going missing (SERVER-028).
    expect(QUEUE_QUERY_KEYS).toEqual([["queue"], ["jobs"], ["docs"]]);
    expect(QUEUE_QUERY_KEYS).toEqual([QUEUE_KEY, JOBS_KEY, DOCS_KEY]);
  });

  it("carries the document collection because `failed-job` reads `events.status`", () => {
    // SPEC.md §2.2: a write invalidates every query whose answer it changes.
    // `GET /api/docs?needs=me` counts documents named by a *failed* event
    // (`docs/needs.ts` FAILED_JOB_SQL), so a transition ages that collection.
    expect(QUEUE_QUERY_KEYS).toContainEqual(DOCS_KEY);
  });
});

describe("scanQueueSync", () => {
  let root: string;
  let store: QueueStore;

  const event = (id: string): StoredEvent => ({
    id,
    type: "comment.created",
    created: "2026-08-06T09:00:00Z",
    source: "cli",
    payload: {},
    status: "pending",
  });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "corpus-s063-scan-"));
    store = new QueueStore(join(root, ".corpus"));
    store.ensureLayoutSync();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // SERVER-063: the boot scan used to rethrow whatever the read threw, which the
  // constructor above it turned into a server that would not start.
  it("skips what it cannot read and keeps scanning, across every status", async () => {
    await store.writeEvent("pending", event("evt_pending00000"));
    await store.writeEvent("processed", event("evt_processed000"));
    // `readdir` lists these as event files; every read of one fails with EISDIR,
    // for every user — a `chmod` would be bypassed by root.
    mkdirSync(store.pathFor("pending", "evt_unreadable01"));
    mkdirSync(store.pathFor("processed", "evt_unreadable02"));
    writeFileSync(store.pathFor("failed", "evt_malformed000"), "{ truncated");

    const scan = scanQueueSync(store);

    // Every readable event survives — including the ones after the failure, and
    // the ones in the status directories after it.
    expect(scan.events.map((each) => [each.id, each.status]).sort()).toEqual([
      ["evt_pending00000", "pending"],
      ["evt_processed000", "processed"],
    ]);
    // Reported as what it is: unreadable is not malformed, and neither is an
    // event — nothing here goes into the mirror.
    expect([...scan.unreadable].sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      {
        id: "evt_unreadable01",
        status: "pending",
        reason: expect.stringContaining("EISDIR") as string,
      },
      {
        id: "evt_unreadable02",
        status: "processed",
        reason: expect.stringContaining("EISDIR") as string,
      },
    ]);
    expect(scan.malformed).toEqual(["evt_malformed000"]);
  });

  it("reports nothing skipped when every file reads", async () => {
    await store.writeEvent("pending", event("evt_pending00000"));

    expect(scanQueueSync(store)).toMatchObject({ malformed: [], unreadable: [] });
  });
});
