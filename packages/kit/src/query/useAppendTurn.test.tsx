/** @vitest-environment jsdom */
import type { Thread } from "@corpus/contract";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCorpusTestHarness, type CorpusTestHarness } from "../testing/index.js";
import { threadKey } from "./keys.js";
import { isPendingTurn, type ThreadTurn, type ThreadView } from "./pendingTurns.js";
import { useAppendTurn } from "./useAppendTurn.js";
import { useJobs } from "./useJobs.js";
import { useThread } from "./useThread.js";

const THREAD_ID = "th_a";

const SERVER_THREAD = {
  id: THREAD_ID,
  title: "Budget questions",
  created: "2026-07-27T09:00:00Z",
  updated: "2026-07-27T09:00:00Z",
  status: "open",
  tags: [],
  parent: null,
  anchor: null,
  agent: "none",
  turns: [{ author: "agent", ts: "2026-07-27T09:00:00Z", body: "First." }],
} as unknown as Thread;

/** The server stamps its own timestamp; SPEC.md §6 makes it unique and monotonic. */
const SERVER_TURN = { author: "user", ts: "2026-07-27T10:00:00Z", body: "Mine." } as const;

type AppendOutcome =
  | { readonly kind: "ok" }
  | { readonly kind: "status"; readonly status: number; readonly code: string }
  | { readonly kind: "transport" };

interface Script {
  readonly fetch: typeof globalThis.fetch;
  turns: { author: string; ts: string; body: string }[];
  append: AppendOutcome;
  appends: number;
  /** What the server says it enqueued — `null` for a "note only" turn (SPEC.md §8). */
  eventId: string | null;
  /** How many times `GET /api/jobs` was read, which is the queue's console feed. */
  jobsReads: number;
  /** When set, the POST waits on it — so a refetch can be raced against it. */
  gate: Promise<void> | undefined;
}

function scripted(): Script {
  const json = (body: unknown, status: number): Response =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const script: Script = {
    fetch: undefined as unknown as typeof globalThis.fetch,
    turns: [...(SERVER_THREAD.turns as unknown as { author: string; ts: string; body: string }[])],
    append: { kind: "ok" },
    appends: 0,
    eventId: null,
    jobsReads: 0,
    gate: undefined,
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (new URL(request.url).pathname === "/api/jobs") {
      script.jobsReads += 1;
      return json({ jobs: [] }, 200);
    }
    if (request.method !== "POST") return json({ ...SERVER_THREAD, turns: script.turns }, 200);

    script.appends += 1;
    if (script.gate !== undefined) await script.gate;
    if (script.append.kind === "transport") throw new TypeError("Failed to fetch");
    if (script.append.kind === "status") {
      return json({ code: script.append.code, message: "refused" }, script.append.status);
    }
    script.turns = [...script.turns, { ...SERVER_TURN }];
    return json({ thread: {}, turn: SERVER_TURN, eventId: script.eventId, warnings: [] }, 201);
  });

  return Object.assign(script, { fetch: fetchMock });
}

function cachedTurns(harness: CorpusTestHarness): readonly ThreadTurn[] {
  return harness.queryClient.getQueryData<ThreadView>(threadKey(THREAD_ID))?.turns ?? [];
}

const pendingCount = (turns: readonly ThreadTurn[]): number => turns.filter(isPendingTurn).length;

async function mount(script: Script) {
  const harness = createCorpusTestHarness({ fetch: script.fetch });
  const { result } = renderHook(
    () => ({ thread: useThread(THREAD_ID), append: useAppendTurn(THREAD_ID) }),
    { wrapper: harness.Wrapper },
  );
  await waitFor(() => {
    expect(result.current.thread.isSuccess).toBe(true);
  });
  return { harness, result };
}

afterEach(cleanup);

