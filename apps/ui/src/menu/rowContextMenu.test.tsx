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

function renderColumns(
  views: readonly ReturnType<typeof viewRow>[],
  rows: readonly ReturnType<typeof docRowFixture>[],
): BoardTransport {
  const wire = boardTransport({ views, defaultRows: rows });
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

function renderBoard(rows: readonly ReturnType<typeof docRowFixture>[]): BoardTransport {
  return renderColumns([VIEW], rows);
}

/**
 * A plugin owning `type`'s row (the PLUGINS-001 `ListItem` seam) — a *core*
 * column's row, painted by plugin code. UI-036: this is not a plugin-rendered
 * surface, and the core menu must reach it.
 */
function installListItemFor(type: string): void {
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
                  type,
                  ListItem: ({
                    row: item,
                  }: {
                    readonly row: { readonly id: string; readonly title: string };
                  }) => (
                    // `.row-title` and the row dataset are what a `ListItem`
                    // owes the board — the shipped `TodoListItem` carries both,
                    // and the ⇧F10 path reads the subject back off them.
                    <div
                      className="row"
                      data-row-doc={item.id}
                      data-row-type={type}
                      data-row-status="open"
                    >
                      <span className="row-title">{item.title}</span> plugin row
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
}

const PLUGIN_VIEW = viewRow({
  id: "doc_pluginview",
  title: "Fixture board",
  order: 20,
  column: "fx/board",
  query: {},
});

/** The id the fixture column body paints a row for — its own invention. */
const PLUGIN_ROW_ID = "doc_plugin_row";

/**
 * A plugin **column body**: everything below it is the plugin's own surface,
 * which is what sign-off item 4 excludes. It paints a row-shaped node on
 * purpose — the shape core's own cursor and menu look for — so the exclusion is
 * proved against the hardest case rather than an obviously foreign one.
 */
function installFxColumn(): void {
  setPluginRegistry(
    buildRegistry([
      {
        dir: "fx",
        loaded: {
          module: {
            default: {
              id: "fx",
              name: "Fixture",
              docTypes: [],
              columns: [
                {
                  type: "board",
                  label: "FX board",
                  Component: () => (
                    <div
                      className="row"
                      data-row-doc={PLUGIN_ROW_ID}
                      data-row-type="note"
                      data-row-status="open"
                    >
                      <span className="row-title">Plugin body row</span>
                    </div>
                  ),
                },
              ],
            },
          },
        },
      },
    ]),
  );
}

function renderPluginColumn(): BoardTransport {
  return renderColumns([PLUGIN_VIEW], []);
}

async function pluginRow(): Promise<HTMLElement> {
  return waitFor(() => {
    const element = document.querySelector<HTMLElement>(`.row[data-row-doc="${PLUGIN_ROW_ID}"]`);
    if (element === null) throw new Error("no plugin column row");
    return element;
  });
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
    // `resolve` is in the row set since UI-094: SPEC.md §5's statuses are one
    // vocabulary, so a note's set is a thread's set.
    expect(menuActions()).toEqual(["open", "open-focus", "resolve", "archive", "delete"]);
  });

  it("keeps resolve on a thread row, which is now the same set a note offers", async () => {
    renderBoard([THREAD]);
    fireEvent.contextMenu(await row("th_1"), { clientX: 40, clientY: 60 });
    expect(menuActions()).toEqual(["open", "open-focus", "resolve", "archive", "delete"]);
  });

  it("shows the staleness quick actions only where the ramp already shows them", async () => {
    renderBoard([FRESH, STALE]);

    fireEvent.contextMenu(await row("doc_a"), { clientX: 10, clientY: 10 });
    expect(menuActions()).not.toContain("review");
    expect(menuActions()).not.toContain("triage");
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.contextMenu(await row("doc_c"), { clientX: 10, clientY: 10 });
    expect(menuActions()).toEqual([
      "open",
      "open-focus",
      "review",
      "resolve",
      "triage",
      "archive",
      "delete",
    ]);
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

  /**
   * UI-036. The v1 exclusion (sign-off item 4) is about surfaces a **plugin
   * renders**; it used to be asked of the row's **type**, so registering a
   * `ListItem` cost that document type its whole core action set in every
   * column on the board — no open, no archive, no delete, no staleness. A
   * `todo` document is a core subject and `RowMenuItems` needs nothing from the
   * plugin: the subject is the `DocRow` core already holds.
   */
  it("gives a core row the core menu even when a plugin ListItem paints it", async () => {
    installListItemFor("note");
    renderBoard([FRESH]);

    const painted = await row("doc_a");
    expect(painted.textContent).toContain("plugin row");

    fireEvent.contextMenu(painted, { clientX: 40, clientY: 60 });
    expect(screen.getByRole("menu", { name: "Actions for Mortgage options" })).toBeTruthy();
    expect(menuActions()).toEqual(["open", "open-focus", "resolve", "archive", "delete"]);
  });

  it("acts on the document, not on the plugin — the menu archives through the core route", async () => {
    installListItemFor("note");
    const wire = renderBoard([FRESH]);

    fireEvent.contextMenu(await row("doc_a"), { clientX: 40, clientY: 60 });
    fireEvent.click(screen.getByRole("menuitem", { name: /Archive/ }));

    await waitFor(() => {
      expect(wire.writes("POST")).toHaveLength(1);
    });
    expect(wire.writes("POST")[0]?.path).toBe("/api/docs/doc_a/archive");
  });

  /**
   * The negative the signed rule still owns: rows a **plugin column body**
   * renders are the plugin's own surface, and core declines to half-populate a
   * menu over them.
   */
  it("leaves a plugin column body's own rows to the browser (v1 scope)", async () => {
    installFxColumn();
    renderPluginColumn();
    const painted = await pluginRow();

    fireEvent.contextMenu(painted, { clientX: 40, clientY: 60 });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(painted.closest("[data-plugin-surface]")).not.toBeNull();
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

  /** UI-036, the keyboard half: ⇧F10 keys on the surface, not on the type. */
  it("opens the core menu on a row a plugin ListItem painted", async () => {
    installListItemFor("note");
    renderBoard([FRESH]);
    await row("doc_a");
    fireEvent.keyDown(document, { key: "ArrowDown" });

    fireEvent.keyDown(document, { key: "F10", shiftKey: true });

    const menu = screen.getByRole("menu", { name: "Actions for Mortgage options" });
    expect(document.activeElement).toBe(within(menu).getAllByRole("menuitem")[0]);
  });

  it("opens nothing on a plugin column body's row, whose surface is the plugin's", async () => {
    installFxColumn();
    const wire = renderPluginColumn();
    const painted = await pluginRow();
    fireEvent.mouseOver(painted);
    fireEvent.keyDown(document, { key: "ArrowDown" });

    fireEvent.keyDown(document, { key: "F10", shiftKey: true });
    expect(screen.queryByRole("menu")).toBeNull();

    // And the cursor really was on that row — `e` acts on it — so the silence
    // above is the exclusion doing its job, not a cursor that never moved.
    fireEvent.keyDown(document, { key: "e" });
    await waitFor(() => {
      expect(wire.writes("POST")).toHaveLength(1);
    });
    expect(wire.writes("POST")[0]?.path).toBe(`/api/docs/${PLUGIN_ROW_ID}/archive`);
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
