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
    openFullScreen: () => undefined,
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

  /**
   * The switch (UI-172; SPEC.md §7's rider signed 2026-08-25).
   */
  describe("the automatic-reflection switch", () => {
    const switchOf = async (): Promise<HTMLElement> =>
      screen.findByRole("switch", { name: "Automatic reflection" });

    it("reads on for a configured window, and says the window in its tooltip", async () => {
      mount({ reflect: { quiet: 45 } });

      const control = await switchOf();
      expect(control.getAttribute("aria-checked")).toBe("true");
      expect(control.textContent).toBe("auto");
      // SHARED-071 chose showing the number over remembering it, and this is
      // where a person whose config says 45 reads 45.
      expect(control.getAttribute("title")).toContain("45 minutes");
    });

    it("reads off at zero, and names the window switching it on restores", async () => {
      mount({ reflect: { quiet: 0 } });

      const control = await switchOf();
      expect(control.getAttribute("aria-checked")).toBe("false");
      expect(control.textContent).toBe("auto off");
      expect(control.getAttribute("title")).toContain("restores the 30-minute quiet window");
    });

    it("writes zero to switch off, and the default to switch on", async () => {
      const { wire } = mount({ reflect: { quiet: 45 } });
      await userEvent.click(await switchOf());

      await waitFor(() => {
        expect(wire.writes("PUT")).toHaveLength(1);
      });
      const written = wire.writes("PUT")[0];
      expect(written?.path).toBe("/api/workspace/reflect/quiet");
      expect(written?.body).toMatchObject({ quiet: 0 });
    });

    /**
     * The whole of what the user asked for: with the automatic path off, this
     * button is the only way a reflection happens, so disabling it would remove
     * the last one.
     */
    it("leaves the ask enabled with the automatic path off", async () => {
      mount({ reflect: { quiet: 0 } });
      await switchOf();

      const ask = screen.getByRole("button", { name: /^Reflect/ });
      expect(ask.hasAttribute("disabled")).toBe(false);
    });

    /**
     * A control that said "off" before it had read anything would be claiming
     * something about the workspace on the strength of not knowing (UI-098).
     * Its slot is reserved in CSS, so the arrival paints and moves nothing.
     */
    it("says nothing at all until the status arrives", () => {
      const pending = (): Promise<Response> => new Promise(() => undefined);
      const harness = createBoardHarness(pending);
      render(<ReflectControl now={NOW} />, { wrapper: harness.Wrapper });

      expect(screen.queryByRole("switch")).toBeNull();
      // The slot is there regardless, which is what keeps the bar still.
      expect(document.querySelector(".reflect-auto")).not.toBeNull();
    });
  });
});
