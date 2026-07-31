/** @vitest-environment jsdom */
import type { Job } from "@corpus/contract";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { resetEscapeLayers } from "../reader/useEscapeStack";
import { ToastProvider } from "../shell/Toasts";
import { ContextMenuProvider, useContextMenu } from "./ContextMenuHost";
import { JobMenuItems } from "./JobMenuItems";

/**
 * A job row's menu, and the one thing about it that was silent (PR #12 review,
 * MAJOR 2).
 *
 * Retry and Abandon are the only items in the app that reach the queue, and
 * both close the menu in the tick they act — which unmounts the component
 * before the request settles. TanStack Query v5 skips a `mutate(…, { onError })`
 * once the observer has no listeners left, so a **refused** retry used to say
 * nothing at all: the job stayed failed, the console redrew it unchanged, and
 * the user was never told the server had turned them down. That is UI-012's
 * failure class at a call site UI-015 did not reach.
 *
 * Nothing here is simulated. The real `ContextMenuProvider` unmounts the real
 * menu on activation, exactly as the console does, and the toast is read from
 * the real `ToastProvider` above it — the surface that outlives the menu.
 */

afterEach(() => {
  cleanup();
  resetEscapeLayers();
});

const FAILED: Job = {
  eventId: "evt_9f2",
  type: "comment.created",
  status: "failed",
  started: "2026-07-27T09:12:00Z",
  updated: "2026-07-27T09:12:09Z",
  lastLine: "the agent exited 1",
  originId: "th_carrier",
  originTitle: "Insurance carrier choice",
  blockedOn: null,
  blockedOnTitle: null,
};

function gate(): { readonly held: Promise<void>; readonly release: () => void } {
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = () => {
      resolve();
    };
  });
  return {
    held,
    release: () => {
      release();
    },
  };
}

interface Wire {
  readonly fetch: typeof globalThis.fetch;
  readonly writes: readonly string[];
}

/**
 * Answers the two queue writes, parking each behind `held` so the menu is
 * demonstrably gone before the response arrives.
 */
function transport(options: { held: Promise<void>; refuse?: boolean }): Wire {
  const writes: string[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const { pathname } = new URL(request.url);
    if (request.method === "GET") {
      return new Response(JSON.stringify({ jobs: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    writes.push(pathname);
    await options.held;
    if (options.refuse === true) {
      return new Response(JSON.stringify({ error: "queue is halted" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ...FAILED, status: "pending" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetchImpl, writes };
}

function Opener(): ReactElement {
  const menu = useContextMenu();
  return (
    <button
      type="button"
      onClick={() => {
        menu.open({
          label: `Actions for ${FAILED.eventId}`,
          clientX: 20,
          clientY: 30,
          items: (close) => <JobMenuItems job={FAILED} close={close} />,
        });
      }}
    >
      open job menu
    </button>
  );
}

function mount(wire: Wire): void {
  const harness = createCorpusTestHarness({ fetch: wire.fetch });
  render(
    <harness.Wrapper>
      <ToastProvider>
        <ContextMenuProvider>
          <Opener />
        </ContextMenuProvider>
      </ToastProvider>
    </harness.Wrapper>,
  );
  fireEvent.click(screen.getByText("open job menu"));
}

describe("a queue write the closed menu started", () => {
  it.each([
    ["Retry", "/api/jobs/evt_9f2/retry", "Could not retry evt_9f2"],
    ["Abandon", "/api/jobs/evt_9f2/abandon", "Could not abandon evt_9f2"],
  ])("%s reports its refusal even though the menu closed first", async (label, path, notice) => {
    const { held, release } = gate();
    const wire = transport({ held, refuse: true });
    mount(wire);

    fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(label) }));
    // The menu is the surface that carried the observer, and it is already gone
    // — before the request it started has even been answered.
    expect(screen.queryByRole("menu")).toBeNull();
    await waitFor(() => {
      expect(wire.writes).toEqual([path]);
    });

    release();

    await waitFor(() => {
      expect(document.querySelector(".toast")?.textContent).toContain(notice);
    });
    expect(document.querySelector(".toast")?.getAttribute("data-tone")).toBe("error");
  });

  it("says nothing when the server accepts it — the console redraws instead", async () => {
    const { held, release } = gate();
    const wire = transport({ held });
    mount(wire);

    fireEvent.click(screen.getByRole("menuitem", { name: /Retry/ }));
    release();

    await waitFor(() => {
      expect(wire.writes).toEqual(["/api/jobs/evt_9f2/retry"]);
    });
    expect(document.querySelector(".toast")).toBeNull();
  });
});

describe("the item set", () => {
  it("offers Retry and Abandon on a failed job, and open on its origin", () => {
    mount(transport({ held: Promise.resolve() }));
    expect(screen.getAllByRole("menuitem").map((item) => item.dataset["act"])).toEqual([
      "open",
      "retry",
      "abandon",
    ]);
  });
});
