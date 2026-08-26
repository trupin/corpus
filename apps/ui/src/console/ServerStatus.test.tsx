/** @vitest-environment jsdom */
import { createCorpusTestHarness, type CorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEscapeLayers } from "../reader/useEscapeStack";
import { UpgradeProvider } from "../upgrade/UpgradeProvider";
import { ServerStatus } from "./ConsoleStrip";

/**
 * The version label, which UI-035 turned into the app's one affordance for
 * SPEC.md §2.4. Its own file rather than another block in `Console.test.tsx`:
 * what is asserted here is the strip's contract with the updates panel, and that
 * is a different subject from the drawer.
 */

const HEALTH = { status: "ok", version: "1.2.3", uptimeSeconds: 3, workspace: "/tmp/ws" };

let harness: CorpusTestHarness | undefined;

function transport(options: { readonly down?: boolean } = {}): {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: string[];
} {
  const calls: string[] = [];
  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    calls.push(`${request.method} ${url.pathname}`);
    if (url.pathname === "/api/health") {
      if (options.down === true) throw new TypeError("Failed to fetch");
      return json(HEALTH);
    }
    if (url.pathname === "/api/upgrade/check") {
      return json({
        installed: "1.2.3",
        latest: "1.2.3",
        upgradeAvailable: false,
        verifiable: true,
        notesUrl: null,
        reachable: true,
        detail: null,
      });
    }
    return json({});
  };
  return { fetch: fetchImpl, calls };
}

function json(body: unknown): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

function mount(node: ReactNode, fetchImpl: typeof globalThis.fetch): ReactElement | null {
  harness = createCorpusTestHarness({
    fetch: fetchImpl,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
  });
  render(<UpgradeProvider>{node}</UpgradeProvider>, { wrapper: harness.Wrapper });
  return null;
}

afterEach(() => {
  cleanup();
  resetEscapeLayers();
  harness?.queryClient.clear();
  harness = undefined;
  vi.restoreAllMocks();
});

describe("the version label", () => {
  it("is a control, and says what pressing it does", async () => {
    mount(<ServerStatus />, transport().fetch);

    const button = await screen.findByRole("button", { name: /corpus 1\.2\.3/ });
    expect(button.getAttribute("title")).toContain("check for updates");
  });

  it("checks nothing until it is pressed", async () => {
    const { fetch, calls } = transport();
    mount(<ServerStatus />, fetch);

    await screen.findByRole("button", { name: /corpus 1\.2\.3/ });
    // §2.4's opening promise: Corpus never looks unless asked.
    expect(calls).not.toContain("GET /api/upgrade/check");

    await userEvent.click(screen.getByRole("button", { name: /corpus 1\.2\.3/ }));
    expect(screen.getByRole("dialog", { name: "Updates" })).toBeTruthy();
  });

  it("still reports an unreachable server as one", async () => {
    const { fetch } = transport({ down: true });
    mount(<ServerStatus />, fetch);

    expect(await screen.findByText("server unreachable")).toBeTruthy();
    // And it is not a control: there is no version to check against.
    expect(screen.queryByRole("button")).toBeNull();
  });
});
