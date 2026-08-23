/** @vitest-environment jsdom */
import type { DocRow, FolderNode } from "@corpus/contract";
import {
  createCorpusTestHarness,
  docRowFixture,
  type CorpusTestHarness,
} from "@corpus/kit/testing";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStorage } from "../testing/memoryStorage";
import { Shell } from "../shell/Shell";
import { EXPLORER_STORAGE_KEY } from "./useExplorerLayout";

/**
 * The explorer, in the shell it lives in (SPEC.md §10, rider 1).
 *
 * Rendered through `<Shell />` rather than in isolation, and deliberately: the
 * acts under test are *between* components — a click in the tree writes a path
 * into the board's browser-local strip, and the mark the tree then draws is read
 * back out of it. A test that mocked the board would assert that the tree calls
 * a function, and the rule it exists to protect ("the next explorer click
 * replaces the preview") lives on the other side of that call.
 */

let harness: CorpusTestHarness | undefined;

interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly search: string;
  readonly body: unknown;
}

const BOARD_ID = "doc_board_files";

function folder(path: string, count: number, children: readonly FolderNode[] = []): FolderNode {
  return {
    path,
    name: path.split("/").at(-1) ?? path,
    count,
    totalCount: count + children.reduce((sum, child) => sum + child.totalCount, 0),
    children,
  };
}

function row(id: string, title: string, extra: Partial<DocRow> = {}): DocRow {
  return docRowFixture({ id, title, path: `data/docs/finance/${id}.md`, ...extra });
}

/**
 * A column on the board, so it really holds **rows**: the keyboard assertion
 * below claims the tree's arrows do not move the board's row cursor, and a
 * board with no rows would make that claim vacuous.
 */
const FINANCE_VIEW = docRowFixture({
  id: "doc_view_finance",
  type: "view",
  title: "Finance",
  path: "data/docs/views/finance.md",
  query: { folder: "finance" },
});

const NOTE_A = row("doc_alpha", "Alpha note");
const NOTE_B = row("doc_beta", "Beta note");
const NOTE_C = row("doc_gamma", "Gamma note", { status: "archived" });

interface Fixture {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: Recorded[];
}

/**
 * One board carrying `default-open` and no columns — the Files board of the
 * seed, which is what the explorer opens onto.
 */
function fixture(
  options: {
    readonly folders?: readonly FolderNode[];
    readonly docs?: Readonly<Record<string, readonly DocRow[]>>;
    /** `page.total` per folder, when it is larger than the rows returned. */
    readonly totals?: Readonly<Record<string, number>>;
  } = {},
): Fixture {
  const calls: Recorded[] = [];
  const folders = options.folders ?? [folder("finance", 3)];
  const docs = options.docs ?? { finance: [NOTE_A, NOTE_B, NOTE_C] };

  const json = (payload: unknown, status = 200): Response =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });

  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const raw = await request.text();
    calls.push({
      method: request.method,
      path: url.pathname,
      search: url.search,
      body: raw === "" ? undefined : (JSON.parse(raw) as unknown),
    });

    if (url.pathname === "/api/tree") return json({ folders });
    if (url.pathname === "/api/docs" && request.method === "GET") {
      const type = url.searchParams.get("type");
      if (type === "board") {
        return json({
          items: [
            docRowFixture({
              id: BOARD_ID,
              type: "board",
              title: "Files",
              path: `data/docs/boards/${BOARD_ID}.md`,
              order: 1,
              columns: [FINANCE_VIEW.id],
              defaultOpen: true,
            }),
          ],
          page: { total: 1, limit: 50, offset: 0 },
        });
      }
      if (type === "view") {
        return json({
          items: [FINANCE_VIEW],
          page: { total: 1, limit: 50, offset: 0 },
        });
      }
      const wanted = url.searchParams.get("folder");
      const items = wanted === null ? [] : (docs[wanted] ?? []);
      return json({
        items,
        page: { total: options.totals?.[wanted ?? ""] ?? items.length, limit: 100, offset: 0 },
      });
    }
    if (url.pathname.startsWith("/api/docs/")) {
      const id = url.pathname.split("/").at(-1) ?? "";
      return json({
        frontmatter: { ...docRowFixture({ id, title: id }), anchors: {} },
        body: "",
        path: `data/docs/finance/${id}.md`,
        anchors: [],
      });
    }
    if (url.pathname === "/api/folders/rename") {
      return json({
        documents: [{ id: "doc_alpha", path: "data/docs/triage/a.md" }],
        warnings: [],
      });
    }
    if (url.pathname === "/api/queue/status") {
      return json({
        agent: { live: false, since: null },
        halted: false,
        pending: 0,
        inProgress: 0,
        deferred: 0,
        processed: 0,
        failed: 0,
        abandoned: 0,
      });
    }
    if (url.pathname === "/api/agents") {
      return json({
        agents: [
          {
            lane: "orchestrator",
            resident: null,
            live: false,
            since: null,
            summary: null,
            origin: null,
          },
        ],
      });
    }
    if (url.pathname === "/api/workspace/reflect") {
      return json({
        reflected: "2026-08-01T09:00:00.000Z",
        pending: null,
        changed: 0,
        lastDigest: null,
        quiet: 30,
      });
    }
    if (url.pathname === "/api/jobs") return json({ jobs: [] });
    if (url.pathname === "/api/index/status") {
      return json({
        indexed: 0,
        pending: 0,
        failed: 0,
        identity: "none",
        rebuilding: false,
        state: "current",
      });
    }
    return json({});
  };

  return { fetch, calls };
}

