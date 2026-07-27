import { afterEach, describe, expect, it } from "vitest";
import {
  closeStubServers,
  jsonResponder,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { runJobAbandon, runJobList, runJobRetry } from "./console.js";

const JOB = {
  eventId: "evt_1111",
  status: "processed",
  started: "2026-07-27T10:00:00.000Z",
  updated: "2026-07-27T10:00:05.000Z",
  lastLine: "wrote the reply",
  originId: "th_2222",
};

const ARGS = { "event-id": "evt_1111" };

afterEach(closeStubServers);

describe("corpus job list", () => {
  it("says so when nothing has run yet", async () => {
    const stub = await startStubServer(jsonResponder(200, { jobs: [] }));

    const harness = stubContext(stub);
    await runJobList(harness.context);

    expect(stub.requests[0]?.url).toBe("/api/jobs");
    expect(harness.stdout()).toBe("no jobs yet.\n");
  });

  it("prints one row per job and passes --recent through", async () => {
    const stub = await startStubServer(
      jsonResponder(200, { jobs: [JOB, { ...JOB, eventId: "evt_2222", lastLine: null }] }),
    );

    const harness = stubContext(stub, { flags: { recent: 5 } });
    await runJobList(harness.context);

    expect(stub.requests[0]?.query.get("recent")).toBe("5");
    expect(harness.stdout()).toBe("evt_1111 processed wrote the reply\nevt_2222 processed\n");
  });

  it("emits the job list under --json", async () => {
    const stub = await startStubServer(jsonResponder(200, { jobs: [JOB] }));

    const harness = stubContext(stub, { json: true });
    await runJobList(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual({ jobs: [JOB] });
  });
});

describe("corpus job retry", () => {
  it("queues the job again and reports its state", async () => {
    const stub = await startStubServer(jsonResponder(200, { ...JOB, status: "pending" }));

    const harness = stubContext(stub, { args: ARGS });
    await runJobRetry(harness.context);

    expect(stub.requests[0]?.path).toBe("/api/jobs/evt_1111/retry");
    expect(harness.stdout()).toBe("job evt_1111 is pending.\n");
  });
});

describe("corpus job abandon", () => {
  it("abandons the job and reports its state", async () => {
    const stub = await startStubServer(jsonResponder(200, { ...JOB, status: "abandoned" }));

    const harness = stubContext(stub, { args: ARGS, json: true });
    await runJobAbandon(harness.context);

    expect(stub.requests[0]?.path).toBe("/api/jobs/evt_1111/abandon");
    expect(JSON.parse(harness.stdout())).toEqual({ ...JOB, status: "abandoned" });
  });
});
