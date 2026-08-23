import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_REFLECT_QUIET_MINUTES } from "@corpus/contract";
import { DEFAULT_ATTACHMENT_LIMITS } from "./attachments/index.js";
import { EDIT_ACK_IDLE_MS } from "./edit/index.js";
import { ConfigError } from "./errors.js";
import {
  CONFIG_RELATIVE_PATH,
  DEFAULT_DATA_DIR,
  DEFAULT_HOST,
  DEFAULT_PORT,
  RECOMMENDED_TOKEN_LENGTH,
  WorkspaceConfigSchema,
  defaultPackageRoot,
  findWorkspaceRoot,
  isLoopbackHost,
  loadServerConfig,
  nonLoopbackBindError,
  readToolVersion,
  readWorkspaceConfig,
  resolveUiDistDir,
  resolveWorkspace,
} from "./config.js";

const LONG_TOKEN = "tkn_0123456789abcdef0123456789abcdef";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-config-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Writes a workspace under `root` and returns its absolute path. */
function makeWorkspace(
  name: string,
  config: string | Record<string, unknown> = { version: 1, token: LONG_TOKEN },
): string {
  const workspace = join(root, name);
  mkdirSync(join(workspace, ".corpus"), { recursive: true });
  writeFileSync(
    join(workspace, ".corpus", "config.json"),
    typeof config === "string" ? config : JSON.stringify(config, null, 2),
    "utf8",
  );
  return workspace;
}

describe("isLoopbackHost", () => {
  it.each([
    ["127.0.0.1", true],
    ["127.0.0.53", true],
    ["127.255.255.255", true],
    ["localhost", true],
    ["LOCALHOST", true],
    ["::1", true],
    ["[::1]", true],
    ["0.0.0.0", false],
    ["192.168.1.10", false],
    ["127.0.0.999", false],
    ["example.com", false],
    ["", false],
  ])("%s -> %s", (host, expected) => {
    expect(isLoopbackHost(host)).toBe(expected);
  });
});

describe("WorkspaceConfigSchema", () => {
  it("applies the documented defaults for every optional key", () => {
    const parsed = WorkspaceConfigSchema.parse({ version: 1, token: LONG_TOKEN });
    expect(parsed).toEqual({
      version: 1,
      port: DEFAULT_PORT,
      host: DEFAULT_HOST,
      token: LONG_TOKEN,
      dataDir: DEFAULT_DATA_DIR,
      attachments: DEFAULT_ATTACHMENT_LIMITS,
      editAcknowledgment: { idleMs: EDIT_ACK_IDLE_MS },
      reflect: { quiet: DEFAULT_REFLECT_QUIET_MINUTES },
    });
  });

  it("takes SPEC.md §4's acknowledgment window from the file, and defaults it to three minutes", () => {
    expect(
      WorkspaceConfigSchema.parse({ version: 1, token: LONG_TOKEN }).editAcknowledgment,
    ).toEqual({ idleMs: EDIT_ACK_IDLE_MS });
    expect(
      WorkspaceConfigSchema.parse({
        version: 1,
        token: LONG_TOKEN,
        editAcknowledgment: { idleMs: 30_000 },
      }).editAcknowledgment,
    ).toEqual({ idleMs: 30_000 });
    // A window of zero is not a shorter acknowledgment; it is one event per
    // autosave, which is the thing §4's window exists to prevent.
    expect(
      WorkspaceConfigSchema.safeParse({
        version: 1,
        token: LONG_TOKEN,
        editAcknowledgment: { idleMs: 0 },
      }).success,
    ).toBe(false);
  });

  it("takes attachment caps from the file, and defaults each one independently", () => {
    const parsed = WorkspaceConfigSchema.parse({
      version: 1,
      token: LONG_TOKEN,
      attachments: { maxFileBytes: 1024 },
    });
    expect(parsed.attachments).toEqual({
      maxFileBytes: 1024,
      maxRequestBytes: DEFAULT_ATTACHMENT_LIMITS.maxRequestBytes,
    });
  });

  it("parses non-strictly: unknown keys from a newer `corpus init` pass (Adjudication 3)", () => {
    expect(() =>
      WorkspaceConfigSchema.parse({ version: 1, token: LONG_TOKEN, futureFeature: { on: true } }),
    ).not.toThrow();
  });

  it("accepts a short token — strength is the generator's concern (Adjudication 3)", () => {
    expect(WorkspaceConfigSchema.parse({ version: 1, token: "t" }).token).toBe("t");
  });

  it("accepts a portless config, defaulting the port to 8765 (Adjudication 6)", () => {
    const parsed = WorkspaceConfigSchema.parse({ version: 1, token: LONG_TOKEN });
    expect(parsed.port).toBe(DEFAULT_PORT);
    expect(DEFAULT_PORT).toBe(8765);
  });

  it.each([["0.0.0.0"], ["192.168.1.10"], ["example.com"], ["::"], [""]])(
    "accepts host %j — loopback-only is a bind rule, not a schema rule (Adjudication 6)",
    (host) => {
      const result = WorkspaceConfigSchema.safeParse({ version: 1, token: LONG_TOKEN, host });
      expect(result.success).toBe(true);
      expect(result.success && result.data.host).toBe(host);
    },
  );

  it.each([
    ["an empty token", { version: 1, token: "" }],
    ["a missing token", { version: 1 }],
    ["a wrong version", { version: 2, token: LONG_TOKEN }],
    ["a port above the range", { version: 1, token: LONG_TOKEN, port: 99999 }],
    ["a fractional port", { version: 1, token: LONG_TOKEN, port: 80.5 }],
    ["an empty dataDir", { version: 1, token: LONG_TOKEN, dataDir: "" }],
  ])("rejects %s", (_label, value) => {
    expect(WorkspaceConfigSchema.safeParse(value).success).toBe(false);
  });
});

