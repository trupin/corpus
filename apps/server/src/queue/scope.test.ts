// SPEC.md §7's scope walk, against a real projection (SERVER-111).
//
// Rows are inserted directly rather than by writing files and projecting them:
// what is under test is the walk over `documents.origin` and `threads.parent_id`
// — the two edges §7 names — and building each fixture out of markdown would
// test the document projector a third time while making the graph under test
// hard to read.
//
// **The traversal itself is no longer here** (UI-119). It is
// `@corpus/contract`'s `walkScope`, tested against literal graphs in
// `packages/contract/src/scope.test.ts`, because `packages/kit`'s composer
// states the same verdict to a person and its copy of the rule went on running
// the order SERVER-117 deleted — green, in a file whose comments said it encoded
// this one's. What these cases still prove is the half that is the server's and
// cannot move: that `NODE_SQL`'s left join puts `documents.origin`,
// `threads.parent_id` and `threads.resident_name` into the node the walk reads,
// for a document, for a thread, and for a `documents` row with no `threads` row.
// So the shapes are deliberately the same as the contract's and the subject is
// not.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ORCHESTRATOR_LANE } from "@corpus/contract";
import { HttpError } from "../errors.js";
import { openProjection, type ProjectionDb } from "../projection/index.js";
import {
  assertRecipientResolvable,
  assertScopeIsLane,
  createLaneScopeLookup,
  isDesignatedRoot,
} from "./scope.js";

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

