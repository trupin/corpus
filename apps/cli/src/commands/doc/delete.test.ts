import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor, UsageError } from "../../errors.js";
import { resolveActor } from "../../input.js";
import { ParsedFlags } from "../../parse-args.js";
import {
  closeStubServers,
  jsonResponder,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { AGENT_REFUSAL, deleteCommand, promptOnTerminal, runDocDelete } from "./delete.js";

const ARGS = { id: "doc_a1b2c3" };
const DELETED = {
  deletedId: "doc_a1b2c3",
  orphanedThreadIds: ["th_x9y8", "th_1a2b"],
  warnings: [],
};

afterEach(closeStubServers);

describe("corpus doc delete — the user-only guard", () => {
  it("refuses --from agent client-side, with ZERO requests sent", async () => {
    const stub = await startStubServer(jsonResponder(200, DELETED));
    const harness = stubContext(stub, { args: ARGS, flags: { yes: true }, actor: "agent" });

    const error: unknown = await runDocDelete(harness.context).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(UsageError);
    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain(AGENT_REFUSAL);
    expect(stub.requests).toHaveLength(0);
    expect(harness.stdout()).toBe("");
  });

  it("refuses CORPUS_FROM=agent identically — the env is resolved before the guard", async () => {
    // The dispatcher's resolution, reproduced exactly: env, then the guard.
    const actor = resolveActor(new ParsedFlags(new Map()), { CORPUS_FROM: "agent" });
    expect(actor).toBe("agent");

    const stub = await startStubServer(jsonResponder(200, DELETED));
    const harness = stubContext(stub, { args: ARGS, flags: { yes: true }, actor });

    const error: unknown = await runDocDelete(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(stub.requests).toHaveLength(0);
  });

  it("points the agent at archive instead", async () => {
    const stub = await startStubServer(jsonResponder(200, DELETED));
    const harness = stubContext(stub, { args: ARGS, actor: "agent" });

    const error: unknown = await runDocDelete(harness.context).catch((cause: unknown) => cause);

    expect(error).toHaveProperty("hint", expect.stringContaining("corpus doc archive doc_a1b2c3"));
  });
});

describe("corpus doc delete — confirmation", () => {
  it("is a usage error without --yes when stdin is not a terminal, and reads nothing", async () => {
    const stub = await startStubServer(jsonResponder(200, DELETED));
    const harness = stubContext(stub, { args: ARGS, actor: "user" });

    const error: unknown = await runDocDelete(harness.context, { stdinIsTTY: false }).catch(
      (cause: unknown) => cause,
    );

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("--yes");
    expect(stub.requests).toHaveLength(0);
  });

  it("asks on a terminal, and deleting nothing is what a refused prompt means", async () => {
    const stub = await startStubServer(jsonResponder(200, DELETED));
    const harness = stubContext(stub, { args: ARGS, actor: "user" });
    const asked: string[] = [];

    const error: unknown = await runDocDelete(harness.context, {
      stdinIsTTY: true,
      confirm: (question) => {
        asked.push(question);
        return Promise.resolve(false);
      },
    }).catch((cause: unknown) => cause);

    expect(asked[0]).toContain("Delete doc_a1b2c3?");
    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(stub.requests).toHaveLength(0);
  });

  it("proceeds when the prompt is answered", async () => {
    const stub = await startStubServer(jsonResponder(200, DELETED));
    const harness = stubContext(stub, { args: ARGS, actor: "user" });

    await runDocDelete(harness.context, { stdinIsTTY: true, confirm: () => Promise.resolve(true) });

    expect(stub.requests[0]?.method).toBe("DELETE");
  });

  it("accepts only an explicit yes at the real prompt, and asks on stderr", async () => {
    const answers: Record<string, boolean> = {
      "y\n": true,
      "yes\n": true,
      "Y\n": true,
      "\n": false,
      "n\n": false,
      "sure\n": false,
    };

    for (const [typed, expected] of Object.entries(answers)) {
      const input = new PassThrough();
      const output = new PassThrough();
      const written: string[] = [];
      output.on("data", (chunk: Buffer) => written.push(chunk.toString("utf8")));

      const asked = promptOnTerminal("Delete doc_a1b2c3? [y/N] ", input, output);
      input.write(typed);
      await expect(asked).resolves.toBe(expected);
      expect(written.join("")).toContain("Delete doc_a1b2c3?");
    }
  });
});

describe("corpus doc delete — the deletion itself", () => {
  it("deletes as the user and names every thread it orphaned", async () => {
    const stub = await startStubServer(jsonResponder(200, DELETED));
    const harness = stubContext(stub, { args: ARGS, flags: { yes: true }, actor: "user" });

    await runDocDelete(harness.context);

    const [request] = stub.requests;
    expect(request?.method).toBe("DELETE");
    expect(request?.path).toBe("/api/docs/doc_a1b2c3");
    expect(request?.headers["x-corpus-author"]).toBe("user");
    expect(harness.stdout()).toBe("deleted doc_a1b2c3 — orphaned 2 threads (th_x9y8, th_1a2b)\n");
  });

  it("says only what happened when nothing was orphaned", async () => {
    const stub = await startStubServer(
      jsonResponder(200, { deletedId: "doc_a1b2c3", orphanedThreadIds: [], warnings: [] }),
    );
    const harness = stubContext(stub, { args: ARGS, flags: { yes: true }, actor: "user" });

    await runDocDelete(harness.context);

    expect(harness.stdout()).toBe("deleted doc_a1b2c3\n");
  });

  it("emits the server's result under --json", async () => {
    const stub = await startStubServer(jsonResponder(200, DELETED));
    const harness = stubContext(stub, {
      args: ARGS,
      flags: { yes: true },
      actor: "user",
      json: true,
    });

    await runDocDelete(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual(DELETED);
  });

  it("documents the guard and the cascade in its help", () => {
    const text = `${deleteCommand.description ?? ""} ${deleteCommand.summary}`;
    expect(text).toContain("user-only");
    expect(text).toContain("orphaned");
    expect(text).toContain("--yes");
  });
});
