import { afterEach, describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor, ServerResponseError, UsageError } from "../../errors.js";
import {
  closeStubServers,
  jsonResponder,
  sendJson,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { runDefer } from "./defer.js";

const EVENT = {
  id: "evt_1111",
  type: "comment.created",
  created: "2026-07-30T10:00:00.000Z",
  source: "ui",
  payload: { threadId: "th_2222" },
};

const ARGS = { "event-id": "evt_1111" };
const BLOCKED_ON = { "blocked-on": "doc_a1b2c3" };

afterEach(closeStubServers);

describe("queue defer", () => {
  it("posts the blocking document to the contract's path and reports the state", async () => {
    const stub = await startStubServer(jsonResponder(200, EVENT));

    const harness = stubContext(stub, { args: ARGS, flags: BLOCKED_ON });
    await runDefer(harness.context);

    expect(stub.requests[0]?.method).toBe("POST");
    expect(stub.requests[0]?.path).toBe("/api/queue/evt_1111/defer");
    expect(JSON.parse(stub.requests[0]?.body ?? "null")).toEqual({ blockedOn: "doc_a1b2c3" });
    // Like its siblings: the response carries no status, so the line states the
    // event's state rather than claiming this call is what moved it.
    expect(harness.stdout()).toBe("event evt_1111 is deferred on doc_a1b2c3.\n");
  });

  it("sends the reason when one is given", async () => {
    const stub = await startStubServer(jsonResponder(200, EVENT));

    await runDefer(
      stubContext(stub, { args: ARGS, flags: { ...BLOCKED_ON, reason: "the user is editing it" } })
        .context,
    );

    expect(JSON.parse(stub.requests[0]?.body ?? "null")).toEqual({
      blockedOn: "doc_a1b2c3",
      reason: "the user is editing it",
    });
  });

  it("treats a blank reason as no reason, never as an empty string", async () => {
    const stub = await startStubServer(jsonResponder(200, EVENT));

    await runDefer(
      stubContext(stub, { args: ARGS, flags: { ...BLOCKED_ON, reason: "  " } }).context,
    );

    expect(JSON.parse(stub.requests[0]?.body ?? "null")).toEqual({ blockedOn: "doc_a1b2c3" });
  });

  it("trims the blocking document id rather than sending the spacing", async () => {
    const stub = await startStubServer(jsonResponder(200, EVENT));

    const harness = stubContext(stub, { args: ARGS, flags: { "blocked-on": " doc_a1b2c3 " } });
    await runDefer(harness.context);

    expect(JSON.parse(stub.requests[0]?.body ?? "null")).toEqual({ blockedOn: "doc_a1b2c3" });
    expect(harness.stdout()).toBe("event evt_1111 is deferred on doc_a1b2c3.\n");
  });

  it("emits the event verbatim under --json", async () => {
    const stub = await startStubServer(jsonResponder(200, EVENT));

    const harness = stubContext(stub, { args: ARGS, flags: BLOCKED_ON, json: true });
    await runDefer(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual(EVENT);
  });

  it.each([
    ["absent", {}],
    ["empty", { "blocked-on": "" }],
    ["only spacing", { "blocked-on": "   " }],
  ])("refuses a --blocked-on that is %s without sending a request", async (_case, flags) => {
    const stub = await startStubServer(jsonResponder(200, EVENT));

    const harness = stubContext(stub, { args: ARGS, flags });
    const error: unknown = await runDefer(harness.context).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(UsageError);
    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(error instanceof UsageError ? error.message : "").toContain("--blocked-on");
    // A deferral that named no document could never re-enter, so nothing is sent.
    expect(stub.requests).toEqual([]);
    expect(harness.stdout()).toBe("");
  });

  it.each([
    [409, "conflict", "queue event evt_1111 is pending; only claimed work can be deferred"],
    [404, "not_found", "no such event"],
  ])("surfaces the server's %i as exit 5 with its message", async (status, code, message) => {
    const stub = await startStubServer((_request, response) => {
      sendJson(response, status, { code, message });
    });

    const harness = stubContext(stub, { args: ARGS, flags: BLOCKED_ON });
    const error: unknown = await runDefer(harness.context).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ServerResponseError);
    expect(exitCodeFor(error)).toBe(ExitCode.serverError);
    expect(error instanceof Error ? error.message : "").toContain(message);
    expect(harness.stdout()).toBe("");
  });
});