// Only one artifact has both edges at once: a **thread** an agent opened on some
// document while its `CORPUS_JOB` was set, which carries `parent` *and* `origin`.
// (`apps/cli/src/input.ts` exports `CORPUS_JOB` once per claimed event, so that
// is every agent-created thread, not an exotic one.) Every way the two can
// disagree is enumerated here, because the defect this file was extended for was
// found by enumerating rather than by meeting it (SERVER-117, PR #48's review).
//
// The rule the whole block states, decided by the user 2026-08-17: **for a
// thread the parent chain wins, and the walk falls back rather than concluding
// "no scope".**
describe("a thread whose parent and origin point at different scopes", () => {
  // §7's enumeration gives a *thread* two routes into a scope — its parent chain,
  // and being "a thread on such a document" — and neither is its own origin. An
  // agent that reaches out of its scope to comment on another conversation's
  // draft does not annex that conversation, which is what §7 says of the one
  // crossing it does sanction: "answering a question does not annex the thread it
  // was asked in."
  it("keeps a thread with the scope of the document it hangs on, not the job that opened it", () => {
    thread("th_mine", { resident: "Ana" });
    thread("th_theirs", { resident: "Bo" });
    document("doc_theirs", "th_theirs");
    thread("th_opened", { parent: "doc_theirs", origin: "th_mine" });
    expect(laneFor({ threadId: "th_opened", parentId: "doc_theirs" })).toBe("th_theirs");
  });

  // PR #48's reproduction, four lines. Ana's resident drafted `doc_draft`; a
  // person asked the orchestrator about it in an ordinary thread `th_q`, and the
  // subagent opened `th_c` on the draft with its job set. A reply in `th_c` must
  // reach Ana — she wrote the artifact being discussed. Before SERVER-117 the
  // walk went `th_c → th_q → null → orchestrator` and never visited the draft.
  it("reaches the resident when the origin chain dead-ends and the parent chain does not", () => {
    thread("th_root", { resident: "Ana" });
    document("doc_draft", "th_root");
    thread("th_q");
    thread("th_c", { parent: "doc_draft", origin: "th_q" });
    expect(laneFor({ threadId: "th_c", parentId: "doc_draft" })).toBe("th_root");
  });

  // The mirror image: the preferred edge is the one that dead-ends. A dead end on
  // either edge is a dead end on that branch and never a verdict about the
  // artifact.
  it("falls back to the origin when the parent chain dead-ends", () => {
    thread("th_root", { resident: "Ana" });
    document("doc_loose", null);
    thread("th_opened", { parent: "doc_loose", origin: "th_root" });
    expect(laneFor({ threadId: "th_opened", parentId: "doc_loose" })).toBe("th_root");
  });

  it("routes to the orchestrator only when both edges dead-end", () => {
    document("doc_loose", null);
    thread("th_q");
    thread("th_c", { parent: "doc_loose", origin: "th_q" });
    expect(laneFor({ threadId: "th_c", parentId: "doc_loose" })).toBe(ORCHESTRATOR_LANE);
  });

  it("answers once when both edges reach the same root", () => {
    thread("th_root", { resident: "Ana" });
    document("doc_draft", "th_root");
    thread("th_c", { parent: "doc_draft", origin: "th_root" });
    expect(laneFor({ threadId: "th_c", parentId: "doc_draft" })).toBe("th_root");
  });

  // A branch that names an id this workspace does not hold — a deleted thread, an
  // id from another corpus — is a dead end like any other. It used to end the
  // whole walk, which threw away a live edge the walk had not looked at yet.
  it("treats a missing origin as a dead branch and still follows the parent", () => {
    thread("th_root", { resident: "Ana" });
    document("doc_draft", "th_root");
    thread("th_c", { parent: "doc_draft", origin: "th_gone" });
    expect(laneFor({ threadId: "th_c", parentId: "doc_draft" })).toBe("th_root");
  });

  it("treats a missing parent as a dead branch and still follows the origin", () => {
    thread("th_root", { resident: "Ana" });
    thread("th_c", { parent: "doc_gone", origin: "th_root" });
    expect(laneFor({ threadId: "th_c", parentId: "doc_gone" })).toBe("th_root");
  });

  // "Nearest" is measured along §7's route for a thread, not in hops: the parent
  // chain is followed to its end — through the origin edges of the documents on
  // it, which is §7's "every thread on such a document" — before the thread's own
  // origin is tried at all.
  it("prefers a distant parent chain over a designated thread one origin hop away", () => {
    thread("th_far", { resident: "Ana" });
    document("doc_q", "th_far");
    thread("th_mid", { parent: "doc_q" });
    document("doc_p", "th_mid");
    thread("th_near", { resident: "Bo" });
    thread("th_c", { parent: "doc_p", origin: "th_near" });
    expect(laneFor({ threadId: "th_c", parentId: "doc_p" })).toBe("th_far");
  });

  // §5 makes the files the source of truth, so either branch can be a hand-edited
  // loop. A cycle must cost that branch and nothing else — the walk still has to
  // answer from the other one.
  it("escapes a cycle on the origin branch and answers from the parent branch", () => {
    thread("th_root", { resident: "Ana" });
    document("doc_draft", "th_root");
    thread("th_a", { parent: "doc_draft", origin: "th_b" });
    thread("th_b", { origin: "th_a" });
    expect(laneFor({ threadId: "th_a", parentId: "doc_draft" })).toBe("th_root");
  });

  it("escapes a cycle on the parent branch and answers from the origin branch", () => {
    thread("th_root", { resident: "Ana" });
    thread("th_c", { parent: "doc_loop", origin: "th_root" });
    document("doc_loop", "th_c");
    expect(laneFor({ threadId: "th_c", parentId: "doc_loop" })).toBe("th_root");
  });

  // Both branches converging on one node is what makes a visited set a
  // termination argument rather than a cycle patch: the node is expanded once,
  // whichever branch reaches it first.
  it("terminates when both edges converge on one undesignated node", () => {
    thread("th_j");
    document("doc_p", "th_j");
    thread("th_c", { parent: "doc_p", origin: "th_j" });
    expect(laneFor({ threadId: "th_c", parentId: "doc_p" })).toBe(ORCHESTRATOR_LANE);
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

// SERVER-118: `scope` is validated the way `recipient` is. It had no validation
// at all, so any `th_…` reached `observePark` and made `QueueStatus.agent.live`
// true against a roster listing nothing live.
describe("assertScopeIsLane", () => {
  it("passes an omitted scope, which is the orchestrator's lane", () => {
    expect(() => {
      assertScopeIsLane(projection, undefined);
    }).not.toThrow();
  });

  it("passes the orchestrator, which is a lane whatever is designated", () => {
    expect(() => {
      assertScopeIsLane(projection, ORCHESTRATOR_LANE);
    }).not.toThrow();
  });

  it("passes a designated root", () => {
    thread("th_root", { resident: "Ana" });
    expect(() => {
      assertScopeIsLane(projection, "th_root");
    }).not.toThrow();
  });

  it("refuses a thread that holds no resident with a 422 naming the value", () => {
    thread("th_root");
    try {
      assertScopeIsLane(projection, "th_root");
      expect.unreachable("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      const http = error as HttpError;
      expect(http.status).toBe(422);
      expect(http.body).toMatchObject({ code: "unknown_recipient", recipient: "th_root" });
    }
  });

  it("refuses a thread with a parent: only a standalone thread can be designated", () => {
    thread("th_child", { parent: "doc_host", resident: "Ana" });
    expect(() => {
      assertScopeIsLane(projection, "th_child");
    }).toThrow(HttpError);
  });

  // Same refusal for "no such thread" and "that thread is not a lane", exactly
  // as `assertRecipientResolvable` gives it: telling them apart would make the
  // refusal an existence oracle over the corpus.
  it("refuses an unknown thread the same way, so the refusal is no existence oracle", () => {
    thread("th_root");
    const refusal = (scope: string): HttpError => {
      try {
        assertScopeIsLane(projection, scope);
      } catch (error) {
        return error as HttpError;
      }
      return expect.unreachable("expected a refusal");
    };
    const missing = refusal("th_gone");
    const undesignated = refusal("th_root");
    expect(missing.status).toBe(undesignated.status);
    expect(missing.body.code).toBe(undesignated.body.code);
    expect(missing.body.message.replace("th_gone", "X")).toBe(
      undesignated.body.message.replace("th_root", "X"),
    );
  });

  // The message has to carry the fix, because a park that names a thread with no
  // resident is not a park anything will ever hand work to and the reason is not
  // guessable from a bare "unknown".
  it("names the recovery in the refusal", () => {
    thread("th_root");
    try {
      assertScopeIsLane(projection, "th_root");
      expect.unreachable("expected a refusal");
    } catch (error) {
      const message = (error as HttpError).body.message;
      expect(message).toContain("th_root");
      expect(message).toContain("omit `scope`");
      expect(message).toContain("designate a resident");
      expect(message).toContain("Nothing was parked");
    }
  });
});
