/** @vitest-environment jsdom */
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildRegistry, EMPTY_REGISTRY, setPluginRegistry } from "../plugins/registry";
import { resetSlotCache } from "../plugins/slots";
import { Board } from "../shell/Board";
import { ToastProvider } from "../shell/Toasts";
import { boardTransport, viewRow, type BoardTransport } from "../testing/boardFixture";
import { KeyboardHarness } from "../testing/keyboardHarness";
import { memoryStorage } from "../testing/memoryStorage";

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  resetSlotCache();
});

afterEach(() => {
  cleanup();
  setPluginRegistry(EMPTY_REGISTRY);
  resetSlotCache();
  vi.unstubAllGlobals();
});

function renderBoard(wire: BoardTransport): ReturnType<typeof render> {
  const harness = createCorpusTestHarness({ fetch: wire.fetch });
  function Wrapper({ children }: { readonly children?: ReactNode }): ReactElement {
    return (
      <harness.Wrapper>
        <ToastProvider>
          <KeyboardHarness>{children}</KeyboardHarness>
        </ToastProvider>
      </harness.Wrapper>
    );
  }
  return render(<Board />, { wrapper: Wrapper });
}

const pluginView = viewRow({
  id: "doc_pluginview",
  title: "Fixture board",
  column: "fx/board",
  query: {},
});

interface FxColumnProps {
  readonly title: string;
  readonly onOpen?: ((docId: string) => void) | undefined;
}

function installFx(): void {
  setPluginRegistry(
    buildRegistry([
      {
        dir: "fx",
        loaded: {
          module: {
            default: {
              id: "fx",
              name: "FX",
              docTypes: [],
              columns: [
                {
                  type: "board",
                  label: "FX board",
                  Component: ({ title, onOpen }: FxColumnProps) => (
                    <p data-fx-column="">
                      plugin body for {title}
                      <button
                        type="button"
                        onClick={() => {
                          onOpen?.("doc_target");
                        }}
                      >
                        open a document
                      </button>
                    </p>
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

describe("a plugin column on the board", () => {
  it("renders the registered Component as the column body", async () => {
    installFx();
    renderBoard(boardTransport({ views: [pluginView] }));
    await waitFor(() => {
      expect(screen.getByText("plugin body for Fixture board")).toBeTruthy();
    });
    // The column chrome is the board's: header present, like any column.
    expect(document.querySelector(".col[data-col='doc_pluginview'] .col-head")).toBeTruthy();
  });

  it("issues no GET /api/docs for the plugin column body", async () => {
    installFx();
    const wire = boardTransport({ views: [pluginView] });
    renderBoard(wire);
    await waitFor(() => {
      expect(screen.getByText(/plugin body/)).toBeTruthy();
    });
    // One /api/docs call: the pinned-views query itself. The plugin body owns
    // its own data path and must not cost a docs query it never renders.
    const docsCalls = wire.calls.filter(
      (call) => call.method === "GET" && call.path === "/api/docs",
    );
    expect(docsCalls).toHaveLength(1);
    expect(docsCalls[0]?.search).toContain("pinned");
  });

  /**
   * PR #10 finding 19, stated literally: a plugin column whose view document
   * carries **no `query` at all** compiles to an empty filter, and an empty
   * filter is `GET /api/docs` with nothing on it — the whole corpus, fetched
   * for a body that renders none of it.
   */
  it("issues no GET /api/docs when the view document has no query at all", async () => {
    installFx();
    const wire = boardTransport({
      views: [viewRow({ id: "doc_noquery", title: "No query", column: "fx/board", query: null })],
    });
    renderBoard(wire);
    await waitFor(() => {
      expect(screen.getByText("plugin body for No query")).toBeTruthy();
    });
    const docsCalls = wire.calls.filter(
      (call) => call.method === "GET" && call.path === "/api/docs",
    );
    expect(docsCalls).toHaveLength(1);
    expect(docsCalls[0]?.search).toContain("pinned");
  });

  /**
   * The `onOpen` seam (PLUGINS-002). A plugin column's body is the one board
   * surface that could not link a row to its source document: `apps/ui`
   * internals are lint-forbidden to plugins, so the board's own "push onto this
   * column's navigation stack" has to be handed *in*. Without it an aggregate
   * column — the todos column is the shipped case — renders rows nobody can
   * follow.
   */
  it("hands the plugin body the board's open-in-this-column callback", async () => {
    installFx();
    renderBoard(boardTransport({ views: [pluginView] }));
    await waitFor(() => {
      expect(screen.getByText(/plugin body/)).toBeTruthy();
    });
    // The column is on its list; opening a document pushes its reader.
    expect(document.querySelector(".col[data-col='doc_pluginview'].reading")).toBeNull();
    await act(async () => {
      screen.getByRole("button", { name: "open a document" }).click();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(document.querySelector(".col[data-col='doc_pluginview'].reading")).toBeTruthy();
    });
  });

  it("shows the plugin-missing card while keeping the column when unregistered", async () => {
    setPluginRegistry(EMPTY_REGISTRY);
    renderBoard(boardTransport({ views: [pluginView] }));
    await waitFor(() => {
      expect(screen.getByText("Plugin missing")).toBeTruthy();
    });
    const column = document.querySelector(".col[data-col='doc_pluginview']");
    expect(column).toBeTruthy();
    // Header and controls remain: the column is still reorderable/deletable.
    expect(column?.querySelector(".col-head")).toBeTruthy();
    expect(column?.querySelector(".col-menu")).toBeTruthy();
  });

  it("shows the same card for a registered plugin whose column type was renamed", async () => {
    installFx();
    renderBoard(
      boardTransport({
        views: [viewRow({ id: "doc_renamed", title: "Old type", column: "fx/legacy", query: {} })],
      }),
    );
    await waitFor(() => {
      expect(screen.getByText("Plugin missing")).toBeTruthy();
    });
  });
});
