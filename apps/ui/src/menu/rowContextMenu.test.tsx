/** @vitest-environment jsdom */
import { createCorpusTestHarness, docRowFixture } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildRegistry, EMPTY_REGISTRY, setPluginRegistry } from "../plugins/registry";
import { resetSlotCache } from "../plugins/slots";
import { resetEscapeLayers } from "../reader/useEscapeStack";
import { Board } from "../shell/Board";
import { ToastProvider } from "../shell/Toasts";
import { boardTransport, viewRow, type BoardTransport } from "../testing/boardFixture";
import { KeyboardHarness } from "../testing/keyboardHarness";
import { memoryStorage } from "../testing/memoryStorage";
import { ContextMenuProvider } from "./ContextMenuHost";

/**
 * Right-clicking a row opens that row's own actions (SPEC.md §11), driven
 * through the real board.
 *
 * The assertions that matter are about the **target** and about the **wire**:
 * the menu acts on the item under the cursor rather than on the keyboard
 * highlight, and each item performs the same operation as its existing route
 * (`useRowActions`, `useSetThreadStatus`, `useDeleteDoc`) rather than a parallel
 * implementation.
 */

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  resetSlotCache();
});

afterEach(() => {
  cleanup();
  resetEscapeLayers();
  setPluginRegistry(EMPTY_REGISTRY);
  resetSlotCache();
  vi.unstubAllGlobals();
});

const VIEW = viewRow({ id: "doc_view", title: "Inbox", order: 10 });

const FRESH = docRowFixture({ id: "doc_a", title: "Mortgage options" });
const OTHER = docRowFixture({ id: "doc_b", title: "Rates" });
const STALE = docRowFixture({ id: "doc_c", title: "Old plan", stale: "very-stale" });
const THREAD = docRowFixture({
  id: "th_1",
  type: "thread",
  title: "Rate assumption",
  parent: "doc_a",
  turnCount: 2,
  lastAuthor: "user",
  lastTurn: "is 6.1% right?",
  unread: false,
  awaitingAgent: false,
});

function renderBoard(rows: readonly ReturnType<typeof docRowFixture>[]): BoardTransport {
  const wire = boardTransport({ views: [VIEW], defaultRows: rows });
  const harness = createCorpusTestHarness({ fetch: wire.fetch });
  function Wrapper({ children }: { readonly children?: ReactNode }): ReactElement {
    return (
      <harness.Wrapper>
        <ToastProvider>
          <ContextMenuProvider>
            <KeyboardHarness>{children}</KeyboardHarness>
          </ContextMenuProvider>
        </ToastProvider>
      </harness.Wrapper>
    );
  }
  render(<Board />, { wrapper: Wrapper });
  return wire;
}

async function row(docId: string): Promise<HTMLElement> {
  return waitFor(() => {
    const element = document.querySelector<HTMLElement>(`.row[data-row-doc="${docId}"]`);
    if (element === null) throw new Error(`no row for ${docId}`);
    return element;
  });
}

function menuActions(): string[] {
  return screen.getAllByRole("menuitem").map((item) => item.dataset["act"] ?? "");
}

