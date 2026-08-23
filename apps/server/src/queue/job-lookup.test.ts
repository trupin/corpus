// SERVER-110's `doc.edited` rule, at the level it is testable: the write
// fixture wires no `editSessions`, so no `doc.edited` event is ever emitted
// there, and an "integration" test of it would only prove the event never
// arrived (PR #47 review).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openProjection, type ProjectionDb } from "../projection/index.js";
import { QueueStore } from "./store.js";
import { createJobLookup } from "./job-lookup.js";

let dir: string;
let store: QueueStore;
let projection: ProjectionDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "corpus-s032-joblookup-"));
  store = new QueueStore(dir);
  store.ensureLayoutSync();
  projection = openProjection(
    { workspaceRoot: dir, corpusDir: join(dir, ".corpus") },
    { populate: false },
  );
});

afterEach(() => {
  projection.close();
  rmSync(dir, { recursive: true, force: true });
});

const enqueue = async (id: string, type: string, payload: unknown): Promise<void> => {
  await store.writeEvent("pending", {
    id,
    type,
    status: "pending",
    source: "test",
    created: "2026-08-15T10:00:00Z",
    payload: payload as Record<string, unknown>,
  } as never);
};

const project = (id: string, origin: string | null): void => {
  projection
    .prepare(
      `INSERT INTO documents (id, type, title, path, status, stage, last_actor, tags_json, created,
        updated, due, reviewed, evergreen, origin, body_excerpt, sort_order, query_json,
        board_json, extra_json)
       VALUES (?, 'note', 'T', ?, 'open', NULL, 'user', '[]', NULL, NULL, NULL, NULL, 0, ?, '',
        NULL, NULL, NULL, '{}')`,
    )
    .run(id, `data/docs/inbox/${id}.md`, origin);
};

describe("a job that names a document rather than a thread", () => {
  it("resolves to the document's own origin, keeping reflection in its scope", async () => {
    // §7: reflection work and its artifacts stay in the scope of the document
    // they reflect on. Without this the follow-up an agent writes while working
    // a `doc.edited` event falls out of the scope entirely, and the walk can
    // never reach it.
    project("doc_filed", "th_root");
    await enqueue("evt_reflect", "doc.edited", { docId: "doc_filed", actor: "user" });

    expect(createJobLookup(store, projection).originFor("evt_reflect")).toEqual({
      ok: true,
      origin: "th_root",
    });
  });

  it("resolves to null when the edited document belongs to no conversation", async () => {
    project("doc_unfiled", null);
    await enqueue("evt_reflect", "doc.edited", { docId: "doc_unfiled", actor: "user" });

    expect(createJobLookup(store, projection).originFor("evt_reflect")).toEqual({
      ok: true,
      origin: null,
    });
  });

  it("resolves to null when the document is not in the projection at all", async () => {
    await enqueue("evt_reflect", "doc.edited", { docId: "doc_gone", actor: "user" });

    expect(createJobLookup(store, projection).originFor("evt_reflect")).toEqual({
      ok: true,
      origin: null,
    });
  });

  it("still prefers a thread the payload names outright", async () => {
    project("doc_filed", "th_root");
    await enqueue("evt_comment", "comment.created", {
      threadId: "th_named",
      docId: "doc_filed",
    });

    expect(createJobLookup(store, projection).originFor("evt_comment")).toEqual({
      ok: true,
      origin: "th_named",
    });
  });
});

describe("a job that names nothing this server can serve", () => {
  it("reports an unknown id", () => {
    expect(createJobLookup(store, projection).originFor("evt_nope")).toEqual({
      ok: false,
      reason: "unknown",
    });
  });

  it("reports settled work with the status it is in", async () => {
    await store.writeEvent("processed", {
      id: "evt_done",
      type: "comment.created",
      status: "processed",
      source: "test",
      created: "2026-08-15T10:00:00Z",
      payload: { threadId: "th_root" },
    } as never);

    expect(createJobLookup(store, projection).originFor("evt_done")).toEqual({
      ok: false,
      reason: "settled",
      status: "processed",
    });
  });
});