describe("nonLoopbackBindError", () => {
  it("names the value, the rule and the file to edit", () => {
    const error = nonLoopbackBindError("0.0.0.0", "/ws/.corpus/config.json");
    expect(error).toBeInstanceOf(ConfigError);
    expect(error.message).toContain('refusing to bind "0.0.0.0"');
    expect(error.message).toContain("loopback only");
    expect(error.message).toContain(`set "host" to ${DEFAULT_HOST}`);
    expect(error.message).toContain("/ws/.corpus/config.json");
  });
});

describe("findWorkspaceRoot", () => {
  it("finds the nearest ancestor holding .corpus/config.json", () => {
    const workspace = makeWorkspace("ws");
    const nested = join(workspace, "a", "b", "c");
    mkdirSync(nested, { recursive: true });
    expect(findWorkspaceRoot(nested)).toBe(workspace);
  });

  it("prefers the nearest workspace when workspaces nest", () => {
    const outer = makeWorkspace("outer");
    const inner = join(outer, "inner");
    mkdirSync(join(inner, ".corpus"), { recursive: true });
    writeFileSync(join(inner, ".corpus", "config.json"), "{}", "utf8");
    expect(findWorkspaceRoot(join(inner, "deep"))).toBe(inner);
  });

  it("returns undefined after walking to the filesystem root", () => {
    const orphan = join(root, "no-workspace");
    mkdirSync(orphan, { recursive: true });
    expect(findWorkspaceRoot(orphan)).toBeUndefined();
  });
});

