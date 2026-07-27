/** @vitest-environment jsdom */
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { useConnectionState } from "../events/useConnectionState.js";
import type { BridgeLogger } from "../events/sseBridge.js";
import { useDoc } from "../query/useDoc.js";
import { useDocs } from "../query/useDocs.js";
import { useJobs } from "../query/useJobs.js";
import { useLocks } from "../query/useLocks.js";
import { useThread } from "../query/useThread.js";
import { useTree } from "../query/useTree.js";
import { createCorpusTestHarness } from "../testing/index.js";
import { CorpusProvider, mountedCorpusProviders } from "./CorpusProvider.js";
import { createCorpusQueryClient } from "./queryClient.js";

function stalledFetch(): typeof globalThis.fetch {
  return vi.fn().mockReturnValue(new Promise(() => undefined));
}

/**
 * A logger whose calls are assertable. The spies are held as plain properties
 * rather than read back off the `BridgeLogger`, whose members are declared as
 * methods — referencing one without calling it is an unbound-method defect.
 */
interface LoggerSpy {
  readonly logger: BridgeLogger;
  readonly debug: Mock;
  readonly warn: Mock;
}

function silentLogger(): LoggerSpy {
  const debug = vi.fn();
  const info = vi.fn();
  const warn = vi.fn();
  return { logger: { debug, info, warn }, debug, warn };
}

afterEach(cleanup);

describe("one connection per provider", () => {
  // TEST-13. Six hooks mounted, three unmounted, two more mounted: one stream,
  // never closed. Hook churn is a render concern; the connection is not.
  it("opens exactly one EventSource however many hooks come and go", () => {
    const harness = createCorpusTestHarness({ fetch: stalledFetch() });

    const readers = [
      () => useDocs({}),
      () => useDocs({ type: "note" }),
      () => useDoc("doc_a"),
      () => useThread("th_a"),
      () => useTree(),
      () => useJobs({}),
      () => useLocks(),
      () => useDocs({ folder: "finance" }),
    ] as const;

    function Reader({ index }: { readonly index: number }): ReactElement {
      readers[index]?.();
      return <span />;
    }

    function Churn(): ReactElement {
      const [count, setCount] = useState(6);
      return (
        <>
          {Array.from({ length: count }, (_, index) => (
            <Reader key={index} index={index} />
          ))}
          <button type="button" onClick={() => setCount((value) => (value === 6 ? 3 : 5))}>
            toggle
          </button>
        </>
      );
    }

    render(<Churn />, { wrapper: harness.Wrapper });
    expect(harness.eventSource.sources).toHaveLength(1);

    // six mounted → three unmounted → two more mounted
    act(() => {
      screen.getByRole("button").click();
    });
    act(() => {
      screen.getByRole("button").click();
    });

    expect(harness.eventSource.sources).toHaveLength(1);
    expect(harness.eventSource.latest().closed).toBe(false);
  });

  it("closes its stream when the provider unmounts", () => {
    const harness = createCorpusTestHarness({ fetch: stalledFetch() });
    const { unmount } = render(<div />, { wrapper: harness.Wrapper });
    const source = harness.eventSource.latest();
    expect(source.closed).toBe(false);
    unmount();
    expect(source.closed).toBe(true);
  });

  // TEST-41.
  it("two providers are two connections, and the second is reported", () => {
    const first = createCorpusTestHarness({ fetch: stalledFetch() });
    const second = createCorpusTestHarness({ fetch: stalledFetch() });
    const logger = silentLogger();

    const view = render(
      <CorpusProvider
        client={first.client}
        queryClient={first.queryClient}
        eventSourceFactory={first.eventSource}
        logger={logger.logger}
      >
        <CorpusProvider
          client={second.client}
          queryClient={second.queryClient}
          eventSourceFactory={second.eventSource}
          logger={logger.logger}
        >
          <div />
        </CorpusProvider>
      </CorpusProvider>,
    );

    expect(first.eventSource.sources).toHaveLength(1);
    expect(second.eventSource.sources).toHaveLength(1);
    expect(mountedCorpusProviders()).toBe(2);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("must mount exactly one"));

    view.unmount();
    expect(mountedCorpusProviders()).toBe(0);
  });

  it("builds its own query client when none is supplied", () => {
    const harness = createCorpusTestHarness({ fetch: stalledFetch() });
    const { result } = renderHook(() => useConnectionState(), {
      wrapper: ({ children }) => (
        <CorpusProvider client={harness.client} eventSourceFactory={harness.eventSource}>
          {children}
        </CorpusProvider>
      ),
    });
    expect(result.current).toBe("connecting");
    expect(createCorpusQueryClient().getDefaultOptions().queries?.staleTime).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

// TEST-14: the seam is reachable from the provider's props, which is what makes
// every criterion above verifiable without a real EventSource.
describe("the EventSource seam", () => {
  it("uses the factory the provider was given, token and all", () => {
    const harness = createCorpusTestHarness({ fetch: stalledFetch(), token: "abc" });
    render(<div />, { wrapper: harness.Wrapper });
    expect(harness.eventSource.latest().url).toBe("http://127.0.0.1:8905/events?token=abc");
  });

  it("uses a global EventSource when the runtime has one", () => {
    // A browser has one; Node and jsdom do not. This is the only test that
    // exercises the fallback path the application itself takes.
    const harness = createCorpusTestHarness({ fetch: stalledFetch() });
    const constructed: string[] = [];
    vi.stubGlobal(
      "EventSource",
      class {
        constructor(url: string) {
          constructed.push(url);
        }
        addEventListener(): void {}
        close(): void {}
      },
    );
    try {
      render(
        <CorpusProvider client={harness.client} queryClient={harness.queryClient}>
          <div />
        </CorpusProvider>,
      );
      expect(constructed).toEqual(["http://127.0.0.1:8905/events?token=test-token"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("survives a runtime with no EventSource at all", () => {
    const harness = createCorpusTestHarness({ fetch: stalledFetch() });
    const logger = silentLogger();
    expect("EventSource" in globalThis).toBe(false);

    // No factory: the kit reaches for the global, finds nothing, and treats it
    // as a failed connect rather than throwing into the render tree.
    render(
      <CorpusProvider
        client={harness.client}
        queryClient={harness.queryClient}
        logger={logger.logger}
      >
        <div data-testid="alive" />
      </CorpusProvider>,
    );
    expect(screen.getByTestId("alive")).toBeDefined();
    expect(logger.debug).toHaveBeenCalled();
  });
});

// TEST-25, through a subscribed component rather than the bridge's own API.
describe("useConnectionState", () => {
  it("reports each transition, in order, to a rendering component", () => {
    // The drop below is deliberate, so the default `console` logger would be
    // noise rather than signal.
    const harness = createCorpusTestHarness({
      fetch: stalledFetch(),
      logger: silentLogger().logger,
    });
    const seen: string[] = [];

    function Watcher(): ReactElement {
      const state = useConnectionState();
      seen.push(state);
      return <span data-testid="state">{state}</span>;
    }

    render(<Watcher />, { wrapper: harness.Wrapper });
    expect(screen.getByTestId("state").textContent).toBe("connecting");

    act(() => {
      harness.eventSource.latest().emit("open");
    });
    expect(screen.getByTestId("state").textContent).toBe("open");

    act(() => {
      harness.eventSource.latest().emit("error");
    });
    expect(screen.getByTestId("state").textContent).toBe("reconnecting");

    expect([...new Set(seen)]).toEqual(["connecting", "open", "reconnecting"]);
  });
});
