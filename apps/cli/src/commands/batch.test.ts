import { afterEach, describe, expect, it } from "vitest";
import {
  BatchFailedError,
  ExitCode,
  exitCodeFor,
  ServerResponseError,
  ServerUnreachableError,
  UsageError,
} from "../errors.js";
import type { InputDependencies } from "../input.js";
import { collectRegistryProblems } from "../registry/validate.js";
import type { Registry, WorkspaceCommandContext, WorkspaceCommandSpec } from "../registry/types.js";
import {
  closeStubServers,
  jsonResponder,
  sendJson,
  startStubServer,
  stubContext,
  type StubContextOptions,
  type StubResponder,
  type StubServer,
} from "../testing/stub-server.js";
import {
  batchCommand,
  entryRule,
  MAX_BATCH_COMMANDS,
  runBatch,
  type BatchEntryReport,
} from "./batch.js";

/**
 * The property the whole verb exists for (CLI-064): after a batch, three states
 * are distinguishable per command, positionally, in both output forms — ran and
 * succeeded, ran and failed, never ran. The mandated test is the partial
 * failure; everything else here defends the decisions the issue records.
 */

afterEach(closeStubServers);

/** What the fixture handlers saw happen, in order. */
interface Run {
  readonly name: string;
  readonly actor: string;
}

interface Fixture {
  readonly registry: Registry;
  readonly runs: readonly Run[];
}

const verb = (
  name: string,
  handler: WorkspaceCommandSpec["handler"],
  overrides: Partial<Pick<WorkspaceCommandSpec, "args" | "flags">> = {},
): WorkspaceCommandSpec => ({
  name,
  summary: `Fixture verb ${name}.`,
  args: overrides.args ?? [],
  flags: overrides.flags ?? [],
  examples: [{ command: `corpus t ${name}`, description: "Fixture." }],
  handler,
});

/**
 * A registry of controlled outcomes, so the batch's failure semantics are
 * driven directly rather than through a server scripted per shape. The one
 * real-transport test below uses the shipped registry against a stub server.
 */
function fixture(): Fixture {
  const runs: Run[] = [];
  const saw = (name: string, context: WorkspaceCommandContext): void => {
    runs.push({ name, actor: context.actor });
  };

  const registry: Registry = {
    summary: "a batch-test surface.",
    commands: [
      {
        name: "batch",
        summary: "Stands in for the real batch, for the nesting refusal.",
        args: [],
        flags: [],
        examples: [{ command: "corpus batch", description: "Fixture." }],
        handler: async () => {
          await Promise.resolve();
        },
      },
      {
        name: "upgrade",
        summary: "Stands in for the real upgrade, for its refusal.",
        args: [],
        flags: [],
        examples: [{ command: "corpus upgrade", description: "Fixture." }],
        handler: async () => {
          await Promise.resolve();
        },
      },
      {
        name: "bootstrap",
        summary: "Runs without a workspace.",
        requiresWorkspace: false,
        args: [],
        flags: [],
        examples: [{ command: "corpus bootstrap", description: "Fixture." }],
        handler: async () => {
          await Promise.resolve();
        },
      },
    ],
    topics: [
      {
        name: "t",
        summary: "Fixture verbs.",
        commands: [
          verb("ok", async (context) => {
            saw("ok", context);
            context.out.emit({ answer: 42 });
            context.out.line("ok did its work");
            await Promise.resolve();
          }),
          verb("quiet", async (context) => {
            saw("quiet", context);
            context.out.line("quiet said only this");
            await Promise.resolve();
          }),
          verb(
            "show",
            async (context) => {
              saw("show", context);
              context.out.emit({ id: context.args.get("id") });
              await Promise.resolve();
            },
            { args: [{ name: "id", required: true, description: "An id." }] },
          ),
          verb("fail", async (context) => {
            saw("fail", context);
            await Promise.resolve();
            throw new ServerResponseError("404 not_found: no such document.", {
              code: "not_found",
              status: 404,
            });
          }),
          verb("dead", async (context) => {
            saw("dead", context);
            await Promise.resolve();
            throw new ServerUnreachableError(
              "server not running for this workspace — run `corpus server start`",
            );
          }),
          verb("auth", async (context) => {
            saw("auth", context);
            await Promise.resolve();
            throw new ServerResponseError("401 unauthorized: bad token.", {
              code: "unauthorized",
              status: 401,
            });
          }),
          verb("boom", async (context) => {
            saw("boom", context);
            await Promise.resolve();
            throw new Error("an unexpected defect");
          }),
        ],
      },
    ],
  };

  return { registry, runs };
}