describe("resolveWorkspace", () => {
  it("prefers the explicit argument over CORPUS_WORKSPACE", () => {
    const explicit = makeWorkspace("explicit");
    const env = makeWorkspace("from-env");
    expect(
      resolveWorkspace({ workspace: explicit, env: { CORPUS_WORKSPACE: env }, cwd: root }),
    ).toEqual({ root: explicit, source: "explicit" });
  });

  it("prefers CORPUS_WORKSPACE over the upward search", () => {
    const fromEnv = makeWorkspace("from-env");
    const searchable = makeWorkspace("searchable");
    expect(resolveWorkspace({ env: { CORPUS_WORKSPACE: fromEnv }, cwd: searchable })).toEqual({
      root: fromEnv,
      source: "env",
    });
  });

  it("resolves relative arguments and env values against cwd", () => {
    makeWorkspace("relative");
    expect(resolveWorkspace({ workspace: "relative", env: {}, cwd: root }).root).toBe(
      join(root, "relative"),
    );
    expect(resolveWorkspace({ env: { CORPUS_WORKSPACE: "relative" }, cwd: root }).root).toBe(
      join(root, "relative"),
    );
  });

  it.each([
    ["an empty explicit argument", { workspace: "" }],
    ["a whitespace explicit argument", { workspace: "   " }],
    ["an empty CORPUS_WORKSPACE", { env: { CORPUS_WORKSPACE: "" } }],
  ])("ignores %s and falls through to the search", (_label, overrides) => {
    const workspace = makeWorkspace("ws");
    const resolved = resolveWorkspace({ env: {}, cwd: workspace, ...overrides });
    expect(resolved).toEqual({ root: workspace, source: "search" });
  });

  it("fails with the `corpus init` message when nothing is found", () => {
    const orphan = join(root, "nothing");
    mkdirSync(orphan, { recursive: true });
    expect(() => resolveWorkspace({ env: {}, cwd: orphan })).toThrow(ConfigError);
    expect(() => resolveWorkspace({ env: {}, cwd: orphan })).toThrow(/not a Corpus workspace/);
    expect(() => resolveWorkspace({ env: {}, cwd: orphan })).toThrow(/corpus init/);
  });
});

describe("readWorkspaceConfig", () => {
  it("reads a valid config", () => {
    const workspace = makeWorkspace("ws", { version: 1, port: 9000, token: LONG_TOKEN });
    expect(readWorkspaceConfig(workspace)).toMatchObject({ port: 9000, token: LONG_TOKEN });
  });

  it("names the missing file and the fix", () => {
    const empty = join(root, "empty");
    mkdirSync(empty, { recursive: true });
    expect(() => readWorkspaceConfig(empty)).toThrow(
      new RegExp(`${CONFIG_RELATIVE_PATH.replace("/", "\\/")} is no such file`),
    );
    expect(() => readWorkspaceConfig(empty)).toThrow(/corpus init/);
  });

  it("names the file and the parse position for malformed JSON", () => {
    const workspace = makeWorkspace("bad-json", '{ "version": 1, "token": "x",');
    expect(() => readWorkspaceConfig(workspace)).toThrow(/is not valid JSON/);
    expect(() => readWorkspaceConfig(workspace)).toThrow(/position/);
  });

  it("names the failing field for a schema failure", () => {
    const workspace = makeWorkspace("bad-schema", { version: 1, token: LONG_TOKEN, port: 99999 });
    expect(() => readWorkspaceConfig(workspace)).toThrow(/is not a valid workspace config — port:/);
  });

  it("reads a portless config, defaulting the port (Adjudication 6)", () => {
    const workspace = makeWorkspace("portless", { version: 1, token: LONG_TOKEN });
    expect(readWorkspaceConfig(workspace)).toMatchObject({
      port: DEFAULT_PORT,
      host: DEFAULT_HOST,
      token: LONG_TOKEN,
    });
  });

  it("reads a non-loopback host without complaint — the bind refuses it, not the reader", () => {
    const workspace = makeWorkspace("wide-host", {
      version: 1,
      token: LONG_TOKEN,
      host: "0.0.0.0",
    });
    expect(readWorkspaceConfig(workspace).host).toBe("0.0.0.0");
  });

  it("reports a root-level failure without an empty path segment", () => {
    const workspace = makeWorkspace("not-an-object", '"just a string"');
    expect(() => readWorkspaceConfig(workspace)).toThrow(/<root>:/);
  });

  it("reports an unreadable file distinctly from a missing one", () => {
    const workspace = join(root, "dir-not-file");
    // A directory where the config should be: readable path, unreadable content.
    mkdirSync(join(workspace, ".corpus", "config.json"), { recursive: true });
    expect(() => readWorkspaceConfig(workspace)).toThrow(/is unreadable/);
  });
});

