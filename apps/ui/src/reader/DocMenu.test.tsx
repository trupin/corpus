/** @vitest-environment jsdom */
import type { RowNotice } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { docFixture, readerTransport, type ReaderTransport } from "../testing/readerFixture";
import {
  DELETE_ARMED_LABEL,
  DELETE_ARMED_META,
  DELETE_LABEL,
  DELETE_META,
  DocMenu,
} from "./DocMenu";
import { resetEscapeLayers } from "./useEscapeStack";

afterEach(() => {
  cleanup();
  resetEscapeLayers();
});

const NOTE = docFixture({ frontmatter: { id: "doc_m", title: "Mortgage options" } });
const THREAD = docFixture({
  frontmatter: { id: "th_rate", type: "thread", title: "Rate assumption", status: "open" },
  path: "data/threads/th_rate.md",
});

interface MountOptions {
  readonly doc?: typeof NOTE;
  readonly threadStatus?: string | null;
  readonly wire?: ReaderTransport;
  readonly onNotify?: (notice: RowNotice) => void;
  readonly onGone?: () => void;
  readonly onClose?: () => void;
}

function mount(options: MountOptions = {}): ReaderTransport {
  const doc = options.doc ?? NOTE;
  const wire = options.wire ?? readerTransport({ docs: [doc] });
  const harness = createCorpusTestHarness({ fetch: wire.fetch });
  render(
    <DocMenu
      doc={doc}
      threadStatus={options.threadStatus ?? null}
      onClose={options.onClose ?? (() => undefined)}
      onGone={options.onGone ?? (() => undefined)}
      onNotify={options.onNotify ?? (() => undefined)}
    />,
    { wrapper: harness.Wrapper },
  );
  return wire;
}

/**
 * The sheet as the reader actually mounts it: behind a ⋯ button that toggles it
 * (`ReaderHead.tsx`). Focus behaviour is only meaningful with the trigger in the
 * tree — "focus never left the trigger" was the whole finding (UI-030), and
 * "focus goes back to it" is half the fix.
 */
function mountWithTrigger(options: MountOptions = {}): ReaderTransport {
  const doc = options.doc ?? NOTE;
  const wire = options.wire ?? readerTransport({ docs: [doc] });
  const harness = createCorpusTestHarness({ fetch: wire.fetch });
  function Head(): ReactElement {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button
          type="button"
          data-doc-menu
          onClick={() => {
            setOpen((was) => !was);
          }}
        >
          ⋯
        </button>
        {open ? (
          <DocMenu
            doc={doc}
            threadStatus={options.threadStatus ?? null}
            onClose={() => {
              setOpen(false);
              options.onClose?.();
            }}
            onGone={options.onGone ?? (() => undefined)}
            onNotify={options.onNotify ?? (() => undefined)}
          />
        ) : null}
      </>
    );
  }
  render(<Head />, { wrapper: harness.Wrapper });
  return wire;
}

function trigger(): HTMLElement {
  return screen.getByRole("button", { name: "⋯" });
}

/** The `data-act` of whatever has focus, or `null` when it is not an item. */
function focusedAction(): string | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  if (active.closest("[data-dm-pop]") === null) return null;
  return active.dataset["act"] ?? null;
}

function itemLabels(): string[] {
  return [...document.querySelectorAll(".cp-item .cp-quote")].map((node) => node.textContent ?? "");
}

/**
 * Walks `↓` until `act` has focus.
 *
 * Counting keystrokes to an item is how these tests used to reach one, and it
 * made them assertions about the **length** of a menu that other issues keep
 * adding to — UI-094's Resolve moved every item below it down by one and broke
 * five at once. What they claim is that the arrows reach an item and `↵` runs
 * it, so that is what this walks. The e2e suite's `arrowTo` is the same rule in
 * a real browser.
 */
async function arrowTo(user: UserEvent, act: string): Promise<void> {
  for (let step = 0; step < 12; step += 1) {
    if (focusedAction() === act) return;
    await user.keyboard("{ArrowDown}");
  }
  expect(focusedAction()).toBe(act);
}

