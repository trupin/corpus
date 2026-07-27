import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ACTOR } from "@corpus/contract";
import { UsageError } from "../../errors.js";
import { createTestContext } from "../../registry/fixtures.js";
import { makeTempDir, removeTempDirs } from "../../testing/temp.js";
import type { Workspace } from "../../workspace.js";
import { DEFAULT_LOG_LINES, followFile, logsCommand, tailLines } from "./logs.js";

afterEach(removeTempDirs);

function workspaceWithLog(label: string, contents: string): { workspace: Workspace; path: string } {
  const root = makeTempDir(label);
  mkdirSync(join(root, ".corpus"), { recursive: true });
  const path = join(root, ".corpus", "server.log");
  writeFileSync(path, contents);
  return { workspace: fakeWorkspace(root), path };
}

function fakeWorkspace(root: string): Workspace {
  return {
    root,
    configPath: join(root, ".corpus", "config.json"),
    host: "127.0.0.1",
    port: 8790,
    token: "t",
    dataDir: "data",
    baseUrl: "http://127.0.0.1:8790",
  };
}

describe("tailLines", () => {
  it("returns nothing for a missing or empty file, or a non-positive count", () => {
    const dir = makeTempDir("tail-empty");
    expect(tailLines(join(dir, "missing.log"), 10)).toEqual([]);

    const empty = join(dir, "empty.log");
    writeFileSync(empty, "");
    expect(tailLines(empty, 10)).toEqual([]);

    const some = join(dir, "some.log");
    writeFileSync(some, "a\nb\n");
    expect(tailLines(some, 0)).toEqual([]);
  });

  it("returns the last n lines, and every line when there are fewer", () => {
    const path = join(makeTempDir("tail-n"), "server.log");
    writeFileSync(path, "one\ntwo\nthree\nfour\n");
    expect(tailLines(path, 2)).toEqual(["three", "four"]);
    expect(tailLines(path, 99)).toEqual(["one", "two", "three", "four"]);
  });

  it("handles a final line with no trailing newline", () => {
    const path = join(makeTempDir("tail-partial"), "server.log");
    writeFileSync(path, "one\ntwo");
    expect(tailLines(path, 2)).toEqual(["one", "two"]);
  });

  it("reads backwards across chunks rather than loading the whole file", () => {
    const path = join(makeTempDir("tail-big"), "server.log");
    // Comfortably larger than the 64 KiB read chunk, so the backwards walk runs.
    const lines = Array.from({ length: 20_000 }, (_, index) => `line ${String(index)}`);
    writeFileSync(path, `${lines.join("\n")}\n`);

    expect(statSync(path).size).toBeGreaterThan(64 * 1024);
    expect(tailLines(path, 3)).toEqual(["line 19997", "line 19998", "line 19999"]);
  });

  it("preserves multi-byte characters split across chunk boundaries", () => {
    const path = join(makeTempDir("tail-utf8"), "server.log");
    const padding = "x".repeat(64 * 1024);
    writeFileSync(path, `${padding}\ncafé — naïve\n`);
    expect(tailLines(path, 1)).toEqual(["café — naïve"]);
  });
});

describe("followFile", () => {
  it("streams appended bytes until the signal aborts", async () => {
    const path = join(makeTempDir("follow"), "server.log");
    writeFileSync(path, "first\n");

    const chunks: string[] = [];
    const controller = new AbortController();
    const running = followFile({
      path,
      from: statSync(path).size,
      signal: controller.signal,
      intervalMs: 5,
      write: (text) => chunks.push(text),
    });

    appendFileSync(path, "second\n");
    await waitUntil(() => chunks.join("").includes("second"));
    appendFileSync(path, "third\n");
    await waitUntil(() => chunks.join("").includes("third"));

    controller.abort();
    await running;

    expect(chunks.join("")).toBe("second\nthird\n");
  });

  it("restarts from the beginning when the log is truncated under it", async () => {
    const path = join(makeTempDir("follow-truncate"), "server.log");
    writeFileSync(path, "old content\n");

    const chunks: string[] = [];
    const controller = new AbortController();
    const running = followFile({
      path,
      from: statSync(path).size,
      signal: controller.signal,
      intervalMs: 5,
      write: (text) => chunks.push(text),
    });

    writeFileSync(path, "new\n");
    await waitUntil(() => chunks.join("").includes("new"));
    controller.abort();
    await running;

    expect(chunks.join("")).toBe("new\n");
  });

  it("returns immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await followFile({
      path: "/nonexistent/server.log",
      from: 0,
      signal: controller.signal,
      write: () => undefined,
    });
  });
});

describe("corpus server logs", () => {
  it("prints the tail verbatim", async () => {
    const { workspace, path } = workspaceWithLog("logs-print", "a\nb\nc\n");
    const harness = createTestContext({ flags: { lines: 2, follow: false } });
    await logsCommand.handler({
      ...harness.context,
      workspace,
      client: undefined as never,
      actor: DEFAULT_ACTOR,
    });

    expect(harness.stdout()).toBe("b\nc\n");
    expect(readFileSync(path, "utf8")).toBe("a\nb\nc\n");
  });

  it("emits one JSON value under --json", async () => {
    const { workspace } = workspaceWithLog("logs-json", "a\nb\n");
    const harness = createTestContext({ flags: { lines: 2, follow: false }, json: true });
    await logsCommand.handler({
      ...harness.context,
      workspace,
      client: undefined as never,
      actor: DEFAULT_ACTOR,
    });

    expect(JSON.parse(harness.stdout())).toMatchObject({ lines: ["a", "b"] });
  });

  it("defaults to the documented number of lines", async () => {
    const { workspace } = workspaceWithLog(
      "logs-default",
      `${Array.from({ length: 120 }, (_, i) => `l${String(i)}`).join("\n")}\n`,
    );
    const harness = createTestContext({ flags: { follow: false } });
    await logsCommand.handler({
      ...harness.context,
      workspace,
      client: undefined as never,
      actor: DEFAULT_ACTOR,
    });

    expect(harness.stdout().trimEnd().split("\n")).toHaveLength(DEFAULT_LOG_LINES);
  });

  it("refuses --follow with --json, which promises exactly one value", async () => {
    const { workspace } = workspaceWithLog("logs-conflict", "a\n");
    const harness = createTestContext({ flags: { follow: true }, json: true });

    await expect(
      logsCommand.handler({
        ...harness.context,
        workspace,
        client: undefined as never,
        actor: DEFAULT_ACTOR,
      }),
    ).rejects.toBeInstanceOf(UsageError);
  });

  it("follows until interrupted, then exits cleanly", async () => {
    const { workspace, path } = workspaceWithLog("logs-follow", "start\n");
    const harness = createTestContext({ flags: { lines: 1, follow: true } });

    const running = logsCommand.handler({
      ...harness.context,
      workspace,
      client: undefined as never,
      actor: DEFAULT_ACTOR,
    });
    const before = process.listenerCount("SIGINT");
    appendFileSync(path, "later\n");
    await waitUntil(() => harness.stdout().includes("later"));
    process.emit("SIGINT", "SIGINT");
    await running;

    expect(harness.stdout()).toBe("start\nlater\n");
    // The interrupt handler is the command's, not the process's: it goes away.
    expect(process.listenerCount("SIGINT")).toBe(before - 1);
  });
});

async function waitUntil(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition was never met");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
