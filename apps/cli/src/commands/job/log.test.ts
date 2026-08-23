import { afterEach, describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor, isCliError, UsageError } from "../../errors.js";
import { pipe, unreadable } from "../../testing/stdin.js";
import {
  closeStubServers,
  jsonResponder,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { runJobLog } from "./log.js";

const APPENDED = { eventId: "evt_1111", appended: true };
const ARGS = { "event-id": "evt_1111" };

afterEach(closeStubServers);

describe("corpus job log", () => {
  it("appends the positional line and says nothing in human mode", async () => {
    const stub = await startStubServer(jsonResponder(201, APPENDED));

    const harness = stubContext(stub, { args: { ...ARGS, line: "step 1: reading thread" } });
    await runJobLog(harness.context);

    const [request] = stub.requests;
    expect(request?.method).toBe("POST");
    expect(request?.path).toBe("/api/jobs/evt_1111/log");
    expect(JSON.parse(request?.body ?? "null")).toEqual({ line: "step 1: reading thread" });
    expect(harness.stdout()).toBe("");
    expect(harness.stderr()).toBe("");
  });

  it("holds its bearer token: the tokenless hole is for hooks, not for the CLI", async () => {
    const stub = await startStubServer(jsonResponder(201, APPENDED));

    await runJobLog(stubContext(stub, { args: { ...ARGS, line: "x" } }).context);

    expect(stub.requests[0]?.headers.authorization).toBe("Bearer 0123456789abcdef0123456789abcdef");
  });

  it("reads the line from stdin when the positional is omitted", async () => {
    const stub = await startStubServer(jsonResponder(201, APPENDED));

    const harness = stubContext(stub, { args: ARGS });
    await runJobLog(harness.context, { stdin: pipe("step 2\n"), stdinKind: "fifo" });

    expect(JSON.parse(stub.requests[0]?.body ?? "null")).toEqual({ line: "step 2" });
    expect(harness.stdout()).toBe("");
  });

  it("keeps interior newlines and sends them in one request", async () => {
    const stub = await startStubServer(jsonResponder(201, APPENDED));

    await runJobLog(stubContext(stub, { args: { ...ARGS, line: "a\nb" } }).context);

    expect(stub.requests).toHaveLength(1);
    expect(JSON.parse(stub.requests[0]?.body ?? "null")).toEqual({ line: "a\nb" });
  });

  it("emits the append result under --json, including a dropped line", async () => {
    const stub = await startStubServer(
      jsonResponder(201, { eventId: "evt_1111", appended: false }),
    );

    const harness = stubContext(stub, { args: { ...ARGS, line: "x" }, json: true });
    await runJobLog(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual({ eventId: "evt_1111", appended: false });
  });

  it("is a usage error when neither an argument nor stdin carries a line", async () => {
    const stub = await startStubServer(jsonResponder(201, APPENDED));

    const harness = stubContext(stub, { args: ARGS });
    const error: unknown = await runJobLog(harness.context, {
      stdin: pipe("\n"),
      stdinKind: "fifo",
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(UsageError);
    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(stub.requests).toHaveLength(0);
  });

  it("never reads a stdin that carries no body, so an agent harness cannot hang it", async () => {
    const stub = await startStubServer(jsonResponder(201, APPENDED));

    // The socket an agent harness hands down on fd 0: readable-looking, never
    // written to, never closed. Reading it would block forever (CLI-007), so
    // the probe says "no body" and the verb answers a usage error instead.
    const harness = stubContext(stub, { args: ARGS });
    const error: unknown = await runJobLog(harness.context, {
      stdin: unreadable(),
      stdinKind: "other",
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(UsageError);
    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(stub.requests).toHaveLength(0);
  });

  /**
   * CLI-066: the socket is refused **by name**. The generic "no line to append"
   * told a `spawnSync({ input })` caller to pipe the line in, which is precisely
   * what it had done — over the one transport that is never read.
   */
  it("names the socket rather than asking for the line that was already piped", async () => {
    const stub = await startStubServer(jsonResponder(201, APPENDED));
    const harness = stubContext(stub, { args: ARGS });

    const error: unknown = await runJobLog(harness.context, {
      stdin: unreadable(),
      stdinKind: "socket",
    }).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("stdin is a socket");
    expect(String(error)).not.toContain("no line to append");
    // The line is mandatory, so `< /dev/null` is not offered as a repair.
    expect(isCliError(error) ? (error.hint ?? "") : "").not.toContain("< /dev/null");
    expect(stub.requests).toHaveLength(0);
  });

  it("still logs the positional under a socket — the agent's own call, untouched", async () => {
    const stub = await startStubServer(jsonResponder(201, APPENDED));
    const harness = stubContext(stub, { args: { ...ARGS, line: "reading the thread" } });

    await runJobLog(harness.context, { stdin: unreadable(), stdinKind: "socket" });

    expect(JSON.parse(stub.requests[0]?.body ?? "{}")).toEqual({ line: "reading the thread" });
  });
});
