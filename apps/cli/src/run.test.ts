import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InvocationReport } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { ExitCode, INTERNAL_ERROR_HINT } from "./errors.js";
import { fixtureRegistry, noopHandler } from "./registry/fixtures.js";
import { registry } from "./registry/index.js";
import type { Registry } from "./registry/types.js";
import { run } from "./run.js";

/**
 * The whole CLI, driven the way the bin drives it, against real sockets and real
 * temp-dir workspaces. Only argv, cwd, env and the two writers are injected.
 */

const TOKEN = "0123456789abcdef0123456789abcdef";
const HEALTH = { status: "ok", version: "9.9.9", uptimeSeconds: 42, workspace: "/tmp/ws" };

const servers: Server[] = [];
const scratchRoots: string[] = [];

async function listen(handler: (response: ServerResponse) => void): Promise<number> {
  const server = createServer((_request, response) => handler(response));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

async function healthServer(status = 200, body: unknown = HEALTH): Promise<number> {
  return listen((response) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
}

function workspaceDir(port: number): string {
  const root = mkdtempSync(join(tmpdir(), "corpus-cli-run-"));
  scratchRoots.push(root);
  mkdirSync(join(root, ".corpus"), { recursive: true });
  writeFileSync(
    join(root, ".corpus", "config.json"),
    JSON.stringify({ version: 1, port, token: TOKEN, dataDir: "data" }),
    "utf8",
  );
  return root;
}

function outsideWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "corpus-cli-none-"));
  scratchRoots.push(root);
  return root;
}

interface Invocation {
  readonly code: ExitCode;
  readonly stdout: string;
  readonly stderr: string;
  /**
   * Every cost report this run sent (SPEC.md §9.4), decoded from the body.
   *
   * The telemetry transport is injected rather than left on global `fetch`, so
   * the stub servers below never see a report: a test counting a command's
   * requests must not be counting this one, and one that reads the last request
   * it received must not be reading this one.
   */
  readonly reports: readonly InvocationReport[];
}