/** Renders the shell with the explorer already open, and expands `finance/`. */
async function openTree(fixtureOf: Fixture): Promise<ReturnType<typeof userEvent.setup>> {
  vi.stubGlobal(
    "localStorage",
    memoryStorage({
      [EXPLORER_STORAGE_KEY]: JSON.stringify({ version: 1, open: true, width: 260, expanded: [] }),
    }),
  );
  harness = createCorpusTestHarness({ fetch: fixtureOf.fetch });
  render(<Shell />, { wrapper: harness.Wrapper });
  const user = userEvent.setup();
  await screen.findByRole("treeitem", { name: /finance/ });
  return user;
}

const treeRow = (id: string): HTMLElement =>
  document.querySelector<HTMLElement>(`[data-tree-doc="${id}"]`) as HTMLElement;

/**
 * Waits for a **tree** row, by its data attribute.
 *
 * Not `findByText`: the board's own column lists the same documents, so a text
 * query matches twice and would as happily be satisfied by the column as by the
 * tree — which is the assertion inverted.
 */
async function treeRowAppears(id: string): Promise<HTMLElement> {
  await waitFor(() => {
    expect(treeRow(id)).not.toBeNull();
  });
  return treeRow(id);
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  cleanup();
  harness?.queryClient.clear();
  harness = undefined;
  vi.unstubAllGlobals();
});

