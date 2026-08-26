/** @vitest-environment jsdom */
import type { UpgradeCheck } from "@corpus/contract";
import { HEALTH_KEY } from "@corpus/kit";
import { createCorpusTestHarness, type CorpusTestHarness } from "@corpus/kit/testing";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEscapeLayers } from "../reader/useEscapeStack";
import { UpgradeProvider, useUpgradeSurface } from "./UpgradeProvider";
import { UpgradePanel } from "./UpgradePanel";

/**
 * SPEC.md §2.4's panel, through the transport rather than through mocked hooks:
 * what matters is which requests it issues and when, and a test that stubbed
 * `useCheckUpgrade` would prove it calls a function.
 */

const CHECK: UpgradeCheck = {
  installed: "0.24.0",
  latest: "0.25.0",
  upgradeAvailable: true,
  verifiable: true,
  notesUrl: "https://example.invalid/v0.25.0",
  reachable: true,
  detail: null,
};

interface Server {
  readonly check?: Partial<UpgradeCheck>;
  /** Status for `POST /api/upgrade`; `202` unless a test wants the refusal. */
  readonly triggerStatus?: number;
}

/**
 * The health probe's answer, which a test moves. Real transport states rather
 * than a hand-written query cache: the panel decides from a probe that actually
 * failed, and a test that wrote the failure into the cache would be asserting
 * against its own fixture rather than against the query layer.
 */
interface Health {
  /** A version string, or the sentinel `down` for a server that is not answering. */
  version: string;
}

function transport(
  server: Server = {},
  live: Health = { version: "0.24.0" },
): {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: string[];
} {
  const calls: string[] = [];
  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    calls.push(`${request.method} ${url.pathname}`);

    if (url.pathname === "/api/health") {
      if (live.version === "down") throw new TypeError("Failed to fetch");
      return json(health(live.version));
    }
    if (url.pathname === "/api/upgrade/check") return json({ ...CHECK, ...server.check });
    if (url.pathname === "/api/upgrade") {
      const status = server.triggerStatus ?? 202;
      if (status === 202) return json({ started: true, logPath: ".corpus/upgrade.log" }, 202);
      return json(
        { code: "conflict", message: "an upgrade started at 10:00 is still running" },
        status,
      );
    }
    return json({});
  };
  return { fetch: fetchImpl, calls };
}

