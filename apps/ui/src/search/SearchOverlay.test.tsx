/** @vitest-environment jsdom */
import { createCorpusTestHarness, docRowFixture } from "@corpus/kit/testing";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMemo, type ReactElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BoardNavigationProvider,
  useRegisterBoardNavigation,
  type BoardNavigation,
} from "../board/openInColumn";
import { ToastProvider } from "../shell/Toasts";
import { boardTransport, type RecordedCall } from "../testing/boardFixture";
import { SearchOverlay } from "./SearchOverlay";

afterEach(cleanup);

const ROWS = [
  docRowFixture({
    id: "doc_mortgage",
    title: "Mortgage options",
    path: "data/docs/finance/housing/mortgage.md",
    snippets: [
      {
        field: "body",
        segments: [
          { text: "…the ", match: false },
          { text: "mortgage", match: true },
          { text: " insurance question…", match: false },
        ],
      },
    ],
  }),
  docRowFixture({
    id: "th_rate",
    type: "thread",
    title: "Rate assumption",
    path: "data/threads/th_rate.md",
    parent: "doc_mortgage",
    parentTitle: "Mortgage options",
    turnCount: 4,
  }),
];

interface Handlers {
  readonly open: ReturnType<typeof vi.fn>;
  readonly revealColumn: ReturnType<typeof vi.fn>;
}

function FakeBoard({ handlers }: { readonly handlers: Handlers }): ReactElement {
  const navigation = useMemo<BoardNavigation>(
    () => ({ open: handlers.open, revealColumn: handlers.revealColumn }),
    [handlers],
  );
  useRegisterBoardNavigation(navigation);
  return <div />;
}

function renderOverlay(
  options: { readonly rows?: readonly ReturnType<typeof docRowFixture>[] } = {},
) {
  const wire = boardTransport({ defaultRows: options.rows ?? ROWS, tree: { folders: [] } });
  const harness = createCorpusTestHarness({ fetch: wire.fetch });
  const onClose = vi.fn();
  const handlers: Handlers = { open: vi.fn(), revealColumn: vi.fn() };

  function Wrapper({ children }: { readonly children?: ReactNode }): ReactElement {
    return (
      <harness.Wrapper>
        <ToastProvider>
          <BoardNavigationProvider>
            <FakeBoard handlers={handlers} />
            {children}
          </BoardNavigationProvider>
        </ToastProvider>
      </harness.Wrapper>
    );
  }

  const view = render(<SearchOverlay onClose={onClose} />, { wrapper: Wrapper });
  /**
   * Searches only. The board's pinned-view query shares `/api/docs` and is
   * excluded: `useSaveAsView` reads the column set through `useColumns`, which
   * in the running app is the very query the board already holds — same key,
   * same cache entry, no extra request.
   */
  const searches = (): RecordedCall[] =>
    wire.calls.filter(
      (call) =>
        call.method === "GET" && call.path === "/api/docs" && !call.search.includes("pinned=true"),
    );
  return { ...view, onClose, handlers, wire, searches };
}

const results = async (): Promise<HTMLElement> =>
  waitFor(() => screen.getByRole("listbox", { name: "Search results" }));

