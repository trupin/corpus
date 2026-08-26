// What every thread mutation owes the pipeline, asserted once rather than in
// each verb's suite: §11's warnings, §2.2's invalidation keys, §7's one enqueue
// path, and §4's auto-commit session folding.

import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { QueryKey } from "@corpus/contract";
import {
  appendTurn,
  createDoc,
  createThread,
  createThreadWorkspace,
  postForm,
  threadFrontmatterOf,
  threadPath,
  turnsOf,
  type WriteWorkspace,
} from "./thread-fixture.js";

const QUOTE = "assume a 30-year fixed at 6.1%";
const PARENT_BODY = `The model we ${QUOTE} which may be stale.\n`;

let ws: WriteWorkspace;

afterEach(() => {
  ws.close();
});

/** A `pre-commit` hook that always refuses, with recognisable output. */
function refuseCommits(workspace: WriteWorkspace): void {
  const hook = join(workspace.root, ".git", "hooks", "pre-commit");
  mkdirSync(join(workspace.root, ".git", "hooks"), { recursive: true });
  writeFileSync(hook, "#!/bin/sh\necho 'doc check: refusing' >&2\nexit 1\n", "utf8");
  chmodSync(hook, 0o755);
}

const codesOf = (payload: unknown): string[] =>
  ((payload as { warnings?: { code: string }[] }).warnings ?? []).map((warning) => warning.code);

async function framesDuring(run: () => Promise<unknown>): Promise<QueryKey[][]> {
  const frames: QueryKey[][] = [];
  const unsubscribe = ws.server.bus.subscribe((keys) => frames.push(keys.map((key) => [...key])));
  try {
    await run();
  } finally {
    unsubscribe();
  }
  return frames;
}

describe("§11 warnings reach every thread response (CONTRACT-006)", () => {
  beforeEach(() => {
    ws = createThreadWorkspace("warnings");
  });

  it("carries `commit_failed` on creation, and the mutation still stands", async () => {
    const parent = await createDoc(ws, { type: "note", title: "Model", body: PARENT_BODY });
    const before = ws.log("%H").length;
    refuseCommits(ws);

    const response = await ws.post("/api/threads", {
      parent: parent.id,
      selector: { exact: QUOTE },
      body: "is this right?",
    });
    const payload = (await response.json()) as { thread: { id: string } };

    expect(response.status).toBe(201);
    expect(codesOf(payload)).toContain("commit_failed");
    // §11: the file is the source of truth, so a rejected commit does not roll
    // the write back — it surfaces loudly.
    expect(ws.exists(threadPath(payload.thread.id))).toBe(true);
    expect(ws.log("%H")).toHaveLength(before);
  });

  it.each([
    [
      "a turn",
      async (id: string): Promise<Response> => ws.post(`/api/threads/${id}/turns`, { body: "two" }),
    ],
    [
      "a turn deletion",
      async (id: string): Promise<Response> =>
        ws.del(`/api/threads/${id}/turns/${encodeURIComponent(turnsOf(ws, id)[0]?.ts ?? "")}`),
    ],
  ])("carries `commit_failed` on %s", async (_label, act) => {
    const created = await createThread(ws, { body: "one" });
    await appendTurn(ws, created.id, { body: "two" });
    refuseCommits(ws);

    const response = await act(created.id);
    expect(response.status).toBeLessThan(300);
    expect(codesOf(await response.json())).toContain("commit_failed");
  });

  it("carries `commit_failed` on a capture", async () => {
    refuseCommits(ws);
    const response = await postForm(ws, "/api/capture", [["text", "call the bank"]]);
    expect(response.status).toBe(201);
    expect(codesOf(await response.json())).toContain("commit_failed");
  });

  // The rider CONTRACT-007 landed: resolving rewrites the thread's frontmatter
  // and auto-commits it, so these two owed §11 a response field exactly as the
  // other four verbs do. They computed the warnings all along and could only
  // log them.
  it.each([
    ["resolve", "resolved"],
    ["reopen", "open"],
  ])("carries `commit_failed` on %s, and the status change still stands", async (verb, status) => {
    const created = await createThread(ws, { body: "one" });
    if (verb === "reopen") await ws.post(`/api/threads/${created.id}/resolve`, {});
    refuseCommits(ws);
    const before = ws.log("%H").length;

    const response = await ws.post(`/api/threads/${created.id}/${verb}`, {});
    const payload = (await response.json()) as { thread: { status: string } };

    expect(response.status).toBe(200);
    expect(codesOf(payload)).toContain("commit_failed");
    // The write stands on disk and in the projection; only the commit did not.
    expect(payload.thread.status).toBe(status);
    expect(threadFrontmatterOf(ws, created.id)["status"]).toBe(status);
    expect(ws.log("%H")).toHaveLength(before);
  });
});

describe("a workspace with no git stays fully usable", () => {
  beforeEach(() => {
    ws = createThreadWorkspace("nogit", { git: false });
  });

  it("creates threads and appends turns, warning that nothing was committed", async () => {
    const response = await ws.post("/api/threads", { body: "asking" });
    const payload = (await response.json()) as { thread: { id: string } };

    expect(response.status).toBe(201);
    expect(codesOf(payload)).toContain("commit_skipped");
    expect(ws.exists(threadPath(payload.thread.id))).toBe(true);

    const appended = await ws.post(`/api/threads/${payload.thread.id}/turns`, { body: "second" });
    expect(appended.status).toBe(201);
    expect(codesOf(await appended.json())).toContain("commit_skipped");
    expect(turnsOf(ws, payload.thread.id)).toHaveLength(2);
  });
});

