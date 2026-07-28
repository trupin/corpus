/** @vitest-environment jsdom */
import type { JobLog } from "@corpus/contract";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCorpusTestHarness } from "../testing/index.js";
import { jobKey } from "./keys.js";
import { capLogLines, EMPTY_JOB_LOG, MAX_BUFFERED_LOG_LINES, useJobLog } from "./useJobLog.js";

afterEach(cleanup);

const at = "2026-07-27T09:12:00Z";

function page(from: number, count: number): JobLog {
  return {
    lines: Array.from({ length: count }, (_, index) => ({
      ts: at,
      line: `line ${String(from + index)}`,
    })),
    nextCursor: from + count,
  };
}

/** Serves an append-only log whose length the test controls. */
function transport(total: () => number): {
  readonly fetch: typeof globalThis.fetch;
  readonly cursors: number[];
} {
  const cursors: number[] = [];
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(new Request(input, init).url);
    const cursor = Number(url.searchParams.get("cursor") ?? "0");
    cursors.push(cursor);
    const length = total();
    const body =
      cursor >= length ? { lines: [], nextCursor: length } : page(cursor, length - cursor);
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  return { fetch, cursors };
}

describe("the head cap", () => {
  it("leaves a short buffer alone", () => {
    const lines = [{ ts: at, line: "a" }];
    expect(capLogLines(lines, 1, false)).toEqual({ lines, nextCursor: 1, truncated: false });
  });

  it("drops the oldest lines and says so", () => {
    const lines = Array.from({ length: MAX_BUFFERED_LOG_LINES + 5 }, (_, index) => ({
      ts: at,
      line: `line ${String(index)}`,
    }));
    const capped = capLogLines(lines, lines.length, false);
    expect(capped.lines).toHaveLength(MAX_BUFFERED_LOG_LINES);
    expect(capped.lines[0]?.line).toBe("line 5");
    expect(capped.truncated).toBe(true);
  });

  it("keeps the marker once it has been earned", () => {
    expect(capLogLines([{ ts: at, line: "a" }], 9001, true).truncated).toBe(true);
  });
});

describe("useJobLog", () => {
  it("fetches from the start on first read", async () => {
    const wire = transport(() => 3);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useJobLog("evt_9f2"), { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(result.current.data?.lines).toHaveLength(3);
    });
    expect(wire.cursors).toEqual([0]);
    expect(result.current.data?.nextCursor).toBe(3);
  });

  // TEST-100: the cursor is the deduplication mechanism, not a line diff. Two
  // refetches over a log that grew by two lines must produce five lines, not
  // eight, and the second request must ask for `?cursor=3`.
  it("appends only what it does not already hold", async () => {
    let total = 3;
    const wire = transport(() => total);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useJobLog("evt_9f2"), { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(result.current.data?.lines).toHaveLength(3);
    });

    total = 5;
    await harness.queryClient.invalidateQueries({ queryKey: jobKey("evt_9f2") });

    await waitFor(() => {
      expect(result.current.data?.lines).toHaveLength(5);
    });
    expect(wire.cursors).toEqual([0, 3]);
    expect(result.current.data?.lines.map((line) => line.line)).toEqual([
      "line 0",
      "line 1",
      "line 2",
      "line 3",
      "line 4",
    ]);
  });

  // A stream drop and reconnect refetches with the cursor it already holds; the
  // server answers with nothing new and no line is duplicated.
  it("duplicates nothing when the same cursor is asked for twice", async () => {
    const wire = transport(() => 4);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useJobLog("evt_9f2"), { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(result.current.data?.lines).toHaveLength(4);
    });
    await harness.queryClient.invalidateQueries({ queryKey: jobKey("evt_9f2") });
    await harness.queryClient.invalidateQueries({ queryKey: jobKey("evt_9f2") });

    await waitFor(() => {
      expect(wire.cursors).toEqual([0, 4, 4]);
    });
    expect(result.current.data?.lines).toHaveLength(4);
  });

  // A rotated or replaced file leaves the held cursor past the end. Appending
  // onto a prefix that no longer exists would interleave two different jobs.
  it("re-reads from zero when the log shrank under it", async () => {
    let total = 6;
    const wire = transport(() => total);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useJobLog("evt_9f2"), { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(result.current.data?.lines).toHaveLength(6);
    });

    total = 2;
    await harness.queryClient.invalidateQueries({ queryKey: jobKey("evt_9f2") });

    await waitFor(() => {
      expect(result.current.data?.lines).toHaveLength(2);
    });
    expect(wire.cursors).toEqual([0, 6, 0]);
  });

  it("keeps a per-job buffer across a selection switch", async () => {
    const wire = transport(() => 3);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result, rerender } = renderHook(({ id }: { id: string }) => useJobLog(id), {
      wrapper: harness.Wrapper,
      initialProps: { id: "evt_a" },
    });

    await waitFor(() => {
      expect(result.current.data?.lines).toHaveLength(3);
    });
    rerender({ id: "evt_b" });
    await waitFor(() => {
      expect(result.current.data?.lines).toHaveLength(3);
    });

    const before = wire.cursors.length;
    rerender({ id: "evt_a" });
    await waitFor(() => {
      expect(result.current.data?.lines).toHaveLength(3);
    });
    // The cached buffer answers immediately; the background refetch that
    // follows asks from the cursor it already holds, never from zero again.
    expect(wire.cursors.slice(before).every((cursor) => cursor === 3)).toBe(true);
  });

  it("fetches nothing while disabled, and nothing for a null job", async () => {
    const wire = transport(() => 3);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const disabled = renderHook(() => useJobLog("evt_9f2", { enabled: false }), {
      wrapper: harness.Wrapper,
    });
    const nothing = renderHook(() => useJobLog(null), { wrapper: harness.Wrapper });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(wire.cursors).toEqual([]);
    expect(disabled.result.current.data).toBeUndefined();
    expect(nothing.result.current.data).toBeUndefined();
    expect(EMPTY_JOB_LOG.lines).toEqual([]);
  });
});
