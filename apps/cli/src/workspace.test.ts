import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExitCode, UsageError, WorkspaceConfigError, WorkspaceNotFoundError } from "./errors.js";
import {
  DEFAULT_PORT,
  findWorkspaceRoot,
  readWorkspaceConfig,
  resolveWorkspace,
} from "./workspace.js";

/** A 32+ character token, so a hand-made fixture is one a real server accepts. */
const TOKEN = "0123456789abcdef0123456789abcdef";
const INNER_TOKEN = "fedcba9876543210fedcba9876543210";

const temporaryRoots: string[] = [];

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "corpus-cli-ws-"));
  temporaryRoots.push(root);
  return root;
}

function writeWorkspace(root: string, config: unknown): string {
  mkdirSync(join(root, ".corpus"), { recursive: true });
  writeFileSync(
    join(root, ".corpus", "config.json"),
    typeof config === "string" ? config : JSON.stringify(config),
    "utf8",
  );
  return root;
}

function validConfig(overrides: Record<string, unknown> = {}) {
  return { version: 1, port: 8865, token: TOKEN, dataDir: "data", ...overrides };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("findWorkspaceRoot", () => {
  it("finds the config in the starting directory", () => {
    const root = writeWorkspace(scratch(), validConfig());
    expect(findWorkspaceRoot(root)).toBe(root);
  });

  it("walks up to an ancestor", () => {
    const root = writeWorkspace(scratch(), validConfig());
    const deep = join(root, "a", "b", "c");
    mkdirSync(deep, { recursive: true });
    expect(findWorkspaceRoot(deep)).toBe(root);
  });

  it("returns undefined when no ancestor has one", () => {
    expect(findWorkspaceRoot(scratch())).toBeUndefined();
  });
});

describe("resolveWorkspace", () => {
  it("exposes the root, port, token and base URL", () => {
    const root = writeWorkspace(scratch(), validConfig());
    const workspace = resolveWorkspace({ cwd: root, env: {} });
    expect(workspace.root).toBe(root);
    expect(workspace.port).toBe(8865);
    expect(workspace.token).toBe(TOKEN);
    expect(workspace.host).toBe("127.0.0.1");
    expect(workspace.dataDir).toBe("data");
    expect(workspace.baseUrl).toBe("http://127.0.0.1:8865");
  });

  it("talks to the default port when the config omits one", () => {
    const root = writeWorkspace(scratch(), { version: 1, token: TOKEN });
    const workspace = resolveWorkspace({ cwd: root, env: {} });
    expect(workspace.port).toBe(DEFAULT_PORT);
    expect(workspace.baseUrl).toBe(`http://127.0.0.1:${String(DEFAULT_PORT)}`);
  });

  it("resolves from a directory three levels below the root", () => {
    const root = writeWorkspace(scratch(), validConfig());
    const deep = join(root, "a", "b", "c");
    mkdirSync(deep, { recursive: true });
    expect(resolveWorkspace({ cwd: deep, env: {} }).root).toBe(root);
  });

  it("picks the nearest ancestor and never merges nested configs", () => {
    const outer = writeWorkspace(scratch(), validConfig());
    const inner = writeWorkspace(
      join(outer, "a", "inner"),
      validConfig({ port: 9001, token: INNER_TOKEN }),
    );
    const deep = join(inner, "deep");
    mkdirSync(deep, { recursive: true });

    const workspace = resolveWorkspace({ cwd: deep, env: {} });
    expect(workspace.root).toBe(inner);
    expect(workspace.port).toBe(9001);
    expect(workspace.token).toBe(INNER_TOKEN);
  });

  it("fails with an actionable message and exit code 3 outside a workspace", () => {
    const outside = scratch();
    let thrown: unknown;
    try {
      resolveWorkspace({ cwd: outside, env: {} });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(WorkspaceNotFoundError);
    expect(thrown).toHaveProperty("exitCode", ExitCode.noWorkspace);
    expect((thrown as Error).message).toBe(
      "not inside a Corpus workspace — run `corpus init` here or pass --workspace",
    );
  });

  it("honours --workspace and CORPUS_WORKSPACE, with the flag winning", () => {
    const flagged = writeWorkspace(scratch(), validConfig());
    const fromEnv = writeWorkspace(scratch(), validConfig({ port: 9002, token: INNER_TOKEN }));
    const outside = scratch();

    expect(resolveWorkspace({ cwd: outside, env: {}, workspaceFlag: flagged }).root).toBe(flagged);
    expect(resolveWorkspace({ cwd: outside, env: { CORPUS_WORKSPACE: fromEnv } }).root).toBe(
      fromEnv,
    );
    expect(
      resolveWorkspace({ cwd: outside, env: { CORPUS_WORKSPACE: fromEnv }, workspaceFlag: flagged })
        .root,
    ).toBe(flagged);
  });

  it("lets CORPUS_PORT and CORPUS_TOKEN override the file", () => {
    const root = writeWorkspace(scratch(), validConfig());
    const workspace = resolveWorkspace({
      cwd: root,
      env: { CORPUS_PORT: "9100", CORPUS_TOKEN: "override-token" },
    });
    expect(workspace.port).toBe(9100);
    expect(workspace.token).toBe("override-token");
    expect(workspace.baseUrl).toBe("http://127.0.0.1:9100");
  });

  it("rejects a malformed CORPUS_PORT as a usage error", () => {
    const root = writeWorkspace(scratch(), validConfig());
    expect(() => resolveWorkspace({ cwd: root, env: { CORPUS_PORT: "nope" } })).toThrow(UsageError);
    expect(() => resolveWorkspace({ cwd: root, env: { CORPUS_PORT: "99999" } })).toThrow(
      UsageError,
    );
  });
});

describe("readWorkspaceConfig", () => {
  it("defaults host and dataDir, and passes unknown keys through", () => {
    const root = writeWorkspace(scratch(), { version: 1, port: 8865, token: TOKEN, extra: true });
    const config = readWorkspaceConfig(join(root, ".corpus", "config.json"));
    expect(config.host).toBe("127.0.0.1");
    expect(config.dataDir).toBe("data");
    expect(config).toHaveProperty("extra", true);
  });

  it("accepts the server's shape, including an explicit host", () => {
    const root = writeWorkspace(scratch(), {
      version: 1,
      port: 8865,
      host: "127.0.0.1",
      token: TOKEN,
    });
    expect(readWorkspaceConfig(join(root, ".corpus", "config.json")).host).toBe("127.0.0.1");
  });

  it("defaults port to 8765 for a portless config the server also accepts", () => {
    const root = writeWorkspace(scratch(), { version: 1, token: TOKEN });
    const config = readWorkspaceConfig(join(root, ".corpus", "config.json"));
    expect(config.port).toBe(DEFAULT_PORT);
    expect(config.host).toBe("127.0.0.1");
    expect(config.dataDir).toBe("data");
  });

  it("leaves host schema-opaque: loopback enforcement is the server's boot concern", () => {
    const root = writeWorkspace(scratch(), { version: 1, host: "0.0.0.0", token: TOKEN });
    expect(readWorkspaceConfig(join(root, ".corpus", "config.json")).host).toBe("0.0.0.0");
  });

  it("accepts a short token: token strength is `corpus init`'s job, not a reader's", () => {
    const root = writeWorkspace(scratch(), { version: 1, port: 8865, token: "t" });
    expect(readWorkspaceConfig(join(root, ".corpus", "config.json")).token).toBe("t");
  });

  it.each([
    ["malformed JSON", "{not json", "is not valid JSON"],
    ["a schema violation", JSON.stringify({ version: 2, port: 8865, token: TOKEN }), "version"],
    ["a missing token", JSON.stringify({ version: 1, port: 8865 }), "token"],
    ["a bad port", JSON.stringify({ version: 1, port: 0, token: TOKEN }), "port"],
  ])("reports %s as an invalid config, exit code 3", (_label, contents, expected) => {
    const root = writeWorkspace(scratch(), contents);
    let thrown: unknown;
    try {
      resolveWorkspace({ cwd: root, env: {} });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(WorkspaceConfigError);
    expect(thrown).toHaveProperty("exitCode", ExitCode.noWorkspace);
    expect((thrown as Error).message).toContain("workspace config is invalid");
    expect((thrown as Error).message).toContain(expected);
  });

  it("reports an unreadable config as the OS error, not a stack trace", () => {
    const root = writeWorkspace(scratch(), validConfig());
    const configPath = join(root, ".corpus", "config.json");
    chmodSync(configPath, 0o000);
    try {
      let thrown: unknown;
      try {
        readWorkspaceConfig(configPath);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(WorkspaceConfigError);
      expect((thrown as Error).message).toContain("cannot read");
      expect((thrown as Error).message).toContain("EACCES");
    } finally {
      chmodSync(configPath, 0o600);
    }
  });
});
