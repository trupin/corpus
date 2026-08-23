/** @vitest-environment jsdom */
import type { DocRow } from "@corpus/contract";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boardRow, boardTransport } from "../testing/boardFixture";
import { createBoardHarness } from "../testing/boardHarness";
import { memoryStorage } from "../testing/memoryStorage";
import { docFixture } from "../testing/readerFixture";
import { FrontmatterForm } from "./FrontmatterForm";

/**
 * The reader's `stage ▾` control (SPEC.md §10, rider 6: "anything the graph does
 * not allow is done by setting the field in the document").
 *
 * Its own file, and under a **board** harness rather than the reader one: the
 * control's whole subject is which kanbans claim this document, which is a fact
 * about the bar. `FrontmatterForm.test.tsx` mounts the form with no board
 * provider at all, which is the other half of the same rule — a workspace with
 * no kanban offers no stages, and the control is absent rather than empty.
 */

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  cleanup();
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
    <FrontmatterForm
      doc={DOC}
      selectTitle={false}
      onNotify={(notice) => notices.push(`${notice.tone}:${notice.message}`)}
    />,
    { wrapper: harness.Wrapper },
  );
  return { wire, notices };
}

const stageControl = (): HTMLSelectElement => screen.getByRole("combobox", { name: /stage/i });

/** The bar's boards arrive a request later than the form does. */
async function whenBoardsArrive(): Promise<void> {
  await waitFor(() => {
    expect(stageControl().querySelectorAll("optgroup").length).toBeGreaterThan(0);
  });
}

describe("the stage control", () => {
  it("offers every stage of every kanban that claims the document, under its board's name", async () => {
    mount([
      boardRow({ id: "b_house", title: "House hunt", kanban: HOUSING, query: { tag: "housing" } }),
    ]);
    await whenBoardsArrive();
    const labels = [...stageControl().querySelectorAll("optgroup")].map((group) => group.label);
    expect(labels).toEqual(["House hunt"]);
    const options = [...stageControl().options].map((option) => option.value);
    expect(options).toEqual(["", "candidates", "visiting", "offer"]);
    expect(screen.getByRole("option", { name: "Clear the stage" })).toBeTruthy();
  });

  it("is absent when no kanban over `stage` claims the document", async () => {
    const wire = boardTransport({
      boards: [
        boardRow({ id: "b_other", title: "Elsewhere", kanban: HOUSING, query: { tag: "tax" } }),
      ],
    });
    const harness = createBoardHarness(wire.fetch);
    render(
      <FrontmatterForm
        doc={docFixture({ frontmatter: { ...DOC.frontmatter, stage: null }, path: DOC.path })}
        selectTitle={false}
        onNotify={() => undefined}
      />,
      { wrapper: harness.Wrapper },
    );
    await waitFor(() => {
      expect(wire.calls.some((call) => call.search.includes("type=board"))).toBe(true);
    });
    expect(screen.queryByRole("combobox", { name: /stage/i })).toBeNull();
  });

  it("writes the stage ALONE — never a status the coupling owns", async () => {
    const { wire } = mount([
      boardRow({ id: "b_house", title: "House hunt", kanban: HOUSING, query: { tag: "housing" } }),
    ]);
    await whenBoardsArrive();
    fireEvent.change(stageControl(), { target: { value: "offer" } });

    await waitFor(() => {
      expect(wire.writes("PUT")).toHaveLength(1);
    });
    expect(wire.writes("PUT")[0]?.body).toEqual({ stage: "offer" });
  });

  it("clears the stage with an explicit `null`, which omission could never mean", async () => {
    const { wire } = mount([
      boardRow({ id: "b_house", title: "House hunt", kanban: HOUSING, query: { tag: "housing" } }),
    ]);
    await whenBoardsArrive();
    fireEvent.change(stageControl(), { target: { value: "" } });

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
    await whenBoardsArrive();
    fireEvent.change(stageControl(), { target: { value: "offer" } });

    await waitFor(() => {
      expect(notices.some((notice) => notice.includes("stage `offer` set status to"))).toBe(true);
    });
    expect(notices.some((notice) => notice.includes("House hunt (b_house)"))).toBe(true);
  });

  it("says nothing about a coupling when the server reported none", async () => {
    const { wire, notices } = mount([
      boardRow({ id: "b_house", title: "House hunt", kanban: HOUSING, query: { tag: "housing" } }),
    ]);
    await whenBoardsArrive();
    fireEvent.change(stageControl(), { target: { value: "visiting" } });

    await waitFor(() => {
      expect(wire.writes("PUT")).toHaveLength(1);
    });
    expect(notices).toEqual([]);
  });

  it("shows a stage no board draws rather than rendering blank over it", async () => {
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
      <FrontmatterForm
        doc={docFixture({
          frontmatter: { ...DOC.frontmatter, stage: "gazumped" },
          path: DOC.path,
        })}
        selectTitle={false}
        onNotify={() => undefined}
      />,
      { wrapper: harness.Wrapper },
    );
    await whenBoardsArrive();
    expect(stageControl().value).toBe("gazumped");
    expect(screen.getByRole("option", { name: "gazumped (no board draws this)" })).toBeTruthy();
  });
});
