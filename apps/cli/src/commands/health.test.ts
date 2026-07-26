import { describe, expect, it } from "vitest";
import type { CorpusApi } from "@corpus/contract/client";
import type { CliClient } from "../client.js";
import { createOutput } from "../output.js";
import { ParsedArgs, ParsedFlags } from "../parse-args.js";
import { collectRegistryProblems } from "../registry/validate.js";
import type { Workspace } from "../workspace.js";
import { healthCommand } from "./health.js";

const HEALTH = { status: "ok", version: "0.0.0", uptimeSeconds: 42.4, workspace: "/tmp/ws" };

const workspace: Workspace = {
  root: "/tmp/ws",
  configPath: "/tmp/ws/.corpus/config.json",
  host: "127.0.0.1",
  port: 8865,
  token: "0123456789abcdef0123456789abcdef",
  dataDir: "data",
  baseUrl: "http://127.0.0.1:8865",
};

function clientReturning(body: unknown): { client: CliClient; calls: unknown[] } {
  const calls: unknown[] = [];
  const api = {
    GET: (path: string) => {
      calls.push(path);
      return Promise.resolve({ data: body, response: new Response() });
    },
  } as unknown as CorpusApi;

  return {
    calls,
    client: {
      baseUrl: workspace.baseUrl,
      api,
      request: (call) => call(api).then((result) => result.data as never),
    },
  };
}

async function runHealth(json: boolean) {
  const stdout: string[] = [];
  const { client, calls } = clientReturning(HEALTH);
  await healthCommand.handler({
    args: new ParsedArgs(new Map()),
    flags: new ParsedFlags(new Map()),
    out: createOutput({
      json,
      color: false,
      stdout: (text) => void stdout.push(text),
      stderr: () => undefined,
    }),
    workspace,
    client,
  });
  return { stdout: stdout.join(""), calls };
}

describe("corpus health", () => {
  it("calls the contract's health path through the typed client", async () => {
    const { calls } = await runHealth(false);
    expect(calls).toEqual(["/api/health"]);
  });

  it("prints a single human one-liner without --json", async () => {
    const { stdout } = await runHealth(false);
    expect(stdout).toBe("ok — corpus 0.0.0, up 42s, workspace /tmp/ws\n");
  });

  it("emits the health payload verbatim under --json", async () => {
    const { stdout } = await runHealth(true);
    expect(JSON.parse(stdout)).toEqual(HEALTH);
  });

  it("is a valid registry entry that needs a workspace", () => {
    expect(
      collectRegistryProblems({ summary: "s.", commands: [healthCommand], topics: [] }),
    ).toEqual([]);
    expect(healthCommand.requiresWorkspace).toBeUndefined();
    expect(healthCommand.examples.length).toBeGreaterThan(0);
  });
});