describe("the overlay's chrome", () => {
  it("is a dialog over a scrim, with the query input inside the panel", () => {
    const { container } = renderOverlay();
    const overlay = container.querySelector(".overlay.open");
    expect(overlay).not.toBeNull();

    const panel = screen.getByRole("dialog", { name: "Search" });
    expect(panel.classList.contains("search-panel")).toBe(true);
    expect(panel.getAttribute("aria-modal")).toBe("true");
    expect(panel.querySelector(".search-input-row input")).not.toBeNull();
  });

  it("puts focus in the query input as it opens", async () => {
    renderOverlay();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText("Search query"));
    });
  });

  it("carries the save-as-view ghost chip beside the input", () => {
    const { container } = renderOverlay();
    const chip = container.querySelector(".search-input-row .chip.ghost");
    expect(chip?.textContent).toBe("save as view");
  });

  it("renders the prototype's footer legend", () => {
    const { container } = renderOverlay();
    const hints = [...container.querySelectorAll(".search-foot .hint")].map(
      (node) => node.textContent,
    );
    expect(hints).toEqual([
      "↑↓ navigate",
      "↵ open in its list",
      "⇧↵ new list from search",
      "@ agents · / skills · [[ refs",
    ]);
    expect(container.querySelector(".search-foot .right")?.textContent).toBe(
      "@ agents · / skills · [[ refs",
    );
  });

  it("closes on Escape and on a scrim click, but not on a click inside the panel", async () => {
    const user = userEvent.setup();
    const { container, onClose } = renderOverlay();

    // Focus opens in the input, so Escape reaches the panel's handler.
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("dialog", { name: "Search" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(container.querySelector<HTMLElement>(".overlay")!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("keeps Tab inside the panel", async () => {
    const user = userEvent.setup();
    const { container } = renderOverlay();
    await results();
    await waitFor(() => {
      expect(container.querySelectorAll(".sr[data-sr]").length).toBe(2);
    });

    const panel = screen.getByRole("dialog", { name: "Search" });
    const focusable = (): HTMLElement[] => [
      ...panel.querySelectorAll<HTMLElement>("button, input"),
    ];

    focusable()[focusable().length - 1]?.focus();
    await user.tab();
    expect(panel.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(focusable()[0]);

    await user.tab({ shift: true });
    expect(panel.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(focusable()[focusable().length - 1]);
  });
});

describe("searching", () => {
  it("renders the one response, grouped, with its highlights", async () => {
    const { container } = renderOverlay();
    await results();

    await waitFor(() => {
      expect([...container.querySelectorAll(".sr-group")].map((n) => n.textContent)).toEqual([
        "Documents · 1",
        "Threads · 1",
      ]);
    });
    expect(container.querySelector(".sr-snippet mark")?.textContent).toBe("mortgage");
  });

  it("issues one request per query and never a second one for the Threads group", async () => {
    const user = userEvent.setup();
    const { searches } = renderOverlay();
    await waitFor(() => {
      expect(searches().length).toBe(1);
    });

    await user.type(screen.getByLabelText("Search query"), "mortgage");
    await waitFor(() => {
      expect(searches().length).toBe(2);
    });
    expect(searches()[1]?.search).toContain("q=mortgage");
  });

  it("passes `[[`, `@` and `/` through as literal query text with no autocomplete", async () => {
    const user = userEvent.setup();
    const { container, searches } = renderOverlay();
    const input = screen.getByLabelText<HTMLInputElement>("Search query");

    // Pasted rather than typed: `[` and `{` are userEvent's own key syntax, and
    // the point of this test is the characters, not the typing.
    await user.click(input);
    await user.paste("[[ref]] @agent /skill");
    expect(input.value).toBe("[[ref]] @agent /skill");
    expect(container.querySelector(".ac-menu")).toBeNull();

    await waitFor(() => {
      expect(searches().length).toBeGreaterThan(1);
    });
    const last = searches()[searches().length - 1]?.search ?? "";
    expect(new URLSearchParams(last).get("q")).toBe("[[ref]] @agent /skill");
  });

  it("toggles a chip into the query with one further request", async () => {
    const user = userEvent.setup();
    const { searches } = renderOverlay();
    await waitFor(() => {
      expect(searches().length).toBe(1);
    });

    await user.click(screen.getByRole("button", { name: "unread" }));
    await waitFor(() => {
      expect(searches().length).toBe(2);
    });
    expect(new URLSearchParams(searches()[1]?.search).get("unread")).toBe("true");
    expect(screen.getByRole("button", { name: "unread" }).className).toContain("on");
  });

  it("sends `includeArchived`, never `status=archived`, for the archived chip", async () => {
    const user = userEvent.setup();
    const { container, searches } = renderOverlay();
    await waitFor(() => {
      expect(searches().length).toBe(1);
    });

    const chip = screen.getByRole("button", { name: "include archived" });
    expect(chip.className).toContain("warn");
    await user.click(chip);

    await waitFor(() => {
      expect(searches().length).toBe(2);
    });
    const params = new URLSearchParams(searches()[1]?.search);
    expect(params.get("includeArchived")).toBe("true");
    expect(params.has("status")).toBe(false);
    expect(container.querySelector(".chip.warn.on")).not.toBeNull();
  });

  it("offers documents from the result set to the `references:` picker", async () => {
    const user = userEvent.setup();
    const { searches } = renderOverlay();
    await results();
    await waitFor(() => {
      expect(searches().length).toBe(1);
    });

    await user.click(screen.getByRole("button", { name: "references: …" }));
    const menu = screen.getByRole("menu", { name: "Pick a document for references" });
    // Documents only — a thread is not something you reference by id here.
    expect(within(menu).getByRole("menuitem", { name: /Mortgage options/ })).toBeDefined();
    expect(within(menu).queryByRole("menuitem", { name: /Rate assumption/ })).toBeNull();

    await user.click(within(menu).getByRole("menuitem", { name: /Mortgage options/ }));
    await waitFor(() => {
      expect(searches().length).toBe(2);
    });
    expect(new URLSearchParams(searches()[1]?.search).get("references")).toBe("doc_mortgage");
  });
});

describe("the keyboard", () => {
  it("moves one cursor with ↑↓ and clamps at both ends", async () => {
    const user = userEvent.setup();
    const { container } = renderOverlay();
    await results();
    await waitFor(() => {
      expect(container.querySelectorAll(".sr[data-sr]").length).toBe(2);
    });

    await user.keyboard("{ArrowDown}");
    expect(container.querySelectorAll(".sr.kbd").length).toBe(1);
    expect(container.querySelector<HTMLElement>(".sr.kbd")?.dataset["sr"]).toBe("doc_mortgage");

    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(container.querySelector<HTMLElement>(".sr.kbd")?.dataset["sr"]).toBe("th_rate");

    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(container.querySelector<HTMLElement>(".sr.kbd")?.dataset["sr"]).toBe("doc_mortgage");
  });

  it("opens the highlighted result in its home column and closes", async () => {
    const user = userEvent.setup();
    const { handlers, onClose } = renderOverlay();
    await results();

    await user.keyboard("{ArrowDown}{Enter}");

    expect(onClose).toHaveBeenCalled();
    expect(handlers.open).toHaveBeenCalledWith({
      docId: "doc_mortgage",
      subject: { folder: "finance/housing", type: "note", status: "open" },
    });
  });

  it("opens the first result when ↵ is pressed with no cursor", async () => {
    const user = userEvent.setup();
    const { container, handlers } = renderOverlay();
    await results();
    await waitFor(() => {
      expect(container.querySelectorAll(".sr[data-sr]").length).toBe(2);
    });

    await user.keyboard("{Enter}");
    expect(handlers.open.mock.calls[0]?.[0]).toMatchObject({ docId: "doc_mortgage" });
  });

  it("⇧↵ pins the search — the same POST the chip issues", async () => {
    const user = userEvent.setup();
    const { wire, handlers } = renderOverlay();
    await results();
    await user.type(screen.getByLabelText("Search query"), "mortgage");

    await user.keyboard("{Shift>}{Enter}{/Shift}");

    await waitFor(() => {
      expect(wire.writes("POST").length).toBe(1);
    });
    const fromKeyboard = wire.writes("POST")[0]?.body;
    expect(fromKeyboard).toMatchObject({
      type: "view",
      pinned: true,
      title: "mortgage",
      query: { q: "mortgage", sort: "relevance" },
    });
    await waitFor(() => {
      expect(handlers.revealColumn).toHaveBeenCalledWith("doc_created");
    });

    // And the chip's body is identical.
    cleanup();
    const chipRun = renderOverlay();
    await results();
    await user.type(screen.getByLabelText("Search query"), "mortgage");
    await user.click(screen.getByRole("button", { name: "save as view" }));
    await waitFor(() => {
      expect(chipRun.wire.writes("POST").length).toBe(1);
    });
    expect(chipRun.wire.writes("POST")[0]?.body).toEqual(fromKeyboard);
  });
});

describe("the create row", () => {
  it("appears only for a query of two or more characters that names nothing", async () => {
    const user = userEvent.setup();
    const { container } = renderOverlay();
    const input = screen.getByLabelText("Search query");
    await results();

    await user.type(input, "m");
    await waitFor(() => {
      expect(container.querySelector(".sr-create")).toBeNull();
    });

    await user.type(input, "ortgage optionz");
    await waitFor(() => {
      expect(container.querySelector(".sr-create")?.textContent).toBe(
        '＋ Create "mortgage optionz" — opens ready to edit, in inbox/',
      );
    });
  });

  it("stays hidden when a returned row already carries the title, whatever its case", async () => {
    const user = userEvent.setup();
    const { container, searches } = renderOverlay();
    await results();

    await user.type(screen.getByLabelText("Search query"), "MORTGAGE OPTIONS");
    await waitFor(() => {
      expect(searches().length).toBe(2);
    });
    expect(container.querySelector(".sr-create")).toBeNull();
    // Exact-title detection cost no extra request.
    expect(searches().length).toBe(2);
  });

  it("creates into inbox and opens the new document with its title selected", async () => {
    const user = userEvent.setup();
    const { container, wire, handlers, onClose } = renderOverlay({ rows: [] });
    await results();

    await user.type(screen.getByLabelText("Search query"), "a new thought");
    await waitFor(() => {
      expect(container.querySelector(".sr-create")).not.toBeNull();
    });
    await user.click(container.querySelector<HTMLElement>(".sr-create")!);

    await waitFor(() => {
      expect(wire.writes("POST").length).toBe(1);
    });
    // No folder: the server's own inbox default is not restated by the client.
    expect(wire.writes("POST")[0]?.body).toEqual({ type: "note", title: "a new thought" });
    expect(onClose).toHaveBeenCalled();
    await waitFor(() => {
      expect(handlers.open).toHaveBeenCalledWith({
        docId: "doc_created",
        subject: { folder: "inbox", type: "note", status: "open" },
        selectTitle: true,
      });
    });
    expect(screen.getByRole("status").textContent).toContain("Created “a new thought”");
  });

  it("is the only row, and the cursor's first stop, when nothing matched", async () => {
    const user = userEvent.setup();
    const { container } = renderOverlay({ rows: [] });
    await results();
    await user.type(screen.getByLabelText("Search query"), "nothing here");

    await waitFor(() => {
      expect(container.querySelectorAll(".sr").length).toBe(1);
    });
    await user.keyboard("{ArrowDown}");
    expect(container.querySelector(".sr.kbd")?.classList.contains("sr-create")).toBe(true);
  });
});

describe("failures", () => {
  it("keeps the overlay open and adds no column when the save is refused", async () => {
    const user = userEvent.setup();
    const wire = boardTransport({ defaultRows: ROWS, failing: { "/api/docs": 500 } });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const onClose = vi.fn();
    const handlers: Handlers = { open: vi.fn(), revealColumn: vi.fn() };

    render(<SearchOverlay onClose={onClose} />, {
      wrapper: ({ children }) => (
        <harness.Wrapper>
          <ToastProvider>
            <BoardNavigationProvider>
              <FakeBoard handlers={handlers} />
              {children}
            </BoardNavigationProvider>
          </ToastProvider>
        </harness.Wrapper>
      ),
    });

    await user.click(screen.getByRole("button", { name: "save as view" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("Save as view failed");
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(handlers.revealColumn).not.toHaveBeenCalled();
  });
});
