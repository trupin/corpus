/** @vitest-environment jsdom */
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCorpusTestHarness } from "../testing/index.js";
import { DOCS_KEY, docsListKey, JOBS_KEY, jobsListKey, QUEUE_KEY } from "./keys.js";
import { useAbandonJob, useHaltQueue, useResumeQueue, useRetryJob } from "./useQueueControl.js";

afterEach(cleanup);

const STATUS = {
  halted: true,
  pending: 0,
  inProgress: 0,
  processed: 0,
  failed: 0,
  abandoned: 0,
};

const JOB = {
  eventId: "evt_7aa",
  type: "comment.created",
  status: "pending",
  started: "2026-07-27T09:12:00Z",
  updated: "2026-07-27T09:12:00Z",
  lastLine: null,
  originId: null,
  originTitle: null,
};

interface Capture {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

function transport(
  payload: unknown,
  status = 200,
): {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: Capture[];
} {
  const calls: Capture[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const raw = await request.text();
    calls.push({
      method: request.method,
      path: new URL(request.url).pathname,
      body: raw === "" ? undefined : (JSON.parse(raw) as unknown),
    });
    return new Response(
      JSON.stringify(
        status < 400 ? payload : { code: "conflict", message: "event already reaped", issues: [] },
      ),
      { status, headers: { "content-type": "application/json" } },
    );
  });
  return { fetch, calls };
}

/** The three query families a queue transition makes stale. */
function seed(harness: ReturnType<typeof createCorpusTestHarness>): void {
  harness.queryClient.setQueryData(QUEUE_KEY, STATUS);
  harness.queryClient.setQueryData(jobsListKey({}), { jobs: [] });
  harness.queryClient.setQueryData(docsListKey({ needs: "me" }), { items: [], page: {} });
}

function invalidated(
  harness: ReturnType<typeof createCorpusTestHarness>,
): Record<string, boolean | undefined> {
  return {
    queue: harness.queryClient.getQueryState(QUEUE_KEY)?.isInvalidated,
    jobs: harness.queryClient.getQueryState(jobsListKey({}))?.isInvalidated,
    attention: harness.queryClient.getQueryState(docsListKey({ needs: "me" }))?.isInvalidated,
  };
}

describe("useHaltQueue", () => {
  it("POSTs a bare halt when no reason is given", async () => {
    const wire = transport(STATUS);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useHaltQueue(), { wrapper: harness.Wrapper });

    result.current.mutate(undefined);
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    // A bare POST halts; `{}` would re-record the sentinel with an empty
    // annotation, which is a different act from halting without one.
    expect(wire.calls).toEqual([{ method: "POST", path: "/api/queue/halt", body: undefined }]);
    expect(result.current.data?.halted).toBe(true);
  });

  it("carries a reason into the sentinel when one is given", async () => {
    const wire = transport(STATUS);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useHaltQueue(), { wrapper: harness.Wrapper });

    result.current.mutate("rebuilding the projection");
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(wire.calls[0]?.body).toEqual({ reason: "rebuilding the projection" });
  });

  it("invalidates the queue, the jobs and the Attention collection", async () => {
    const wire = transport(STATUS);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    seed(harness);
    const { result } = renderHook(() => useHaltQueue(), { wrapper: harness.Wrapper });

    result.current.mutate(undefined);
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(invalidated(harness)).toEqual({ queue: true, jobs: true, attention: true });
  });
});

describe("useResumeQueue", () => {
  it("POSTs an empty resume and invalidates the same three", async () => {
    const wire = transport({ ...STATUS, halted: false });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    seed(harness);
    const { result } = renderHook(() => useResumeQueue(), { wrapper: harness.Wrapper });

    result.current.mutate();
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(wire.calls).toEqual([{ method: "POST", path: "/api/queue/resume", body: undefined }]);
    expect(invalidated(harness)).toEqual({ queue: true, jobs: true, attention: true });
  });
});

describe("useRetryJob", () => {
  it("POSTs to the job's retry route", async () => {
    const wire = transport(JOB);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useRetryJob(), { wrapper: harness.Wrapper });

    result.current.mutate("evt_7aa");
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(wire.calls).toEqual([
      { method: "POST", path: "/api/jobs/evt_7aa/retry", body: undefined },
    ]);
  });

  // TEST-108: a failed job is an Attention reason, and the server's queue frames
  // name `queue` and `jobs` only — so the Attention row would not clear without
  // this. Asserted rather than trusted to a blanket invalidation.
  it("makes the Attention collection stale as well as the job list", async () => {
    const wire = transport(JOB);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    seed(harness);
    const { result } = renderHook(() => useRetryJob(), { wrapper: harness.Wrapper });

    result.current.mutate("evt_7aa");
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(invalidated(harness)).toEqual({ queue: true, jobs: true, attention: true });
    // The list key and the per-job log key both sit under `["jobs"]`, so one
    // invalidation reaches the console's log pane too.
    expect(JOBS_KEY).toEqual(["jobs"]);
    expect(DOCS_KEY).toEqual(["docs"]);
  });

  it("surfaces the server's refusal rather than swallowing it", async () => {
    const wire = transport(JOB, 409);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useRetryJob(), { wrapper: harness.Wrapper });

    result.current.mutate("evt_reaped");
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error?.message).toContain("event already reaped");
  });
});

describe("useAbandonJob", () => {
  it("POSTs to the job's abandon route and invalidates the same three", async () => {
    const wire = transport({ ...JOB, status: "abandoned" });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    seed(harness);
    const { result } = renderHook(() => useAbandonJob(), { wrapper: harness.Wrapper });

    result.current.mutate("evt_7aa");
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(wire.calls).toEqual([
      { method: "POST", path: "/api/jobs/evt_7aa/abandon", body: undefined },
    ]);
    expect(invalidated(harness)).toEqual({ queue: true, jobs: true, attention: true });
  });
});