function json(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

let harness: CorpusTestHarness | undefined;

function health(version: string): unknown {
  return { status: "ok", version, uptimeSeconds: 1, workspace: "/tmp/ws" };
}

/**
 * The restart, as the health probe actually experiences it: the server goes
 * away, then answers again. Both halves, because the panel deliberately refuses
 * to conclude anything from the second without the first.
 *
 * The refetch is the SSE bridge's job in the running app — it invalidates the
 * health key on every drop and every reconnect — so invalidating here is what
 * the bridge does, at the moments it does it.
 */
async function rideOutTheRestart(live: Health, version: string): Promise<void> {
  live.version = "down";
  await act(async () => {
    await harness?.queryClient.invalidateQueries({ queryKey: HEALTH_KEY });
  });
  await waitFor(() => {
    expect(screen.getByText(/The server is being replaced/)).toBeTruthy();
  });

  live.version = version;
  await act(async () => {
    await harness?.queryClient.invalidateQueries({ queryKey: HEALTH_KEY });
  });
}

function renderPanel(
  server: Server = {},
  onInFlight: (value: boolean) => void = () => undefined,
  stallAfterMs?: number,
): { readonly calls: string[]; readonly onClose: () => void; readonly live: Health } {
  const live: Health = { version: "0.24.0" };
  const { fetch, calls } = transport(server, live);
  const onClose = vi.fn();
  harness = createCorpusTestHarness({
    fetch,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
  });
  render(
    <UpgradePanel
      onClose={onClose}
      onInFlight={onInFlight}
      {...(stallAfterMs === undefined ? {} : { stallAfterMs })}
    />,
    { wrapper: harness.Wrapper },
  );
  return { calls, onClose, live };
}

afterEach(() => {
  cleanup();
  resetEscapeLayers();
  harness?.queryClient.clear();
  harness = undefined;
  vi.restoreAllMocks();
});

describe("the check", () => {
  it("runs once when the panel opens, and reports both versions", async () => {
    const { calls } = renderPanel();

    await screen.findByText(/Corpus 0\.25\.0 is available/);
    expect(screen.getByText("Update available")).toBeTruthy();
    expect(calls.filter((call) => call === "GET /api/upgrade/check")).toHaveLength(1);
  });

  /*
   * §2.4's opening promise, asserted rather than assumed: nothing reaches GitHub
   * until a person asks. The panel is only mounted by a click, so "on mount" is
   * the click — but nothing re-checks afterwards, and a window focus is exactly
   * the event a `useQuery` would have re-run on.
   */
  it("does not check again when the window is focused", async () => {
    const { calls } = renderPanel();
    await screen.findByText(/Corpus 0\.25\.0 is available/);

    act(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
    });
    await Promise.resolve();

    expect(calls.filter((call) => call === "GET /api/upgrade/check")).toHaveLength(1);
  });

  it("offers the action only when the release can also be verified", async () => {
    renderPanel({ check: { verifiable: false, detail: "no checksum published" } });

    await screen.findByText(/cannot be installed automatically/);
    expect(screen.queryByRole("button", { name: /Upgrade & restart/ })).toBeNull();
  });

  it("offers nothing when there is nothing newer", async () => {
    renderPanel({ check: { latest: "0.24.0", upgradeAvailable: false } });

    await screen.findByText(/is the newest release/);
    expect(screen.queryByRole("button", { name: /Upgrade & restart/ })).toBeNull();
  });

  it("renders an unreachable GitHub as the answer it is, not a crash", async () => {
    renderPanel({
      check: {
        reachable: false,
        latest: null,
        upgradeAvailable: false,
        verifiable: false,
        notesUrl: null,
        detail: "api.github.com could not be reached (fetch failed)",
      },
    });

    await screen.findByText(/could not be reached/);
    expect(screen.getByText("Could not look")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Upgrade & restart/ })).toBeNull();
  });

  it("links the notes so a person can read what is changing first", async () => {
    renderPanel();
    const link = await screen.findByRole("link", { name: /Read what changed/ });
    expect(link.getAttribute("href")).toBe("https://example.invalid/v0.25.0");
  });
});

