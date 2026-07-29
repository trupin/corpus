/** @vitest-environment jsdom */
import type { DocRow } from "@corpus/contract";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCorpusTestHarness, docRowFixture } from "../testing/index.js";
import { Row } from "./Row.js";
import { triagePrompt, type RowNotice } from "./useRowActions.js";

afterEach(cleanup);

const NOW = new Date("2026-07-27T12:00:00.000Z");

interface Capture {
  readonly method: string;
  readonly path: string;
  readonly body: Record<string, unknown> | undefined;
}

const STALE_ROW: DocRow = docRowFixture({
  id: "doc_taxchecklist",
  title: "2025 tax checklist",
  path: "data/docs/finance/2025-tax-checklist.md",
  stale: "very-stale",
  updated: "2025-11-12T10:00:00.000Z",
  attention: ["stale"],
});

interface Wired {
  readonly calls: Capture[];
  readonly notices: RowNotice[];
}

/** Renders the stale row and records every request its buttons issue. */
function renderStaleRow(
  options: {
    readonly failWith?: number;
    readonly row?: DocRow;
    /** Parks every write until it resolves, so a test can unmount mid-flight. */
    readonly holdWrites?: Promise<void>;
  } = {},
): Wired {
  const calls: Capture[] = [];
  const notices: RowNotice[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const { pathname } = new URL(request.url);
    const raw = await request.text();
    const body = raw === "" ? undefined : (JSON.parse(raw) as Record<string, unknown>);
    calls.push({ method: request.method, path: pathname, body });

    if (options.holdWrites !== undefined && request.method !== "GET") await options.holdWrites;

    if (options.failWith !== undefined && request.method !== "GET") {
      return new Response(
        JSON.stringify({ code: "locked", message: "agent holds the edit lock" }),
        { status: options.failWith, headers: { "content-type": "application/json" } },
      );
    }
    const bodies: Record<string, unknown> = {
      "/api/locks": { locks: [] },
      "/api/jobs": { jobs: [] },
      "/api/threads": {
        thread: {
          id: "th_new",
          title: "Stale review",
          created: NOW.toISOString(),
          updated: NOW.toISOString(),
          status: "open",
          tags: [],
          parent: STALE_ROW.id,
          anchor: null,
          agent: "requested",
          turns: [],
        },
        anchorId: null,
        eventId: "evt_1",
        warnings: [],
      },
    };
    return new Response(
      JSON.stringify(
        bodies[pathname] ?? { doc: {}, anchors: { remapped: [], orphaned: [] }, warnings: [] },
      ),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });

  const harness = createCorpusTestHarness({ fetch: fetch as unknown as typeof globalThis.fetch });
  render(
    <Row
      row={options.row ?? STALE_ROW}
      now={NOW}
      onNotify={(notice) => notices.push(notice)}
      onOpen={() => {
        throw new Error("a quick action must never open the document");
      }}
    />,
    { wrapper: harness.Wrapper },
  );
  return { calls, notices };
}

const writes = (calls: readonly Capture[]): Capture[] =>
  calls.filter((call) => call.method !== "GET");

describe("Archive", () => {
  it("issues a single PUT setting status: archived", async () => {
    const { calls, notices } = renderStaleRow();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => {
      expect(writes(calls)).toHaveLength(1);
    });
    expect(writes(calls)[0]).toMatchObject({
      method: "PUT",
      path: "/api/docs/doc_taxchecklist",
      body: { status: "archived" },
    });
    await waitFor(() => {
      expect(notices.at(-1)?.message).toContain("Archived");
    });
    expect(notices.at(-1)?.tone).toBe("info");
  });

  it("plays the leaving animation while the row is on its way out", async () => {
    renderStaleRow();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => {
      expect(document.querySelector(".row")?.className).toContain("leaving");
    });
  });

  it("fires exactly once when double-clicked", async () => {
    const { calls } = renderStaleRow();
    const archive = screen.getByRole("button", { name: "Archive" });
    fireEvent.click(archive);
    fireEvent.click(archive);
    fireEvent.click(archive);

    await waitFor(() => {
      expect(writes(calls)).toHaveLength(1);
    });
    // Settle any straggler before asserting the count is final.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(writes(calls)).toHaveLength(1);
  });

  it("leaves the row alone and surfaces the failure when the server refuses", async () => {
    const { calls, notices } = renderStaleRow({ failWith: 423 });
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => {
      expect(notices.at(-1)?.tone).toBe("error");
    });
    expect(notices.at(-1)?.message).toContain("Archive failed");
    const row = document.querySelector(".row");
    expect(row).not.toBeNull();
    expect(row?.className).not.toContain("leaving");
    // Still level 3: nothing was optimistically changed about the row's state.
    expect(row?.getAttribute("data-row-level")).toBe("3");
    expect(screen.getByRole("alert").textContent).toContain("agent holds the edit lock");
    expect(writes(calls)).toHaveLength(1);
  });
});

