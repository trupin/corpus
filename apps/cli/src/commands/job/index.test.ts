import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceCommandSpec } from "../../registry/types.js";
import { collectRegistryProblems } from "../../registry/validate.js";
import {
  closeStubServers,
  sendJson,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { jobTopic } from "./index.js";

const JOB = {
  eventId: "evt_1111",
  status: "processed",
  started: "2026-07-27T10:00:00.000Z",
  updated: "2026-07-27T10:00:01.000Z",
  lastLine: null,
  originId: null,
};

const EXPECTED_PATHS: Readonly<Record<string, string>> = {
  log: "/api/jobs/evt_1111/log",
  list: "/api/jobs",
  retry: "/api/jobs/evt_1111/retry",
  abandon: "/api/jobs/evt_1111/abandon",
};

afterEach(closeStubServers);

describe("the job topic", () => {
  it("is a valid registry topic", () => {
    expect(collectRegistryProblems({ summary: "s.", commands: [], topics: [jobTopic] })).toEqual(
      [],
    );
  });

  it("declares the agent's write verb plus the console's read and actions", () => {
    expect(jobTopic.commands.map((command) => command.name)).toEqual(Object.keys(EXPECTED_PATHS));
  });

  it("wires every verb to its contract path", async () => {
    for (const command of jobTopic.commands) {
      const stub = await startStubServer((request, response) => {
        if (request.path === "/api/jobs") return sendJson(response, 200, { jobs: [] });
        if (request.path.endsWith("/log")) {
          return sendJson(response, 201, { eventId: "evt_1111", appended: true });
        }
        sendJson(response, 200, JOB);
      });

      const harness = stubContext(stub, {
        args: { "event-id": "evt_1111", line: "a progress line" },
      });
      expect(command.requiresWorkspace).not.toBe(false);
      await (command as WorkspaceCommandSpec).handler(harness.context);

      expect(stub.requests[0]?.path, `corpus job ${command.name}`).toBe(
        EXPECTED_PATHS[command.name],
      );
    }
  });
});