describe("a row's context menu", () => {
  it("offers exactly the row set SPEC.md §11 enumerates", async () => {
    renderBoard([FRESH]);
    fireEvent.contextMenu(await row("doc_a"), { clientX: 40, clientY: 60 });

    expect(screen.getByRole("menu", { name: "Actions for Mortgage options" })).toBeTruthy();
    expect(menuActions()).toEqual(["open", "open-focus", "archive", "delete"]);
  });

  it("adds resolve on a thread row", async () => {
    renderBoard([THREAD]);
    fireEvent.contextMenu(await row("th_1"), { clientX: 40, clientY: 60 });
    expect(menuActions()).toContain("resolve");
  });

  it("shows the staleness quick actions only where the ramp already shows them", async () => {
    renderBoard([FRESH, STALE]);

    fireEvent.contextMenu(await row("doc_a"), { clientX: 10, clientY: 10 });
    expect(menuActions()).not.toContain("review");
    expect(menuActions()).not.toContain("triage");
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.contextMenu(await row("doc_c"), { clientX: 10, clientY: 10 });
    expect(menuActions()).toEqual(["open", "open-focus", "review", "triage", "archive", "delete"]);
  });

  it("acts on the row under the cursor, not on the keyboard highlight", async () => {
    const wire = renderBoard([FRESH, OTHER]);
    await row("doc_a");
    // The highlight lands on the first row.
    fireEvent.keyDown(document, { key: "ArrowDown" });
    await waitFor(() => {
      expect(document.querySelector(".row.kbd")?.getAttribute("data-row-doc")).toBe("doc_a");
    });

    fireEvent.contextMenu(await row("doc_b"), { clientX: 40, clientY: 60 });
    expect(screen.getByRole("menu", { name: "Actions for Rates" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: /Archive/ }));

    await waitFor(() => {
      expect(
        wire.writes("POST").filter((call) => call.path === "/api/docs/doc_b/archive"),
      ).toHaveLength(1);
    });
    expect(wire.writes("POST").some((call) => call.path === "/api/docs/doc_a/archive")).toBe(false);
  });

  /**
   * UI-020, Adjudication 7. "The shipped route" used to be
   * `PUT {status: "archived"}`, which is not the route that archives: only
   * `POST …/archive` moves a skill's folder out of `.claude/skills/`.
   */
  it("archives through the route that owns the transition", async () => {
    const wire = renderBoard([FRESH]);
    fireEvent.contextMenu(await row("doc_a"), { clientX: 40, clientY: 60 });
    fireEvent.click(screen.getByRole("menuitem", { name: /Archive/ }));

    await waitFor(() => {
      expect(wire.writes("POST")).toHaveLength(1);
    });
    expect(wire.writes("POST")[0]?.path).toBe("/api/docs/doc_a/archive");
    expect(wire.writes("PUT")).toHaveLength(0);
  });

  it("keeps deletion behind its explicit confirmation", async () => {
    const wire = renderBoard([FRESH]);
    fireEvent.contextMenu(await row("doc_a"), { clientX: 40, clientY: 60 });

    fireEvent.click(screen.getByRole("menuitem", { name: /Delete…/ }));
    expect(wire.writes("DELETE")).toHaveLength(0);

    fireEvent.click(screen.getByRole("menuitem", { name: /Really delete/ }));
    await waitFor(() => {
      expect(wire.writes("DELETE")).toHaveLength(1);
    });
    expect(wire.writes("DELETE")[0]?.path).toBe("/api/docs/doc_a");
  });

  it("opens the row in its column", async () => {
    renderBoard([FRESH]);
    fireEvent.contextMenu(await row("doc_a"), { clientX: 40, clientY: 60 });
    const openItem = document.querySelector<HTMLElement>('[role="menuitem"][data-act="open"]');
    if (openItem === null) throw new Error("no open item");
    fireEvent.click(openItem);

    await waitFor(() => {
      expect(document.querySelector('.reader[data-reader-doc="doc_a"]')).not.toBeNull();
    });
  });

  it("leaves the native menu alone off any row, and on a field", async () => {
    renderBoard([FRESH]);
    await row("doc_a");

    const list = document.querySelector(".col-list");
    if (list === null) throw new Error("no list");
    fireEvent.contextMenu(list, { clientX: 5, clientY: 5 });
    expect(screen.queryByRole("menu")).toBeNull();

    // The header's rename field is an input: Corpus does not take it over.
    fireEvent.click(screen.getByRole("button", { name: "List options for Inbox" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Rename/ }));
    const field = screen.getByLabelText("Rename Inbox");
    fireEvent.contextMenu(field, { clientX: 5, clientY: 5 });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("leaves a plugin-rendered row to the browser (v1 scope)", async () => {
    setPluginRegistry(
      buildRegistry([
        {
          dir: "fx",
          loaded: {
            module: {
              default: {
                id: "fx",
                name: "Fixture",
                docTypes: [
                  {
                    type: "note",
                    ListItem: ({ row: item }: { readonly row: { readonly id: string } }) => (
                      <div className="row" data-row-doc={item.id} data-row-type="note">
                        plugin row
                      </div>
                    ),
                  },
                ],
                columns: [],
              },
            },
          },
        },
      ]),
    );
    renderBoard([FRESH]);

    fireEvent.contextMenu(await row("doc_a"), { clientX: 40, clientY: 60 });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("the keyboard opening", () => {
  it("opens the highlighted row's menu on ⇧F10, with its first item focused", async () => {
    renderBoard([FRESH, OTHER]);
    await row("doc_a");
    fireEvent.keyDown(document, { key: "ArrowDown" });
    await waitFor(() => {
      expect(document.querySelector(".row.kbd")).not.toBeNull();
    });

    fireEvent.keyDown(document, { key: "F10", shiftKey: true });

    const menu = screen.getByRole("menu", { name: "Actions for Mortgage options" });
    expect(document.activeElement).toBe(within(menu).getAllByRole("menuitem")[0]);
  });

  it("opens nothing when no row is highlighted", async () => {
    renderBoard([FRESH]);
    await row("doc_a");
    fireEvent.keyDown(document, { key: "ContextMenu" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("a column header's context menu", () => {
  it("offers the same three acts the ⋯ button does", async () => {
    renderBoard([FRESH]);
    await row("doc_a");
    const header = document.querySelector<HTMLElement>(".col-head");
    if (header === null) throw new Error("no header");

    fireEvent.contextMenu(header, { clientX: 40, clientY: 20 });
    expect(screen.getByRole("menu", { name: "List options for Inbox" })).toBeTruthy();
    expect(menuActions()).toEqual(["rename", "edit-query", "unpin"]);
  });

  it("unpins by archiving the view document, never by deleting it", async () => {
    const wire = renderBoard([FRESH]);
    await row("doc_a");
    const header = document.querySelector<HTMLElement>(".col-head");
    if (header === null) throw new Error("no header");

    fireEvent.contextMenu(header, { clientX: 40, clientY: 20 });
    fireEvent.click(screen.getByRole("menuitem", { name: /Unpin/ }));

    await waitFor(() => {
      expect(wire.writes("PUT").filter((call) => call.path === "/api/docs/doc_view")).toHaveLength(
        1,
      );
    });
    expect(wire.writes("DELETE")).toHaveLength(0);
  });
});
