import { afterEach, describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor, ServerResponseError, UsageError } from "../../errors.js";
import {
  closeStubServers,
  jsonResponder,
  sendJson,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { AGENT_REFUSAL, breakCommand, runBreak } from "./break.js";

const BROKEN = { docId: "doc_a1b2c3", released: true, holder: "agent" };
const ARGS = { "doc-id": "doc_a1b2c3" };

afterEach(closeStubServers);

describe("corpus lock break", () => {
  it("acts as the user, because the server refuses a break from the agent", async () => {
    const stub = await startStubServer(jsonResponder(200, BROKEN));

    await runBreak(stubContext(stub, { args: ARGS, actor: "user" }).context);

    const [request] = stub.requests;
    expect(request?.method).toBe("POST");
    expect(request?.path).toBe("/api/locks/doc_a1b2c3/break");
    expect(request?.headers["x-corpus-author"]).toBe("user");
  });

  it("refuses `--from agent` before anything is sent, rather than rewriting it to user", async () => {
    const stub = await startStubServer(jsonResponder(200, BROKEN));

    const harness = stubContext(stub, { args: ARGS, actor: "agent" });
    const error: unknown = await runBreak(harness.context).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(UsageError);
    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect((error as Error).message).toBe(AGENT_REFUSAL);
    // The whole point of a client-side guard: the server never heard about it,
    // so nothing was attributed to the user who did not ask for it.
    expect(stub.requests).toHaveLength(0);
    expect(harness.stdout()).toBe("");
  });

  it("refuses the same way under --json, with nothing on stdout", async () => {
    const stub = await startStubServer(jsonResponder(200, BROKEN));

    const harness = stubContext(stub, { args: ARGS, actor: "agent", json: true });
    const error: unknown = await runBreak(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(stub.requests).toHaveLength(0);
    expect(harness.stdout()).toBe("");
  });

  it("names the holder it cleared", async () => {
    const stub = await startStubServer(jsonResponder(200, BROKEN));

    const harness = stubContext(stub, { args: ARGS });
    await runBreak(harness.context);

    expect(harness.stdout()).toBe("broke the agent lock on doc_a1b2c3.\n");
  });

  it("emits one JSON value naming what was broken", async () => {
    const stub = await startStubServer(jsonResponder(200, BROKEN));

    const harness = stubContext(stub, { args: ARGS, json: true });
    await runBreak(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual({
      docId: "doc_a1b2c3",
      broken: true,
      holder: "agent",
    });
  });

  it("treats an unlocked document as a stated no-op, not a failure", async () => {
    const stub = await startStubServer((_request, response) => {
      sendJson(response, 404, { code: "not_found", message: "no lock on doc_a1b2c3" });
    });

    const human = stubContext(stub, { args: ARGS });
    await runBreak(human.context);
    expect(human.stdout()).toBe("no lock held on doc_a1b2c3.\n");

    const machine = stubContext(stub, { args: ARGS, json: true });
    await runBreak(machine.context);
    expect(JSON.parse(machine.stdout())).toEqual({ docId: "doc_a1b2c3", broken: false });
  });

  it("still fails loudly on any other server error", async () => {
    const stub = await startStubServer((_request, response) => {
      sendJson(response, 403, { code: "forbidden", message: "user-only" });
    });

    const harness = stubContext(stub, { args: ARGS });
    const error: unknown = await runBreak(harness.context).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ServerResponseError);
    expect(exitCodeFor(error)).toBe(ExitCode.serverError);
    expect(harness.stdout()).toBe("");
  });

  it("documents the refusal and the 404 no-op in its help", () => {
    const text = `${breakCommand.description ?? ""} ${breakCommand.summary}`;
    expect(text).toContain("The agent may not run this");
    expect(text).toContain("--from agent");
    expect(text).toContain("exit 2");
    expect(text).toContain("no lock held");
    // The prose the guard replaced said the actor was silently overridden.
    expect(text).not.toContain("sends as **`user` rather than `agent`**");
  });
});