describe("optimistic append", () => {
  // TEST-35.
  it("shows the provisional turn while the POST is still in flight", async () => {
    const script = scripted();
    const { harness, result } = await mount(script);

    let release: (() => void) | undefined;
    script.gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    let settled: Promise<unknown> | undefined;
    act(() => {
      settled = result.current.append.mutateAsync({ body: "Mine." });
    });

    await waitFor(() => {
      expect(cachedTurns(harness)).toHaveLength(2);
    });
    const provisional = cachedTurns(harness)[1];
    expect(provisional).toMatchObject({ author: "user", body: "Mine.", pending: true });
    // The POST has not resolved: the marker is what lets a view render it
    // differently instead of pretending the server has it.
    expect(script.appends).toBe(1);
    expect(script.turns).toHaveLength(1);

    release?.();
    await act(async () => {
      await settled;
    });
  });

  // TEST-36.
  it("replaces the provisional turn with the server's rather than sitting beside it", async () => {
    const script = scripted();
    const { harness, result } = await mount(script);

    await act(async () => {
      await result.current.append.mutateAsync({ body: "Mine." });
    });
    await waitFor(() => {
      expect(result.current.thread.isFetching).toBe(false);
    });

    const turns = cachedTurns(harness);
    expect(turns.filter((turn) => turn.body === "Mine.")).toHaveLength(1);
    expect(turns[1]?.ts).toBe(SERVER_TURN.ts);
    expect(pendingCount(turns)).toBe(0);
  });

  // TEST-38.
  it("keeps the provisional turn through an invalidation that lands mid-flight", async () => {
    const script = scripted();
    const { harness, result } = await mount(script);

    let release: (() => void) | undefined;
    script.gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    let settled: Promise<unknown> | undefined;
    act(() => {
      settled = result.current.append.mutateAsync({ body: "Mine." });
    });
    await waitFor(() => {
      expect(pendingCount(cachedTurns(harness))).toBe(1);
    });

    // The server announces the thread went stale before our own POST resolves.
    await act(async () => {
      harness.eventSource.latest().invalidate(["threads", THREAD_ID]);
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(pendingCount(cachedTurns(harness))).toBe(1);

    release?.();
    await act(async () => {
      await settled;
    });
    await waitFor(() => {
      expect(result.current.thread.isFetching).toBe(false);
    });

    expect(cachedTurns(harness).filter((turn) => turn.body === "Mine.")).toHaveLength(1);
    expect(pendingCount(cachedTurns(harness))).toBe(0);
  });
});

/**
 * The queue is where "is an agent response outstanding?" is answered — the
 * console's rows and the thread card's pending indicator both read it (SPEC.md
 * §8, UI-058) — so a turn that enqueued has to drop it, and a turn that enqueued
 * nothing has to leave it alone.
 */
describe("the job feed", () => {
  async function mountWithJobs(script: Script) {
    const harness = createCorpusTestHarness({ fetch: script.fetch });
    const { result } = renderHook(() => ({ jobs: useJobs({}), append: useAppendTurn(THREAD_ID) }), {
      wrapper: harness.Wrapper,
    });
    await waitFor(() => {
      expect(result.current.jobs.isSuccess).toBe(true);
    });
    return result;
  }

  it("is refetched when the turn enqueued an event", async () => {
    const script = scripted();
    script.eventId = "evt_1";
    const result = await mountWithJobs(script);
    const before = script.jobsReads;

    await act(async () => {
      await result.current.append.mutateAsync({ body: "Mine.", requestsAgent: true });
    });

    await waitFor(() => {
      expect(script.jobsReads).toBeGreaterThan(before);
    });
  });

  it("is left alone by a note-only turn, which enqueued nothing", async () => {
    const script = scripted();
    const result = await mountWithJobs(script);
    const before = script.jobsReads;

    await act(async () => {
      await result.current.append.mutateAsync({ body: "Mine.", requestsAgent: false });
    });
    // Long enough for an invalidation to have produced a fetch had one fired.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    expect(script.jobsReads).toBe(before);
  });
});

describe("rollback", () => {
  // TEST-37: three failure shapes, each restoring the pre-mutation snapshot and
  // surfacing the error instead of swallowing it.
  it.each([
    ["a forbidden response", { kind: "status", status: 403, code: "forbidden" } as const, /403/],
    ["a locked response", { kind: "status", status: 423, code: "locked" } as const, /423/],
    ["a transport failure", { kind: "transport" } as const, /Failed to fetch/],
  ])("restores the cache after %s", async (_label, failure, message) => {
    const script = scripted();
    const { harness, result } = await mount(script);
    const before = cachedTurns(harness);
    expect(before).toHaveLength(1);

    script.append = failure;
    await act(async () => {
      await expect(result.current.append.mutateAsync({ body: "Mine." })).rejects.toThrow(message);
    });

    expect(cachedTurns(harness)).toEqual(before);
    expect(pendingCount(cachedTurns(harness))).toBe(0);
    await waitFor(() => {
      expect(result.current.append.error?.message).toMatch(message);
    });
  });

  it("leaves no cache entry behind when there was none to restore", async () => {
    const script = scripted();
    script.append = { kind: "transport" };
    const harness = createCorpusTestHarness({ fetch: script.fetch });
    const { result } = renderHook(() => useAppendTurn(THREAD_ID), { wrapper: harness.Wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync({ body: "Mine." })).rejects.toThrow();
    });
    expect(harness.queryClient.getQueryData(threadKey(THREAD_ID))).toBeUndefined();
  });
});

describe("the request it makes", () => {
  it("posts once and forwards an explicit note-only flag", async () => {
    const script = scripted();
    const { result } = await mount(script);
    await act(async () => {
      await result.current.append.mutateAsync({ body: "Mine.", requestsAgent: false });
    });
    expect(script.appends).toBe(1);
  });
});