async function invoke(
  argv: readonly string[],
  overrides: {
    cwd?: string;
    env?: Record<string, string | undefined>;
    isTTY?: boolean;
    registry?: Registry;
    /** Replaces the capturing transport, for the failure cases. */
    telemetryFetch?: typeof globalThis.fetch;
  } = {},
): Promise<Invocation> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const reports: InvocationReport[] = [];
  let bytes = 0;

  const capture: typeof globalThis.fetch = (_input, init) => {
    const body: unknown = JSON.parse(typeof init?.body === "string" ? init.body : "null");
    if (body !== null && typeof body === "object" && "invocations" in body) {
      reports.push(...(body as { invocations: InvocationReport[] }).invocations);
    } else {
      reports.push(body as InvocationReport);
    }
    return Promise.resolve(new Response(null, { status: 204 }));
  };

  const code = await run({
    argv,
    cwd: overrides.cwd ?? outsideWorkspace(),
    env: overrides.env ?? {},
    stdout: (text) => {
      stdout.push(text);
      bytes += Buffer.byteLength(text, "utf8");
    },
    stderr: (text) => {
      stderr.push(text);
      bytes += Buffer.byteLength(text, "utf8");
    },
    isTTY: overrides.isTTY ?? false,
    version: "9.9.9",
    bytesWritten: () => bytes,
    telemetry: { fetch: overrides.telemetryFetch ?? capture },
    ...(overrides.registry === undefined ? {} : { registry: overrides.registry }),
  });
  return { code, stdout: stdout.join(""), stderr: stderr.join(""), reports };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
  for (const root of scratchRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("help and version", () => {
  it("prints top-level help and exits 0 for no arguments", async () => {
    const result = await invoke([]);
    expect(result.code).toBe(ExitCode.success);
    expect(result.stdout).toContain("corpus <command> [args] [flags]");
    expect(result.stdout).toContain("health");
    expect(result.stderr).toBe("");
  });

  it("prints the package version for --version", async () => {
    const result = await invoke(["--version"]);
    expect(result.code).toBe(ExitCode.success);
    expect(result.stdout).toBe("9.9.9\n");
  });

  it("prints the version even after a command name", async () => {
    expect((await invoke(["health", "--version"])).stdout).toBe("9.9.9\n");
  });

  it("renders all three help levels from the registry", async () => {
    const root = await invoke(["--help"], { registry: fixtureRegistry });
    expect(root.stdout).toContain("Topics:");
    expect(root.stdout).toContain("widget");

    const topic = await invoke(["widget", "--help"], { registry: fixtureRegistry });
    expect(topic.stdout).toContain("Verbs:");
    expect(topic.stdout).toContain("Show one widget.");

    const command = await invoke(["widget", "show", "--help"], { registry: fixtureRegistry });
    expect(command.stdout).toContain("corpus widget show <id> [flags]");
    expect(command.stdout).toContain("Examples:");
    expect(command.stdout).toContain("corpus widget show w-1");
    expect([root.code, topic.code, command.code]).toEqual([0, 0, 0]);
  });

  it("still prints human help when --json is combined with --help", async () => {
    const result = await invoke(["health", "--help", "--json"]);
    expect(result.code).toBe(ExitCode.success);
    expect(result.stdout).toContain("corpus health [flags]");
    expect(() => {
      JSON.parse(result.stdout);
    }).toThrow();
  });

  it("prints topic help for a topic named with no verb", async () => {
    const result = await invoke(["widget"], { registry: fixtureRegistry });
    expect(result.code).toBe(ExitCode.success);
    expect(result.stdout).toContain("corpus widget <verb> [args] [flags]");
  });
});

describe("--help=brief", () => {
  it("renders all three levels briefly and exits 0", async () => {
    const root = await invoke(["--help=brief"], { registry: fixtureRegistry });
    expect(root.stdout).toContain("Topics:");
    expect(root.stdout).not.toContain("Global flags:");

    const topic = await invoke(["widget", "--help=brief"], { registry: fixtureRegistry });
    expect(topic.stdout).toContain("Show one widget.");
    expect(topic.stdout).not.toContain("A fixture topic standing in");

    const command = await invoke(["widget", "show", "--help=brief"], {
      registry: fixtureRegistry,
    });
    expect(command.stdout).toContain("corpus widget show <id> [flags]");
    expect(command.stdout).not.toContain("Examples:");
    expect([root.code, topic.code, command.code]).toEqual([0, 0, 0]);
  });

  it("costs a fraction of the full text on a real verb", async () => {
    const words = (text: string): number => text.trim().split(/\s+/).length;
    const full = await invoke(["doc", "list", "--help"]);
    const brief = await invoke(["doc", "list", "--help=brief"]);
    expect(words(brief.stdout)).toBeLessThan(words(full.stdout) / 3);
    // Every flag name survives the cut — that is the whole point of the mode.
    for (const flag of ["--needs", "--is-parent", "--sort", "--limit"]) {
      expect(brief.stdout).toContain(flag);
    }
    // …and the prose does not.
    expect(full.stdout).toContain("SPEC.md §9.2");
    expect(brief.stdout.length).toBeLessThan(full.stdout.length);
  });

  it("leaves bare --help exactly as it was", async () => {
    const bare = await invoke(["doc", "list", "--help"]);
    const explicit = await invoke(["doc", "list", "--help=full"]);
    expect(bare.stdout).toBe(explicit.stdout);
    expect(bare.stdout).toContain("Examples:");
  });

  it("exits 2 on an unknown mode, at every level", async () => {
    for (const argv of [["--help=short"], ["doc", "--help=short"], ["doc", "list", "--help=x"]]) {
      const result = await invoke(argv);
      expect(result.code, argv.join(" ")).toBe(ExitCode.usageError);
      expect(result.stderr).toContain("unknown help mode");
      expect(result.stderr).toContain("--help=brief");
    }
  });

  it("does not swallow the token after --help", async () => {
    // `corpus --help doc` used to be impossible to get wrong because `--help`
    // was a boolean. Now that it carries a value, the `bareValue` rule is what
    // keeps `doc` a topic name rather than the help mode.
    const result = await invoke(["--help", "doc"]);
    expect(result.code).toBe(ExitCode.success);
    expect(result.stdout).toContain("corpus doc <verb> [args] [flags]");
  });
});

describe("usage errors", () => {
  it("exits 2 for an unknown command, listing the valid names", async () => {
    const result = await invoke(["nosuchtopic"]);
    expect(result.code).toBe(ExitCode.usageError);
    expect(result.stderr).toContain('unknown command "nosuchtopic"');
    // The names, not their order: which command happens to be listed first is
    // registration order and not a promise, so pinning it makes adding a
    // top-level verb fail a test about unknown commands.
    expect(result.stderr).toMatch(/Valid: .*\bhealth\b/);
    expect(result.stderr).toMatch(/Valid: .*\bthread\b/);
    expect(result.stdout).toBe("");
  });

  it("exits 2 for an unknown verb inside a topic", async () => {
    const result = await invoke(["widget", "nosuchverb"], { registry: fixtureRegistry });
    expect(result.code).toBe(ExitCode.usageError);
    expect(result.stderr).toContain('unknown verb "nosuchverb"');
  });

  it("suggests a near miss", async () => {
    const result = await invoke(["helth"]);
    expect(result.code).toBe(ExitCode.usageError);
    expect(result.stderr).toContain('Did you mean "health"?');
  });

  it("exits 2 for an unknown flag and for a missing required argument", async () => {
    expect((await invoke(["health", "--nope"])).code).toBe(ExitCode.usageError);
    const missing = await invoke(["widget", "show"], { registry: fixtureRegistry });
    expect(missing.code).toBe(ExitCode.usageError);
    expect(missing.stderr).toContain("missing required argument <id>");
  });

  it("reports usage errors as JSON on stderr under --json, with the same exit code", async () => {
    const human = await invoke(["nosuchtopic"]);
    const structured = await invoke(["nosuchtopic", "--json"]);
    expect(structured.code).toBe(human.code);
    expect(structured.stdout).toBe("");
    expect(JSON.parse(structured.stderr)).toMatchObject({
      error: { code: "usage_error" },
    });
  });
});

describe("workspace resolution", () => {
  it("exits 3 outside a workspace, naming `corpus init`", async () => {
    const result = await invoke(["health"], { cwd: outsideWorkspace() });
    expect(result.code).toBe(ExitCode.noWorkspace);
    expect(result.stderr).toContain("not inside a Corpus workspace — run `corpus init`");
  });

  it("resolves the workspace from three directories down", async () => {
    const port = await healthServer();
    const root = workspaceDir(port);
    const deep = join(root, "a", "b", "c");
    mkdirSync(deep, { recursive: true });

    const result = await invoke(["health"], { cwd: deep });
    expect(result.code).toBe(ExitCode.success);
    expect(result.stdout).toContain("ok — corpus 9.9.9");
  });

  it("accepts --workspace from outside any workspace", async () => {
    const port = await healthServer();
    const root = workspaceDir(port);
    const result = await invoke(["health", "--workspace", root], { cwd: outsideWorkspace() });
    expect(result.code).toBe(ExitCode.success);
  });

  it("exits 3 for an invalid workspace config", async () => {
    const root = outsideWorkspace();
    mkdirSync(join(root, ".corpus"), { recursive: true });
    writeFileSync(join(root, ".corpus", "config.json"), "{not json", "utf8");

    const result = await invoke(["health"], { cwd: root });
    expect(result.code).toBe(ExitCode.noWorkspace);
    expect(result.stderr).toContain("workspace config is invalid");
    expect(result.stderr).not.toContain("at Object");
  });
});

describe("corpus health against a real server", () => {
  it("is quiet on success without --json", async () => {
    const port = await healthServer();
    const result = await invoke(["health"], { cwd: workspaceDir(port) });
    expect(result.code).toBe(ExitCode.success);
    expect(result.stdout).toBe("ok — corpus 9.9.9, up 42s, workspace /tmp/ws\n");
    expect(result.stderr).toBe("");
  });

  it("writes exactly one JSON value on stdout with --json", async () => {
    const port = await healthServer();
    const result = await invoke(["health", "--json"], { cwd: workspaceDir(port) });
    expect(result.code).toBe(ExitCode.success);
    expect(JSON.parse(result.stdout)).toEqual(HEALTH);
    expect(result.stdout.trimEnd().split("\n")).toHaveLength(1);
    expect(result.stderr).toBe("");
  });

  it("exits 4 with the start instruction when nothing is listening", async () => {
    const port = await healthServer();
    await new Promise<void>((resolve) => {
      const server = servers.pop();
      if (server === undefined) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });

    const result = await invoke(["health"], { cwd: workspaceDir(port) });
    expect(result.code).toBe(ExitCode.serverUnreachable);
    expect(result.stderr).toContain(
      "server not running for this workspace — run `corpus server start`",
    );
    expect(result.stderr).not.toContain("ECONNREFUSED");
  });

  it("exits 5 with token guidance on 401", async () => {
    const port = await healthServer(401, { code: "unauthorized", message: "bad token" });
    const result = await invoke(["health"], { cwd: workspaceDir(port) });
    expect(result.code).toBe(ExitCode.serverError);
    expect(result.stderr).toContain("401 unauthorized: bad token");
    expect(result.stderr).toContain("The workspace bearer token was rejected");
  });

  it("keeps the exit code identical under --json, with the problem on stderr", async () => {
    const port = await healthServer(404, { code: "not_found", message: "gone" });
    const root = workspaceDir(port);
    const human = await invoke(["health"], { cwd: root });
    const structured = await invoke(["health", "--json"], { cwd: root });

    expect(structured.code).toBe(human.code);
    expect(structured.code).toBe(ExitCode.serverError);
    expect(structured.stdout).toBe("");
    expect(JSON.parse(structured.stderr)).toEqual({
      error: { code: "not_found", message: "404 not_found: gone", hint: null },
    });
  });

  it("honours --timeout, reporting a hung server as unreachable", async () => {
    const port = await listen(() => {
      // Never answers.
    });
    const result = await invoke(["health", "--timeout", "40"], { cwd: workspaceDir(port) });
    expect(result.code).toBe(ExitCode.serverUnreachable);
    expect(result.stderr).toContain("did not answer within 40ms");
  });

  it("reads the port and token overrides from the environment", async () => {
    const port = await healthServer();
    const root = workspaceDir(9999);
    const result = await invoke(["health"], {
      cwd: root,
      env: { CORPUS_PORT: String(port), CORPUS_TOKEN: "another-token" },
    });
    expect(result.code).toBe(ExitCode.success);
  });

  it("resolves the workspace from CORPUS_WORKSPACE", async () => {
    const port = await healthServer();
    const root = workspaceDir(port);
    const result = await invoke(["health"], {
      cwd: outsideWorkspace(),
      env: { CORPUS_WORKSPACE: root },
    });
    expect(result.code).toBe(ExitCode.success);
  });
});

describe("internal errors", () => {
  const explodingRegistry: Registry = {
    summary: "a registry whose handler throws.",
    commands: [
      {
        name: "boom",
        summary: "Throw an unexpected exception.",
        requiresWorkspace: false,
        args: [],
        flags: [],
        examples: [{ command: "corpus boom", description: "Explode." }],
        handler: async () => {
          await Promise.resolve();
          throw new Error("unexpected explosion");
        },
      },
    ],
    topics: [],
  };

  it("exits 1 and prints no stack without --verbose", async () => {
    const result = await invoke(["boom"], { registry: explodingRegistry });
    expect(result.code).toBe(ExitCode.internalError);
    expect(result.stderr).toBe("corpus: unexpected explosion\n");
  });

  it("prints the stack under --verbose", async () => {
    const result = await invoke(["boom", "--verbose"], { registry: explodingRegistry });
    expect(result.code).toBe(ExitCode.internalError);
    expect(result.stderr).toContain("Error: unexpected explosion");
    expect(result.stderr).toContain("run.test.ts");
  });

  it("reports an internal error as JSON under --json", async () => {
    const result = await invoke(["boom", "--json"], { registry: explodingRegistry });
    expect(JSON.parse(result.stderr)).toEqual({
      error: { code: "internal_error", message: "unexpected explosion", hint: INTERNAL_ERROR_HINT },
    });
  });
});

describe("colour and standalone commands", () => {
  it("emits no ANSI escapes when stdout is not a TTY", async () => {
    const result = await invoke(["--help"]);
    expect(result.stdout).not.toContain(String.fromCharCode(27));
  });

  it("emits ANSI escapes on a TTY, and none once --no-color is passed", async () => {
    const coloured = await invoke(["health", "--help"], { isTTY: true });
    expect(coloured.stdout).toContain(String.fromCharCode(27));

    const plain = await invoke(["health", "--help", "--no-color"], { isTTY: true });
    expect(plain.stdout).not.toContain(String.fromCharCode(27));
  });

  it("runs a requiresWorkspace: false command outside any workspace", async () => {
    const registry: Registry = {
      summary: "standalone only.",
      commands: [
        {
          name: "bootstrap",
          summary: "Run with no workspace.",
          requiresWorkspace: false,
          args: [],
          flags: [],
          examples: [{ command: "corpus bootstrap", description: "Bootstrap." }],
          handler: noopHandler,
        },
      ],
      topics: [],
    };
    const result = await invoke(["bootstrap"], { cwd: outsideWorkspace(), registry });
    expect(result.code).toBe(ExitCode.success);
    expect(result.stderr).toBe("");
  });
});

describe("actor attribution, resolved once by the dispatcher", () => {
  const seen: { header?: string | undefined; count: number } = { count: 0 };

  async function recordingServer(): Promise<number> {
    const server = createServer((request, response) => {
      seen.count += 1;
      seen.header = request.headers["x-corpus-author"] as string | undefined;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(HEALTH));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return (server.address() as AddressInfo).port;
  }

  afterEach(() => {
    seen.count = 0;
    seen.header = undefined;
  });

  it("attributes an unnamed actor to the user", async () => {
    const port = await recordingServer();
    const result = await invoke(["health"], { cwd: workspaceDir(port) });
    expect(result.code).toBe(ExitCode.success);
    expect(seen.header).toBe("user");
  });

  it("sends --from, and lets it beat CORPUS_FROM", async () => {
    const port = await recordingServer();
    const root = workspaceDir(port);

    await invoke(["health", "--from", "agent"], { cwd: root });
    expect(seen.header).toBe("agent");

    await invoke(["health"], { cwd: root, env: { CORPUS_FROM: "agent" } });
    expect(seen.header).toBe("agent");

    await invoke(["health", "--from", "user"], { cwd: root, env: { CORPUS_FROM: "agent" } });
    expect(seen.header).toBe("user");
  });

  it("rejects an unknown actor with exit 2 before any request leaves the process", async () => {
    const port = await recordingServer();
    const root = workspaceDir(port);

    const flag = await invoke(["health", "--from", "robot"], { cwd: root });
    expect(flag.code).toBe(ExitCode.usageError);
    expect(flag.stderr).toContain("--from must be one of: user, agent");

    const env = await invoke(["health"], { cwd: root, env: { CORPUS_FROM: "robot" } });
    expect(env.code).toBe(ExitCode.usageError);
    expect(env.stderr).toContain("CORPUS_FROM must be one of");

    expect(seen.count).toBe(0);
  });

  it("is documented in the root help's global flags, which every verb's page points at", async () => {
    // Since CLI-080 a verb's page carries the global flags as names on one
    // line — the glossed block lives on `corpus --help` alone.
    const root = await invoke(["--help"]);
    expect(root.stdout).toContain("--from <user|agent>");
    expect(root.stdout).toContain("CORPUS_FROM");

    const verb = await invoke(["doc", "create", "--help"]);
    expect(verb.stdout).toContain("--from");
    expect(verb.stdout).toContain("Global flags: --from,");
    expect(verb.stdout).toContain("(`corpus --help`)");
  });
});

/**
 * What every invocation weighs (SPEC.md §9.4, CLI-085), driven through the whole
 * dispatcher rather than through the reporter alone — the report is composed
 * from three facts that become available at three different moments, and it is
 * the composition this describes.
 */
describe("the invocation's own cost report", () => {
  it("reports the resolved command path, never the raw argv", async () => {
    const port = await healthServer();
    const result = await invoke(["health", "--json"], { cwd: workspaceDir(port) });

    expect(result.code).toBe(ExitCode.success);
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0]?.command).toBe("health");
  });

  it("composes topic and verb for a topic's verb", async () => {
    const port = await healthServer(404, { error: { code: "not_found", message: "gone" } });
    const result = await invoke(["doc", "show", "doc_a1b2c3"], { cwd: workspaceDir(port) });

    expect(result.reports[0]?.command).toBe("doc show");
  });

  it("counts what the command printed, to the byte", async () => {
    const port = await healthServer();
    const result = await invoke(["health", "--json"], { cwd: workspaceDir(port) });

    const printed = Buffer.byteLength(result.stdout + result.stderr, "utf8");
    expect(printed).toBeGreaterThan(0);
    expect(result.reports[0]?.readBytes).toBe(printed);
  });

  it("counts a failure's own output too, since the caller paid for it", async () => {
    const port = await healthServer(500, { error: { code: "internal", message: "boom" } });
    const result = await invoke(["health"], { cwd: workspaceDir(port) });

    expect(result.code).not.toBe(ExitCode.success);
    expect(result.stderr).not.toBe("");
    expect(result.reports[0]?.readBytes).toBe(
      Buffer.byteLength(result.stdout + result.stderr, "utf8"),
    );
  });

  it("counts the joined argv as what the caller wrote", async () => {
    const port = await healthServer();
    const result = await invoke(["health", "--json"], { cwd: workspaceDir(port) });

    expect(result.reports[0]?.wroteBytes).toBe(Buffer.byteLength("health --json", "utf8"));
  });

  it("counts a multi-byte argument in bytes, not characters", async () => {
    const port = await healthServer(404, { error: { code: "not_found", message: "gone" } });
    const argv = ["doc", "show", "doc_a1b2c3", "--section", "Café — notes"];
    const result = await invoke(argv, { cwd: workspaceDir(port) });

    const joined = argv.join(" ");
    expect(Buffer.byteLength(joined, "utf8")).toBeGreaterThan(joined.length);
    expect(result.reports[0]?.wroteBytes).toBe(Buffer.byteLength(joined, "utf8"));
  });

  it("names the documents the invocation itself named, positionally", async () => {
    const port = await healthServer(404, { error: { code: "not_found", message: "gone" } });
    const result = await invoke(["doc", "show", "doc_a1b2c3", "doc_d4e5f6"], {
      cwd: workspaceDir(port),
    });

    expect(result.reports[0]?.subjects).toEqual(["doc_a1b2c3", "doc_d4e5f6"]);
  });

  it("names a document that arrived in a flag", async () => {
    const port = await healthServer(200, { documents: [], total: 0, truncated: false });
    const result = await invoke(["doc", "list", "--parent", "doc_a1b2c3"], {
      cwd: workspaceDir(port),
    });

    expect(result.reports[0]?.subjects).toEqual(["doc_a1b2c3"]);
  });

  it("reports no subject for a verb that names none", async () => {
    // §9.4 attributes to the documents an invocation *named*. A search and a
    // listing name none: they take a query or filters, and the ids in their
    // output are the answer rather than the question.
    const port = await healthServer(200, { results: [], total: 0, truncated: false });
    const root = workspaceDir(port);

    const searched = await invoke(["search", "anything"], { cwd: root });
    expect(searched.reports).toHaveLength(1);
    expect(searched.reports[0]?.subjects).toEqual([]);

    const listed = await invoke(["doc", "list"], { cwd: root });
    expect(listed.reports).toHaveLength(1);
    expect(listed.reports[0]?.subjects).toEqual([]);
  });

  it("stamps when the invocation finished", async () => {
    const port = await healthServer();
    const result = await invoke(["health"], { cwd: workspaceDir(port) });

    const at = result.reports[0]?.at ?? "";
    expect(new Date(at).toISOString()).toBe(at);
  });

  it("sends exactly one report per invocation, and never one about itself", async () => {
    const port = await healthServer();
    const result = await invoke(["health"], { cwd: workspaceDir(port) });

    expect(result.reports).toHaveLength(1);
    expect(result.reports.map((one) => one.command)).toEqual(["health"]);
  });
});