describe("the tree", () => {
  it("lists a folder's documents on expand, and asks for them bounded and archived-inclusive", async () => {
    const wire = fixture();
    const user = await openTree(wire);

    await user.click(screen.getByRole("treeitem", { name: /finance/ }));
    await treeRowAppears("doc_alpha");

    // `includeArchived=true` is what tells the tree's listing apart from the
    // board column's over the same folder: the explorer is the one list that
    // includes archived documents (rider 1).
    const listing = wire.calls.find(
      (call) =>
        call.path === "/api/docs" &&
        call.search.includes("folder=finance") &&
        call.search.includes("includeArchived=true"),
    );
    expect(listing).toBeDefined();
    expect(listing?.search).toContain("limit=100");
  });

  it("keeps an archived document in the tree, marked", async () => {
    const user = await openTree(fixture());
    await user.click(screen.getByRole("treeitem", { name: /finance/ }));
    await treeRowAppears("doc_gamma");

    const gamma = treeRow("doc_gamma");
    expect(gamma.className).toContain("archived");
    expect(within(gamma).getByText("archived")).toBeDefined();
    expect(gamma.title).toContain("archived");
  });

  it("says so when the listing reached its bound rather than ending quietly", async () => {
    const user = await openTree(fixture({ totals: { finance: 900 } }));
    await user.click(screen.getByRole("treeitem", { name: /finance/ }));
    expect(await screen.findByText("3 of 900 — the listing reached its bound")).toBeDefined();
  });

  it("issues no folder listing at all until a folder is expanded", async () => {
    const wire = fixture();
    await openTree(wire);
    await waitFor(() => {
      expect(wire.calls.some((call) => call.path === "/api/tree")).toBe(true);
    });
    expect(
      wire.calls.some(
        (call) =>
          call.search.includes("folder=finance") && call.search.includes("includeArchived=true"),
      ),
    ).toBe(false);
  });
});

describe("opening (riders 1 and 3)", () => {
  async function expanded(): Promise<ReturnType<typeof userEvent.setup>> {
    const user = await openTree(fixture());
    await user.click(screen.getByRole("treeitem", { name: /finance/ }));
    await treeRowAppears("doc_alpha");
    return user;
  }

  it("opens a preview path at the left edge and marks its origin row", async () => {
    const user = await expanded();
    await user.click(treeRow("doc_alpha"));

    await waitFor(() => {
      expect(document.querySelectorAll(".pcol")).toHaveLength(1);
    });
    expect(treeRow("doc_alpha").className).toContain("origin");
  });

  it("replaces the preview on the next click rather than opening a second path", async () => {
    const user = await expanded();
    await user.click(treeRow("doc_alpha"));
    await waitFor(() => {
      expect(document.querySelectorAll(".pcol")).toHaveLength(1);
    });

    await user.click(treeRow("doc_beta"));
    await waitFor(() => {
      expect(treeRow("doc_beta").className).toContain("origin");
    });
    expect(document.querySelectorAll(".pcol")).toHaveLength(1);
    expect(treeRow("doc_alpha").className).not.toContain("origin");
  });

  it("keeps the path on a double click, so the next click opens a second one", async () => {
    const user = await expanded();
    await user.dblClick(treeRow("doc_alpha"));
    await waitFor(() => {
      expect(document.querySelectorAll(".pcol")).toHaveLength(1);
    });
    // Kept means detached: no row is the explorer's origin any more.
    await waitFor(() => {
      expect(treeRow("doc_alpha").className).not.toContain("origin");
    });

    await user.click(treeRow("doc_beta"));
    await waitFor(() => {
      expect(document.querySelectorAll(".pcol")).toHaveLength(2);
    });
  });
});