describe("DocMenu", () => {
  /**
   * Resolve is here on a **note** since UI-094: SPEC.md §5's three statuses are
   * one vocabulary and not a per-type one (rider signed 2026-08-12), so the set
   * a note offers is the set a thread offers.
   */
  it("offers Still current, Resolve, Archive and Delete on a note", () => {
    mount();
    expect(itemLabels()).toEqual(["Still current", "Resolve", "Archive", DELETE_LABEL]);
  });

  it("keeps Resolve on a thread document, labelled by its current status", () => {
    mount({ doc: THREAD, threadStatus: "open" });
    expect(itemLabels()).toEqual(["Still current", "Resolve", "Archive", DELETE_LABEL]);
    cleanup();
    mount({ doc: THREAD, threadStatus: "resolved" });
    expect(itemLabels()).toContain("Reopen");
  });

  /**
   * SPEC.md §10/§13: the publish plugin adds "Copy for Google Docs" and "Push
   * update to Google Doc…" through the manifest. Core rendering them — even
   * inert — is core knowing a plugin's name.
   */
  it("carries no publish-plugin items", () => {
    mount();
    expect(itemLabels().join(" ")).not.toContain("Google");
  });

  /** SPEC.md §5: a committed act distinct from editing — `reviewed`, nothing else. */
  it("marks still current through the kit's shared unit, writing reviewed and nothing else", async () => {
    const wire = mount();
    fireEvent.click(screen.getByText("Still current"));
    await waitFor(() => {
      expect(wire.of("PUT", "/api/docs/doc_m")).toHaveLength(1);
    });
    const body = wire.of("PUT")[0]?.body as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["reviewed"]);
    expect(typeof body["reviewed"]).toBe("string");
  });

  /**
   * UI-020. The route, not `PUT {status: "archived"}` — only the route runs the
   * server's folder move, and without it archiving a skill left its folder in
   * `.claude/skills/`, still discovered and still holding its name.
   */
  it("archives through the route that owns the transition", async () => {
    const wire = mount();
    fireEvent.click(screen.getByText("Archive"));
    await waitFor(() => {
      expect(wire.of("POST", "/api/docs/doc_m/archive")).toHaveLength(1);
    });
    expect(wire.of("PUT")).toHaveLength(0);
  });

  /** SPEC.md §7: an archived skill is "restorable", and this is where from. */
  it("offers Unarchive in Archive's place once a document is archived", async () => {
    const archived = docFixture({
      frontmatter: { id: "doc_m", title: "Mortgage options", status: "archived" },
    });
    const wire = mount({ doc: archived });
    expect(itemLabels()).toEqual(["Still current", "Unarchive", DELETE_LABEL]);

    fireEvent.click(screen.getByText("Unarchive"));
    await waitFor(() => {
      expect(wire.of("POST", "/api/docs/doc_m/unarchive")).toHaveLength(1);
    });
    // SERVER-039 refuses the `PUT` that would otherwise express this.
    expect(wire.of("PUT")).toHaveLength(0);
  });

  it("flips a thread's status through the thread route, not through a doc write", async () => {
    const wire = mount({ doc: THREAD, threadStatus: "open" });
    fireEvent.click(screen.getByText("Resolve"));
    await waitFor(() => {
      expect(wire.of("POST", "/api/threads/th_rate/resolve")).toHaveLength(1);
    });
    expect(wire.of("PUT")).toHaveLength(0);
  });

  it("arms Delete on the first click and issues nothing", () => {
    const wire = mount();
    fireEvent.click(screen.getByText(DELETE_LABEL));

    expect(screen.getByText(DELETE_ARMED_LABEL)).toBeDefined();
    expect(screen.getByText(DELETE_ARMED_META)).toBeDefined();
    expect(wire.calls.filter((call) => call.method === "DELETE")).toHaveLength(0);
  });

  it("labels Delete as user-only before it is armed", () => {
    mount();
    expect(screen.getByText(DELETE_META)).toBeDefined();
    expect(document.querySelector(".cp-item.cp-danger")).not.toBeNull();
  });

  it("deletes on the second click, and says what it cost", async () => {
    const notify = vi.fn<(notice: RowNotice) => void>();
    const onGone = vi.fn();
    const wire = mount({ onNotify: notify, onGone });
    fireEvent.click(screen.getByText(DELETE_LABEL));
    fireEvent.click(screen.getByText(DELETE_ARMED_LABEL));

    await waitFor(() => {
      expect(wire.of("DELETE", "/api/docs/doc_m")).toHaveLength(1);
    });
    expect(onGone).toHaveBeenCalled();
    expect(notify.mock.calls[0]?.[0]?.message).toContain("git retains its history");
  });

  it("disarms and reports a refused delete", async () => {
    const notify = vi.fn<(notice: RowNotice) => void>();
    const wire = readerTransport({
      docs: [NOTE],
      failing: { "DELETE /api/docs/doc_m": 403 },
    });
    mount({ wire, onNotify: notify });
    fireEvent.click(screen.getByText(DELETE_LABEL));
    fireEvent.click(screen.getByText(DELETE_ARMED_LABEL));

    await waitFor(() => {
      expect(notify.mock.calls[0]?.[0]?.message).toContain("Delete failed");
    });
    expect(screen.getByText(DELETE_LABEL)).toBeDefined();
  });

  /**
   * UI-012. Every item here calls `onClose()` in the same tick, which unmounts
   * this component before the request settles. TanStack Query v5 skips a
   * `mutate(…, { onSuccess })` callback once its observer has no listeners, so
   * these three used to commit their write and say nothing at all. The notices
   * now ride on the mutation hooks, and the close stays immediate — which is
   * what returns focus to the ⋯ button that opened the menu.
   */
  describe("reporting a write the closed menu started", () => {
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

    /** Parks every write until `held` resolves, recording through `inner`. */
    function heldTransport(inner: ReaderTransport, held: Promise<void>): typeof globalThis.fetch {
      return async (input, init) => {
        const method = input instanceof Request ? input.method : (init?.method ?? "GET");
        if (method !== "GET") await held;
        return inner.fetch(input, init);
      };
    }

    it.each([
      ["Still current", "still current"],
      ["Archive", "Archived"],
    ])("%s toasts even though the menu closed first", async (label, fragment) => {
      const notify = vi.fn<(notice: RowNotice) => void>();
      const onClose = vi.fn();
      const { held, release } = gate();
      const inner = readerTransport({ docs: [NOTE] });
      const harness = createCorpusTestHarness({ fetch: heldTransport(inner, held) });
      render(
        <DocMenu
          doc={NOTE}
          threadStatus={null}
          onClose={onClose}
          onGone={() => undefined}
          onNotify={notify}
        />,
        { wrapper: harness.Wrapper },
      );

      fireEvent.click(screen.getByText(label));
      expect(onClose).toHaveBeenCalledTimes(1);
      // The host acts on `onClose` by unmounting the menu — the teardown that
      // used to swallow the result.
      cleanup();
      release();

      await waitFor(() => {
        expect(notify.mock.calls.at(-1)?.[0]?.message).toContain(fragment);
      });
      expect(notify.mock.calls.at(-1)?.[0]?.tone).toBe("info");
    });

    it("Resolve toasts even though the menu closed first", async () => {
      const notify = vi.fn<(notice: RowNotice) => void>();
      const { held, release } = gate();
      const inner = readerTransport({ docs: [THREAD] });
      const harness = createCorpusTestHarness({ fetch: heldTransport(inner, held) });
      render(
        <DocMenu
          doc={THREAD}
          threadStatus="open"
          onClose={() => undefined}
          onGone={() => undefined}
          onNotify={notify}
        />,
        { wrapper: harness.Wrapper },
      );

      fireEvent.click(screen.getByText("Resolve"));
      cleanup();
      release();

      await waitFor(() => {
        expect(notify.mock.calls.at(-1)?.[0]?.message).toContain("Thread resolved");
      });
    });

    /**
     * PR #12 review, NIT 24. Delete keeps the menu open on purpose — a refusal
     * has to have something to re-arm — but `esc`, an outside click or the
     * reader closing dismisses it anyway, and the refusal notice went with the
     * observer. The one outcome nobody may lose: the document is still there
     * and the user was told nothing.
     */
    it("reports a refused delete even though the menu was dismissed mid-flight", async () => {
      const notify = vi.fn<(notice: RowNotice) => void>();
      const { held, release } = gate();
      const inner = readerTransport({
        docs: [NOTE],
        failing: { "DELETE /api/docs/doc_m": 409 },
      });
      const harness = createCorpusTestHarness({ fetch: heldTransport(inner, held) });
      render(
        <DocMenu
          doc={NOTE}
          threadStatus={null}
          onClose={() => undefined}
          onGone={() => undefined}
          onNotify={notify}
        />,
        { wrapper: harness.Wrapper },
      );

      fireEvent.click(screen.getByText(DELETE_LABEL));
      fireEvent.click(screen.getByText(DELETE_ARMED_LABEL));
      // What `esc` does to this surface: the menu goes while the request is
      // still on the wire.
      cleanup();
      release();

      await waitFor(() => {
        expect(notify.mock.calls.at(-1)?.[0]?.message).toContain("Delete failed");
      });
      expect(notify.mock.calls.at(-1)?.[0]?.tone).toBe("error");
    });

    it("reports a delete that committed after the menu was dismissed", async () => {
      const notify = vi.fn<(notice: RowNotice) => void>();
      const { held, release } = gate();
      const inner = readerTransport({ docs: [NOTE] });
      const harness = createCorpusTestHarness({ fetch: heldTransport(inner, held) });
      render(
        <DocMenu
          doc={NOTE}
          threadStatus={null}
          onClose={() => undefined}
          onGone={() => undefined}
          onNotify={notify}
        />,
        { wrapper: harness.Wrapper },
      );

      fireEvent.click(screen.getByText(DELETE_LABEL));
      fireEvent.click(screen.getByText(DELETE_ARMED_LABEL));
      cleanup();
      release();

      await waitFor(() => {
        expect(notify.mock.calls.at(-1)?.[0]?.message).toContain("Deleted “Mortgage options”");
      });
      expect(notify.mock.calls.at(-1)?.[0]?.tone).toBe("info");
    });

    it("Reopen names its own verb when the flip is refused", async () => {
      const notify = vi.fn<(notice: RowNotice) => void>();
      const { held, release } = gate();
      const inner = readerTransport({
        docs: [THREAD],
        failing: { "POST /api/threads/th_rate/reopen": 409 },
      });
      const harness = createCorpusTestHarness({ fetch: heldTransport(inner, held) });
      render(
        <DocMenu
          doc={THREAD}
          threadStatus="resolved"
          onClose={() => undefined}
          onGone={() => undefined}
          onNotify={notify}
        />,
        { wrapper: harness.Wrapper },
      );

      fireEvent.click(screen.getByText("Reopen"));
      cleanup();
      release();

      await waitFor(() => {
        expect(notify.mock.calls.at(-1)?.[0]?.message).toContain("Reopen failed");
      });
      expect(notify.mock.calls.at(-1)?.[0]?.tone).toBe("error");
    });
  });

  it("closes on Escape rather than letting the surface below act on it", () => {
    const onClose = vi.fn();
    mount({ onClose });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/**
 * UI-030. The sheet shipped with `role="menuitem"` buttons focus never reached:
 * `↓` and Tab both left `activeElement` on the ⋯ trigger, so `↵` re-toggled the
 * trigger and no action on this menu could be run from the keyboard at all.
 * These assert on `activeElement` — the exact thing that was stuck.
 */
describe("the ⋯ sheet from the keyboard", () => {
  it("takes focus when it opens, instead of leaving it on the ⋯ button", async () => {
    const user = userEvent.setup();
    mountWithTrigger();
    await user.click(trigger());

    expect(document.activeElement).toBe(screen.getByRole("menu", { name: "Document actions" }));
    expect(document.activeElement).not.toBe(trigger());
  });

  it("moves focus onto the items with the arrows, Home and End", async () => {
    const user = userEvent.setup();
    mountWithTrigger();
    await user.click(trigger());

    // Walked against the order the sheet actually rendered, so this stays a
    // claim about the arrows rather than about how many items the menu has.
    const order = [...document.querySelectorAll("[data-dm-pop] [role='menuitem']")].map(
      (node) => (node as HTMLElement).dataset["act"] ?? "",
    );
    expect(order.length).toBeGreaterThan(2);

    for (const act of order) {
      await user.keyboard("{ArrowDown}");
      expect(focusedAction()).toBe(act);
    }
    await user.keyboard("{End}");
    expect(focusedAction()).toBe(order.at(-1));
    await user.keyboard("{Home}");
    expect(focusedAction()).toBe(order[0]);
    // Clamped, not wrapped: ↑ at the top is not a jump to Delete…
    await user.keyboard("{ArrowUp}");
    expect(focusedAction()).toBe(order[0]);
  });

  it.each([
    ["↵", "{Enter}"],
    ["space", "[Space]"],
  ])("runs the focused action on %s, once, and closes", async (_key, press) => {
    const user = userEvent.setup();
    const wire = mountWithTrigger();
    await user.click(trigger());
    await arrowTo(user, "archive");

    await user.keyboard(press);

    await waitFor(() => {
      expect(wire.of("POST", "/api/docs/doc_m/archive")).toHaveLength(1);
    });
    // A second activation path bolted on top of the button's native one is the
    // obvious wrong fix, and it would show up here as two.
    expect(wire.calls.filter((call) => call.method !== "GET")).toHaveLength(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  /**
   * The frame implements no `↵` of its own — a focused `<button>` activates
   * through its default action, and a handler on top of that would be a second
   * activation path that fires twice. What the frame must do is stay out of the
   * way, and the raw event is what proves it: unprevented, nothing run by the
   * keydown itself, and exactly one write once the browser's own click lands.
   *
   * The numpad key only reaches this way: `user-event` has no `NumpadEnter` in
   * its keyboard map, while a browser reports it as `key: "Enter"` with that
   * code — which is the case worth asserting, since a `code`-based handler would
   * miss it.
   */
  it.each(["Enter", "NumpadEnter"])(
    "leaves activation to the item itself on code %s",
    async (code) => {
      const user = userEvent.setup();
      const wire = mountWithTrigger();
      await user.click(trigger());
      await arrowTo(user, "archive");
      const item = document.activeElement;

      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        code,
        bubbles: true,
        cancelable: true,
      });
      item?.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(wire.calls.filter((call) => call.method !== "GET")).toHaveLength(0);
      expect(screen.getByRole("menu")).toBeDefined();

      // The default action the browser performs on an unprevented ↵: a click on
      // the focused button. jsdom does not synthesise it, so it is fired.
      fireEvent.click(item as HTMLElement);
      await waitFor(() => {
        expect(wire.of("POST", "/api/docs/doc_m/archive")).toHaveLength(1);
      });
      expect(wire.calls.filter((call) => call.method !== "GET")).toHaveLength(1);
      expect(screen.queryByRole("menu")).toBeNull();
    },
  );

  it("closes on esc without running anything, and hands focus back to ⋯", async () => {
    const user = userEvent.setup();
    const wire = mountWithTrigger();
    await user.click(trigger());
    await arrowTo(user, "archive");

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).toBeNull();
    expect(wire.calls.filter((call) => call.method !== "GET")).toHaveLength(0);
    expect(document.activeElement).toBe(trigger());
  });

  it("dismisses on Tab rather than walking the keyboard out behind the sheet", async () => {
    const user = userEvent.setup();
    mountWithTrigger();
    await user.click(trigger());

    await user.keyboard("{Tab}");

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });
});

/**
 * jsdom applies no stylesheet, so the colours are asserted against the
 * stylesheet itself — the same approach `theme.test.ts` takes to `index.html`'s
 * pre-paint script. The browser measurement lives in the issue's E2E log.
 */
describe("the destructive item's treatment (TEST-18)", () => {
  const css = readFileSync(join(import.meta.dirname, "Reader.css"), "utf8");
  const rule = (selector: string): string =>
    new RegExp(`${selector.replace(/\./g, "\\.")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";

  it.each([".cp-danger .cp-quote", ".cp-danger .cp-meta"])(
    "renders %s in --signal, so both of Delete's lines read as the warning they are",
    (selector) => {
      expect(rule(selector)).toContain("color: var(--signal)");
    },
  );

  it("leaves every other item's sub-label in --ink-3", () => {
    expect(rule(".cp-meta")).toContain("color: var(--ink-3)");
  });
});