describe("what is never measured", () => {
  it("reports nothing for help, at any level, in either register", async () => {
    const port = await healthServer();
    const root = workspaceDir(port);

    for (const argv of [
      [],
      ["--help"],
      ["--help=brief"],
      ["--version"],
      ["doc"],
      ["doc", "--help"],
      ["doc", "show", "--help"],
      ["health", "--version"],
    ]) {
      const result = await invoke(argv, { cwd: root });
      expect(result.reports, argv.join(" ")).toEqual([]);
    }
  });

  it("reports nothing for the commands that declare themselves unmeasured", async () => {
    // Declared on the command rather than listed in the dispatcher (SPEC.md
    // §9.4): the set is read off the registry here, so a verb added to it is
    // covered without touching this test.
    const excluded = [
      ...registry.commands.filter((command) => command.measured === false).map((c) => [c.name]),
      ...registry.topics.flatMap((topic) =>
        topic.commands
          .filter((command) => command.measured === false)
          .map((command) => [topic.name, command.name]),
      ),
    ];
    expect(excluded.map((argv) => argv.join(" "))).toEqual([
      "init",
      "upgrade",
      "server start",
      "server status",
      "server stop",
      "server logs",
    ]);

    const port = await healthServer();
    const root = workspaceDir(port);
    for (const argv of excluded) {
      const result = await invoke([...argv, "--help"], { cwd: root });
      expect(result.reports, argv.join(" ")).toEqual([]);
    }
  });

  it("reports nothing when there is no workspace to report to", async () => {
    const result = await invoke(["health"], { cwd: outsideWorkspace() });
    expect(result.code).toBe(ExitCode.noWorkspace);
    expect(result.reports).toEqual([]);
  });
});

