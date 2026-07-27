import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceCommandSpec } from "../../registry/types.js";
import { collectRegistryProblems } from "../../registry/validate.js";
import {
  closeStubServers,
  sendJson,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { lockTopic } from "./index.js";

const LOCK = {
  docId: "doc_a1b2c3",
  holder: "agent",
  acquired: "2026-07-27T10:00:00.000Z",
  ttl: 300,
};

const EXPECTED_PATHS: Readonly<Record<string, string>> = {
  break: "/api/locks/doc_a1b2c3/break",
  reap: "/api/locks/reap",
  list: "/api/locks",
  acquire: "/api/locks/doc_a1b2c3",
  release: "/api/locks/doc_a1b2c3",
};

afterEach(closeStubServers);

describe("the lock topic", () => {
  it("is a valid registry topic", () => {
    expect(collectRegistryProblems({ summary: "s.", commands: [], topics: [lockTopic] })).toEqual(
      [],
    );
  });

  it("declares the operator escape hatches plus the explicit lease verbs", () => {
    expect(lockTopic.commands.map((command) => command.name)).toEqual(Object.keys(EXPECTED_PATHS));
  });

  it("wires every verb to its contract path", async () => {
    for (const command of lockTopic.commands) {
      const stub = await startStubServer((request, response) => {
        if (request.path === "/api/locks" && request.method === "GET") {
          return sendJson(response, 200, { locks: [LOCK] });
        }
        if (request.path === "/api/locks/reap") return sendJson(response, 200, { reaped: [] });
        if (request.method === "POST" && request.path.endsWith("/break")) {
          return sendJson(response, 200, { docId: LOCK.docId, released: true, holder: "agent" });
        }
        if (request.method === "DELETE") {
          return sendJson(response, 200, { docId: LOCK.docId, released: true, holder: "agent" });
        }
        sendJson(response, 201, LOCK);
      });

      const harness = stubContext(stub, { args: { "doc-id": "doc_a1b2c3" } });
      expect(command.requiresWorkspace).not.toBe(false);
      await (command as WorkspaceCommandSpec).handler(harness.context);

      expect(stub.requests[0]?.path, `corpus lock ${command.name}`).toBe(
        EXPECTED_PATHS[command.name],
      );
    }
  });
});
