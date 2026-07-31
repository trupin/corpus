import { afterEach, describe, expect, it } from "vitest";
import { collectRegistryProblems } from "../../registry/validate.js";
import type { WorkspaceCommandSpec } from "../../registry/types.js";
import {
  closeStubServers,
  sendJson,
  sendNoContent,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { queueTopic } from "./index.js";

/**
 * Wiring, not behaviour: every verb is invoked through the registry entry the
 * dispatcher will use, so a spec pointing at the wrong handler — or at the
 * wrong contract path — fails here rather than in front of the agent.
 */

const STATUS = {
  halted: false,
  pending: 0,
  inProgress: 0,
  deferred: 0,
  processed: 0,
  failed: 0,
  abandoned: 0,
};

const EVENT = {
  id: "evt_1111",
  type: "comment.created",
  created: "2026-07-27T10:00:00.000Z",
  source: "cli",
  payload: {},
};

afterEach(closeStubServers);

/** Answers whatever the queue routes need, so any verb can be driven. */
function queueResponder(): Parameters<typeof startStubServer>[0] {
  return (request, response) => {
    if (request.path === "/api/queue/idle") return sendNoContent(response);
    if (request.path === "/api/queue/claim-all") return sendJson(response, 200, { events: [] });
    if (request.path === "/api/queue/reap-stale") return sendJson(response, 200, { reaped: [] });
    if (
      request.path.endsWith("/complete") ||
      request.path.endsWith("/fail") ||
      request.path.endsWith("/defer")
    ) {
      return sendJson(response, 200, EVENT);
    }
    if (request.method === "DELETE") return sendJson(response, 200, EVENT);
    sendJson(response, 200, STATUS);
  };
}

const EXPECTED_PATHS: Readonly<Record<string, string>> = {
  idle: "/api/queue/idle",
  "claim-all": "/api/queue/claim-all",
  complete: "/api/queue/evt_1111/complete",
  fail: "/api/queue/evt_1111/fail",
  abandon: "/api/queue/evt_1111",
  defer: "/api/queue/evt_1111/defer",
  "reap-stale": "/api/queue/reap-stale",
  halt: "/api/queue/halt",
  resume: "/api/queue/resume",
  status: "/api/queue/status",
};

describe("the queue topic", () => {
  it("is a valid registry topic", () => {
    expect(collectRegistryProblems({ summary: "s.", commands: [], topics: [queueTopic] })).toEqual(
      [],
    );
  });

  it("declares exactly the verbs SPEC.md §7 names", () => {
    expect(queueTopic.commands.map((command) => command.name)).toEqual(Object.keys(EXPECTED_PATHS));
  });

  it("wires every verb to its contract path", async () => {
    for (const command of queueTopic.commands) {
      const stub = await startStubServer(queueResponder());
      const harness = stubContext(stub, {
        args: { "event-id": "evt_1111" },
        // A zero window keeps `idle` to a single probe; `defer` refuses to send
        // anything without the document it is blocked on.
        flags: { wait: 0, "blocked-on": "doc_a1b2c3" },
      });

      expect(command.requiresWorkspace).not.toBe(false);
      await (command as WorkspaceCommandSpec).handler(harness.context);

      expect(stub.requests[0]?.path, `corpus queue ${command.name}`).toBe(
        EXPECTED_PATHS[command.name],
      );
    }
  });
});