async function* oneChunk(text: string): AsyncGenerator<string> {
  await Promise.resolve();
  yield text;
}

function stdinWith(commands: unknown): InputDependencies {
  return {
    stdinKind: "file",
    stdin: oneChunk(typeof commands === "string" ? commands : JSON.stringify(commands)),
  };
}

interface Harness {
  readonly context: WorkspaceCommandContext;
  stdout(): string;
  stderr(): string;
  readonly stub: StubServer;
}

async function harness(registry: Registry, options: StubContextOptions = {}): Promise<Harness> {
  const stub = await startStubServer(jsonResponder(200, {}));
  const built = stubContext(stub, { registry, ...options });
  return {
    context: built.context,
    stdout: () => built.stdout(),
    stderr: () => built.stderr(),
    stub,
  };
}

const reportsFrom = (stdout: string): readonly BatchEntryReport[] =>
  JSON.parse(stdout) as BatchEntryReport[];

describe("corpus batch — the mandated partial-failure test", () => {
  it("distinguishes succeeded, failed and never-ran per command under --json", async () => {
    const { registry, runs } = fixture();
    const h = await harness(registry, { json: true });
    const commands = [
      ["t", "ok"],
      ["t", "quiet"],
      ["t", "ok"],
      ["t", "dead"],
      ["t", "ok"],
    ];

    const failure = await runBatch(h.context, stdinWith(commands)).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BatchFailedError);
    expect(exitCodeFor(failure)).toBe(ExitCode.batchFailed);
    expect((failure as BatchFailedError).details).toEqual({ failed: [4], notRun: [5] });

    const reports = reportsFrom(h.stdout());
    expect(reports).toHaveLength(5);
    // Three succeeded — `ran` and `ok` both true, value carried.
    expect(reports[0]).toEqual({
      command: ["t", "ok"],
      ran: true,
      ok: true,
      value: { answer: 42 },
    });
    expect(reports[2]?.ok).toBe(true);
    // One ran and failed — the same problem object a lone failure's envelope carries.
    expect(reports[3]?.ran).toBe(true);
    expect(reports[3]?.ok).toBe(false);
    expect(reports[3]?.error?.code).toBe("server_unreachable");
    // One never ran — `ran: false`, and nothing else claimed about it.
    expect(reports[4]).toEqual({ command: ["t", "ok"], ran: false });
    // The fifth handler genuinely never executed.
    expect(runs.map((run) => run.name)).toEqual(["ok", "quiet", "ok", "dead"]);
  });

  it("distinguishes the same three states in the human rendering", async () => {
    const { registry } = fixture();
    const h = await harness(registry);
    const commands = [
      ["t", "ok"],
      ["t", "dead"],
      ["t", "quiet"],
    ];

    await expect(runBatch(h.context, stdinWith(commands))).rejects.toThrow(BatchFailedError);

    const out = h.stdout();
    expect(out).toContain(entryRule(1, "t ok"));
    expect(out).toContain("ok did its work");
    expect(out).toContain(entryRule(2, "t dead"));
    expect(out).toContain("corpus: server not running for this workspace");
    expect(out).toContain(entryRule(3, "t quiet"));
    expect(out).toContain("not run.");
    // The never-ran verb printed none of its own output.
    expect(out).not.toContain("quiet said only this");
  });
});

