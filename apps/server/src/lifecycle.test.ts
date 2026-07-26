import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CorpusServer } from "./app.js";
import { CorpusError } from "./errors.js";
import { createLogger, type LogSink } from "./logger.js";
import {
  SHUTDOWN_GRACE_MS,
  SHUTDOWN_SIGNALS,
  parseServerArgs,
  runServerProcess,
  type ProcessHooks,
} from "./lifecycle.js";

const TOKEN = "tkn_0123456789abcdef0123456789abcdef";

/**
 * Every test that binds a socket takes an ephemeral port. Hard-coding 8765 here
 * would make the suite fail whenever a real workspace server is running.
 */
const EPHEMERAL: NodeJS.ProcessEnv = { CORPUS_PORT: "0" };

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-lifecycle-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.useRealTimers();
});

function makeWorkspace(
  name: string,
  config: unknown = { version: 1, port: 8765, token: TOKEN },
): string {
  const workspace = join(root, name);
  mkdirSync(join(workspace, ".corpus"), { recursive: true });
  writeFileSync(join(workspace, ".corpus", "config.json"), JSON.stringify(config), "utf8");
  return workspace;
}

interface Harness {
  hooks: ProcessHooks;
  lines: string[];
  exits: number[];
  signals: Map<string, Array<() => void>>;
  rejectionHandlers: Array<(reason: unknown) => void>;
  timers: Array<{ handler: () => void; ms: number; unrefCalls: number }>;
  logger: ReturnType<typeof createLogger>;
  /** Fires every handler registered for a signal, as the OS would. */
  raise(signal: string): void;
}

function harness(): Harness {
  const lines: string[] = [];
  const exits: number[] = [];
  const signals = new Map<string, Array<() => void>>();
  const rejectionHandlers: Array<(reason: unknown) => void> = [];
  const timers: Array<{ handler: () => void; ms: number; unrefCalls: number }> = [];
  const sink: LogSink = { write: (line) => lines.push(line) };

  const hooks: ProcessHooks = {
    onSignal: (signal, handler) => {
      const existing = signals.get(signal) ?? [];
      existing.push(handler);
      signals.set(signal, existing);
    },
    onUnhandledRejection: (handler) => rejectionHandlers.push(handler),
    exit: (code) => exits.push(code),
    setTimeout: (handler, ms) => {
      const timer = { handler, ms, unrefCalls: 0 };
      timers.push(timer);
      return {
        unref: () => {
          timer.unrefCalls += 1;
          return timer;
        },
      };
    },
  };

  return {
    hooks,
    lines,
    exits,
    signals,
    rejectionHandlers,
    timers,
    // `debug` so the harness sees the info-level boot and shutdown lines the
    // process really emits, not just its errors.
    logger: createLogger("debug", sink),
    raise(signal) {
      for (const handler of signals.get(signal) ?? []) handler();
    },
  };
}

describe("parseServerArgs", () => {
  it.each([
    [[], undefined],
    [["--workspace", "/ws"], "/ws"],
    [["--workspace=/ws"], "/ws"],
    [["-w", "/ws"], "/ws"],
    [["/ws"], "/ws"],
    [["--workspace", "/first", "--workspace", "/second"], "/second"],
  ])("parses %j as %j", (argv, expected) => {
    expect(parseServerArgs(argv).workspace).toBe(expected);
  });

  it.each([
    [["--workspace"], /--workspace requires a workspace directory/],
    [["-w"], /-w requires a workspace directory/],
    [["--workspace", "--other"], /requires a workspace directory/],
    [["--workspace="], /--workspace requires a workspace directory/],
    [["--bogus"], /unknown option --bogus/],
  ])("rejects %j", (argv, message) => {
    expect(() => parseServerArgs(argv)).toThrow(message);
    expect(() => parseServerArgs(argv)).toThrow(CorpusError);
  });
});

