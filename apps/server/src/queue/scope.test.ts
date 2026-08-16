// SPEC.md §7's scope walk, against a real projection (SERVER-111).
//
// Rows are inserted directly rather than by writing files and projecting them:
// what is under test is the walk over `documents.origin` and `threads.parent_id`
// — the two edges §7 names — and building each fixture out of markdown would
// test the document projector a third time while making the graph under test
// hard to read.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ORCHESTRATOR_LANE } from "@corpus/contract";
import { HttpError } from "../errors.js";
import { openProjection, type ProjectionDb } from "../projection/index.js";
import { assertRecipientResolvable, createLaneScopeLookup, isDesignatedRoot } from "./scope.js";

let dir: string;
let projection: ProjectionDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "corpus-s111-scope-"));
  projection = openProjection(
    { workspaceRoot: dir, corpusDir: join(dir, ".corpus") },
    { populate: false },
  );
});

afterEach(() => {
  projection.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A document row, with §9.2's origin. Every thread gets one of these too. */
const document = (id: string, origin: string | null): void => {
  projection
    .prepare(
      `INSERT INTO documents (id, type, title, path, status, tags_json, created, updated, due,
        reviewed, evergreen, origin, body_excerpt, pinned, sort_order, query_json, column_ref, extra_json)
       VALUES (?, 'note', 'T', ?, 'open', '[]', NULL, NULL, NULL, NULL, 0, ?, '', 0, NULL, NULL, NULL, '{}')`,
    )
    .run(id, `data/docs/inbox/${id}.md`, origin);
};

/** A thread: its `documents` row plus its `threads` row. */
const thread = (
  id: string,
  options: { parent?: string | null; origin?: string | null; resident?: string | null } = {},
): void => {
  const parent = options.parent ?? null;
  const resident = options.resident ?? null;
  document(id, options.origin ?? null);
  projection
    .prepare(
      `INSERT INTO threads (id, parent_id, status, agent, anchor_id, title, created, updated,
        turn_count, last_author, last_ts, resident_name, resident_doc_id)
       VALUES (?, ?, 'open', 'none', NULL, 'T', NULL, NULL, 0, NULL, NULL, ?, ?)`,
    )
    // Both halves move together, exactly as the projector writes them.
    .run(id, parent, resident, resident === null ? null : "doc_agent");
};

const laneFor = (payload: Record<string, unknown>): string =>
  createLaneScopeLookup(projection)(payload);

describe("the scope walk", () => {
  it("routes a comment in a designated thread to that thread's lane", () => {
    thread("th_root", { resident: "Ana" });
    expect(laneFor({ threadId: "th_root", parentId: null })).toBe("th_root");
  });

  it("routes a comment in an undesignated standalone thread to the orchestrator", () => {
    thread("th_root");
    expect(laneFor({ threadId: "th_root", parentId: null })).toBe(ORCHESTRATOR_LANE);
  });

  // §7's point of the whole scope: "a conversation that produces a draft, and a
  // comment left on that draft, reach the same agent".
  it("reaches the resident from a thread on a document the resident's scope holds", () => {
    thread("th_root", { resident: "Ana" });
    document("doc_draft", "th_root");
    thread("th_comment", { parent: "doc_draft" });
    expect(laneFor({ threadId: "th_comment", parentId: "doc_draft" })).toBe("th_root");
  });

  // The `doc.edited` shape: a payload naming a document and no thread at all.
  // §7 puts reflection work in the scope of what it reflects on.
  it("reaches the resident from a doc.edited on a document in its scope", () => {
    thread("th_root", { resident: "Ana" });
    document("doc_draft", "th_root");
    expect(laneFor({ docId: "doc_draft", sessionId: "s1" })).toBe("th_root");
  });

  it("routes a doc.edited on an unfiled document to the orchestrator", () => {
    document("doc_loose", null);
    expect(laneFor({ docId: "doc_loose", sessionId: "s1" })).toBe(ORCHESTRATOR_LANE);
  });

  // §7: designation captures retroactively, because the origin was recorded when
  // the document was written rather than when it became interesting. Nothing is
  // migrated when the resident is designated — the walk simply starts answering
  // differently.
  it("captures a document written before its root was designated", () => {
    thread("th_root");
    document("doc_draft", "th_root");
    expect(laneFor({ docId: "doc_draft", sessionId: "s1" })).toBe(ORCHESTRATOR_LANE);

    projection.prepare("UPDATE threads SET resident_name = 'Ana' WHERE id = ?").run("th_root");
    expect(laneFor({ docId: "doc_draft", sessionId: "s1" })).toBe("th_root");
  });

  // A standalone thread has no parent, so its own origin is the only edge out of
  // it — which is how a conversation the resident opened while working stays in
  // the scope it came from.
  it("follows a standalone thread's own origin", () => {
    thread("th_root", { resident: "Ana" });
    thread("th_spawned", { origin: "th_root" });
    expect(laneFor({ threadId: "th_spawned", parentId: null })).toBe("th_root");
  });

  it("walks a chain several links long", () => {
    thread("th_root", { resident: "Ana" });
    document("doc_one", "th_root");
    thread("th_mid", { parent: "doc_one" });
    document("doc_two", "th_mid");
    thread("th_leaf", { parent: "doc_two" });
    expect(laneFor({ threadId: "th_leaf", parentId: "doc_two" })).toBe("th_root");
  });

  // §7: "an artifact belongs to at most one scope". A nearer designated thread
  // is the root of its own scope, and the walk stops there rather than
  // continuing to the one above it.
  it("stops at the nearest designated thread", () => {
    thread("th_outer", { resident: "Ana" });
    thread("th_inner", { origin: "th_outer", resident: "Bo" });
    document("doc_leaf", "th_inner");
    expect(laneFor({ docId: "doc_leaf", sessionId: "s1" })).toBe("th_inner");
  });

  // The one artifact whose two edges disagree: a thread an agent opened on
  // *another* conversation's document while naming its own job. §7 arbitrates on
  // origin ("a second scope cannot claim what a first already holds"), and
  // `core/provenance.ts` makes it decisive — a thread filed into one scope whose
  // follow-up work queued on another is a resident that owns the artifact and
  // never hears about it.
  it("prefers a thread's own origin over the scope of the document it hangs on", () => {
    thread("th_mine", { resident: "Ana" });
    thread("th_theirs", { resident: "Bo" });
    document("doc_theirs", "th_theirs");
    thread("th_opened", { parent: "doc_theirs", origin: "th_mine" });
    expect(laneFor({ threadId: "th_opened", parentId: "doc_theirs" })).toBe("th_mine");
  });

  it("routes an event naming nothing to the orchestrator", () => {
    expect(laneFor({ sessionId: "s1" })).toBe(ORCHESTRATOR_LANE);
  });

  it("routes an event naming a document this workspace does not hold to the orchestrator", () => {
    expect(laneFor({ threadId: "th_gone", parentId: null })).toBe(ORCHESTRATOR_LANE);
  });

  // §5 makes the files the source of truth, so a hand-edited pair of
  // frontmatters can name each other. The answer is the orchestrator's lane, not
  // a hung request.
  it("terminates on a cycle a hand-edited workspace can create", () => {
    thread("th_a", { origin: "th_b" });
    thread("th_b", { origin: "th_a" });
    expect(laneFor({ threadId: "th_a", parentId: null })).toBe(ORCHESTRATOR_LANE);
  });
});

describe("isDesignatedRoot", () => {
  it("accepts a standalone thread with a resident", () => {
    thread("th_root", { resident: "Ana" });
    expect(isDesignatedRoot(projection, "th_root")).toBe(true);
  });

  it("refuses a standalone thread with no resident", () => {
    thread("th_root");
    expect(isDesignatedRoot(projection, "th_root")).toBe(false);
  });

  it("refuses a thread this workspace does not hold", () => {
    expect(isDesignatedRoot(projection, "th_gone")).toBe(false);
  });

  it("refuses a document that is not a thread at all", () => {
    document("doc_a", null);
    expect(isDesignatedRoot(projection, "doc_a")).toBe(false);
  });
});

describe("assertRecipientResolvable", () => {
  it("passes an omitted recipient without a lookup", () => {
    expect(() => {
      assertRecipientResolvable(projection, undefined);
    }).not.toThrow();
  });

  it("passes the orchestrator, which is a lane whatever is designated", () => {
    expect(() => {
      assertRecipientResolvable(projection, ORCHESTRATOR_LANE);
    }).not.toThrow();
  });

  it("passes a designated root", () => {
    thread("th_root", { resident: "Ana" });
    expect(() => {
      assertRecipientResolvable(projection, "th_root");
    }).not.toThrow();
  });

  it("refuses a thread that holds no resident with a 422 naming the value", () => {
    thread("th_root");
    try {
      assertRecipientResolvable(projection, "th_root");
      expect.unreachable("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      const http = error as HttpError;
      expect(http.status).toBe(422);
      expect(http.body).toMatchObject({ code: "unknown_recipient", recipient: "th_root" });
    }
  });

  it("refuses an unknown thread the same way, so the refusal is no existence oracle", () => {
    thread("th_root");
    const missing = ((): HttpError => {
      try {
        assertRecipientResolvable(projection, "th_gone");
      } catch (error) {
        return error as HttpError;
      }
      return expect.unreachable("expected a refusal");
    })();
    const undesignated = ((): HttpError => {
      try {
        assertRecipientResolvable(projection, "th_root");
      } catch (error) {
        return error as HttpError;
      }
      return expect.unreachable("expected a refusal");
    })();
    expect(missing.status).toBe(undesignated.status);
    expect(missing.body.code).toBe(undesignated.body.code);
    expect(missing.body.message.replace("th_gone", "X")).toBe(
      undesignated.body.message.replace("th_root", "X"),
    );
  });
});