describe("Still current", () => {
  it("sends `reviewed` and nothing else — no `updated`, no `body`", async () => {
    const { calls, notices } = renderStaleRow();
    fireEvent.click(screen.getByRole("button", { name: "Still current" }));

    await waitFor(() => {
      expect(writes(calls)).toHaveLength(1);
    });
    const request = writes(calls)[0];
    expect(request?.method).toBe("PUT");
    expect(request?.path).toBe("/api/docs/doc_taxchecklist");
    // The exact key set, asserted as a set: an extra key here is what makes
    // staleness lie (SPEC.md §5).
    expect(Object.keys(request?.body ?? {})).toEqual(["reviewed"]);
    expect(request?.body).toEqual({ reviewed: NOW.toISOString() });
    await waitFor(() => {
      expect(notices.at(-1)?.message).toContain("still current");
    });
  });

  it("does not slide the row out — it is not leaving, it is refreshed", async () => {
    const { calls } = renderStaleRow();
    fireEvent.click(screen.getByRole("button", { name: "Still current" }));
    await waitFor(() => {
      expect(writes(calls)).toHaveLength(1);
    });
    expect(document.querySelector(".row")?.className).not.toContain("leaving");
  });

  it("reports a rejected review without changing the row", async () => {
    const { notices } = renderStaleRow({ failWith: 423 });
    fireEvent.click(screen.getByRole("button", { name: "Still current" }));
    await waitFor(() => {
      expect(notices.at(-1)?.message).toContain("Still current failed");
    });
    expect(document.querySelector(".row")?.getAttribute("data-row-level")).toBe("3");
  });
});

describe("@agent triage", () => {
  it("creates a whole-document, agent-requested thread with a real first turn", async () => {
    const { calls, notices } = renderStaleRow();
    fireEvent.click(screen.getByRole("button", { name: "@agent triage" }));

    await waitFor(() => {
      expect(writes(calls)).toHaveLength(1);
    });
    const request = writes(calls)[0];
    expect(request?.method).toBe("POST");
    expect(request?.path).toBe("/api/threads");
    expect(request?.body).toMatchObject({
      parent: "doc_taxchecklist",
      selector: null,
      requestsAgent: true,
    });
    expect(request?.body?.["body"]).toBe(triagePrompt("2025 tax checklist"));
    await waitFor(() => {
      expect(notices.at(-1)?.message).toContain("Queued");
    });
  });

  it("names the document in the prompt so the agent has something to answer", () => {
    expect(triagePrompt("2025 tax checklist")).toContain('"2025 tax checklist"');
    expect(triagePrompt("x")).toMatch(/archive it, update it, or split it/);
  });

  it("surfaces a rejected triage", async () => {
    const { notices } = renderStaleRow({ failWith: 423 });
    fireEvent.click(screen.getByRole("button", { name: "@agent triage" }));
    await waitFor(() => {
      expect(notices.at(-1)?.message).toContain("@agent triage failed");
    });
  });
});

/**
 * The teardown path (UI-012).
 *
 * The reader's ⋯ menu closes itself the moment an item is clicked, so the
 * component that started the write is gone long before the server answers.
 * TanStack Query v5 skips a `mutate(…, { onSuccess })` callback once its
 * observer has no listeners left, which is exactly what unmounting does — so
 * every notice these actions produce lives on the hook's own callbacks
 * instead. A write that commits with nothing said about it is the outcome
 * `shell/Toasts.tsx` exists to prevent.
 */
describe("a result that outlives the surface", () => {
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

  it.each([
    ["Archive", "Archived"],
    ["Still current", "still current"],
    ["@agent triage", "Queued"],
  ])("%s still reports success after the surface has gone", async (label, fragment) => {
    const { held, release } = gate();
    const { calls, notices } = renderStaleRow({ holdWrites: held });
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() => {
      expect(writes(calls)).toHaveLength(1);
    });

    cleanup();
    release();

    await waitFor(() => {
      expect(notices.at(-1)?.message).toContain(fragment);
    });
    expect(notices.at(-1)?.tone).toBe("info");
  });

  it.each([
    ["Archive", "Archive failed"],
    ["Still current", "Still current failed"],
    ["@agent triage", "@agent triage failed"],
  ])("%s still reports a refusal after the surface has gone", async (label, fragment) => {
    const { held, release } = gate();
    const { notices } = renderStaleRow({ failWith: 423, holdWrites: held });
    fireEvent.click(screen.getByRole("button", { name: label }));

    cleanup();
    release();

    await waitFor(() => {
      expect(notices.at(-1)?.message).toContain(fragment);
    });
    expect(notices.at(-1)?.tone).toBe("error");
  });
});

describe("click isolation", () => {
  it.each(["Archive", "Still current", "@agent triage"])(
    "clicking %s does not fire the row's open handler",
    async (label) => {
      // `onOpen` throws in this fixture: a propagated click fails the test loudly.
      const { calls } = renderStaleRow();
      fireEvent.click(screen.getByRole("button", { name: label }));
      await waitFor(() => {
        expect(writes(calls)).toHaveLength(1);
      });
    },
  );

  it("keyboard activation of a quick action behaves identically", async () => {
    const { calls } = renderStaleRow();
    const archive = screen.getByRole("button", { name: "Archive" });
    archive.focus();
    // A real `<button>` turns Enter into a click; the row's keydown handler must
    // not also see it as an activation of the row.
    fireEvent.keyDown(archive, { key: "Enter" });
    fireEvent.click(archive);
    await waitFor(() => {
      expect(writes(calls)).toHaveLength(1);
    });
  });

  it("works with no notifier wired up at all", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ locks: [], jobs: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const harness = createCorpusTestHarness({ fetch });
    render(<Row row={STALE_ROW} now={NOW} />, { wrapper: harness.Wrapper });
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => {
      expect(document.querySelector(".row")?.className).toContain("leaving");
    });
  });
});