describe("runServerProcess — boot", () => {
  it("starts a real server and logs the bound URL", async () => {
    const workspace = makeWorkspace("ws");
    const h = harness();

    const server = await runServerProcess({
      argv: ["--workspace", workspace],
      env: EPHEMERAL,
      cwd: root,
      hooks: h.hooks,
      logger: h.logger,
    });

    expect(server).toBeDefined();
    try {
      const listening = h.lines
        .map((line) => JSON.parse(line) as { msg: string })
        .find((entry) => entry.msg.startsWith("listening on http://127.0.0.1:"));
      expect(listening).toBeDefined();
      expect(h.exits).toEqual([]);
    } finally {
      await server?.close();
    }
  });

  it("prefers the explicit argument over CORPUS_WORKSPACE", async () => {
    const fromArg = makeWorkspace("from-arg");
    const fromEnv = makeWorkspace("from-env");
    const h = harness();

    const server = await runServerProcess({
      argv: ["--workspace", fromArg],
      env: { ...EPHEMERAL, CORPUS_WORKSPACE: fromEnv },
      cwd: root,
      hooks: h.hooks,
      logger: h.logger,
    });

    try {
      expect(server?.config.workspaceRoot).toBe(fromArg);
    } finally {
      await server?.close();
    }
  });

  it("surfaces a short-token warning without failing", async () => {
    const workspace = makeWorkspace("short", { version: 1, port: 8765, token: "t" });
    const h = harness();

    const server = await runServerProcess({
      argv: [],
      env: { ...EPHEMERAL, CORPUS_WORKSPACE: workspace },
      cwd: root,
      hooks: h.hooks,
      logger: h.logger,
    });

    try {
      expect(h.lines.join("\n")).toContain("warning: the workspace token is 1 characters");
      expect(h.exits).toEqual([]);
    } finally {
      await server?.close();
    }
  });

  it.each([
    ["a missing workspace", { argv: [], env: {} }, /not a Corpus workspace/],
    ["an unknown option", { argv: ["--bogus"], env: {} }, /unknown option/],
  ])("exits 1 with a bare message for %s", async (_label, options, message) => {
    const h = harness();
    const empty = join(root, "empty");
    mkdirSync(empty, { recursive: true });

    const server = await runServerProcess({
      ...options,
      cwd: empty,
      hooks: h.hooks,
      logger: h.logger,
    });

    expect(server).toBeUndefined();
    expect(h.exits).toEqual([1]);
    expect(h.lines).toHaveLength(1);

    const entry = JSON.parse(h.lines[0] ?? "") as Record<string, unknown>;
    expect(entry.level).toBe("error");
    expect(String(entry.msg)).toMatch(message);
    // A deliberate, actionable failure carries no stack trace (TEST-34/37).
    expect(entry).not.toHaveProperty("stack");
  });

  it("dumps the full error for an unexpected boot failure", async () => {
    const workspace = makeWorkspace("ws");
    const h = harness();

    const server = await runServerProcess({
      argv: ["--workspace", workspace],
      env: EPHEMERAL,
      cwd: root,
      hooks: h.hooks,
      logger: h.logger,
      createServerFn: () => {
        throw new TypeError("something unexpected");
      },
    });

    expect(server).toBeUndefined();
    expect(h.exits).toEqual([1]);
    const entry = JSON.parse(h.lines[0] ?? "") as Record<string, unknown>;
    expect(entry.msg).toBe("failed to start");
    expect(entry).toHaveProperty("stack");
  });

  it("exits 1 with the port-in-use message when the bind fails", async () => {
    const workspace = makeWorkspace("ws");
    const first = harness();
    const running = await runServerProcess({
      argv: ["--workspace", workspace],
      env: EPHEMERAL,
      cwd: root,
      hooks: first.hooks,
      logger: first.logger,
    });

    try {
      const { port } = JSON.parse(
        first.lines.find((line) => line.includes("listening on")) ?? "{}",
      ) as { port: number };

      const second = harness();
      const blocked = await runServerProcess({
        argv: ["--workspace", workspace],
        env: { CORPUS_PORT: String(port) },
        cwd: root,
        hooks: second.hooks,
        logger: second.logger,
      });

      expect(blocked).toBeUndefined();
      expect(second.exits).toEqual([1]);
      expect(second.lines.join("\n")).toContain(`port ${port} already in use`);
      expect(second.lines.join("\n")).toContain("corpus server status");
      expect(second.lines.join("\n")).not.toContain("EADDRINUSE");
    } finally {
      await running?.close();
    }
  });

  it("falls back to its own logger when none is injected", async () => {
    const empty = join(root, "no-workspace");
    mkdirSync(empty, { recursive: true });
    const h = harness();
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    try {
      await runServerProcess({ argv: [], env: {}, cwd: empty, hooks: h.hooks });
      expect(write).toHaveBeenCalledTimes(1);
    } finally {
      write.mockRestore();
    }
  });
});

