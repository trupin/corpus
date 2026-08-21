/** @vitest-environment jsdom */
import type { QueueStatus } from "@corpus/contract";
import { createCorpusTestHarness, type CorpusTestHarness } from "@corpus/kit/testing";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_NOTICES, TOAST_DURATION_MS, ToastProvider, useToast } from "../shell/Toasts";
import { memoryStorage } from "../testing/memoryStorage";
import { Console } from "./Console";
import { Notices } from "./Notices";
import { droppedNoticesLine, NO_NOTICES_NOTE } from "./noticesModel";
import { CONSOLE_STORAGE_KEY } from "./useConsoleLayout";

/**
 * The console's third tab (UI-139), where a refusal outlives its toast.
 *
 * jsdom cannot see the defect this issue is about — a `title` that produces no
 * tooltip on focus is a browser fact, and `notices.spec.ts` is what proves the
 * keyboard path end to end. What is asserted here is everything a browser would
 * make expensive: which notices the tab holds, what the bound says when it
 * bites, and that reading the tab is what clears the console's mark.
 */

/** A server string of the length a refusal really has: past the toast's two lines. */
const LONG_REFUSAL =
  "Pin refused because the view document this list would need already exists under " +
  "another name in the same folder, and creating a second one would leave two " +
  "columns claiming the same query.";

const IDLE_QUEUE: QueueStatus = {
  agent: { live: true, since: new Date().toISOString() },
  halted: false,
  pending: 0,
  inProgress: 0,
  deferred: 0,
  processed: 0,
  failed: 0,
  abandoned: 0,
};

function json(body: unknown): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

/** Answers the console's reads and nothing more: no test here is about them. */
function transport(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(new Request(input).url);
  if (url.pathname === "/api/queue/status") return json(IDLE_QUEUE);
  if (url.pathname === "/api/jobs") return json({ jobs: [] });
  if (url.pathname === "/api/health") {
    return json({ status: "ok", version: "1.2.3", uptimeSeconds: 3, workspace: "/tmp/ws" });
  }
  return json({});
}

/** Raises the notices a test needs, through the one seam that raises them. */
function Narrator(): ReactElement {
  const toast = useToast();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          toast({ tone: "error", message: LONG_REFUSAL });
        }}
      >
        refuse
      </button>
      <button
        type="button"
        onClick={() => {
          toast({ tone: "info", message: "Pinned — a view document was created." });
        }}
      >
        confirm
      </button>
    </>
  );
}

let harness: CorpusTestHarness | undefined;

/** The tab on its own: no queries, so no client is needed to render it. */
function renderTab(): void {
  render(
    <ToastProvider>
      <Narrator />
      <Notices />
    </ToastProvider>,
  );
}

/** The whole drawer, opened, so the tab strip and the strip's mark are real. */
function renderConsole(): void {
  harness = createCorpusTestHarness({
    fetch: transport,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
  });
  const { Wrapper } = harness;
  render(
    <Wrapper>
      <ToastProvider>
        <Narrator />
        <Console />
      </ToastProvider>
    </Wrapper>,
  );
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  localStorage.setItem(
    CONSOLE_STORAGE_KEY,
    JSON.stringify({ version: 1, open: true, height: 210 }),
  );
});

afterEach(() => {
  cleanup();
  harness?.queryClient.clear();
  harness = undefined;
  vi.unstubAllGlobals();
});

