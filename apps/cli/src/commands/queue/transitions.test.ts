import { afterEach, describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor, ServerResponseError } from "../../errors.js";
import {
  closeStubServers,
  jsonResponder,
  sendJson,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { runAbandon, runComplete, runFail } from "./transitions.js";

const EVENT = {
  id: "evt_1111",
  type: "comment.created",
  created: "2026-07-27T10:00:00.000Z",
  source: "ui",
  payload: { threadId: "th_2222" },
};

const ARGS = { "event-id": "evt_1111" };

afterEach(closeStubServers);

describe("queue transitions", () => {
  it("completes through the contract's path and reports the state, not the move", async () => {
    const stub = await startStubServer(jsonResponder(200, EVENT));

    const harness = stubContext(stub, { args: ARGS });
    await runComplete(harness.context);

    expect(stub.requests[0]?.method).toBe("POST");
    expect(stub.requests[0]?.path).toBe("/api/queue/evt_1111/complete");
    // `QueueEvent` has no status, so the CLI cannot claim it moved the event —
    // repeating the call must print the same thing as the first.
    expect(harness.stdout()).toBe("event evt_1111 is complete.\n");
  });

  it("says the same thing when the event was already complete", async () => {
    const stub = await startStubServer(jsonResponder(200, EVENT));

    const first = stubContext(stub, { args: ARGS });
    await runComplete(first.context);
    const second = stubContext(stub, { args: ARGS });
    await runComplete(second.context);

    expect(second.stdout()).toBe(first.stdout());
  });

  it("emits the event verbatim under --json", async () => {
    const stub = await startStubServer(jsonResponder(200, EVENT));

    const harness = stubContext(stub, { args: ARGS, json: true });
    await runComplete(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual(EVENT);
  });

  it("sends no body at all for a bare fail", async () => {
    const stub = await startStubServer(jsonResponder(200, EVENT));

    await runFail(stubContext(stub, { args: ARGS }).context);

    expect(stub.requests[0]?.path).toBe("/api/queue/evt_1111/fail");
    expect(stub.requests[0]?.body).toBe("");
  });

  it("sends the reason when one is given", async () => {
    const stub = await startStubServer(jsonResponder(200, EVENT));

    await runFail(stubContext(stub, { args: ARGS, flags: { reason: "hook rejected" } }).context);

    expect(JSON.parse(stub.requests[0]?.body ?? "null")).toEqual({ reason: "hook rejected" });
  });

  it("treats a blank reason as no reason, never as an empty string", async () => {
    const stub = await startStubServer(jsonResponder(200, EVENT));

    await runFail(stubContext(stub, { args: ARGS, flags: { reason: "  " } }).context);

    expect(stub.requests[0]?.body).toBe("");
  });

  it("abandons with a DELETE, which moves rather than deletes", async () => {
    const stub = await startStubServer(jsonResponder(200, EVENT));

    const harness = stubContext(stub, { args: ARGS });
    await runAbandon(harness.context);

    expect(stub.requests[0]?.method).toBe("DELETE");
    expect(stub.requests[0]?.path).toBe("/api/queue/evt_1111");
    expect(harness.stdout()).toBe("event evt_1111 is abandoned.\n");
  });

  it("maps an unknown event id to exit 5 with an empty stdout", async () => {
    const stub = await startStubServer((_request, response) => {
      sendJson(response, 404, { code: "not_found", message: "no such event" });
    });

    const harness = stubContext(stub, { args: { "event-id": "evt_zzzz" } });
    const error: unknown = await runComplete(harness.context).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ServerResponseError);
    expect(exitCodeFor(error)).toBe(ExitCode.serverError);
    expect(harness.stdout()).toBe("");
  });
});