describe("resolveUiDistDir", () => {
  it("honours CORPUS_UI_DIST even when it does not exist", () => {
    const missing = join(root, "no-such-ui");
    expect(resolveUiDistDir({ CORPUS_UI_DIST: missing }, root)).toBe(missing);
  });

  it("resolves a relative CORPUS_UI_DIST against the package root", () => {
    expect(resolveUiDistDir({ CORPUS_UI_DIST: "some/ui" }, root)).toBe(join(root, "some", "ui"));
  });

  it("falls back to the monorepo layout <packageRoot>/../ui/dist", () => {
    const packageRoot = join(root, "apps", "server");
    mkdirSync(packageRoot, { recursive: true });
    const monorepo = join(root, "apps", "ui", "dist");
    mkdirSync(monorepo, { recursive: true });
    expect(resolveUiDistDir({}, packageRoot)).toBe(monorepo);
  });

  it("falls back to the packaged layout <packageRoot>/ui", () => {
    const packageRoot = join(root, "package");
    mkdirSync(join(packageRoot, "ui"), { recursive: true });
    expect(resolveUiDistDir({}, packageRoot)).toBe(join(packageRoot, "ui"));
  });

  it("returns undefined when no candidate exists", () => {
    const packageRoot = join(root, "bare");
    mkdirSync(packageRoot, { recursive: true });
    expect(resolveUiDistDir({}, packageRoot)).toBeUndefined();
  });

  it.each(["", "   "])("ignores a blank CORPUS_UI_DIST (%j)", (value) => {
    const packageRoot = join(root, "blank");
    mkdirSync(packageRoot, { recursive: true });
    expect(resolveUiDistDir({ CORPUS_UI_DIST: value }, packageRoot)).toBeUndefined();
  });
});

