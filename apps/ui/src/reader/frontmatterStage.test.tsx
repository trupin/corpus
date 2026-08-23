/** @vitest-environment jsdom */
import type { DocRow } from "@corpus/contract";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boardRow, boardTransport } from "../testing/boardFixture";
import { createBoardHarness } from "../testing/boardHarness";
import { memoryStorage } from "../testing/memoryStorage";
import { docFixture } from "../testing/readerFixture";
import { ContextMenuProvider } from "../menu/ContextMenuHost";
import { resetEscapeLayers } from "./useEscapeStack";
import { FrontmatterForm } from "./FrontmatterForm";

/**
 * The reader's stage chip (SPEC.md §10, rider 6: "anything the graph does not
 * allow is done by setting the field in the document" — moved onto the chip by
 * the 2026-08-23 rider, UI-162).
 *
 * Its own file, and under a **board** harness rather than the reader one: the
 * chip's whole subject is which kanbans claim this document, which is a fact
 * about the bar. `FrontmatterForm.test.tsx` mounts the form with no board
 * provider at all, which is the other half of the same rule — a workspace with
 * no kanban offers no stages, and the chip's menu is absent rather than empty.
 */

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  cleanup();
  resetEscapeLayers();
  vi.unstubAllGlobals();
});

const HOUSING: DocRow["kanban"] = {
  field: "stage",
  stages: ["candidates", "visiting", "offer"],
  status: { offer: "resolved" },
};

const DOC = docFixture({
  frontmatter: {
    id: "doc_h",
    title: "Maple Street",
    tags: ["housing"],
    status: "open",
    stage: "candidates",
  },
  path: "data/docs/finance/housing/maple.md",
});

interface Mounted {
  readonly wire: ReturnType<typeof boardTransport>;
  readonly notices: string[];
}

