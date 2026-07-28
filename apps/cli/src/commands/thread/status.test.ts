import { afterEach, describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor } from "../../errors.js";
import {
  closeStubServers,
  sendJson,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { runThreadStatus } from "./status.js";

const ARGS = { id: "th_a1b2c3" };

const thread = (status: "open" | "resolved") => ({
  id: "th_a1b2c3",
  title: "Re: the rate",
  created: "2026-07-27T10:00:00Z",
  updated: "2026-07-27T10:05:00Z",
  status,
  tags: [],
  parent: "doc_a1b2c3",
  anchor: "a_1",
  agent: "engaged",
  turns: [{ author: "user", ts: "2026-07-27T10:00:00Z", body: "hi" }],
});

const summary = (status: "open" | "resolved") => ({
  id: "th_a1b2c3",
  title: "Re: the rate",
  status,
  parent: "doc_a1b2c3",
  anchor: "a_1",
  agent: "engaged",
  created: "2026-07-27T10:00:00Z",
  updated: "2026-07-27T10:05:00Z",
  turnCount: 1,
  lastAuthor: "user",
  lastTs: "2026-07-27T10:00:00Z",
});

type Warning = { code: string; detail: string };

/**
 * Answers the read with `before` and the flip with the `{thread, warnings}`
 * mutation envelope the server actually returns.
 */
const scripted = (
  before: "open" | "resolved",
  after: "open" | "resolved",
  warnings: Warning[] = [],
) =>
  startStubServer((request, response) => {
    if (request.method === "GET") return sendJson(response, 200, thread(before));
    sendJson(response, 200, { thread: summary(after), warnings });
  });

const COMMIT_FAILED: Warning = {
  code: "commit_failed",
  detail: "pre-commit hook rejected the commit",
};

afterEach(closeStubServers);

describe("corpus thread resolve", () => {
  it("flips an open thread and prints one line", async () => {
    const stub = await scripted("open", "resolved");
    const harness = stubContext(stub, { args: ARGS, actor: "agent" });

    await runThreadStatus(harness.context, "resolved");

    const post = stub.requests[1];
    expect(post?.method).toBe("POST");
    expect(post?.path).toBe("/api/threads/th_a1b2c3/resolve");
    expect(post?.headers["x-corpus-author"]).toBe("agent");
    expect(harness.stdout()).toBe("resolved th_a1b2c3\n");
  });

  it("is idempotent: an already-resolved thread says so and exits 0", async () => {
    const stub = await scripted("resolved", "resolved");
    const harness = stubContext(stub, { args: ARGS });

    await runThreadStatus(harness.context, "resolved");

    expect(harness.stdout()).toBe("th_a1b2c3 is already resolved\n");
  });

  it("emits the whole {thread, warnings} envelope under --json", async () => {
    const stub = await scripted("open", "resolved", [COMMIT_FAILED]);
    const harness = stubContext(stub, { args: ARGS, json: true });

    await runThreadStatus(harness.context, "resolved");

    expect(JSON.parse(harness.stdout())).toEqual({
      thread: summary("resolved"),
      warnings: [COMMIT_FAILED],
    });
  });

  it("appends a §14 warning raised by the auto-commit to the printed line", async () => {
    const stub = await scripted("open", "resolved", [COMMIT_FAILED]);
    const harness = stubContext(stub, { args: ARGS });

    await runThreadStatus(harness.context, "resolved");

    expect(harness.stdout()).toBe(
      "resolved th_a1b2c3 — warning: commit_failed (pre-commit hook rejected the commit)\n",
    );
  });

  it("summarises several warnings by code", async () => {
    const stub = await scripted("open", "resolved", [
      COMMIT_FAILED,
      { code: "anchor_orphaned", detail: "a_1 no longer matches" },
    ]);
    const harness = stubContext(stub, { args: ARGS });

    await runThreadStatus(harness.context, "resolved");

    expect(harness.stdout()).toBe(
      "resolved th_a1b2c3 — 2 warnings: commit_failed, anchor_orphaned\n",
    );
  });
});

describe("corpus thread reopen", () => {
  it("flips a resolved thread back", async () => {
    const stub = await scripted("resolved", "open");
    const harness = stubContext(stub, { args: ARGS });

    await runThreadStatus(harness.context, "open");

    expect(stub.requests[1]?.path).toBe("/api/threads/th_a1b2c3/reopen");
    expect(harness.stdout()).toBe("reopened th_a1b2c3\n");
  });

  it("is idempotent on an already-open thread", async () => {
    const stub = await scripted("open", "open");
    const harness = stubContext(stub, { args: ARGS });

    await runThreadStatus(harness.context, "open");

    expect(harness.stdout()).toBe("th_a1b2c3 is already open\n");
  });

  it("appends a §14 warning raised by the auto-commit to the printed line", async () => {
    const stub = await scripted("resolved", "open", [COMMIT_FAILED]);
    const harness = stubContext(stub, { args: ARGS });

    await runThreadStatus(harness.context, "open");

    expect(harness.stdout()).toBe(
      "reopened th_a1b2c3 — warning: commit_failed (pre-commit hook rejected the commit)\n",
    );
  });

  it("reports an unknown thread as a server error", async () => {
    const stub = await startStubServer((_request, response) => {
      sendJson(response, 404, { code: "not_found", message: "no thread th_zzzzzzzz" });
    });
    const harness = stubContext(stub, { args: { id: "th_zzzzzzzz" } });

    const error: unknown = await runThreadStatus(harness.context, "open").catch(
      (cause: unknown) => cause,
    );

    expect(exitCodeFor(error)).toBe(ExitCode.serverError);
    expect(harness.stdout()).toBe("");
  });
});