describe("readToolVersion", () => {
  it("reads the version from the package manifest", () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "1.2.3" }), "utf8");
    expect(readToolVersion(root)).toBe("1.2.3");
  });

  it.each([
    ["a missing manifest", undefined],
    ["a malformed manifest", "{"],
    ["a manifest with no version", '{"name":"x"}'],
  ])("falls back to 0.0.0 for %s", (_label, contents) => {
    const dir = join(root, `pkg-${_label.replace(/\s/g, "-")}`);
    mkdirSync(dir, { recursive: true });
    if (contents !== undefined) writeFileSync(join(dir, "package.json"), contents, "utf8");
    expect(readToolVersion(dir)).toBe("0.0.0");
  });

  it("reads this package's real manifest through defaultPackageRoot", () => {
    expect(readToolVersion(defaultPackageRoot())).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("loadServerConfig", () => {
  it("returns absolute, workspace-derived paths", () => {
    const workspace = makeWorkspace("ws", { version: 1, port: 9100, token: LONG_TOKEN });
    const config = loadServerConfig({ workspace, env: {}, cwd: root, packageRoot: root });

    expect(config).toMatchObject({
      workspaceRoot: workspace,
      corpusDir: join(workspace, ".corpus"),
      dataDir: join(workspace, "data"),
      configPath: join(workspace, ".corpus", "config.json"),
      host: DEFAULT_HOST,
      port: 9100,
      token: LONG_TOKEN,
      logLevel: "info",
      warnings: [],
    });
  });

  it("loads a portless config with the default port and host (Adjudication 6)", () => {
    const workspace = makeWorkspace("portless", { version: 1, token: LONG_TOKEN });
    const config = loadServerConfig({ workspace, env: {}, cwd: root, packageRoot: root });
    expect(config).toMatchObject({ port: DEFAULT_PORT, host: DEFAULT_HOST, warnings: [] });
  });

  it("carries a non-loopback host through — refusing to bind it is `start()`'s job", () => {
    const workspace = makeWorkspace("wide-host", {
      version: 1,
      token: LONG_TOKEN,
      host: "0.0.0.0",
    });
    const config = loadServerConfig({ workspace, env: {}, cwd: root, packageRoot: root });
    expect(config.host).toBe("0.0.0.0");
  });

  // SERVER-022 finding 9. `dataDir` used to be parsed, resolved and then read by
  // nothing: `projection/roots.ts` spells `data/docs` and `data/threads` out,
  // deliberately. A workspace configured to keep its corpus elsewhere started
  // cleanly and kept it under `data/` anyway.
  it.each([
    ["a sibling directory", "content"],
    ["a nested directory", "corpus/data"],
    ["an absolute path", "/tmp/elsewhere"],
    ["a parent escape", "../shared-data"],
  ])("refuses to start when dataDir names %s", (_label, dataDir) => {
    const workspace = makeWorkspace(`datadir-${dataDir.replace(/\W/g, "")}`, {
      version: 1,
      token: LONG_TOKEN,
      dataDir,
    });

    const load = (): unknown =>
      loadServerConfig({ workspace, env: {}, cwd: root, packageRoot: root });

    expect(load).toThrow(ConfigError);
    // The message names the field, the value it refused, and the file to edit.
    expect(load).toThrow(/"dataDir"/);
    expect(load).toThrow(new RegExp(JSON.stringify(dataDir).replace(/[/\\]/g, "\\$&")));
    expect(load).toThrow(/config\.json/);
  });

  it.each([
    ["the value `corpus init` writes", "data"],
    ["an equivalent relative spelling", "./data"],
    ["a trailing slash", "data/"],
  ])("accepts %s", (_label, dataDir) => {
    const workspace = makeWorkspace(`datadir-ok-${dataDir.replace(/\W/g, "")}`, {
      version: 1,
      token: LONG_TOKEN,
      dataDir,
    });

    expect(loadServerConfig({ workspace, env: {}, cwd: root, packageRoot: root }).dataDir).toBe(
      resolve(workspace, "data"),
    );
  });

  it.each([
    ["9200", 9200],
    // 0 means "bind an ephemeral port"; the config file may not use it, the
    // override may, so tests never collide with a real workspace's server.
    ["0", 0],
  ])("lets CORPUS_PORT=%s override the config's port", (value, expected) => {
    const workspace = makeWorkspace("ws", { version: 1, port: 9100, token: LONG_TOKEN });
    expect(
      loadServerConfig({ workspace, env: { CORPUS_PORT: value }, cwd: root, packageRoot: root })
        .port,
    ).toBe(expected);
  });

  it("rejects port 0 in the config file itself — the CLI must know the port", () => {
    expect(
      WorkspaceConfigSchema.safeParse({ version: 1, token: LONG_TOKEN, port: 0 }).success,
    ).toBe(false);
  });

  it.each([["notaport"], ["-1"], ["70000"], ["8.5"]])("rejects CORPUS_PORT=%s", (value) => {
    const workspace = makeWorkspace("ws");
    expect(() =>
      loadServerConfig({ workspace, env: { CORPUS_PORT: value }, cwd: root, packageRoot: root }),
    ).toThrow(/CORPUS_PORT must be a port number/);
  });

  it.each([["silent"], ["info"], ["debug"]] as const)("accepts CORPUS_LOG_LEVEL=%s", (level) => {
    const workspace = makeWorkspace("ws");
    expect(
      loadServerConfig({
        workspace,
        env: { CORPUS_LOG_LEVEL: level },
        cwd: root,
        packageRoot: root,
      }).logLevel,
    ).toBe(level);
  });

  it("rejects an unknown CORPUS_LOG_LEVEL by name", () => {
    const workspace = makeWorkspace("ws");
    expect(() =>
      loadServerConfig({
        workspace,
        env: { CORPUS_LOG_LEVEL: "chatty" },
        cwd: root,
        packageRoot: root,
      }),
    ).toThrow(/silent, info, debug/);
  });

  it.each([
    ["CORPUS_PORT", { CORPUS_PORT: "  " }],
    ["CORPUS_LOG_LEVEL", { CORPUS_LOG_LEVEL: "" }],
  ])("ignores a blank %s", (_label, env) => {
    const workspace = makeWorkspace("ws", { version: 1, port: 9100, token: LONG_TOKEN });
    const config = loadServerConfig({ workspace, env, cwd: root, packageRoot: root });
    expect(config.port).toBe(9100);
    expect(config.logLevel).toBe("info");
  });

  it("warns — but does not fail — on a token shorter than the generator's", () => {
    const workspace = makeWorkspace("ws", { version: 1, token: "t" });
    const config = loadServerConfig({ workspace, env: {}, cwd: root, packageRoot: root });
    expect(config.token).toBe("t");
    expect(config.warnings).toEqual([expect.stringContaining(String(RECOMMENDED_TOKEN_LENGTH))]);
  });

  it("uses defaultPackageRoot when none is passed", () => {
    const workspace = makeWorkspace("ws");
    expect(loadServerConfig({ workspace, env: {}, cwd: root }).version).toMatch(/^\d+\.\d+\.\d+/);
  });

  // SERVER-043 / sprint-021 TEST-850. The block is optional on the schema and
  // judged at boot: a workspace that predates it must load unchanged, and a
  // block this build cannot serve must warn rather than refuse to start.
  describe("the embedding block", () => {
    it("loads a workspace with no block as the zero-config case", () => {
      const workspace = makeWorkspace("ws");
      const config = loadServerConfig({ workspace, env: {}, cwd: root, packageRoot: root });
      expect(config.embedding).toEqual({ kind: "absent" });
      expect(config.warnings).toEqual([]);
    });

    it("carries a configured provider through, judged and complete", () => {
      const workspace = makeWorkspace("configured", {
        version: 1,
        token: LONG_TOKEN,
        embedding: {
          provider: "ollama",
          endpoint: "http://127.0.0.1:11434",
          model: "nomic-embed-text",
        },
      });
      const config = loadServerConfig({ workspace, env: {}, cwd: root, packageRoot: root });
      expect(config.embedding).toEqual({
        kind: "configured",
        provider: {
          kind: "ollama",
          endpoint: "http://127.0.0.1:11434",
          model: "nomic-embed-text",
        },
      });
      expect(config.warnings).toEqual([]);
    });

    it("warns at boot — and still starts — on a provider this build cannot serve", () => {
      const workspace = makeWorkspace("unknown-provider", {
        version: 1,
        token: LONG_TOKEN,
        embedding: { provider: "magic-embed" },
      });
      const config = loadServerConfig({ workspace, env: {}, cwd: root, packageRoot: root });

      expect(config.embedding).toMatchObject({ kind: "invalid" });
      expect(config.warnings).toEqual([expect.stringContaining('"magic-embed"')]);
      expect(config.warnings[0]).toContain(join(workspace, ".corpus", "config.json"));
    });

    it("never fails the whole file over the embedding block", () => {
      const workspace = makeWorkspace("half-block", {
        version: 1,
        token: LONG_TOKEN,
        embedding: { provider: "openai" },
      });
      // The parse succeeds — refusing here would break every other reader of a
      // file whose only problem is a key none of them use.
      expect(readWorkspaceConfig(workspace).embedding).toEqual({ provider: "openai" });
      expect(() =>
        loadServerConfig({ workspace, env: {}, cwd: root, packageRoot: root }),
      ).not.toThrow();
    });

    it("keeps the key out of the warnings it produces", () => {
      const workspace = makeWorkspace("keyed", {
        version: 1,
        token: LONG_TOKEN,
        embedding: { provider: "nope", apiKey: "sk-live-config-1" },
      });
      const config = loadServerConfig({ workspace, env: {}, cwd: root, packageRoot: root });
      expect(config.warnings.join("\n")).not.toContain("sk-live-config-1");
    });
  });
});