/**
 * TEST-1202, and the reason §9.4 says what it says: the measurement is advisory,
 * so with nothing listening every verb must behave exactly as it did before this
 * feature existed. Asserted as an **absence** — no warning, no mention, no
 * second exit code — rather than as a tolerated diagnostic.
 */
describe("a server that is not running", () => {
  const deadTelemetry: typeof globalThis.fetch = () =>
    Promise.reject(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));

  async function bothWays(
    argv: readonly string[],
    cwd: string,
  ): Promise<{ readonly quiet: Invocation; readonly dead: Invocation }> {
    return {
      quiet: await invoke(argv, { cwd, telemetryFetch: () => Promise.reject(new Error("off")) }),
      dead: await invoke(argv, { cwd, telemetryFetch: deadTelemetry }),
    };
  }

  it("changes no verb's stdout, stderr or exit code", async () => {
    // A port with nothing behind it, so the command's own request fails exactly
    // as it does in the field — and the report's does too.
    const root = workspaceDir(1);

    for (const argv of [
      ["health"],
      ["doc", "show", "doc_a1b2c3"],
      ["doc", "edit", "doc_a1b2c3", "-m", "text"],
      ["doc", "show"],
      ["--help"],
      ["--version"],
    ]) {
      const { quiet, dead } = await bothWays(argv, root);
      expect(dead.code, argv.join(" ")).toBe(quiet.code);
      expect(dead.stdout, argv.join(" ")).toBe(quiet.stdout);
      expect(dead.stderr, argv.join(" ")).toBe(quiet.stderr);
    }
  });

  it("says nothing anywhere about telemetry, a report, or a measurement", async () => {
    const root = workspaceDir(1);
    const result = await invoke(["health"], { cwd: root, telemetryFetch: deadTelemetry });

    const everything = `${result.stdout}${result.stderr}`.toLowerCase();
    for (const word of ["telemetry", "report", "measure", "cost", "invocations"]) {
      expect(everything, word).not.toContain(word);
    }
  });

  it("cannot replace the exit code, even when composing the report throws", async () => {
    // `settle` runs from a `finally`, so anything it threw would become this
    // function's answer. The guarantee is structural rather than a claim about
    // three lines that happen not to throw today.
    const port = await healthServer();
    const stdout: string[] = [];
    const stderr: string[] = [];

    const code = await run({
      argv: ["health"],
      cwd: workspaceDir(port),
      env: {},
      stdout: (text) => void stdout.push(text),
      stderr: (text) => void stderr.push(text),
      isTTY: false,
      version: "9.9.9",
      bytesWritten: () => {
        throw new Error("the counter itself failed");
      },
    });

    expect(code).toBe(ExitCode.success);
    expect(stdout.join("")).toContain("ok — corpus");
    expect(stderr.join("")).toBe("");
  });

  it("still exits when the report's transport never settles", async () => {
    // The hazard sprint-025 P5 identifies: the bin sets `process.exitCode` and
    // never calls `process.exit`, so an unbounded request would hold the process
    // open. The cap is what stops that, and this is it exercised end to end.
    const port = await healthServer();
    const result = await invoke(["health"], {
      cwd: workspaceDir(port),
      telemetryFetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    });

    expect(result.code).toBe(ExitCode.success);
    expect(result.stderr).toBe("");
  });
});
