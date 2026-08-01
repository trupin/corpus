import type { IndexStatus } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor } from "../../errors.js";
import {
  closeStubServers,
  jsonResponder,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { NO_IDENTITY, renderIndexStatus, runIndexStatus, statusCommand } from "./status.js";

/**
 * The five states CONTRACT-023's schema round-trips are the five this verb has
 * to render, and the property under test is that **one block comes out in one
 * order** whatever the state: an agent reads these positionally, so the field
 * order is a parse target rather than a formatting choice.
 */

const status = (overrides: Partial<IndexStatus> = {}): IndexStatus => ({
  indexed: 660,
  pending: 0,
  failed: 0,
  identity: "local/all-MiniLM-L6-v2@384",
  rebuilding: false,
  state: "current",
  ...overrides,
});

/** The fixture states, named as the contract names them. */
const FIXTURES = {
  fresh: status({ indexed: 0, pending: 0, failed: 0, identity: null, state: "disabled" }),
  draining: status({ indexed: 120, pending: 540, state: "stale" }),
  rebuilding: status({ indexed: 0, pending: 660, rebuilding: true, state: "indexing" }),
  current: status(),
  failing: status({ indexed: 655, failed: 5, state: "current" }),
} as const;

const labels = (block: readonly string[]): readonly string[] =>
  block.map((line) => line.split(" ")[0] ?? "");

afterEach(closeStubServers);

describe("corpus index status", () => {
  it("reads the status route and prints one block, nothing else", async () => {
    const stub = await startStubServer(jsonResponder(200, FIXTURES.current));
    const harness = stubContext(stub, {});

    await runIndexStatus(harness.context);

    const [request] = stub.requests;
    expect(request?.method).toBe("GET");
    expect(request?.path).toBe("/api/index/status");
    expect(harness.stdout()).toBe(
      [
        "identity    local/all-MiniLM-L6-v2@384",
        "indexed     660",
        "pending     0",
        "failed      0",
        "rebuilding  no",
        "state       current",
        "",
      ].join("\n"),
    );
  });

  it("keeps one field order across every state the contract can produce", () => {
    for (const fixture of Object.values(FIXTURES)) {
      const block = renderIndexStatus(fixture);
      expect(block).toHaveLength(6);
      expect(labels(block)).toEqual([
        "identity",
        "indexed",
        "pending",
        "failed",
        "rebuilding",
        "state",
      ]);
      expect(block.join("\n")).not.toContain("undefined");
    }
  });

  it("says a fresh workspace has no identity yet, rather than printing null", () => {
    const block = renderIndexStatus(FIXTURES.fresh).join("\n");

    expect(block).toContain(`identity    ${NO_IDENTITY}`);
    expect(block).not.toContain("null");
    expect(block).toContain("state       disabled");
  });

  it("reports the rebuild flag as a word a person reads, in both directions", () => {
    expect(renderIndexStatus(FIXTURES.rebuilding).at(-2)).toBe("rebuilding  yes");
    expect(renderIndexStatus(FIXTURES.draining).at(-2)).toBe("rebuilding  no");
  });

  it("shows the backlog and the failures as the separate numbers they are", () => {
    const draining = renderIndexStatus(FIXTURES.draining).join("\n");
    expect(draining).toContain("pending     540");
    expect(draining).toContain("state       stale");

    const failing = renderIndexStatus(FIXTURES.failing).join("\n");
    expect(failing).toContain("failed      5");
  });

  it("emits the server's report verbatim under --json, as exactly one line", async () => {
    const stub = await startStubServer(jsonResponder(200, FIXTURES.draining));
    const harness = stubContext(stub, { json: true });

    await runIndexStatus(harness.context);

    expect(harness.stdout()).toBe(`${JSON.stringify(FIXTURES.draining)}\n`);
    expect(harness.stdout().trimEnd().split("\n")).toHaveLength(1);
    expect(harness.stdout()).not.toContain("identity  ");
  });

  it("treats a disabled index as an answer, not a failure — exit 0", async () => {
    const stub = await startStubServer(jsonResponder(200, FIXTURES.fresh));
    const harness = stubContext(stub, {});

    await expect(runIndexStatus(harness.context)).resolves.toBeUndefined();
  });

  it("surfaces a refused token as the shipped server error, exit 5", async () => {
    const stub = await startStubServer(
      jsonResponder(401, { code: "unauthorized", message: "missing or invalid bearer token" }),
    );
    const harness = stubContext(stub, {});

    const error: unknown = await runIndexStatus(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.serverError);
    expect(String(error)).toContain("401 unauthorized: missing or invalid bearer token");
  });

  it("declares no flags of its own — the block is the whole surface", () => {
    expect(statusCommand.flags).toEqual([]);
    expect(statusCommand.args).toEqual([]);
  });
});
