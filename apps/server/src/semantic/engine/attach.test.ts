import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type CorpusServer } from "../../app.js";
import { DEFAULT_ATTACHMENT_LIMITS } from "../../attachments/index.js";
import type { ServerConfig } from "../../config.js";
import { createLogger } from "../../logger.js";
import { openWorkspaceProjection } from "../../projection/index.js";
import { EMBEDDED_PROVIDER } from "../embedded-engine.js";
import { attachEmbeddedEngine } from "./attach.js";
import { EMBEDDED_MODEL } from "./manifest.js";

const TOKEN = "tkn_0123456789abcdef0123456789abcdef";

let root: string;
let workspaceRoot: string;
let lines: string[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s048-engine-attach-"));
  workspaceRoot = join(root, "ws");
  mkdirSync(join(workspaceRoot, "data", "docs"), { recursive: true });
  lines = [];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function boot(): CorpusServer {
  const config: ServerConfig = {
    workspaceRoot,
    corpusDir: join(workspaceRoot, ".corpus"),
    attachments: DEFAULT_ATTACHMENT_LIMITS,
    dataDir: join(workspaceRoot, "data"),
    configPath: join(workspaceRoot, ".corpus", "config.json"),
    host: "127.0.0.1",
    port: 0,
    token: TOKEN,
    version: "9.9.9",
    logLevel: "info",
    uiDistDir: undefined,
    embedding: { kind: "absent" },
    warnings: [],
  };
  const logger = createLogger("info", { write: (line) => lines.push(line) });
  const projection = openWorkspaceProjection(config, logger);
  return createServer(config, { logger, projection });
}

describe("attachEmbeddedEngine", () => {
  it("builds an engine named for the pinned model without touching disk or network", async () => {
    const server = boot();
    const engine = attachEmbeddedEngine(
      server,
      { HOME: join(root, "home") },
      { platform: "linux" },
    );

    expect(engine.ref).toEqual({ provider: EMBEDDED_PROVIDER, model: EMBEDDED_MODEL.model });
    // The cache directory does not exist; the honest answer is "not downloaded",
    // and nothing was created to find that out.
    await expect(engine.availability()).resolves.toMatchObject({
      available: false,
      reason: "model-not-downloaded",
    });
    await server.close();
  });

  it("reports itself unavailable when the server's environment names no home", async () => {
    const server = boot();
    const engine = attachEmbeddedEngine(server, {}, { platform: "linux" });

    await expect(engine.availability()).resolves.toMatchObject({
      available: false,
      reason: "unsupported-platform",
    });
    await server.close();
  });

  it("closes with the server, so a shutdown releases the model", async () => {
    const server = boot();
    const engine = attachEmbeddedEngine(
      server,
      { HOME: join(root, "home") },
      { platform: "linux" },
    );

    await server.close();

    // Registered as a disposer, so the engine is shut after `server.close()`.
    await expect(engine.availability()).resolves.toMatchObject({
      available: false,
      reason: "engine-not-installed",
    });
  });

  it("speaks through the server's logger, at both levels", async () => {
    const server = boot();
    const engine = attachEmbeddedEngine(
      server,
      { HOME: join(root, "home") },
      {
        platform: "linux",
        // Never the real network in a unit test: a refusing transport gives the
        // download's start line and its failure line in one run.
        engine: { fetchFn: () => Promise.resolve(new Response(null, { status: 502 })) },
      },
    );

    engine.requestModel();
    await engine.whenSettled();

    const log = lines.join("\n");
    expect(log).toContain(`downloading the ${EMBEDDED_MODEL.model} embedding model`);
    expect(log).toContain("HTTP 502");
    expect(lines.some((line) => line.includes("error"))).toBe(true);
    await server.close();
  });
});