describe("corpus batch — every command runs", () => {
  it("charges a command-level failure to that command alone and keeps going", async () => {
    const { registry, runs } = fixture();
    const h = await harness(registry, { json: true });

    const failure = await runBatch(
      h.context,
      stdinWith([
        ["t", "ok"],
        ["t", "fail"],
        ["t", "quiet"],
      ]),
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BatchFailedError);
    expect((failure as BatchFailedError).details).toEqual({ failed: [2], notRun: [] });
    expect(runs.map((run) => run.name)).toEqual(["ok", "fail", "quiet"]);

    const reports = reportsFrom(h.stdout());
    expect(reports.map((report) => report.ran)).toEqual([true, true, true]);
    expect(reports.map((report) => report.ok)).toEqual([true, false, true]);
    expect(reports[1]?.error?.code).toBe("not_found");
  });

  it("treats an unexpected exception as that command's failure, not the batch's end", async () => {
    const { registry, runs } = fixture();
    const h = await harness(registry, { json: true });

    await expect(
      runBatch(
        h.context,
        stdinWith([
          ["t", "boom"],
          ["t", "ok"],
        ]),
      ),
    ).rejects.toThrow(BatchFailedError);

    expect(runs.map((run) => run.name)).toEqual(["boom", "ok"]);
    const reports = reportsFrom(h.stdout());
    expect(reports[0]?.error?.code).toBe("internal_error");
    expect(reports[1]?.ok).toBe(true);
  });

  it("ends the batch on a 401, which dooms every remaining command identically", async () => {
    const { registry, runs } = fixture();
    const h = await harness(registry, { json: true });

    const failure = await runBatch(
      h.context,
      stdinWith([
        ["t", "auth"],
        ["t", "ok"],
      ]),
    ).catch((error: unknown) => error);

    expect((failure as BatchFailedError).details).toEqual({ failed: [1], notRun: [2] });
    expect(runs.map((run) => run.name)).toEqual(["auth"]);
  });

  it("emits value: null for a command that ran and returned nothing", async () => {
    const { registry } = fixture();
    const h = await harness(registry, { json: true });

    await runBatch(h.context, stdinWith([["t", "quiet"]]));

    const reports = reportsFrom(h.stdout());
    // Explicitly null rather than absent: "ran and returned nothing" is
    // written down, so it can never be confused with "did not run".
    expect(reports).toEqual([{ command: ["t", "quiet"], ran: true, ok: true, value: null }]);
  });

  it("succeeds quietly with exit 0 semantics when every command succeeds", async () => {
    const { registry } = fixture();
    const h = await harness(registry);

    await runBatch(
      h.context,
      stdinWith([
        ["t", "ok"],
        ["t", "quiet"],
      ]),
    );

    expect(h.stdout()).toContain("all 2 commands succeeded.");
  });

  it("a batch of one is legal and still reports as an array of one", async () => {
    const { registry } = fixture();
    const h = await harness(registry, { json: true });

    await runBatch(h.context, stdinWith([["t", "ok"]]));

    expect(reportsFrom(h.stdout())).toHaveLength(1);
  });
});

describe("corpus batch — actors", () => {
  it("hands entries the batch's actor unless the entry names its own", async () => {
    const { registry, runs } = fixture();
    const h = await harness(registry, { actor: "agent" });

    await runBatch(
      h.context,
      stdinWith([
        ["t", "ok"],
        ["t", "quiet", "--from", "user"],
      ]),
    );

    expect(runs.map((run) => run.actor)).toEqual(["agent", "user"]);
  });

  it("refuses the whole batch, before anything runs, on a misspelled entry actor", async () => {
    const { registry, runs } = fixture();
    const h = await harness(registry);

    await expect(
      runBatch(
        h.context,
        stdinWith([
          ["t", "ok"],
          ["t", "quiet", "--from", "bogus"],
        ]),
      ),
    ).rejects.toThrow(UsageError);
    expect(runs).toEqual([]);
  });
});