function mount(
  boards: readonly DocRow[],
  options: { readonly warnCoupled?: boolean } = {},
): Mounted {
  const wire = boardTransport({ boards });
  const notices: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const response = await wire.fetch(input, init);
    if (options.warnCoupled !== true) return response;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (method !== "PUT") return response;
    const payload = (await response.json()) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        ...payload,
        warnings: [
          {
            code: "stage_status",
            detail:
              "stage `offer` set status to `resolved`: this document is in the kanban " +
              "House hunt (b_house), whose `kanban.status` map decides a status on entry " +
              "(SPEC.md §5).",
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const harness = createBoardHarness(fetch);
  render(
    <ContextMenuProvider>
      <FrontmatterForm
        doc={DOC}
        selectTitle={false}
        onNotify={(notice) => notices.push(`${notice.tone}:${notice.message}`)}
      />
    </ContextMenuProvider>,
    { wrapper: harness.Wrapper },
  );
  return { wire, notices };
}

const stageChip = (): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>("button[data-chip='stage']");
const menuItem = (act: string): HTMLButtonElement =>
  document.querySelector(`[data-ctx-menu] [data-act='${act}']`) as HTMLButtonElement;

function openStageMenu(): void {
  const chip = stageChip();
  if (chip === null) throw new Error("no stage chip on the strip");
  fireEvent.click(chip);
}

/**
 * The bar's boards arrive a request later than the form does, and the chip is
 * already a control before they do — a held stage alone offers Clear plus
 * itself. The menu snapshots its items when it opens, so the only honest way
 * to wait for the vocabulary is to open, look, and close until it is there.
 *
 * A plain polled loop, **not** `waitFor`: this probe mutates the DOM (a menu
 * opens and closes), and `waitFor` re-runs its callback on every mutation —
 * a self-feeding microtask loop that starves its own timeout timer. Measured:
 * one worker pinned at ~90% CPU, forever.
 */
async function whenBoardsOffer(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (stageChip() !== null) {
      openStageMenu();
      const groups = document.querySelectorAll("[data-ctx-menu] .fm-menu-group").length;
      fireEvent.keyDown(document, { key: "Escape" });
      if (groups > 0) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("the boards never offered a stage vocabulary");
}

describe("the stage chip", () => {
  it("offers every stage of every kanban that claims the document, under its board's name", async () => {
    mount([
      boardRow({ id: "b_house", title: "House hunt", kanban: HOUSING, query: { tag: "housing" } }),
    ]);
    await whenBoardsOffer();
    expect(stageChip()?.textContent).toBe("stage: candidates");

    openStageMenu();
    const groups = [...document.querySelectorAll("[data-ctx-menu] .fm-menu-group")].map(
      (group) => group.textContent,
    );
    expect(groups).toEqual(["House hunt"]);
    const items = [...document.querySelectorAll("[data-ctx-menu] [role='menuitem']")].map((item) =>
      item.getAttribute("data-act"),
    );
    expect(items).toEqual(["stage:clear", "stage:candidates", "stage:visiting", "stage:offer"]);
    // The current word is marked — the strip and the menu read one value.
    expect(menuItem("stage:candidates").textContent).toContain("✓ candidates");
  });

  it("is absent when no kanban over `stage` claims the document", async () => {
    const wire = boardTransport({
      boards: [
        boardRow({ id: "b_other", title: "Elsewhere", kanban: HOUSING, query: { tag: "tax" } }),
      ],
    });
    const harness = createBoardHarness(wire.fetch);
    render(
      <ContextMenuProvider>
        <FrontmatterForm
          doc={docFixture({ frontmatter: { ...DOC.frontmatter, stage: null }, path: DOC.path })}
          selectTitle={false}
          onNotify={() => undefined}
        />
      </ContextMenuProvider>,
      { wrapper: harness.Wrapper },
    );
    await waitFor(() => {
      expect(wire.calls.some((call) => call.search.includes("type=board"))).toBe(true);
    });
    expect(stageChip()).toBeNull();
    expect(screen.queryByText(/^stage:/)).toBeNull();
  });

  it("writes the stage ALONE — never a status the coupling owns", async () => {
    const { wire } = mount([
      boardRow({ id: "b_house", title: "House hunt", kanban: HOUSING, query: { tag: "housing" } }),
    ]);
    await whenBoardsOffer();
    openStageMenu();
    fireEvent.click(menuItem("stage:offer"));

    await waitFor(() => {
      expect(wire.writes("PUT")).toHaveLength(1);
    });
    expect(wire.writes("PUT")[0]?.body).toEqual({ stage: "offer" });
  });

  it("clears the stage with an explicit `null`, which omission could never mean", async () => {
    const { wire } = mount([
      boardRow({ id: "b_house", title: "House hunt", kanban: HOUSING, query: { tag: "housing" } }),
    ]);
    await whenBoardsOffer();
    openStageMenu();
    fireEvent.click(menuItem("stage:clear"));

    await waitFor(() => {
      expect(wire.writes("PUT")).toHaveLength(1);
    });
    expect(wire.writes("PUT")[0]?.body).toEqual({ stage: null });
  });

  it("reports the status the server coupled, in the server's own words", async () => {
    const { notices } = mount(
      [
        boardRow({
          id: "b_house",
          title: "House hunt",
          kanban: HOUSING,
          query: { tag: "housing" },
        }),
      ],
      { warnCoupled: true },
    );
    await whenBoardsOffer();
    openStageMenu();
    fireEvent.click(menuItem("stage:offer"));

    await waitFor(() => {
      expect(notices.some((notice) => notice.includes("stage `offer` set status to"))).toBe(true);
    });
    expect(notices.some((notice) => notice.includes("House hunt (b_house)"))).toBe(true);
  });

  it("says nothing about a coupling when the server reported none", async () => {
    const { wire, notices } = mount([
      boardRow({ id: "b_house", title: "House hunt", kanban: HOUSING, query: { tag: "housing" } }),
    ]);
    await whenBoardsOffer();
    openStageMenu();
    fireEvent.click(menuItem("stage:visiting"));

    await waitFor(() => {
      expect(wire.writes("PUT")).toHaveLength(1);
    });
    expect(notices).toEqual([]);
  });

  it("shows a stage no board draws rather than marking nothing over it", async () => {
    const wire = boardTransport({
      boards: [
        boardRow({
          id: "b_house",
          title: "House hunt",
          kanban: HOUSING,
          query: { tag: "housing" },
        }),
      ],
    });
    const harness = createBoardHarness(wire.fetch);
    render(
      <ContextMenuProvider>
        <FrontmatterForm
          doc={docFixture({
            frontmatter: { ...DOC.frontmatter, stage: "gazumped" },
            path: DOC.path,
          })}
          selectTitle={false}
          onNotify={() => undefined}
        />
      </ContextMenuProvider>,
      { wrapper: harness.Wrapper },
    );
    await whenBoardsOffer();
    expect(stageChip()?.textContent).toBe("stage: gazumped");
    openStageMenu();
    expect(menuItem("stage:gazumped").textContent).toContain("✓ gazumped");
    expect(menuItem("stage:gazumped").textContent).toContain("no board draws this");
  });
});
