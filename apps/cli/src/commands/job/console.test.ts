import { QUEUE_EVENT_STATUSES } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { ExitCode } from "../../errors.js";
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

  it("passes --status through verbatim, comma-separated set and all", async () => {
    const stub = await startStubServer(jsonResponder(200, { jobs: [JOB] }));

    const harness = stubContext(stub, { flags: { status: "pending,in-progress,deferred" } });
    await runJobList(harness.context);

    // Verbatim: the CLI does not split, re-join, sort or dedupe the set. The
    // contract owns that grammar (CLI-031).
    expect(stub.requests[0]?.query.get("status")).toBe("pending,in-progress,deferred");
  });

  it("sends --origin as originId, and --recent alongside it untouched", async () => {
    const stub = await startStubServer(jsonResponder(200, { jobs: [JOB] }));

    const harness = stubContext(stub, { flags: { origin: "th_2222", recent: 5 } });
    await runJobList(harness.context);

    // `recent` is still sent; the server is what ignores it once `originId` is
    // present, and second-guessing that here would fork the documented rule.
    expect(stub.requests[0]?.query.get("originId")).toBe("th_2222");
    expect(stub.requests[0]?.query.get("recent")).toBe("5");
  });

  it("sends no query at all when no flag was passed", async () => {
    const stub = await startStubServer(jsonResponder(200, { jobs: [JOB] }));

    const harness = stubContext(stub);
    await runJobList(harness.context);

    expect(stub.requests[0]?.url).toBe("/api/jobs");
  });

  it("says a filter matched nothing rather than that the queue is empty", async () => {
    const stub = await startStubServer(jsonResponder(200, { jobs: [] }));

    const harness = stubContext(stub, { flags: { status: "in-progress" } });
    await runJobList(harness.context);

    expect(harness.stdout()).toBe("no jobs match.\n");
  });

  it("surfaces an unknown status as the server's error, naming the legal values", async () => {
    // The CLI holds no list of statuses to check against: the contract validates
    // this parameter at its boundary precisely so a typo is an error naming the
    // legal set instead of a filter that silently matches nothing (CLI-031).
    const issues = [
      {
        path: "query.status",
        message: `unknown job status "in_progress"; expected one of ${QUEUE_EVENT_STATUSES.join(", ")}`,
      },
    ];
    const stub = await startStubServer(
      jsonResponder(400, { code: "bad_request", message: "request failed validation", issues }),
    );

    const harness = stubContext(stub, { flags: { status: "in_progress" } });

    // It reached the wire — the CLI did not refuse it locally.
    await expect(runJobList(harness.context)).rejects.toMatchObject({
      code: "bad_request",
      exitCode: ExitCode.serverError,
      message: "400 bad_request: request failed validation",
      details: issues,
    });
    expect(stub.requests[0]?.query.get("status")).toBe("in_progress");
    expect(harness.stdout()).toBe("");
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