describe("corpus batch — refused whole before anything runs", () => {
  const refusals: readonly [string, unknown, string][] = [
    ["an unknown verb", [["t", "nope"]], "command 1"],
    ["an unknown top-level name", [["nope"]], "command 1"],
    ["a topic with no verb", [["t"]], "without a verb"],
    ["a bare --help entry", [["--help"]], "help or the version"],
    ["an unknown flag", [["t", "ok", "--frobnicate"]], "does not parse"],
    ["a missing required argument", [["t", "show"]], "does not parse"],
    ["an entry naming --json", [["t", "ok", "--json"]], "--json"],
    ["an entry naming --help", [["t", "ok", "--help"]], "--help"],
    ["an entry naming --workspace", [["t", "ok", "--workspace", "/x"]], "--workspace"],
    ["a nested batch", [["batch"]], "batch inside a batch"],
    ["an upgrade", [["upgrade"]], "replaces the running tool"],
    ["a command that runs without a workspace", [["bootstrap"]], "without a workspace"],
    ["an empty batch", [], "empty"],
  ];

  it.each(refusals)("refuses %s at exit 2 with nothing run", async (_what, commands, needle) => {
    const { registry, runs } = fixture();
    const h = await harness(registry);

    const failure = await runBatch(h.context, stdinWith(commands)).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(UsageError);
    expect((failure as UsageError).message).toContain(needle);
    expect(runs).toEqual([]);
    expect(h.stub.requests).toHaveLength(0);
  });

  it("refuses more than the stated cap of commands, cap named", async () => {
    const { registry, runs } = fixture();
    const h = await harness(registry);
    const commands = Array.from({ length: MAX_BATCH_COMMANDS + 1 }, () => ["t", "ok"]);

    const failure = await runBatch(h.context, stdinWith(commands)).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(UsageError);
    expect((failure as UsageError).message).toContain(String(MAX_BATCH_COMMANDS));
    expect(runs).toEqual([]);
  });

  it("refuses stdin that is not JSON, and JSON that is not commands, naming the position", async () => {
    const { registry } = fixture();
    const h = await harness(registry);

    await expect(runBatch(h.context, stdinWith("not json ["))).rejects.toThrow(
      "the batch on stdin is not JSON.",
    );
    await expect(runBatch(h.context, stdinWith([["t", "ok"], "oops"]))).rejects.toThrow(
      "command 2",
    );
    await expect(runBatch(h.context, stdinWith({ commands: [] }))).rejects.toThrow("the top level");
  });

  it("refuses a socket stdin and reads nothing from it", async () => {
    const { registry } = fixture();
    const h = await harness(registry);

    await expect(runBatch(h.context, { stdinKind: "socket" })).rejects.toThrow("stdin is a socket");
  });

  it("says how to supply commands when stdin carries none", async () => {
    const { registry } = fixture();
    const h = await harness(registry);

    for (const kind of ["tty", "other"] as const) {
      await expect(runBatch(h.context, { stdinKind: kind })).rejects.toThrow(
        "no commands on stdin",
      );
    }
  });
});

describe("corpus batch — through the real registry and a real socket", () => {
  it("runs shipped verbs in order, one request each, one process", async () => {
    const { registry: real } = await import("../registry/index.js");
    const stub = await startStubServer(
      jsonResponder(200, { status: "ok", version: "0.0.0", uptimeSeconds: 1, workspace: "w" }),
    );
    const built = stubContext(stub, { registry: real, json: true });

    await runBatch(built.context, stdinWith([["health"], ["health"]]));

    expect(stub.requestsTo("/api/health")).toHaveLength(2);
    const reports = reportsFrom(built.stdout());
    expect(reports.map((report) => report.ok)).toEqual([true, true]);
    expect(reports[0]?.value).toMatchObject({ status: "ok" });
  });
});

/**
 * CLI-068. A batch runs each command through a nested output, and that output
 * used to report `json: false` whatever the invocation was. A command that
 * reads `out.json` to decide **what** it produces — rather than merely how it
 * prints it — was therefore told the wrong mode, and `queue claim-all` writes
 * its payload with `out.write` in human mode: inside `corpus batch --json` the
 * claim went to the channel a `--json` parent suppresses and the report said
 * `value: null` for a command that had just emptied the queue.
 *
 * These assert the payload's **contents**. A test checking `value !== null`
 * would pass on an empty object, and an empty claim reads as "nothing to do".
 */
