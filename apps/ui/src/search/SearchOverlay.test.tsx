/** @vitest-environment jsdom */
import { createCorpusTestHarness } from "@corpus/kit/testing";
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
import { SearchOverlay } from "./SearchOverlay";
import { hitFixture, searchTransport, type SearchTransportOptions } from "./searchTransport";

afterEach(cleanup);

const HITS = [
  hitFixture({
    id: "doc_mortgage",
    title: "Mortgage options",
    headingPath: "Mortgage options › Rate assumptions",
    snippet: "the base case assumes a 30-year fixed; the mortgage insurance question",
  }),
  hitFixture({
    id: "th_rate",
    title: "Rate assumption",
    headingPath: "user · 2026-07-19T10:05:00Z",
    snippet: "is 6.1% the right base case?",
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

function renderOverlay(options: SearchTransportOptions = {}) {
  const wire = searchTransport({
    hits: HITS,
    tree: { folders: [] },
    docs: { doc_mortgage: { path: "data/docs/finance/housing/mortgage.md" } },
    ...options,
  });
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
  return { ...view, onClose, handlers, wire, searches: wire.searches };
}

const results = async (): Promise<HTMLElement> =>
  waitFor(() => screen.getByRole("listbox", { name: "Search results" }));

/** Types a query and waits for its ranking to land. */
async function search(user: ReturnType<typeof userEvent.setup>, text: string): Promise<void> {
  await user.type(screen.getByLabelText("Search query"), text);
  await waitFor(() => {
    expect(document.querySelectorAll(".sr[data-sr]").length).toBeGreaterThan(0);
  });
}

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

  it("carries all twelve chips, unchanged in count and in composition", () => {
    const { container } = renderOverlay();
    const chips = [...container.querySelectorAll(".search-filters .chip")].map(
      (node) => node.textContent,
    );
    expect(chips).toEqual([
      "type: any",
      "status: any",
      "folder: any",
      "tag: any",
      "due: any",
      "updated: any",
      "unread",
      "needs: form",
      "agent: any",
      "references: …",
      "parent: …",
      "include archived",
    ]);
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
    await search(user, "mortgage");
    expect(container.querySelectorAll(".sr[data-sr]").length).toBe(2);

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
  it("asks nothing until something is typed, and says so", async () => {
    const { container, searches } = renderOverlay();
    await results();
    expect(searches().length).toBe(0);
    expect(container.querySelector(".sr-empty")?.textContent).toBe(
      "Type to search — documents, threads and turns, ranked.",
    );
  });

  it("renders the one ranking, grouped, with its highlights and its addresses", async () => {
    const user = userEvent.setup();
    const { container } = renderOverlay();
    await results();
    await search(user, "mortgage");

    expect([...container.querySelectorAll(".sr-group")].map((n) => n.textContent)).toEqual([
      "Documents · 1",
      "Threads · 1",
    ]);
    expect(container.querySelector(".sr-snippet mark")?.textContent).toBe("mortgage");
    expect(
      container.querySelector<HTMLElement>(".sr[data-sr='doc_mortgage'] .sr-path")?.textContent,
    ).toBe("Mortgage options › Rate assumptions");
  });

  it("issues one ranked request per query and never a second one for the Threads group", async () => {
    const user = userEvent.setup();
    const { searches } = renderOverlay();
    await results();

    await search(user, "mortgage");
    expect(searches().length).toBe(1);
    expect(searches()[0]?.path).toBe("/api/search");
    expect(new URLSearchParams(searches()[0]?.search).get("q")).toBe("mortgage");
    expect(new URLSearchParams(searches()[0]?.search).has("sort")).toBe(false);
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
      expect(searches().length).toBeGreaterThan(0);
    });
    const last = searches()[searches().length - 1]?.search ?? "";
    expect(new URLSearchParams(last).get("q")).toBe("[[ref]] @agent /skill");
  });

  it("toggles a chip into the query with one further request", async () => {
    const user = userEvent.setup();
    const { searches } = renderOverlay();
    await search(user, "mortgage");
    expect(searches().length).toBe(1);

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
    await search(user, "mortgage");
    expect(searches().length).toBe(1);

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

  it("offers documents from the ranking to the `references:` picker", async () => {
    const user = userEvent.setup();
    const { searches } = renderOverlay();
    await search(user, "mortgage");
    expect(searches().length).toBe(1);

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

describe("the degraded-ranking note", () => {
  const noteText = (): string | undefined =>
    document.querySelector(".search-note")?.textContent ?? undefined;

  it("stays silent while ranking is current", async () => {
    const user = userEvent.setup();
    renderOverlay({ semanticIndex: "current" });
    await search(user, "mortgage");
    expect(noteText()).toBeUndefined();
  });

  it("stays silent when the server makes no claim at all", async () => {
    const user = userEvent.setup();
    renderOverlay();
    await search(user, "mortgage");
    expect(noteText()).toBeUndefined();
  });

  it("shows one quiet line while the index is catching up", async () => {
    const user = userEvent.setup();
    renderOverlay({ semanticIndex: "indexing" });
    await search(user, "mortgage");
    await waitFor(() => {
      expect(noteText()).toBe("Ranked on text alone — the semantic index is still being built.");
    });
    expect(document.querySelectorAll(".search-note").length).toBe(1);
  });

  it("shows it for `stale` and for `disabled` too", async () => {
    const user = userEvent.setup();
    renderOverlay({ semanticIndex: "stale" });
    await search(user, "mortgage");
    await waitFor(() => {
      expect(noteText()).toContain("some documents are not in the semantic index yet");
    });

    cleanup();
    const off = userEvent.setup();
    renderOverlay({ semanticIndex: "disabled" });
    await search(off, "mortgage");
    await waitFor(() => {
      expect(noteText()).toContain("no semantic index is configured");
    });
  });
});

describe("the keyboard", () => {
  it("moves one cursor with ↑↓ and clamps at both ends", async () => {
    const user = userEvent.setup();
    const { container } = renderOverlay();
    await search(user, "mortgage options");
    expect(container.querySelectorAll(".sr[data-sr]").length).toBe(2);

    await user.keyboard("{ArrowDown}");
    expect(container.querySelectorAll(".sr.kbd").length).toBe(1);
    expect(container.querySelector<HTMLElement>(".sr.kbd")?.dataset["sr"]).toBe("doc_mortgage");

    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(container.querySelector<HTMLElement>(".sr.kbd")?.dataset["sr"]).toBe("th_rate");

    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(container.querySelector<HTMLElement>(".sr.kbd")?.dataset["sr"]).toBe("doc_mortgage");
  });

  it("opens the highlighted hit in its home column and closes", async () => {
    const user = userEvent.setup();
    const { handlers, onClose } = renderOverlay();
    await search(user, "mortgage options");

    await user.keyboard("{ArrowDown}{Enter}");

    expect(onClose).toHaveBeenCalled();
    /*
     * A hit carries no folder, type or status, so the overlay reads the
     * document — through the reader's own `["docs", id]` cache entry — and hands
     * `resolveColumn` the same subject a board row would have.
     */
    await waitFor(() => {
      expect(handlers.open).toHaveBeenCalledWith({
        docId: "doc_mortgage",
        subject: { folder: "finance/housing", type: "note", status: "open" },
      });
    });
  });

  it("still opens the document when the placement read is refused", async () => {
    const user = userEvent.setup();
    const { handlers } = renderOverlay({ failing: { "/api/docs/doc_mortgage": 500 } });
    await search(user, "mortgage options");

    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => {
      expect(handlers.open).toHaveBeenCalledWith({ docId: "doc_mortgage", subject: null });
    });
  });

  it("opens the first result when ↵ is pressed with no cursor", async () => {
    const user = userEvent.setup();
    const { container, handlers } = renderOverlay();
    await search(user, "mortgage options");
    expect(container.querySelectorAll(".sr[data-sr]").length).toBe(2);

    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(handlers.open.mock.calls[0]?.[0]).toMatchObject({ docId: "doc_mortgage" });
    });
  });

  /**
   * The save-as-view regression (sprint-022 TEST-1022/1024). The view document
   * this writes is a `GET /api/docs` query — `sort: relevance` included — and it
   * is byte-identical to the one the pre-change overlay wrote for the same
   * search, because `toApiParams`/`toViewFrontmatter` never moved.
   */
  it("⇧↵ pins the search as the same `GET /api/docs` view document it always did", async () => {
    const user = userEvent.setup();
    const { wire, handlers } = renderOverlay();
    await search(user, "mortgage");

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
    const chipUser = userEvent.setup();
    await search(chipUser, "mortgage");
    await chipUser.click(screen.getByRole("button", { name: "save as view" }));
    await waitFor(() => {
      expect(chipRun.wire.writes("POST").length).toBe(1);
    });
    expect(chipRun.wire.writes("POST")[0]?.body).toEqual(fromKeyboard);
  });

  it("pins a chip-only search even though nothing was ranked — a view is a list", async () => {
    const user = userEvent.setup();
    const { wire, searches } = renderOverlay();
    await results();

    await user.click(screen.getByRole("button", { name: "unread" }));
    await user.click(screen.getByRole("button", { name: "save as view" }));

    await waitFor(() => {
      expect(wire.writes("POST").length).toBe(1);
    });
    expect(wire.writes("POST")[0]?.body).toMatchObject({
      type: "view",
      pinned: true,
      query: { unread: "true" },
    });
    // …and it cost no ranked request, because there was no `q` to rank.
    expect(searches().length).toBe(0);
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

  it("stays hidden when a returned hit already carries the title, whatever its case", async () => {
    const user = userEvent.setup();
    const { container, searches } = renderOverlay();
    await results();

    await user.type(screen.getByLabelText("Search query"), "MORTGAGE OPTIONS");
    await waitFor(() => {
      expect(searches().length).toBe(1);
    });
    await waitFor(() => {
      expect(container.querySelectorAll(".sr[data-sr]").length).toBe(2);
    });
    expect(container.querySelector(".sr-create")).toBeNull();
    // Exact-title detection cost no extra request.
    expect(searches().length).toBe(1);
  });

  it("creates into inbox and opens the new document with its title selected", async () => {
    const user = userEvent.setup();
    const { container, wire, handlers, onClose } = renderOverlay({ hits: [] });
    await results();

    await user.type(screen.getByLabelText("Search query"), "a new thought");
    await waitFor(() => {
      expect(container.querySelector(".sr-create")).not.toBeNull();
    });
    await user.click(container.querySelector<HTMLElement>(".sr-create")!);

    await waitFor(() => {
      expect(wire.writes("POST").length).toBe(1);
    });
    // The create row's copy promises the inbox, so the request names it.
    expect(wire.writes("POST")[0]?.body).toEqual({
      type: "note",
      title: "a new thought",
      folder: "inbox",
    });
    expect(onClose).toHaveBeenCalled();
    await waitFor(() => {
      expect(handlers.open).toHaveBeenCalledWith({
        docId: "doc_created",
        subject: { folder: "inbox", type: "note", status: "open" },
        selectTitle: true,
      });
    });
    // The toast surface is an `aria-live` region, not a `role="status"` element:
    // the console strip owns that role (see `Toasts.tsx`).
    expect(document.querySelector(".toast")?.textContent).toContain("Created “a new thought”");
  });

  it("is the only row, and the cursor's first stop, when nothing matched", async () => {
    const user = userEvent.setup();
    const { container } = renderOverlay({ hits: [] });
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
  it("shows a refused ranking without emptying the panel", async () => {
    const user = userEvent.setup();
    renderOverlay({ searchFails: 400 });
    await results();

    await user.type(screen.getByLabelText("Search query"), "boom");
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("no such filter");
    });
  });

  it("keeps the overlay open and adds no column when the save is refused", async () => {
    const user = userEvent.setup();
    const { onClose, handlers } = renderOverlay({ failing: { "/api/docs": 500 } });

    await user.click(screen.getByRole("button", { name: "save as view" }));

    await waitFor(() => {
      expect(document.querySelector(".toast")?.textContent).toContain("Save as view failed");
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(handlers.revealColumn).not.toHaveBeenCalled();
  });
});
