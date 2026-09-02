import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  allocatePort,
  assertRehearsalWorkspace,
  BASE_DIR_PREFIX,
  MARKER_FILE,
  RehearsalSafetyError,
  sanitizedEnv,
  shimContent,
  USER_SERVER_PORT,
  type RehearsalWorkspace,
} from "./fixture.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sanitizedEnv", () => {
  it("strips every CORPUS_* variable and prepends the bin dir to PATH", () => {
    vi.stubEnv("CORPUS_WORKSPACE", "/somebody/elses/workspace");
    vi.stubEnv("CORPUS_FROM", "agent");
    vi.stubEnv("PATH", "/usr/bin");
    const env = sanitizedEnv("/bin-dir");
    expect(env.CORPUS_WORKSPACE).toBeUndefined();
    expect(env.CORPUS_FROM).toBeUndefined();
    expect(env.PATH?.startsWith("/bin-dir:")).toBe(true);
    expect(env.PATH?.includes("/usr/bin")).toBe(true);
  });
});

describe("shimContent", () => {
  it("quotes both paths and forwards argv untouched", () => {
    const shim = shimContent("/usr/local/bin/node", "/repo/apps/cli/dist/bin/corpus.js");
    expect(shim).toBe(
      '#!/bin/sh\nexec "/usr/local/bin/node" "/repo/apps/cli/dist/bin/corpus.js" "$@"\n',
    );
  });
});

describe("allocatePort", () => {
  it("hands out a real port and never the live server's 8765", async () => {
    const port = await allocatePort();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65536);
    expect(port).not.toBe(USER_SERVER_PORT);
  });
});

describe("the temp directory name", () => {
  it("does not whisper to the agent that it is being observed (rule 1)", () => {
    for (const banned of ["rehears", "test", "fixture", "scenario"]) {
      expect(BASE_DIR_PREFIX.toLowerCase()).not.toContain(banned);
    }
  });
});

describe("assertRehearsalWorkspace — the harness acts only on what it created", () => {
  const handleFor = (baseDir: string, nonce: string): RehearsalWorkspace => ({
    baseDir,
    workspaceRoot: join(baseDir, "workspace"),
    corpusBin: join(baseDir, "bin", "corpus"),
    binDir: join(baseDir, "bin"),
    port: 4321,
    nonce,
  });

  it("refuses a directory with no marker", async () => {
    const dir = await mkdtemp(join(tmpdir(), "corpus-fixture-test-"));
    await expect(assertRehearsalWorkspace(handleFor(dir, "abc"))).rejects.toThrow(
      RehearsalSafetyError,
    );
  });

  it("refuses a marker carrying somebody else's nonce", async () => {
    const dir = await mkdtemp(join(tmpdir(), "corpus-fixture-test-"));
    await writeFile(join(dir, MARKER_FILE), JSON.stringify({ nonce: "theirs" }), "utf8");
    await expect(assertRehearsalWorkspace(handleFor(dir, "ours"))).rejects.toThrow(
      RehearsalSafetyError,
    );
  });

  it("accepts its own marker", async () => {
    const dir = await mkdtemp(join(tmpdir(), "corpus-fixture-test-"));
    await writeFile(join(dir, MARKER_FILE), JSON.stringify({ nonce: "ours" }), "utf8");
    await expect(assertRehearsalWorkspace(handleFor(dir, "ours"))).resolves.toBeUndefined();
  });

  it("refuses port 8765 whatever the marker says", async () => {
    const dir = await mkdtemp(join(tmpdir(), "corpus-fixture-test-"));
    await writeFile(join(dir, MARKER_FILE), JSON.stringify({ nonce: "ours" }), "utf8");
    const handle = { ...handleFor(dir, "ours"), port: USER_SERVER_PORT };
    await expect(assertRehearsalWorkspace(handle)).rejects.toThrow(RehearsalSafetyError);
  });

  it("refuses a workspace path outside its base", async () => {
    const dir = await mkdtemp(join(tmpdir(), "corpus-fixture-test-"));
    await writeFile(join(dir, MARKER_FILE), JSON.stringify({ nonce: "ours" }), "utf8");
    const handle = { ...handleFor(dir, "ours"), workspaceRoot: "/somewhere/else" };
    await expect(assertRehearsalWorkspace(handle)).rejects.toThrow(RehearsalSafetyError);
  });
});