describe("invalidation keys (SPEC.md §2.2 rule 3)", () => {
  beforeEach(() => {
    ws = createThreadWorkspace("keys");
  });

  it("announces the thread, its parent, the collection and the tree on anchored creation", async () => {
    const parent = await createDoc(ws, { type: "note", title: "Model", body: PARENT_BODY });
    let id = "";

    const frames = await framesDuring(async () => {
      const created = await createThread(ws, {
        parent: parent.id,
        selector: { exact: QUOTE },
        body: "?",
      });
      id = created.id;
    });

    expect(frames).toEqual([
      [["docs"], ["docs", id], ["threads", id], ["docs", parent.id], ["tree"], ["reflect"]],
    ]);
  });

  it("announces only the thread and the collection for a standalone thread", async () => {
    let id = "";
    const frames = await framesDuring(async () => {
      id = (await createThread(ws, { body: "asking" })).id;
    });
    expect(frames).toEqual([[["docs"], ["docs", id], ["threads", id], ["reflect"]]]);
  });

  // The media type is a wire detail; what the board has to refetch is not. Both
  // branches run the same `runMutation` with the same plan, and this is what
  // says so from the outside.
  it("announces exactly the same frame for a multipart creation as for a JSON one", async () => {
    const parent = await createDoc(ws, { type: "note", title: "Model", body: PARENT_BODY });
    let id = "";

    const frames = await framesDuring(async () => {
      const response = await postForm(ws, "/api/threads", [
        ["parent", parent.id],
        ["selector", JSON.stringify({ exact: QUOTE })],
        ["text", "?"],
        ["files", new File(["png-bytes"], "shot.png", { type: "image/png" })],
      ]);
      expect(response.status).toBe(201);
      id = ((await response.json()) as { thread: { id: string } }).thread.id;
    });

    expect(frames).toEqual([
      [["docs"], ["docs", id], ["threads", id], ["docs", parent.id], ["tree"], ["reflect"]],
    ]);
  });

  it("announces the queue as well when a turn wakes the agent", async () => {
    const created = await createThread(ws, { body: "first" });

    const frames = await framesDuring(() =>
      appendTurn(ws, created.id, { body: "@agent look", requestsAgent: true }),
    );

    // The write's own frame, then the queue service's — enqueue announces the
    // queue, the job list, the document collection (`["docs"]` because the
    // `failed-job` needs reason reads `events.status`, SERVER-028) and, since
    // SERVER-155, the roster: the event lands in `pending/` and moves its lane's
    // count, which is what the orchestrator starts a listener from.
    expect(frames).toEqual([
      [["docs"], ["docs", created.id], ["threads", created.id], ["reflect"]],
      [["queue"], ["jobs"], ["docs"], ["agents"], ["reflect"]],
    ]);
  });

  it("announces the thread and its parent on a turn deletion", async () => {
    const parent = await createDoc(ws, { type: "note", title: "Model", body: PARENT_BODY });
    const created = await createThread(ws, { parent: parent.id, body: "one" });
    await appendTurn(ws, created.id, { body: "two" });
    const stamp = turnsOf(ws, created.id)[0]?.ts ?? "";

    const frames = await framesDuring(() =>
      ws.del(`/api/threads/${created.id}/turns/${encodeURIComponent(stamp)}`),
    );

    expect(frames).toEqual([
      [["docs"], ["docs", created.id], ["threads", created.id], ["docs", parent.id], ["reflect"]],
    ]);
  });

  it("never carries data — only keys (§2 rule 3)", async () => {
    const frames = await framesDuring(() => createThread(ws, { body: "asking" }));
    for (const key of frames.flat()) {
      expect(Array.isArray(key)).toBe(true);
      for (const segment of key) expect(typeof segment).toBe("string");
    }
  });
});

describe("the queue and the auto-commit", () => {
  beforeEach(() => {
    ws = createThreadWorkspace("pipeline");
  });

  // Proof the thread path used `server.queue.enqueue` and not a file drop: only
  // the service notifies waiters, and a parked `idle` is what the agent's loop
  // is blocked on (SPEC.md §7).
  it("wakes a parked long-poll", async () => {
    const created = await createThread(ws, { body: "first" });
    const parked = ws.server.queue.idle({ timeoutMs: 5_000 });
    // `idle` scans the queue directory before it parks, so the waiter appears a
    // tick later; waiting for it is what makes this a wake rather than a poll.
    while (ws.server.queue.parked === 0) {
      await new Promise((settle) => setTimeout(settle, 5));
    }

    const started = Date.now();
    await appendTurn(ws, created.id, { body: "@agent are you there?" });
    const available = await parked;

    expect(available?.events).toHaveLength(1);
    expect(available?.events[0]?.type).toBe("comment.created");
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(ws.server.queue.parked).toBe(0);
  });

  it("folds two same-actor thread writes inside the squash window into one commit", async () => {
    const created = await createThread(ws, { body: "first" });
    const before = ws.log("%H").length;

    await appendTurn(ws, created.id, { body: "second" });
    expect(ws.log("%H")).toHaveLength(before);

    // The other actor starts a fresh commit, and so does the same actor past the window.
    await appendTurn(ws, created.id, { body: "third" }, "agent");
    expect(ws.log("%H")).toHaveLength(before + 1);
    ws.advance(31_000);
    await appendTurn(ws, created.id, { body: "fourth" }, "agent");
    expect(ws.log("%H")).toHaveLength(before + 2);
  });

  it("commits with the acting party as git author (SPEC.md §4)", async () => {
    const created = await createThread(ws, { body: "first" });
    await appendTurn(ws, created.id, { body: "second" }, "agent");
    expect(ws.log("%an").slice(0, 2)).toEqual(["agent", "user"]);
  });
});
