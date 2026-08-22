import { describe, expect, it } from "vitest";
import { commentPayload, enqueueComment } from "./events.js";
import { NO_MENTIONS } from "./mentions.js";
import type { EnqueueInput, ThreadsWorkspace } from "./workspace.js";

const PARSED = {
  generic: true,
  mentions: [{ name: "researcher", docId: "doc_a1b2c3", status: "open" }],
  skills: [{ name: "comment", docId: "doc_d4e5f6", status: "archived" }],
  unresolved: ["@nobody"],
};

describe("commentPayload", () => {
  // This shape is the contract with AGENT-002's orchestrator skill, which reads
  // `mentions` and `skills` to dispatch. Pinned as a whole rather than field by
  // field, so a renamed key fails here instead of silently in the agent loop.
  it("carries §8's structured fields under the names the orchestrator reads", () => {
    expect(
      commentPayload({
        threadId: "th_x9y8z7w6",
        parentId: "doc_a1b2c3",
        turnTs: "2026-07-19T10:05:00Z",
        parsed: PARSED,
        weight: undefined,
        recipient: undefined,
      }),
    ).toEqual({
      threadId: "th_x9y8z7w6",
      parentId: "doc_a1b2c3",
      turnTs: "2026-07-19T10:05:00Z",
      mentions: [{ name: "researcher", docId: "doc_a1b2c3", status: "open" }],
      skills: [{ name: "comment", docId: "doc_d4e5f6", status: "archived" }],
      unresolved: ["@nobody"],
    });
  });

  it("carries a null parent for a standalone thread", () => {
    const payload = commentPayload({
      threadId: "th_x9y8z7w6",
      parentId: null,
      turnTs: "2026-07-19T10:05:00Z",
      parsed: NO_MENTIONS,
      weight: undefined,
      recipient: undefined,
    });
    expect(payload).toMatchObject({ parentId: null, mentions: [], skills: [], unresolved: [] });
  });

  // SERVER-069 / SHARED-022: the payload is where a stated weight is handed to
  // whatever does the work (§7, §10).
  it("carries a stated weight verbatim, under the key the dispatch reads", () => {
    const payload = commentPayload({
      threadId: "th_x9y8z7w6",
      parentId: null,
      turnTs: "2026-07-19T10:05:00Z",
      parsed: NO_MENTIONS,
      weight: "Heavy or judgment-laden",
      recipient: undefined,
    });

    expect(payload["weight"]).toBe("Heavy or judgment-laden");
  });

  it("writes no `weight` key at all when the request stated none", () => {
    const payload = commentPayload({
      threadId: "th_x9y8z7w6",
      parentId: null,
      turnTs: "2026-07-19T10:05:00Z",
      parsed: NO_MENTIONS,
      weight: undefined,
      recipient: undefined,
    });

    // Not `toBeUndefined()`: a `weight: undefined` key would satisfy that and
    // survive the JSON round trip onto disk as a second spelling of "no choice",
    // which §7 has exactly one of — absence means the orchestrator decides.
    expect(Object.keys(payload)).not.toContain("weight");
  });
});

describe("enqueueComment", () => {
  it("goes through the workspace's enqueue seam as a `comment.created` from the thread surface", async () => {
    const calls: EnqueueInput[] = [];
    const workspace = {
      enqueue: (input: EnqueueInput) => {
        calls.push(input);
        return Promise.resolve({ id: "evt_a1b2c3d4e5f6" });
      },
    } as unknown as ThreadsWorkspace;

    const id = await enqueueComment(workspace, {
      threadId: "th_x9y8z7w6",
      parentId: "doc_a1b2c3",
      turnTs: "2026-07-19T10:05:00Z",
      parsed: NO_MENTIONS,
      weight: undefined,
      recipient: undefined,
    });

    expect(id).toBe("evt_a1b2c3d4e5f6");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ type: "comment.created", source: "thread" });
  });

  it("lets a composing surface name itself", async () => {
    const calls: EnqueueInput[] = [];
    const workspace = {
      enqueue: (input: EnqueueInput) => {
        calls.push(input);
        return Promise.resolve({ id: "evt_a1b2c3d4e5f6" });
      },
    } as unknown as ThreadsWorkspace;

    await enqueueComment(workspace, {
      threadId: "th_x9y8z7w6",
      parentId: "doc_a1b2c3",
      turnTs: "2026-07-19T10:05:00Z",
      parsed: NO_MENTIONS,
      weight: undefined,
      recipient: undefined,
      source: "capture",
    });

    expect(calls[0]?.source).toBe("capture");
  });
});