describe("the keyboard inside the tree", () => {
  it("moves with ↑/↓, opens on ↵, and keeps on ⌥↵", async () => {
    const user = await openTree(fixture());
    const folderRow = screen.getByRole("treeitem", { name: /finance/ });
    folderRow.focus();

    // `→` on a closed folder opens it rather than moving.
    await user.keyboard("{ArrowRight}");
    await treeRowAppears("doc_alpha");
    expect(folderRow.getAttribute("aria-expanded")).toBe("true");

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(treeRow("doc_alpha"));

    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(treeRow("doc_alpha").className).toContain("origin");
    });

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(treeRow("doc_beta"));
    await user.keyboard("{Alt>}{Enter}{/Alt}");
    /*
     * "Keep" turns the **preview** into the kept path rather than adding one:
     * the preview was transient, and `⌥↵` is a statement about where this open
     * lands, not a request for a second column. What it buys is the next line —
     * the following pick opens a new preview beside it instead of replacing it.
     */
    await waitFor(() => {
      expect(document.querySelector(".tr.origin")).toBeNull();
    });
    expect(document.querySelectorAll(".pcol")).toHaveLength(1);

    await user.click(treeRow("doc_alpha"));
    await waitFor(() => {
      expect(document.querySelectorAll(".pcol")).toHaveLength(2);
    });
    expect(treeRow("doc_alpha").className).toContain("origin");
  });

  it("collapses with ← on an open folder, and climbs from a document row", async () => {
    const user = await openTree(fixture());
    const folderRow = screen.getByRole("treeitem", { name: /finance/ });
    folderRow.focus();
    await user.keyboard("{ArrowRight}");
    await treeRowAppears("doc_alpha");

    await user.keyboard("{ArrowDown}{ArrowLeft}");
    expect(document.activeElement).toBe(screen.getByRole("treeitem", { name: /finance/ }));

    await user.keyboard("{ArrowLeft}");
    await waitFor(() => {
      expect(treeRow("doc_alpha")).toBeNull();
    });
  });

  /**
   * The board's own `↑`/`↓` must not also fire: the tree declares
   * `data-shortcuts="off"`, and the row cursor in a column nobody is looking at
   * would otherwise move under every keystroke here.
   */
  it("does not move the board's row cursor", async () => {
    const user = await openTree(fixture());
    // The board holds a column of rows, so the absence below is a fact about
    // rows rather than about an empty board.
    await waitFor(() => {
      expect(document.querySelector(".col-list .row[data-row-doc]")).not.toBeNull();
    });
    screen.getByRole("treeitem", { name: /finance/ }).focus();
    /*
     * `j`, not `↓`. The tree calls `preventDefault()` on the arrows and the
     * registry skips a prevented event, so an arrow-key assertion here would
     * pass against a tree that had never declared `data-shortcuts="off"`. `j`
     * is a board binding the tree does not handle at all.
     */
    await user.keyboard("jj");
    expect(document.querySelector(".row.kbd")).toBeNull();
  });
});

describe("the document menu", () => {
  it("names the board its plain Open lands on, and offers keeping the path", async () => {
    const user = await openTree(fixture());
    await user.click(screen.getByRole("treeitem", { name: /finance/ }));
    await treeRowAppears("doc_alpha");

    await user.pointer({ target: treeRow("doc_alpha"), keys: "[MouseRight]" });

    // The default-open board by name, not a bare "Open": the tree opens
    // somewhere specific, and rider 2 says which.
    expect(await screen.findByRole("menuitem", { name: /Open in Files/ })).toBeDefined();
    expect(screen.getByRole("menuitem", { name: /Open and keep/ })).toBeDefined();
    // "Open here" means "in this column's reader", and the tree is not a column.
    expect(screen.queryByRole("menuitem", { name: /Open here/ })).toBeNull();
  });
});

describe("the folder menu", () => {
  it("renames the last segment and posts both whole paths, unchanged", async () => {
    const wire = fixture({ folders: [folder("Inbox", 0)] });
    vi.stubGlobal(
      "localStorage",
      memoryStorage({
        [EXPLORER_STORAGE_KEY]: JSON.stringify({
          version: 1,
          open: true,
          width: 260,
          expanded: [],
        }),
      }),
    );
    harness = createCorpusTestHarness({ fetch: wire.fetch });
    render(<Shell />, { wrapper: harness.Wrapper });
    const user = userEvent.setup();

    const node = await screen.findByRole("treeitem", { name: /Inbox/ });
    await user.pointer({ target: node, keys: "[MouseRight]" });
    await user.click(await screen.findByRole("menuitem", { name: /Rename folder/ }));

    const field = await screen.findByLabelText("Rename Inbox");
    await user.clear(field);
    await user.type(field, "triage{Enter}");

    await waitFor(() => {
      expect(wire.calls.some((call) => call.path === "/api/folders/rename")).toBe(true);
    });
    const rename = wire.calls.find((call) => call.path === "/api/folders/rename");
    // Not lower-cased, not trimmed of its parent: the server compares exactly.
    expect(rename?.body).toEqual({ from: "Inbox", to: "triage" });
  });
});