describe("the upgrade", () => {
  it("triggers, then says the server is being replaced rather than unreachable", async () => {
    const inFlight = vi.fn();
    const { calls } = renderPanel({}, inFlight);

    await screen.findByText(/Corpus 0\.25\.0 is available/);
    await userEvent.click(screen.getByRole("button", { name: /Upgrade & restart/ }));

    await screen.findByText(/The server is being replaced/);
    expect(calls).toContain("POST /api/upgrade");
    // The strip is told, so it stops saying "server unreachable" about a server
    // that is deliberately away.
    expect(inFlight).toHaveBeenCalledWith(true);
  });

  /*
   * The trap this ride-through was rewritten for. The `202` is written **before
   * the download begins**, so for several seconds the old server is still
   * answering on the old version. A panel that declared success on the next
   * successful probe would report a result before anything had happened.
   */
  it("does not call it finished while the old server is still answering", async () => {
    renderPanel();
    await screen.findByText(/Corpus 0\.25\.0 is available/);
    await userEvent.click(screen.getByRole("button", { name: /Upgrade & restart/ }));
    await screen.findByText(/The server is being replaced/);

    await act(async () => {
      await harness?.queryClient.invalidateQueries({ queryKey: HEALTH_KEY });
    });

    expect(screen.getByText(/The server is being replaced/)).toBeTruthy();
    expect(screen.queryByText(/Upgraded from/)).toBeNull();
    expect(screen.queryByText(/the version it was already running/)).toBeNull();
  });

  it("says so, and stops promising, when nothing ever restarts", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const inFlight = vi.fn();
      renderPanel({}, inFlight, 50);
      await screen.findByText(/Corpus 0\.25\.0 is available/);
      await userEvent.click(screen.getByRole("button", { name: /Upgrade & restart/ }));
      await screen.findByText(/The server is being replaced/);

      await act(async () => {
        vi.advanceTimersByTime(60);
        await Promise.resolve();
      });

      expect(screen.getByText(/has not restarted/)).toBeTruthy();
      expect(screen.getByText(/\.corpus\/upgrade\.log/)).toBeTruthy();
      expect(inFlight).toHaveBeenLastCalledWith(false);
      // And the panel is closable again, because nothing is on its way out.
      expect(screen.getByRole("button", { name: "Close" }).hasAttribute("disabled")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cannot be closed while the server is being replaced", async () => {
    const { onClose } = renderPanel();
    await screen.findByText(/Corpus 0\.25\.0 is available/);
    await userEvent.click(screen.getByRole("button", { name: /Upgrade & restart/ }));
    await screen.findByText(/The server is being replaced/);

    const close = screen.getByRole("button", { name: "Close" });
    expect(close.hasAttribute("disabled")).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows the new version when the server answers again", async () => {
    const inFlight = vi.fn();
    const { live } = renderPanel({}, inFlight);

    await screen.findByText(/Corpus 0\.25\.0 is available/);
    await userEvent.click(screen.getByRole("button", { name: /Upgrade & restart/ }));
    await screen.findByText(/The server is being replaced/);

    await rideOutTheRestart(live, "0.25.0");

    await waitFor(() => {
      expect(screen.getByText(/Upgraded from 0\.24\.0 to 0\.25\.0/)).toBeTruthy();
    });
    expect(inFlight).toHaveBeenLastCalledWith(false);
  });

  it("claims nothing when the server comes back on the same version", async () => {
    const { live } = renderPanel();

    await screen.findByText(/Corpus 0\.25\.0 is available/);
    await userEvent.click(screen.getByRole("button", { name: /Upgrade & restart/ }));
    await screen.findByText(/The server is being replaced/);

    await rideOutTheRestart(live, "0.24.0");

    await waitFor(() => {
      expect(screen.getByText(/the version it was already running/)).toBeTruthy();
    });
    expect(screen.queryByText(/Upgraded from/)).toBeNull();
    expect(screen.getByText(/\.corpus\/upgrade\.log/)).toBeTruthy();
  });

  it("reports the refusal as a refusal, with no retry beside it", async () => {
    renderPanel({ triggerStatus: 409 });

    await screen.findByText(/Corpus 0\.25\.0 is available/);
    await userEvent.click(screen.getByRole("button", { name: /Upgrade & restart/ }));

    await screen.findByText(/is still running/);
    expect(screen.queryByRole("button", { name: /Upgrade & restart/ })).toBeNull();
    // Closable: nothing of this server is going anywhere.
    expect(screen.getByRole("button", { name: "Close" }).hasAttribute("disabled")).toBe(false);
  });
});

describe("UpgradeProvider", () => {
  function Probe(): ReactElement {
    const upgrade = useUpgradeSurface();
    return (
      <button type="button" onClick={upgrade.open}>
        {upgrade.inFlight ? "running" : "open updates"}
      </button>
    );
  }

  it("mounts no panel until something opens one", async () => {
    const { fetch, calls } = transport();
    harness = createCorpusTestHarness({
      fetch,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    });
    render(
      <UpgradeProvider>
        <Probe />
      </UpgradeProvider>,
      { wrapper: harness.Wrapper },
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    // And nothing has been asked of GitHub, which is the promise.
    expect(calls).not.toContain("GET /api/upgrade/check");

    await userEvent.click(screen.getByRole("button", { name: "open updates" }));
    expect(screen.getByRole("dialog", { name: "Updates" })).toBeTruthy();
    await waitFor(() => {
      expect(calls).toContain("GET /api/upgrade/check");
    });
  });
});
