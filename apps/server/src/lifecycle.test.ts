import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type CorpusServer } from "./app.js";
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
      // No plugin discovery noise: this test pins the FIRST log line.
      discoverPluginsFn: () => Promise.resolve([]),
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

  it("exits 1 with the loopback rule when the config names a routable host", async () => {
    // The file is well-formed — it parses, and the CLI reads the same one — so
    // the refusal happens at the bind, not at the read (Adjudication 6).
    const workspace = makeWorkspace("wide-host", { version: 1, token: TOKEN, host: "0.0.0.0" });
    const h = harness();

    const server = await runServerProcess({
      argv: ["--workspace", workspace],
      env: EPHEMERAL,
      cwd: root,
      hooks: h.hooks,
      logger: h.logger,
      // No plugin discovery noise: this test pins the FIRST log line.
      discoverPluginsFn: () => Promise.resolve([]),
    });

    expect(server).toBeUndefined();
    expect(h.exits).toEqual([1]);

    const entry = JSON.parse(h.lines[0] ?? "") as Record<string, unknown>;
    expect(entry.level).toBe("error");
    expect(String(entry.msg)).toContain('refusing to bind "0.0.0.0"');
    expect(String(entry.msg)).toContain(join(workspace, ".corpus", "config.json"));
    // Anticipated and actionable: no stack trace to bury the message.
    expect(entry).not.toHaveProperty("stack");
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

  it("opens the SQLite projection before the socket, and closes it at shutdown", async () => {
    const workspace = makeWorkspace("ws-projection");
    mkdirSync(join(workspace, "data", "docs"), { recursive: true });
    writeFileSync(
      join(workspace, "data", "docs", "a.md"),
      "---\nid: doc_aaa\ntype: note\ntitle: A\n---\n\nBody.\n",
      "utf8",
    );

    const h = harness();
    const server = await runServerProcess({
      argv: ["--workspace", workspace],
      env: EPHEMERAL,
      cwd: root,
      hooks: h.hooks,
      logger: h.logger,
    });

    const cacheDb = join(workspace, ".corpus", "cache.db");
    expect(existsSync(cacheDb)).toBe(true);
    const projected = new Database(cacheDb, { readonly: true });
    try {
      expect(projected.prepare("SELECT id FROM documents").all()).toEqual([{ id: "doc_aaa" }]);
    } finally {
      projected.close();
    }

    await server?.close();
  });

  /**
   * SERVER-025. The race this pins is the one UI-002 reported and nobody could
   * reproduce: a client refetching the instant a restarted server answers,
   * before the file written while it was down had been projected. It is not
   * reproducible because it is not possible — `runServerProcess` projects the
   * workspace synchronously at :134 and only binds the socket at :150, so the
   * first request a client can *make* is already served from a populated
   * projection.
   *
   * That is an ordering, not a guarantee anything else defends, which is why it
   * is asserted here: a refactor that moves the projection off the boot path, or
   * makes `populateFromFiles` asynchronous, has to fail in this file rather than
   * in a browser three phases later.
   */
  it("has finished projecting the workspace before it binds, and before its first request", async () => {
    const workspace = makeWorkspace("ws-boot-ordering");
    mkdirSync(join(workspace, "data", "docs"), { recursive: true });
    // Written "while the server was down".
    writeFileSync(
      join(workspace, "data", "docs", "offline.md"),
      "---\nid: doc_offline\ntype: note\ntitle: Offline\n---\n\nWritten while it was down.\n",
      "utf8",
    );

    const h = harness();
    let rowsAtBind: unknown[] | undefined;
    const server = await runServerProcess({
      argv: ["--workspace", workspace],
      env: EPHEMERAL,
      cwd: root,
      hooks: h.hooks,
      logger: h.logger,
      createServerFn: (config, deps) => {
        const real = createServer(config, deps);
        return {
          ...real,
          start: async () => {
            // The last instant before anything can connect.
            rowsAtBind = deps.projection?.prepare("SELECT id FROM documents").all();
            return real.start();
          },
        };
      },
    });
    if (server === undefined) throw new Error("server failed to boot");

    try {
      expect(rowsAtBind).toEqual([{ id: "doc_offline" }]);

      // And the same fact from the outside: the very first request a client can
      // make already sees the row.
      const address = h.lines
        .map((line) => JSON.parse(line) as { msg: string; url?: string })
        .find((entry) => entry.msg.startsWith("listening on"))?.url;
      expect(address).toBeDefined();
      const response = await fetch(`${address ?? ""}/api/docs`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      const body = (await response.json()) as { items: { id: string }[] };
      expect(body.items.map((item) => item.id)).toEqual(["doc_offline"]);
    } finally {
      await server.close();
    }
  });

  it("hands the open projection to the app, so the read routes answer from it", async () => {
    const workspace = makeWorkspace("ws-read-routes");
    mkdirSync(join(workspace, "data", "docs", "finance"), { recursive: true });
    writeFileSync(
      join(workspace, "data", "docs", "finance", "m.md"),
      "---\nid: doc_bbb\ntype: note\ntitle: Escrow\n---\n\nBody.\n",
      "utf8",
    );

    const h = harness();
    const server = await runServerProcess({
      argv: ["--workspace", workspace],
      env: EPHEMERAL,
      cwd: root,
      hooks: h.hooks,
      logger: h.logger,
    });

    try {
      const response = await server?.app.request("/api/docs?folder=finance", {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(response?.status).toBe(200);
      expect(await response?.json()).toMatchObject({
        items: [{ id: "doc_bbb", title: "Escrow" }],
        page: { total: 1 },
      });
    } finally {
      await server?.close();
    }
  });

  it("starts the watcher, so an out-of-band edit is projected and announced", async () => {
    const workspace = makeWorkspace("ws-watcher");
    mkdirSync(join(workspace, "data", "docs"), { recursive: true });
    const h = harness();

    const server = await runServerProcess({
      argv: ["--workspace", workspace],
      env: EPHEMERAL,
      cwd: root,
      hooks: h.hooks,
      logger: h.logger,
    });
    if (server === undefined) throw new Error("server failed to boot");

    try {
      const batches: string[] = [];
      server.bus.subscribe((keys) => batches.push(JSON.stringify(keys)));
      // chokidar's `ready` says the initial scan finished, not that every OS
      // watch is armed; a real workspace is edited seconds later, a test isn't.
      await new Promise((resolve) => setTimeout(resolve, 400));

      writeFileSync(
        join(workspace, "data", "docs", "b.md"),
        "---\nid: doc_bbb\ntype: note\ntitle: B\n---\n\nOut of band.\n",
        "utf8",
      );

      await vi.waitFor(
        () => {
          expect(batches.join(" ")).toContain('["docs","doc_bbb"]');
        },
        { timeout: 8000, interval: 25 },
      );

      const projected = new Database(join(workspace, ".corpus", "cache.db"), { readonly: true });
      try {
        expect(projected.prepare("SELECT id FROM documents WHERE id = 'doc_bbb'").all()).toEqual([
          { id: "doc_bbb" },
        ]);
      } finally {
        projected.close();
      }
    } finally {
      await server.close();
    }
  }, 30_000);

  it("announces a queue transition exactly once — the write path, never the watcher too", async () => {
    const workspace = makeWorkspace("ws-suppression");
    const h = harness();

    const server = await runServerProcess({
      argv: ["--workspace", workspace],
      env: EPHEMERAL,
      cwd: root,
      hooks: h.hooks,
      logger: h.logger,
    });
    if (server === undefined) throw new Error("server failed to boot");

    try {
      const batches: string[] = [];
      server.bus.subscribe((keys) => batches.push(JSON.stringify(keys)));
      await new Promise((resolve) => setTimeout(resolve, 400));

      const event = await server.queue.enqueue({
        type: "comment.created",
        source: "cli",
        payload: {},
      });
      await server.queue.claimAll();
      await server.queue.complete(event.id);

      // Long enough for any watcher event the three transitions produced to
      // have been debounced, batched and — if suppression failed — broadcast.
      await new Promise((resolve) => setTimeout(resolve, 800));

      // One frame per transition, each the whole `QUEUE_QUERY_KEYS` table —
      // and none from the watcher, which is what this test is about.
      expect(batches).toEqual([
        '[["queue"],["jobs"],["docs"]]',
        '[["queue"],["jobs"],["docs"]]',
        '[["queue"],["jobs"],["docs"]]',
      ]);
    } finally {
      await server.close();
    }
  }, 30_000);

  it("treats a projection that cannot be opened as a boot failure", async () => {
    const workspace = makeWorkspace("ws-projection-fails");
    const h = harness();

    const server = await runServerProcess({
      argv: ["--workspace", workspace],
      env: EPHEMERAL,
      cwd: root,
      hooks: h.hooks,
      logger: h.logger,
      attachProjectionFn: () => {
        throw new CorpusError("cache.db is unreadable");
      },
    });

    expect(server).toBeUndefined();
    expect(h.exits).toEqual([1]);
    expect(h.lines.join("\n")).toContain("cache.db is unreadable");
  });

  /**
   * SERVER-043. The seam attaches last so its disposer runs first: it reads the
   * projection, and an aborted resolution must be awaited before the database
   * closes.
   */
  it("attaches the embedding seam after the watcher", async () => {
    const workspace = makeWorkspace("ws-semantic-order");
    const h = harness();
    const order: string[] = [];

    const server = await runServerProcess({
      argv: ["--workspace", workspace],
      env: EPHEMERAL,
      cwd: root,
      hooks: h.hooks,
      logger: h.logger,
      attachWatcherFn: () => order.push("watcher"),
      attachSemanticFn: () => order.push("semantic"),
    });
    if (server === undefined) throw new Error("server failed to boot");

    expect(order).toEqual(["watcher", "semantic"]);
    await server.close();
  });

  it("says in the boot log that a zero-config workspace has no semantic index", async () => {
    const workspace = makeWorkspace("ws-semantic-disabled");
    const h = harness();

    const server = await runServerProcess({
      argv: ["--workspace", workspace],
      env: EPHEMERAL,
      cwd: root,
      hooks: h.hooks,
      logger: h.logger,
      // `runServerProcess` deliberately does not hand its logger to
      // `createServer` (the server builds one from `config.logLevel`), so the
      // seam's line goes to stdout in production; this is how a test reads it.
      createServerFn: (config, deps) => createServer(config, { ...deps, logger: h.logger }),
    });
    if (server === undefined) throw new Error("server failed to boot");

    // The resolution runs beside the boot; the seam's disposer is what awaits it.
    await server.close();

    const line = h.lines.find((entry) => entry.includes("semantic index disabled"));
    // The build ships an embedded engine (SERVER-048), so the reason is no
    // longer "there is no engine": this environment names no per-user cache
    // directory, which is what a server booted with `env: {}` looks like.
    expect(line).toContain("no per-user cache directory");
    expect(line).toContain('"level":"info"');
  });

  it("says the model is not downloaded yet, rather than that nothing is configured", async () => {
    const workspace = makeWorkspace("ws-semantic-model-absent");
    const h = harness();

    const server = await runServerProcess({
      argv: ["--workspace", workspace],
      env: { ...EPHEMERAL, HOME: join(root, "home"), CORPUS_MODEL_CACHE_DIR: join(root, "models") },
      cwd: root,
      hooks: h.hooks,
      logger: h.logger,
      createServerFn: (config, deps) => createServer(config, { ...deps, logger: h.logger }),
    });
    if (server === undefined) throw new Error("server failed to boot");
    await server.close();

    const line = h.lines.find((entry) => entry.includes("semantic index disabled"));
    // SPEC.md §9.1's honest distinction: "not downloaded yet" is not "nothing
    // configured", and search says which one it is.
    expect(line).toContain("has not been downloaded yet");
  });

  it("makes no network request while booting, however much there is to index", async () => {
    const workspace = makeWorkspace("ws-semantic-no-boot-download");
    const h = harness();
    const original = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (input) => {
      calls.push(input instanceof URL ? input.href : JSON.stringify(input));
      return Promise.reject(new Error("no network at boot"));
    };

    try {
      const server = await runServerProcess({
        argv: ["--workspace", workspace],
        env: { ...EPHEMERAL, CORPUS_MODEL_CACHE_DIR: join(root, "models") },
        cwd: root,
        hooks: h.hooks,
        logger: h.logger,
      });
      if (server === undefined) throw new Error("server failed to boot");
      await server.close();
    } finally {
      globalThis.fetch = original;
    }

    // "Lazily on first index need" and "none at server boot" are the same rule.
    expect(calls).toEqual([]);
    expect(existsSync(join(root, "models"))).toBe(false);
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
      // This stand-in server carries no real config, so the projection has no
      // workspace to open; what is under test here is the shutdown path.
      openProjectionFn: () => undefined,
      attachProjectionFn: () => undefined,
      attachSemanticFn: () => undefined,
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
