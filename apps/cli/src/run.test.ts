import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExitCode, INTERNAL_ERROR_HINT } from "./errors.js";
import { fixtureRegistry, noopHandler } from "./registry/fixtures.js";
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
}

async function invoke(
  argv: readonly string[],
  overrides: {
    cwd?: string;
    env?: Record<string, string | undefined>;
    isTTY?: boolean;
    registry?: Registry;
  } = {},
): Promise<Invocation> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run({
    argv,
    cwd: overrides.cwd ?? outsideWorkspace(),
    env: overrides.env ?? {},
    stdout: (text) => void stdout.push(text),
    stderr: (text) => void stderr.push(text),
    isTTY: overrides.isTTY ?? false,
    version: "9.9.9",
    ...(overrides.registry === undefined ? {} : { registry: overrides.registry }),
  });
  return { code, stdout: stdout.join(""), stderr: stderr.join("") };
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

describe("usage errors", () => {
  it("exits 2 for an unknown command, listing the valid names", async () => {
    const result = await invoke(["nosuchtopic"]);
    expect(result.code).toBe(ExitCode.usageError);
    expect(result.stderr).toContain('unknown command "nosuchtopic"');
    expect(result.stderr).toContain("Valid: health");
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

  it("is documented in the global flags every level of help renders", async () => {
    const root = await invoke(["--help"]);
    const verb = await invoke(["doc", "create", "--help"]);
    for (const text of [root.stdout, verb.stdout]) {
      expect(text).toContain("--from <user|agent>");
      expect(text).toContain("CORPUS_FROM");
    }
  });
});
