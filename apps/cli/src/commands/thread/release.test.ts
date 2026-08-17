import type { ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { ServerResponseError } from "../../errors.js";
import { collectRegistryProblems } from "../../registry/validate.js";
import {
  closeStubServers,
  sendJson,
  startStubServer,
  stubContext,
  type StubRequest,
} from "../../testing/stub-server.js";
import { threadTopic } from "./index.js";
import { releaseCommand, runThreadRelease } from "./release.js";

const ARGS = { id: "th_4b8e2c" };

const THREAD = {
  id: "th_4b8e2c",
  title: "Q3 planning",
  created: "2026-08-16T09:00:00.000Z",
  updated: "2026-08-16T09:05:00.000Z",
  status: "open",
  tags: [],
  parent: null,
  anchor: null,
  agent: "none",
  resident: { name: "researcher", docId: "doc_r1" },
  turns: [],
};

const RELEASED_SUMMARY = {
  id: "th_4b8e2c",
  title: "Q3 planning",
  status: "open",
  parent: null,
  anchor: null,
  agent: "none",
  resident: null,
  created: "2026-08-16T09:00:00.000Z",
  updated: "2026-08-16T09:06:00.000Z",
  turnCount: 0,
  lastAuthor: "user",
  lastTs: "2026-08-16T09:00:00.000Z",
};

/**
 * The read, then the release — the route answers with `resident: null` either
 * way, so the pre-read is the only thing that can tell the two outcomes apart.
 */
function residentStub(
  resident: unknown,
  warnings: readonly unknown[] = [],
): (request: StubRequest, response: ServerResponse) => void {
  return (request, response) => {
    if (request.method === "GET") {
      sendJson(response, 200, { ...THREAD, resident });
      return;
    }
    sendJson(response, 200, { thread: RELEASED_SUMMARY, warnings });
  };
}

afterEach(closeStubServers);

describe("corpus thread release", () => {
  it("deletes the resident and names who was released", async () => {
    const stub = await startStubServer(residentStub(THREAD.resident));

    const harness = stubContext(stub, { args: ARGS });
    await runThreadRelease(harness.context);

    expect(stub.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      "GET /api/threads/th_4b8e2c",
      "DELETE /api/threads/th_4b8e2c/resident",
    ]);
    expect(harness.stdout()).toBe("released researcher from th_4b8e2c\n");
  });

  it("reports a release with nothing to release as exactly that", async () => {
    // Idempotent on the wire, and the response cannot say which happened — the
    // pre-read is what stops this claiming a change it did not make.
    const stub = await startStubServer(residentStub(null));

    const harness = stubContext(stub, { args: ARGS });
    await runThreadRelease(harness.context);

    expect(harness.stdout()).toBe("th_4b8e2c had no resident — nothing to release\n");
  });

  it("still sends the release when there was nobody, so the state is the one asked for", async () => {
    const stub = await startStubServer(residentStub(null));

    await runThreadRelease(stubContext(stub, { args: ARGS }).context);

    expect(stub.requests.map((request) => request.method)).toEqual(["GET", "DELETE"]);
  });

  it("is a no-op twice over: the second run reports nothing to release", async () => {
    let resident: unknown = THREAD.resident;
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") {
        sendJson(response, 200, { ...THREAD, resident });
        return;
      }
      resident = null;
      sendJson(response, 200, { thread: RELEASED_SUMMARY, warnings: [] });
    });

    const first = stubContext(stub, { args: ARGS });
    await runThreadRelease(first.context);
    const second = stubContext(stub, { args: ARGS });
    await runThreadRelease(second.context);

    expect(first.stdout()).toBe("released researcher from th_4b8e2c\n");
    expect(second.stdout()).toBe("th_4b8e2c had no resident — nothing to release\n");
  });

  it("emits the mutation envelope untouched under --json", async () => {
    const stub = await startStubServer(residentStub(THREAD.resident));

    const harness = stubContext(stub, { args: ARGS, json: true });
    await runThreadRelease(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual({ thread: RELEASED_SUMMARY, warnings: [] });
  });

  it("appends a §14 warning to the line rather than hiding it", async () => {
    const stub = await startStubServer(
      residentStub(THREAD.resident, [
        { code: "commit_failed", detail: "hook rejected the change" },
      ]),
    );

    const harness = stubContext(stub, { args: ARGS });
    await runThreadRelease(harness.context);

    expect(harness.stdout()).toContain("— warning: commit_failed");
  });

  it("renders the server's 403 verbatim instead of pre-refusing the agent", async () => {
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") {
        sendJson(response, 200, THREAD);
        return;
      }
      sendJson(response, 403, {
        code: "forbidden",
        message:
          "releasing a resident is user-only; it is the other half of the same user-only state",
      });
    });

    const harness = stubContext(stub, { args: ARGS, actor: "agent" });
    const thrown = await runThreadRelease(harness.context).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(ServerResponseError);
    expect((thrown as ServerResponseError).message).toContain("releasing a resident is user-only");
    expect(harness.stdout()).toBe("");
  });
});

describe("the release command spec", () => {
  it("keeps the thread topic a valid registry topic", () => {
    expect(collectRegistryProblems({ summary: "s.", commands: [], topics: [threadTopic] })).toEqual(
      [],
    );
  });

  it("takes one required thread id and no flags", () => {
    expect(releaseCommand.args).toEqual([
      { name: "id", required: true, description: "The thread's id." },
    ]);
    expect(releaseCommand.flags).toEqual([]);
  });

  it("says nothing already queued is re-routed, which is what makes releasing safe", () => {
    expect(releaseCommand.description).toContain("strands no queued work");
  });

  it("is reachable as `corpus thread release`", () => {
    expect(threadTopic.commands.map((command) => command.name)).toContain("release");
  });
});