describe("the Notices tab", () => {
  it("says what it is, and what it costs, before anything has been raised", () => {
    renderTab();
    expect(screen.getByText(NO_NOTICES_NOTE)).toBeTruthy();
    expect(document.querySelectorAll(".notice")).toHaveLength(0);
  });

  /**
   * The acceptance criterion this tab exists for. The toast shows two lines of
   * this string and reveals the rest on a `title` no keyboard reaches; here the
   * whole of it is text, in one node, with no `title` standing in for anything.
   */
  it("shows a refusal's whole reason, unclamped and not behind a tooltip", async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(screen.getByText("refuse"));

    const message = document.querySelector(".notice-msg");
    expect(message?.textContent).toBe(LONG_REFUSAL);
    // A `title` here would be this issue's own defect, one surface further in.
    expect(message?.getAttribute("title")).toBeNull();
  });

  it("keeps the reason after the toast that carried it has gone", () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderTab();
    fireEvent.click(screen.getByText("refuse"));
    expect(document.querySelectorAll(".toast")).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS + 1);
    });
    expect(document.querySelectorAll(".toast")).toHaveLength(0);
    expect(document.querySelector(".notice-msg")?.textContent).toBe(LONG_REFUSAL);
    vi.useRealTimers();
  });

  it("lists newest first, with each notice's tone and time", async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(screen.getByText("confirm"));
    await user.click(screen.getByText("refuse"));

    const rows = [...document.querySelectorAll(".notice")];
    expect(rows.map((row) => row.getAttribute("data-tone"))).toEqual(["error", "info"]);
    expect(rows[0]?.querySelector(".notice-tone")?.textContent).toBe("error");
    // `HH:MM:SS` — the fixed-width column, not a locale string of any length.
    expect(rows[0]?.querySelector(".notice-time")?.textContent).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("records the same refusal twice as two notices", async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(screen.getByText("refuse"));
    await user.click(screen.getByText("refuse"));
    expect(document.querySelectorAll(".notice")).toHaveLength(2);
  });

  it("says how many it dropped rather than ending quietly", () => {
    renderTab();
    // Nothing to say until the bound bites.
    fireEvent.click(screen.getByText("confirm"));
    expect(document.querySelector(".notice-dropped")).toBeNull();

    for (let index = 0; index < MAX_NOTICES + 1; index++) {
      fireEvent.click(screen.getByText("confirm"));
    }
    expect(document.querySelectorAll(".notice")).toHaveLength(MAX_NOTICES);
    expect(document.querySelector(".notice-dropped")?.textContent).toBe(
      droppedNoticesLine(2, MAX_NOTICES),
    );
  });

  it("is a scroll container the keyboard can put focus into", () => {
    renderTab();
    const list = document.querySelector(".notice-list");
    expect(list?.getAttribute("tabindex")).toBe("0");
  });
});

