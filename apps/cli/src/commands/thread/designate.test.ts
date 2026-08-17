import { afterEach, describe, expect, it } from "vitest";
import { ServerResponseError, UsageError } from "../../errors.js";
import { collectRegistryProblems } from "../../registry/validate.js";
import {
  closeStubServers,
  jsonResponder,
  sendJson,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { designateCommand, runThreadDesignate } from "./designate.js";
import { threadTopic } from "./index.js";

const ARGS = { id: "th_4b8e2c" };

const THREAD = {
  id: "th_4b8e2c",
  title: "Q3 planning",
  status: "open",
  parent: null,
  anchor: null,
  agent: "none",
  resident: { name: "researcher", docId: "doc_r1" },
  created: "2026-08-16T09:00:00.000Z",
  updated: "2026-08-16T09:05:00.000Z",
  turnCount: 1,
  lastAuthor: "user",
  lastTs: "2026-08-16T09:00:00.000Z",
};

/** A typed refusal, exactly as the server sends one. */
function refusal(status: number, code: string, message: string) {
  return jsonResponder(status, { code, message });
}

afterEach(closeStubServers);

describe("corpus thread designate", () => {
  it("posts the name to the designation route and prints what it resolved to", async () => {
    const stub = await startStubServer(jsonResponder(200, { thread: THREAD, warnings: [] }));

    const harness = stubContext(stub, { args: ARGS, flags: { agent: "RESEARCHER" } });
    await runThreadDesignate(harness.context);

    const [request] = stub.requests;
    expect(request?.method).toBe("POST");
    expect(request?.path).toBe("/api/threads/th_4b8e2c/resident");
    expect(JSON.parse(request?.body ?? "")).toEqual({ name: "RESEARCHER" });
    // The resolution is the point: the caller typed one spelling and the server
    // answered with the agent-def it actually landed on.
    expect(harness.stdout()).toBe("designated researcher (doc_r1) on th_4b8e2c\n");
  });

  it("emits the mutation envelope untouched under --json", async () => {
    const response = { thread: THREAD, warnings: [] };
    const stub = await startStubServer(jsonResponder(200, response));

    const harness = stubContext(stub, { args: ARGS, flags: { agent: "researcher" }, json: true });
    await runThreadDesignate(harness.context);

    expect(harness.stdout()).toBe(`${JSON.stringify(response)}\n`);
  });

  it("appends a §14 warning to the line rather than hiding it", async () => {
    const stub = await startStubServer(
      jsonResponder(200, {
        thread: THREAD,
        warnings: [{ code: "commit_failed", detail: "pre-commit hook rejected the change" }],
      }),
    );

    const harness = stubContext(stub, { args: ARGS, flags: { agent: "researcher" } });
    await runThreadDesignate(harness.context);

    expect(harness.stdout()).toContain("— warning: commit_failed");
  });

  it("never reports a repeat as a no-op, because a repeat is not one", async () => {
    // Designating the resident a thread already has writes no file but still
    // announces — it is how a person asks for a stopped listener to be launched
    // again (SPEC.md §7). Saying "already designated" would report the one thing
    // the caller came to do as not having happened.
    const stub = await startStubServer(jsonResponder(200, { thread: THREAD, warnings: [] }));

    const harness = stubContext(stub, { args: ARGS, flags: { agent: "researcher" } });
    await runThreadDesignate(harness.context);

    expect(harness.stdout()).toBe("designated researcher (doc_r1) on th_4b8e2c\n");
    expect(harness.stdout()).not.toContain("already");
    // And nothing is read first: there is no state to compare against.
    expect(stub.requests).toHaveLength(1);
  });

  it("refuses to send a designation that names nobody", async () => {
    const stub = await startStubServer(jsonResponder(200, { thread: THREAD, warnings: [] }));

    const harness = stubContext(stub, { args: ARGS });
    await expect(runThreadDesignate(harness.context)).rejects.toBeInstanceOf(UsageError);

    expect(stub.requests).toEqual([]);
  });

  it("renders the server's 403 verbatim instead of pre-refusing the agent", async () => {
    // The server owns actors. A client-side check here would be a second source
    // of truth about who may designate (the reason `doc detach` has none).
    const stub = await startStubServer(
      refusal(
        403,
        "forbidden",
        "designating a resident is user-only; a resident claims a conversation",
      ),
    );

    const harness = stubContext(stub, {
      args: ARGS,
      flags: { agent: "researcher" },
      actor: "agent",
    });
    const thrown = await runThreadDesignate(harness.context).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(ServerResponseError);
    expect((thrown as ServerResponseError).message).toContain(
      "designating a resident is user-only",
    );
    // The request was actually sent, with the agent's header on it.
    expect(stub.requests[0]?.headers["x-corpus-author"]).toBe("agent");
  });

  it("renders the server's 409 for a thread that may not have a resident", async () => {
    const stub = await startStubServer(
      refusal(409, "conflict", "only a standalone thread may have a resident"),
    );

    const harness = stubContext(stub, { args: ARGS, flags: { agent: "researcher" } });
    const thrown = await runThreadDesignate(harness.context).catch((error: unknown) => error);

    expect((thrown as ServerResponseError).message).toBe(
      "409 conflict: only a standalone thread may have a resident",
    );
  });

  it("renders the server's 404 for a name that resolves to no agent-def", async () => {
    const stub = await startStubServer(
      refusal(404, "not_found", "no agent named nobody in this workspace"),
    );

    const harness = stubContext(stub, { args: ARGS, flags: { agent: "nobody" } });
    const thrown = await runThreadDesignate(harness.context).catch((error: unknown) => error);

    expect((thrown as ServerResponseError).message).toContain("no agent named nobody");
  });

  it("falls back to the caller's spelling if a 200 somehow carries no resident", async () => {
    const stub = await startStubServer((_request, response) => {
      sendJson(response, 200, { thread: { ...THREAD, resident: null }, warnings: [] });
    });

    const harness = stubContext(stub, { args: ARGS, flags: { agent: "researcher" } });
    await runThreadDesignate(harness.context);

    expect(harness.stdout()).toBe("designated researcher on th_4b8e2c\n");
  });
});

describe("the designate command spec", () => {
  it("keeps the thread topic a valid registry topic", () => {
    expect(collectRegistryProblems({ summary: "s.", commands: [], topics: [threadTopic] })).toEqual(
      [],
    );
  });

  it("takes one required thread id and requires --agent", () => {
    expect(designateCommand.args).toEqual([
      { name: "id", required: true, description: "The standalone thread's id." },
    ]);
    expect(designateCommand.flags.map((flag) => flag.name)).toEqual(["agent"]);
  });

  it("describes scope as a walk rather than as a guarantee about artifacts", () => {
    // SHARED-044: §7's "an artifact belongs to at most one scope" is not
    // delivered by its own clauses, so this surface describes how membership is
    // computed and never promises exclusivity.
    expect(designateCommand.description).toContain("a walk, not a label");
    expect(designateCommand.description).not.toContain("at most one scope");
  });

  it("says a repeat is not a no-op, which is what makes it a relaunch", () => {
    expect(designateCommand.description).toContain("a repeat is not a no-op");
  });

  it("is reachable as `corpus thread designate`", () => {
    expect(threadTopic.commands.map((command) => command.name)).toContain("designate");
  });
});
