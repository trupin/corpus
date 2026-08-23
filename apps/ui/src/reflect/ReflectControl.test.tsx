/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardNavigationProvider, useRegisterBoardNavigation } from "../board/openInColumn";
import { boardTransport, type BoardTransportOptions } from "../testing/boardFixture";
import { createBoardHarness } from "../testing/boardHarness";
import { ReflectControl } from "./ReflectControl";

afterEach(cleanup);

const NOW = new Date("2026-08-01T12:00:00.000Z");

/**
 * A stand-in board that publishes an `open` — the seam every surface outside the
 * board opens a document through, and the one the digest link uses.
 */
function OpenSpy({ open }: { readonly open: (docId: string) => void }): ReactElement {
  useRegisterBoardNavigation({
    open: (target) => {
      open(target.docId);
    },
    revealColumn: () => undefined,
  });
  return <span />;
}

function mount(options: BoardTransportOptions, open = vi.fn<(docId: string) => void>()) {
  const wire = boardTransport(options);
  const harness = createBoardHarness(wire.fetch);
  function Wrapper({ children }: { readonly children?: ReactNode }): ReactElement {
    return (
      <harness.Wrapper>
        <BoardNavigationProvider>
          <OpenSpy open={open} />
          {children}
        </BoardNavigationProvider>
      </harness.Wrapper>
    );
  }
  render(<ReflectControl now={NOW} />, { wrapper: Wrapper });
  return { wire, open };
}

describe("the Reflect control", () => {
  it("carries the corpus count and the clock", async () => {
    mount({ reflect: { reflected: "2026-08-01T09:00:00.000Z", changed: 2 } });

    const button = await screen.findByRole("button", { name: "Reflect · 2 changes since 3h" });
    expect(button.hasAttribute("disabled")).toBe(false);
    // The number is in a box of its own, so it can be tabular and fixed-width.
    expect(button.querySelector(".reflect-count")?.textContent).toBe("2");
    expect(screen.getByText("reflected 3h")).toBeTruthy();
  });

  /** A person may always ask, even with nothing outstanding (SPEC.md §7). */
  it("offers the act with nothing changed", async () => {
    mount({ reflect: { changed: 0 } });
    const button = await screen.findByRole("button", { name: "Reflect" });
    expect(button.hasAttribute("disabled")).toBe(false);
  });

  it("reads never reflected for a corpus nobody has looked at", async () => {
    mount({ reflect: { reflected: null, changed: 3 } });
    expect(await screen.findByText("never reflected")).toBeTruthy();
    // No clock means no "since" clause rather than an invented one.
    expect(screen.getByRole("button", { name: "Reflect · 3 changes" })).toBeTruthy();
  });

  it("says nothing about the clock before the status arrives", () => {
    // Rendered synchronously, before the fetch resolves: the button is there and
    // the clock is not, because a page that has asked nobody must not announce
    // "never reflected".
    mount({ reflect: { reflected: null } });
    expect(screen.getByRole("button", { name: "Reflect" })).toBeTruthy();
    expect(screen.queryByText("never reflected")).toBeNull();
  });

  it("shows the pending state and refuses a second ask while one runs", async () => {
    mount({ reflect: { pending: "evt_running", changed: 5 } });
    const button = await screen.findByRole("button", { name: "reflecting…" });
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  /**
   * The acceptance criterion: "a `pending: true` answer on click shows the
   * pending state, never an error toast". The route answers `202` either way, so
   * there is no failure branch to take.
   */
  it("asks, and a pending answer is not an error", async () => {
    const { wire } = mount({ reflect: { changed: 1, pending: "evt_running" } });
    await screen.findByRole("button", { name: "reflecting…" });

    // Nothing was posted by rendering; the ask is the press.
    expect(wire.calls.filter((call) => call.method === "POST")).toHaveLength(0);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("posts the ask when pressed", async () => {
    const user = userEvent.setup();
    const { wire } = mount({ reflect: { changed: 1 } });

    await user.click(await screen.findByRole("button", { name: "Reflect · 1 change since 3h" }));

    await waitFor(() => {
      const asks = wire.calls.filter(
        (call) => call.method === "POST" && call.path === "/api/workspace/reflect",
      );
      expect(asks).toHaveLength(1);
      // §7: the window is server state, so the ask carries no body of its own.
      expect(asks[0]?.body).toBeUndefined();
    });
  });

  it("opens the last digest thread", async () => {
    const user = userEvent.setup();
    const { open } = mount({ reflect: { lastDigest: "th_digest" } });

    await user.click(await screen.findByRole("button", { name: "reflected 3h" }));
    expect(open).toHaveBeenCalledWith("th_digest");
  });

  /** A reflection with nothing to say still posts a thread, so this is the pre-first state. */
  it("has nothing to open before the first digest exists", async () => {
    mount({ reflect: { lastDigest: null } });
    await screen.findByText("reflected 3h");
    expect(screen.queryByRole("button", { name: "reflected 3h" })).toBeNull();
  });

  it("says reflections are manual only when the quiet window is zero", async () => {
    mount({ reflect: { quiet: 0 } });
    // The clock arriving is what says the status has been read — the label is
    // "Reflect" both before and after, so waiting on it would prove nothing.
    await screen.findByText("reflected 3h");
    const button = screen.getByRole("button", { name: "Reflect" });
    expect(button.getAttribute("title")).toContain("manual only");
  });
});