describe("the console's third tab", () => {
  it("sits between Jobs and Residents, and opens on Jobs as before", async () => {
    renderConsole();
    await waitFor(() => {
      expect(document.querySelectorAll(".console-tab")).toHaveLength(3);
    });
    expect([...document.querySelectorAll(".console-tab")].map((tab) => tab.textContent)).toEqual([
      "Jobs",
      "Notices",
      "Residents",
    ]);
    expect(screen.getByRole("tab", { name: "Jobs" }).getAttribute("aria-selected")).toBe("true");
  });

  it("shows the notices when its tab is pressed, and nothing else", async () => {
    const user = userEvent.setup();
    renderConsole();
    await user.click(screen.getByText("refuse"));
    await user.click(screen.getByRole("tab", { name: "Notices" }));

    expect(document.querySelector(".notice-msg")?.textContent).toBe(LONG_REFUSAL);
    // The other two bodies are gone, not merely hidden behind it.
    expect(document.querySelector(".job-list")).toBeNull();
    expect(document.querySelector(".lane-list")).toBeNull();
  });

  /**
   * The tab strip's keys. It shipped with none: a `role="tablist"` owes a
   * keyboard user its arrows, and — because the shell claims `Enter` globally
   * and calls `preventDefault()` on it (`useShortcuts`) — a focused tab was not
   * even activated by `Enter`. `notices.spec.ts` proves the whole path in a real
   * browser, where that interception is real. These are the key-by-key facts.
   */
  describe("the tab strip's keyboard", () => {
    const selected = (): string | null =>
      document.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? null;

    async function focusJobs(): Promise<void> {
      renderConsole();
      await waitFor(() => {
        expect(document.querySelectorAll(".console-tab")).toHaveLength(3);
      });
      screen.getByRole("tab", { name: "Jobs" }).focus();
    }

    it("walks the tabs with the arrows, and takes the focus along", async () => {
      const user = userEvent.setup();
      await focusJobs();

      await user.keyboard("{ArrowRight}");
      expect(selected()).toBe("Notices");
      expect(document.activeElement?.id).toBe("console-tab-notices");

      await user.keyboard("{ArrowRight}");
      expect(selected()).toBe("Residents");
      // Wraps rather than stopping: three tabs is a ring, not a queue.
      await user.keyboard("{ArrowRight}");
      expect(selected()).toBe("Jobs");
      await user.keyboard("{ArrowLeft}");
      expect(selected()).toBe("Residents");
    });

    it("jumps to the ends with Home and End", async () => {
      const user = userEvent.setup();
      await focusJobs();
      await user.keyboard("{End}");
      expect(selected()).toBe("Residents");
      await user.keyboard("{Home}");
      expect(selected()).toBe("Jobs");
    });

    it("activates the focused tab on Enter and on Space", async () => {
      const user = userEvent.setup();
      await focusJobs();

      screen.getByRole("tab", { name: "Notices" }).focus();
      await user.keyboard("{Enter}");
      expect(selected()).toBe("Notices");

      screen.getByRole("tab", { name: "Residents" }).focus();
      await user.keyboard(" ");
      expect(selected()).toBe("Residents");
    });

    it("leaves keys it does not own alone", async () => {
      const user = userEvent.setup();
      await focusJobs();
      await user.keyboard("{ArrowDown}");
      expect(selected()).toBe("Jobs");
    });
  });

  /**
   * SHARED-058 call 5: a durable record helps only a person who already knows to
   * look, so an unread refusal marks the console. Scoped to the error tone,
   * because a mark that lit for every saved document is noise.
   */
  describe("the attention marker", () => {
    const strip = (): string | null =>
      document.querySelector(".c-notice-mark")?.getAttribute("data-unread") ?? null;
    const tab = (): string | null =>
      document.querySelector(".console-tab[data-unread]")?.getAttribute("data-unread") ?? null;

    it("is drawn unlit before anything is raised, so its arrival moves nothing", async () => {
      renderConsole();
      await waitFor(() => {
        expect(strip()).toBe("false");
      });
      // Present in the DOM at rest — reserved, not conditional.
      expect(document.querySelectorAll(".c-notice-mark")).toHaveLength(1);
      expect(tab()).toBe("false");
    });

    it("lights for a refusal and not for a confirmation", async () => {
      const user = userEvent.setup();
      renderConsole();
      await user.click(screen.getByText("confirm"));
      expect(strip()).toBe("false");

      await user.click(screen.getByText("refuse"));
      expect(strip()).toBe("true");
      expect(tab()).toBe("true");
    });

    it("stays lit while the drawer is open on another tab", async () => {
      const user = userEvent.setup();
      renderConsole();
      await user.click(screen.getByText("refuse"));
      await user.click(screen.getByRole("tab", { name: "Residents" }));
      expect(strip()).toBe("true");
    });

    it("clears when the Notices tab is opened, and only then", async () => {
      const user = userEvent.setup();
      renderConsole();
      await user.click(screen.getByText("refuse"));
      expect(strip()).toBe("true");

      await user.click(screen.getByRole("tab", { name: "Notices" }));
      await waitFor(() => {
        expect(strip()).toBe("false");
      });
      expect(tab()).toBe("false");
    });

    it("does not light behind a person already reading the tab", async () => {
      const user = userEvent.setup();
      renderConsole();
      await user.click(screen.getByRole("tab", { name: "Notices" }));
      await user.click(screen.getByText("refuse"));

      // The notice is in the list they are looking at, so there is nothing
      // unshown to mark.
      expect(document.querySelectorAll(".notice")).toHaveLength(1);
      await waitFor(() => {
        expect(strip()).toBe("false");
      });
    });
  });
});
