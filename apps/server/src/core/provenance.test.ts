import { describe, expect, it } from "vitest";
import { isStampable, resolveOrigin, STAMPABLE_STATUSES } from "./provenance.js";

describe("resolveOrigin — where a job's work came from", () => {
  it("takes the thread a comment names", () => {
    // `comment.created` names its thread, and the thread is the conversation the
    // work belongs to (SPEC.md §7 scope).
    expect(resolveOrigin({ threadId: "th_x9y8", docId: "doc_a1b2" })).toBe("th_x9y8");
  });

  it("prefers the thread over the parent and the document, in that order", () => {
    // The order is `jobs/project.ts`'s, shared on purpose: the console's "open
    // where this job came from" and the origin stamp must point at one place.
    expect(resolveOrigin({ threadId: "th_first", parentId: "th_second" })).toBe("th_first");
    expect(resolveOrigin({ parentId: "th_second", docId: "doc_a1b2" })).toBe("th_second");
  });

  it("answers null for an event that names only a document", () => {
    // The rule that keeps reflection inside the scope it reflects on: a
    // `doc.edited` event carries only a `docId`, so its origin is the *edited
    // document's own* origin — which this function cannot know without reading
    // the corpus, and deliberately does not try to. The caller has the document.
    expect(resolveOrigin({ docId: "doc_a1b2" })).toBeNull();
    expect(resolveOrigin({ docId: "doc_a1b2", sessionId: "s1", actor: "user" })).toBeNull();
  });

  it("ignores a key that names something other than a thread", () => {
    // A payload whose `threadId` is a document id is a malformed event, not a
    // scope: stamping it would file the document into a conversation that does
    // not exist.
    expect(resolveOrigin({ threadId: "doc_a1b2" })).toBeNull();
    expect(resolveOrigin({ threadId: 42 })).toBeNull();
    expect(resolveOrigin({ threadId: null })).toBeNull();
  });

  it("answers null for anything that is not an object", () => {
    for (const payload of [null, undefined, "th_x9y8", 7, []]) {
      expect(resolveOrigin(payload)).toBeNull();
    }
  });

  it("reads the event it is handed and nothing else", () => {
    // Pure and synchronous by contract: the write path already holds a document
    // lane, and SERVER-111 will call this on the enqueue path, where a
    // filesystem read per event would be paid on every message.
    expect(resolveOrigin.length).toBe(1);
  });
});

describe("which statuses a job may be named by", () => {
  it("accepts work that is under way, parked, or waiting", () => {
    // A resident stamps while *holding* its event, so `in-progress` is the
    // ordinary case rather than an edge one, and `deferred` is an event that
    // will come back to the same owner.
    expect(STAMPABLE_STATUSES).toEqual(["pending", "in-progress", "deferred"]);
    for (const status of STAMPABLE_STATUSES) expect(isStampable(status)).toBe(true);
  });

  it("refuses work that is over", () => {
    // A write claiming to serve settled work is a stale job id being reused or a
    // loop that never settled its own event. Neither should acquire a scope.
    for (const status of ["processed", "failed", "abandoned"] as const) {
      expect(isStampable(status)).toBe(false);
    }
  });
});
