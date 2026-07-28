/** @vitest-environment jsdom */
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOCK_HEARTBEAT_MS,
  LOCK_IDLE_RELEASE_MS,
  LOCK_TTL_SECONDS,
  useUserLock,
} from "./useUserLock.js";

/**
 * The user's edit lock (SPEC.md §7): taken on the first keystroke, renewed
 * while the session is live, given back on blur, on idle and on close.
 *
 * Every assertion is about *requests*, because the whole point of the lock is
 * that another process — the agent's queue — can see it.
 */

interface Call {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

interface Wire {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: Call[];
  readonly locks: () => Call[];
  refuse: boolean;
}

function wire(): Wire {
  const calls: Call[] = [];
  const state: Wire = {
    fetch: null as unknown as typeof globalThis.fetch,
    calls,
    locks: () => calls.filter((call) => call.path.startsWith("/api/locks/")),
    refuse: false,
  };
  Object.assign(state, {
    fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const raw = await request.text();
      calls.push({
        method: request.method,
        path: url.pathname,
        body: raw === "" ? undefined : (JSON.parse(raw) as unknown),
      });
      if (url.pathname === "/api/locks") return json({ locks: [] });
      if (url.pathname.startsWith("/api/locks/")) {
        const docId = url.pathname.split("/")[3] ?? "";
        if (request.method === "POST") {
          if (state.refuse) {
            return json(
              {
                code: "conflict",
                message: "agent holds it",
                lock: { docId, holder: "agent", acquired: "2026-07-28T09:00:00Z", ttl: 300 },
              },
              409,
            );
          }
          return json({ docId, holder: "user", acquired: "2026-07-28T09:00:00Z", ttl: 300 }, 201);
        }
        return json({ docId, released: true, holder: "user" });
      }
      return json({});
    },
  });
  return state;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let touch: () => void = () => undefined;
let blur: () => void = () => undefined;

function Session({ docId, enabled }: { readonly docId: string; readonly enabled: boolean }): null {
  const lock = useUserLock({ docId, enabled });
  touch = lock.touch;
  blur = lock.blur;
  return null;
}

function Host({
  transport,
  docId,
  enabled,
}: {
  readonly transport: Wire;
  readonly docId?: string;
  readonly enabled?: boolean;
}): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  return (
    <harness.Wrapper>
      <Session docId={docId ?? "doc_a1b2c3"} enabled={enabled ?? true} />
    </harness.Wrapper>
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("acquiring", () => {
  it("takes the lock on the first keystroke and not before", async () => {
    const transport = wire();
    render(<Host transport={transport} />);
    await act(async () => {
      await Promise.resolve();
    });
    // Merely opening a document is reading, not editing.
    expect(transport.locks()).toHaveLength(0);

    await act(async () => {
      touch();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(transport.locks()).toHaveLength(1);
    });
    expect(transport.locks()[0]).toMatchObject({
      method: "POST",
      path: "/api/locks/doc_a1b2c3",
      body: { ttl: LOCK_TTL_SECONDS },
    });
  });

  it("takes it once, however much is typed", async () => {
    const transport = wire();
    render(<Host transport={transport} />);
    await act(async () => {
      for (let index = 0; index < 20; index += 1) touch();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(transport.locks()).toHaveLength(1);
    });
  });

  it("takes none at all while another party holds it", async () => {
    const transport = wire();
    render(<Host transport={transport} enabled={false} />);
    await act(async () => {
      touch();
      await Promise.resolve();
    });
    expect(transport.locks()).toHaveLength(0);
  });

  it("stops claiming the lock when the server refuses it", async () => {
    const transport = wire();
    transport.refuse = true;
    render(<Host transport={transport} />);
    await act(async () => {
      touch();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(transport.locks()).toHaveLength(1);
    });

    // No heartbeat for a lock that was never granted.
    await act(async () => {
      vi.advanceTimersByTime(LOCK_HEARTBEAT_MS * 3);
      await Promise.resolve();
    });
    expect(transport.locks().filter((call) => call.method === "POST")).toHaveLength(1);
    // And nothing to release.
    expect(transport.locks().filter((call) => call.method === "DELETE")).toHaveLength(0);
  });
});

describe("renewing", () => {
  it("re-acquires while the session is live", async () => {
    const transport = wire();
    render(<Host transport={transport} />);
    await act(async () => {
      touch();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(transport.locks()).toHaveLength(1);
    });

    await act(async () => {
      // Keep typing, so the idle release does not fire first.
      for (let elapsed = 0; elapsed < LOCK_HEARTBEAT_MS * 2; elapsed += LOCK_IDLE_RELEASE_MS / 2) {
        touch();
        vi.advanceTimersByTime(LOCK_IDLE_RELEASE_MS / 2);
      }
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(
        transport.locks().filter((call) => call.method === "POST").length,
      ).toBeGreaterThanOrEqual(2);
    });
  });
});

describe("releasing", () => {
  it("gives the lock back on blur", async () => {
    const transport = wire();
    render(<Host transport={transport} />);
    await act(async () => {
      touch();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(transport.locks()).toHaveLength(1);
    });

    await act(async () => {
      blur();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(transport.locks().filter((call) => call.method === "DELETE")).toHaveLength(1);
    });
    expect(transport.locks().at(-1)?.path).toBe("/api/locks/doc_a1b2c3");
  });

  it("gives it back after the idle window, without a blur", async () => {
    const transport = wire();
    render(<Host transport={transport} />);
    await act(async () => {
      touch();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(transport.locks()).toHaveLength(1);
    });

    await act(async () => {
      vi.advanceTimersByTime(LOCK_IDLE_RELEASE_MS + 100);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(transport.locks().filter((call) => call.method === "DELETE")).toHaveLength(1);
    });
  });

  it("gives it back when the surface goes away", async () => {
    const transport = wire();
    const view = render(<Host transport={transport} />);
    await act(async () => {
      touch();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(transport.locks()).toHaveLength(1);
    });

    view.unmount();
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(transport.locks().filter((call) => call.method === "DELETE")).toHaveLength(1);
    });
  });

  it("gives it back the moment another party takes one", async () => {
    const transport = wire();
    const view = render(<Host transport={transport} />);
    await act(async () => {
      touch();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(transport.locks()).toHaveLength(1);
    });

    // The agent's lock arrived over SSE; the surface went read-only.
    view.rerender(<Host transport={transport} enabled={false} />);
    await waitFor(() => {
      expect(transport.locks().filter((call) => call.method === "DELETE")).toHaveLength(1);
    });
  });

  it("releases nothing it never took", async () => {
    const transport = wire();
    const view = render(<Host transport={transport} />);
    await act(async () => {
      blur();
      await Promise.resolve();
    });
    view.unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(transport.locks()).toHaveLength(0);
  });
});