describe("runServerProcess — shutdown", () => {
  /** Boots a real server on an ephemeral port with a fake process attached. */
  async function boot(overrides: Partial<Parameters<typeof runServerProcess>[0]> = {}) {
    const workspace = makeWorkspace(`ws-${Math.random().toString(36).slice(2)}`);
    const h = harness();
    const server = await runServerProcess({
      argv: ["--workspace", workspace],
      env: EPHEMERAL,
      cwd: root,
      hooks: h.hooks,
      logger: h.logger,
      ...overrides,
    });
    if (server === undefined) throw new Error("server failed to boot");
    return { h, server };
  }

  it.each(SHUTDOWN_SIGNALS)("closes and exits 0 on %s", async (signal) => {
    const { h, server } = await boot();
    let disposed = false;
    server.registerDisposer(() => {
      disposed = true;
    });

    h.raise(signal);
    await vi.waitFor(() => expect(h.exits).toEqual([0]));

    expect(disposed).toBe(true);
    expect(h.lines.join("\n")).toContain("shutting down");
    expect(h.lines.join("\n")).toContain("shutdown complete");
  });

  it("registers a handler for both signals", async () => {
    const { h, server } = await boot();
    try {
      expect([...h.signals.keys()].sort()).toEqual(["SIGINT", "SIGTERM"]);
    } finally {
      await server.close();
    }
  });

  it("ignores a second signal instead of double-disposing", async () => {
    const { h, server } = await boot();
    let disposals = 0;
    server.registerDisposer(() => {
      disposals += 1;
    });

    h.raise("SIGTERM");
    h.raise("SIGTERM");
    h.raise("SIGINT");
    await vi.waitFor(() => expect(h.exits).toEqual([0]));

    expect(disposals).toBe(1);
    expect(h.lines.join("\n")).toContain("shutdown already in progress");
  });

  it("arms an unref'd 5 s backstop that forces exit when a disposer hangs", async () => {
    const { h, server } = await boot();
    server.registerDisposer(() => new Promise<void>(() => undefined));

    h.raise("SIGTERM");

    expect(h.timers).toHaveLength(1);
    const backstop = h.timers[0];
    expect(backstop?.ms).toBe(SHUTDOWN_GRACE_MS);
    // The backstop must not itself hold the process open.
    expect(backstop?.unrefCalls).toBe(1);
    expect(h.exits).toEqual([]);

    backstop?.handler();
    expect(h.exits).toEqual([1]);
    expect(h.lines.join("\n")).toContain(`did not complete within ${SHUTDOWN_GRACE_MS}ms`);
  });

  it("honours a custom grace period", async () => {
    const { h, server } = await boot({ gracePeriodMs: 250 });
    // Not awaited: `close()` releases the socket before it reaches the
    // disposers, so the hanging one leaks nothing.
    server.registerDisposer(() => new Promise<void>(() => undefined));

    h.raise("SIGTERM");
    expect(h.timers[0]?.ms).toBe(250);
  });

  it("exits 1 when close itself rejects", async () => {
    const failing = {
      config: { workspaceRoot: "/ws", version: "0" },
      close: () => Promise.reject(new Error("close exploded")),
      start: () => Promise.resolve({ host: "127.0.0.1", port: 1234, url: "http://127.0.0.1:1234" }),
      registerDisposer: () => undefined,
    } as unknown as CorpusServer;

    const workspace = makeWorkspace("ws-failing-close");
    const h = harness();
    await runServerProcess({
      argv: ["--workspace", workspace],
      env: EPHEMERAL,
      cwd: root,
      hooks: h.hooks,
      logger: h.logger,
      createServerFn: () => failing,
    });

    h.raise("SIGTERM");
    await vi.waitFor(() => expect(h.exits).toEqual([1]));
    expect(h.lines.join("\n")).toContain("close exploded");
  });
});

describe("runServerProcess — unhandled rejections", () => {
  it("logs and exits non-zero rather than silently continuing", async () => {
    const workspace = makeWorkspace("ws-rejections");
    const h = harness();
    const server = await runServerProcess({
      argv: ["--workspace", workspace],
      env: EPHEMERAL,
      cwd: root,
      hooks: h.hooks,
      logger: h.logger,
    });

    try {
      expect(h.rejectionHandlers).toHaveLength(1);
      h.rejectionHandlers[0]?.(new Error("floating rejection"));

      expect(h.exits).toEqual([1]);
      expect(h.lines.join("\n")).toContain("unhandled promise rejection");
      expect(h.lines.join("\n")).toContain("floating rejection");
    } finally {
      await server?.close();
    }
  });
});