describe("corpus batch — a command that reads the output mode (CLI-068)", () => {
  const CLAIMED = {
    events: [
      { id: "evt_sxgnzdvfb747", type: "comment.created", threadId: "th_o67m5q3s" },
      { id: "evt_9k2m4p1qr8sv", type: "document.updated", threadId: null },
    ],
    inProgress: { events: [], total: 0, truncated: false },
  };

  const QUEUE_STATUS = {
    agent: { live: false, since: null },
    halted: false,
    pending: 0,
    inProgress: 2,
    deferred: 0,
    processed: 0,
    failed: 0,
    abandoned: 0,
  };

  const queueResponder: StubResponder = (request, response) => {
    if (request.path === "/api/queue/claim-all") return sendJson(response, 200, CLAIMED);
    if (request.path === "/api/queue/status") return sendJson(response, 200, QUEUE_STATUS);
    return sendJson(response, 404, { code: "not_found", message: "no such route" });
  };

  it("carries queue claim-all's claim, field for field, beside a command that never lost one", async () => {
    const { registry: real } = await import("../registry/index.js");
    const stub = await startStubServer(queueResponder);
    const built = stubContext(stub, { registry: real, json: true });

    await runBatch(
      built.context,
      stdinWith([
        ["queue", "claim-all"],
        ["queue", "status"],
      ]),
    );

    const reports = reportsFrom(built.stdout());
    expect(reports.map((report) => report.ok)).toEqual([true, true]);
    // The contents, not the non-nullity: every claimed id and type, and the
    // in-progress set that rides beside them rather than inside them.
    expect(reports[0]?.value).toEqual(CLAIMED);
    expect(reports[1]?.value).toEqual(QUEUE_STATUS);
  });

  it("hands the batch exactly what the same claim carries when it runs alone", async () => {
    const { registry: real } = await import("../registry/index.js");
    const stub = await startStubServer(queueResponder);

    const batched = stubContext(stub, { registry: real, json: true });
    await runBatch(batched.context, stdinWith([["queue", "claim-all"]]));

    const alone = stubContext(stub, { registry: real, json: true });
    const claimAll = real.topics
      .find((topic) => topic.name === "queue")
      ?.commands.find((command) => command.name === "claim-all");
    await claimAll?.handler(alone.context);

    expect(reportsFrom(batched.stdout())[0]?.value).toEqual(JSON.parse(alone.stdout()));
  });

  it("does not turn a command that really emitted nothing into an empty object", async () => {
    // The other direction of the same guarantee: `value: null` still means
    // ran-and-returned-nothing, and the fix must not manufacture a payload.
    const { registry } = fixture();
    const h = await harness(registry, { json: true });

    await runBatch(h.context, stdinWith([["t", "quiet"]]));

    expect(reportsFrom(h.stdout())[0]).toEqual({
      command: ["t", "quiet"],
      ran: true,
      ok: true,
      value: null,
    });
  });

  it("lets doc list --fields see the --json its own refusal asks for", async () => {
    // The second site of the same cause: this verb refuses itself unless the
    // invocation is in `--json`, and inside a `--json` batch it used to be told
    // it was not — so a projection was unusable in the one place it saves most.
    const { registry: real } = await import("../registry/index.js");
    const stub = await startStubServer(
      jsonResponder(200, {
        items: [
          {
            id: "doc_a1b2c3",
            type: "note",
            status: "open",
            title: "Rate assumption",
            path: "data/docs/inbox/rate-assumption.md",
          },
        ],
        page: { total: 1, limit: 50, offset: 0 },
      }),
    );
    const built = stubContext(stub, { registry: real, json: true });

    await runBatch(built.context, stdinWith([["doc", "list", "--fields", "id,title"]]));

    const reports = reportsFrom(built.stdout());
    expect(reports[0]?.error).toBeUndefined();
    expect(reports[0]?.value).toEqual({
      items: [{ id: "doc_a1b2c3", title: "Rate assumption" }],
      page: { total: 1, limit: 50, offset: 0 },
    });
  });

  it("refuses server logs --follow inside a --json batch instead of streaming forever", async () => {
    // The third site: `--follow` is refused under `--json` because it never
    // returns. Told the mode was human, it followed the log and the batch hung.
    const { registry: real } = await import("../registry/index.js");
    const stub = await startStubServer(jsonResponder(200, {}));
    const built = stubContext(stub, { registry: real, json: true });

    const failure = await runBatch(built.context, stdinWith([["server", "logs", "-f"]])).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(BatchFailedError);
    expect(reportsFrom(built.stdout())[0]?.error?.message).toContain("--follow streams");
  });

  it("keeps human mode exactly as it was: the claim is still one line on stdout", async () => {
    const { registry: real } = await import("../registry/index.js");
    const stub = await startStubServer(queueResponder);
    const built = stubContext(stub, { registry: real });

    await runBatch(built.context, stdinWith([["queue", "claim-all"]]));

    expect(built.stdout()).toContain(JSON.stringify(CLAIMED));
  });
});

describe("the registry entry", () => {
  it("declares a valid command whose help states the non-transactional rule", () => {
    expect(collectRegistryProblems({ summary: "x", commands: [batchCommand], topics: [] })).toEqual(
      [],
    );
    expect(batchCommand.description).toContain("not a transaction");
    expect(batchCommand.description).toContain("not** a promise of atomicity");
  });
});
