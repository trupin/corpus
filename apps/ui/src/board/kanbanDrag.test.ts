/** @vitest-environment jsdom */
import type { DocRow, Warning } from "@corpus/contract";
import { createCorpusTestHarness, docRowFixture } from "@corpus/kit/testing";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { boardTransport } from "../testing/boardFixture";
import type { Board, KanbanSpec } from "./boardDoc";
import { deriveStageColumns } from "./kanban";
import { changedFieldsMessage, dropStateFor, useKanbanDrag, type RowDrag } from "./kanbanDrag";
import type { BoardColumn } from "./viewDoc";

afterEach(cleanup);

const HOUSING: KanbanSpec = {
  field: "stage",
  stages: ["candidates", "visiting", "offer", "done"],
  transitions: {
    candidates: ["visiting"],
    visiting: ["offer", "candidates"],
    offer: ["done"],
    done: [],
  },
  status: { done: "resolved" },
};

const board = (kanban: KanbanSpec = HOUSING, overrides: Partial<Board> = {}): Board => ({
  id: "board_k",
  title: "House hunt",
  order: 1,
  columnIds: [],
  kanban,
  defaultOpen: false,
  query: { tag: "housing" },
  width: null,
  ...overrides,
});

const row = (overrides: Partial<DocRow> = {}): DocRow =>
  docRowFixture({ id: "doc_h", title: "Maple Street", stage: "candidates", ...overrides });

const dragEvent = (): { event: unknown; dropEffect: () => string } => {
  const transfer = { dropEffect: "" };
  return {
    event: {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: transfer,
    },
    dropEffect: () => transfer.dropEffect,
  };
};

function columnsOf(spec: KanbanSpec): readonly BoardColumn[] {
  return deriveStageColumns(board(spec));
}

describe("dropStateFor", () => {
  const columns = columnsOf(HOUSING);
  const at = (stage: string): BoardColumn =>
    columns.find((column) => column.title === stage) as BoardColumn;
  const drag: RowDrag = { row: row(), from: at("candidates").stage! };

  it("paints nothing at all while nothing is in flight", () => {
    expect(dropStateFor(HOUSING, null, at("visiting").stage!, null, at("visiting").id)).toBeNull();
  });

  it("paints nothing on the column the row came from", () => {
    expect(
      dropStateFor(HOUSING, drag, at("candidates").stage!, null, at("candidates").id),
    ).toBeNull();
  });

  it("outlines what the graph reaches and dims what it does not", () => {
    expect(dropStateFor(HOUSING, drag, at("visiting").stage!, null, at("visiting").id)).toBe(
      "can-drop",
    );
    expect(dropStateFor(HOUSING, drag, at("offer").stage!, null, at("offer").id)).toBe("no-drop");
    expect(dropStateFor(HOUSING, drag, at("done").stage!, null, at("done").id)).toBe("no-drop");
  });

  it("says which of the two the column under the pointer is", () => {
    const over = at("visiting");
    expect(dropStateFor(HOUSING, drag, over.stage!, over.id, over.id)).toBe("drop-over");
    const bad = at("offer");
    expect(dropStateFor(HOUSING, drag, bad.stage!, bad.id, bad.id)).toBe("drop-bad");
  });

  it("outlines both neighbours on a board with no transitions", () => {
    const funnel: KanbanSpec = { field: "stage", stages: ["a", "b", "c"] };
    const cols = columnsOf(funnel);
    const fromB: RowDrag = { row: row({ stage: "b" }), from: cols[1]!.stage! };
    expect(dropStateFor(funnel, fromB, cols[0]!.stage!, null, cols[0]!.id)).toBe("can-drop");
    expect(dropStateFor(funnel, fromB, cols[2]!.stage!, null, cols[2]!.id)).toBe("can-drop");
  });

  it("dims every column on a board whose `transitions` is `{}`", () => {
    const frozen: KanbanSpec = { field: "stage", stages: ["a", "b", "c"], transitions: {} };
    const cols = columnsOf(frozen);
    const fromB: RowDrag = { row: row({ stage: "b" }), from: cols[1]!.stage! };
    expect(dropStateFor(frozen, fromB, cols[0]!.stage!, null, cols[0]!.id)).toBe("no-drop");
    expect(dropStateFor(frozen, fromB, cols[2]!.stage!, null, cols[2]!.id)).toBe("no-drop");
  });
});

describe("changedFieldsMessage", () => {
  const after = (stage: string | null, status: string): never =>
    ({ stage, status }) as unknown as never;

  it("names both fields when the server wrote both", () => {
    const coupled: Warning[] = [{ code: "stage_status", detail: "…" }];
    expect(
      changedFieldsMessage(
        "Maple Street",
        { stage: "offer", status: "open" },
        after("done", "resolved"),
        coupled,
      ),
    ).toBe(
      "“Maple Street” — stage → done, status → resolved. One commit. " +
        "The board’s `kanban.status` map decided the status.",
    );
  });

  it("names one field when the server wrote one, and claims no coupling", () => {
    expect(
      changedFieldsMessage(
        "Maple Street",
        { stage: "candidates", status: "open" },
        after("visiting", "open"),
        [],
      ),
    ).toBe("“Maple Street” — stage → visiting. One commit.");
  });

  it("says a cleared stage is none", () => {
    expect(
      changedFieldsMessage(
        "Maple Street",
        { stage: "done", status: "open" },
        after(null, "open"),
        [],
      ),
    ).toBe("“Maple Street” — stage → none. One commit.");
  });

  it("claims nothing when the response moved nothing", () => {
    expect(
      changedFieldsMessage(
        "Maple Street",
        { stage: "done", status: "open" },
        after("done", "open"),
        [],
      ),
    ).toBe("“Maple Street” — nothing changed; it was already there.");
  });
});

interface Harness {
  readonly drag: ReturnType<typeof useKanbanDrag>;
  readonly wire: ReturnType<typeof boardTransport>;
  readonly notify: Mock;
  readonly columns: readonly BoardColumn[];
  readonly rerender: () => void;
}

function mount(spec: KanbanSpec = HOUSING): Harness {
  const wire = boardTransport();
  const harness = createCorpusTestHarness({ fetch: wire.fetch });
  const notify = vi.fn();
  const live = board(spec);
  const rendered = renderHook(() => useKanbanDrag({ board: live, notify }), {
    wrapper: harness.Wrapper,
  });
  return {
    get drag() {
      return rendered.result.current;
    },
    wire,
    notify,
    columns: deriveStageColumns(live),
    rerender: () => {
      rendered.rerender();
    },
  };
}

describe("useKanbanDrag", () => {
  const find = (columns: readonly BoardColumn[], stage: string): BoardColumn =>
    columns.find((column) => column.title === stage) as BoardColumn;

  it("writes `stage` ALONE on an accepted drop — the coupling is the server's", async () => {
    const h = mount();
    act(() => {
      h.drag.onRowDragStart(find(h.columns, "candidates"), row());
    });
    const { event } = dragEvent();
    act(() => {
      h.drag.onColumnDrop(find(h.columns, "visiting"), event as never);
    });

    await waitFor(() => {
      expect(h.wire.writes("PUT")).toHaveLength(1);
    });
    const put = h.wire.writes("PUT")[0];
    expect(put?.path).toBe("/api/docs/doc_h");
    expect(put?.body).toEqual({ stage: "visiting" });
    expect(Object.keys(put?.body as object)).not.toContain("status");
  });

  it("REFUSES a drop the graph does not draw — and sends nothing at all", async () => {
    const h = mount();
    act(() => {
      h.drag.onRowDragStart(find(h.columns, "candidates"), row());
    });
    const { event } = dragEvent();
    act(() => {
      h.drag.onColumnDrop(find(h.columns, "done"), event as never);
    });

    await waitFor(() => {
      expect(h.notify).toHaveBeenCalled();
    });
    expect(h.notify).toHaveBeenCalledWith({
      tone: "error",
      message:
        "“candidates” does not lead to “done” on this board. " +
        "Set stage in the document to override, or add the transition to the board.",
    });
    // The claim that matters: the restriction is this module's, so a refusal
    // that still wrote would be a refusal in name only.
    expect(h.wire.writes("PUT")).toHaveLength(0);
    expect(h.wire.writes("POST")).toHaveLength(0);
  });

  it("does nothing at all when dropped on the column it came from", async () => {
    const h = mount();
    act(() => {
      h.drag.onRowDragStart(find(h.columns, "visiting"), row({ stage: "visiting" }));
    });
    const { event } = dragEvent();
    act(() => {
      h.drag.onColumnDrop(find(h.columns, "visiting"), event as never);
    });
    await Promise.resolve();
    expect(h.notify).not.toHaveBeenCalled();
    expect(h.wire.writes("PUT")).toHaveLength(0);
  });

  it("refuses the drop effect over a column the graph does not reach", () => {
    const h = mount();
    act(() => {
      h.drag.onRowDragStart(find(h.columns, "candidates"), row());
    });
    const good = dragEvent();
    act(() => {
      h.drag.onColumnDragOver(find(h.columns, "visiting"), good.event as never);
    });
    expect(good.dropEffect()).toBe("move");

    const bad = dragEvent();
    act(() => {
      h.drag.onColumnDragOver(find(h.columns, "done"), bad.event as never);
    });
    expect(bad.dropEffect()).toBe("none");
  });

  it("lights the columns while a row is in flight, and clears on drag end", () => {
    const h = mount();
    expect(h.drag.dropStateOf(find(h.columns, "visiting"))).toBeNull();
    act(() => {
      h.drag.onRowDragStart(find(h.columns, "candidates"), row());
    });
    expect(h.drag.dropStateOf(find(h.columns, "visiting"))).toBe("can-drop");
    expect(h.drag.dropStateOf(find(h.columns, "done"))).toBe("no-drop");
    act(() => {
      h.drag.onRowDragEnd();
    });
    expect(h.drag.dropStateOf(find(h.columns, "visiting"))).toBeNull();
  });

  it("enters a status kanban's `archived` column through the archive route (UI-020)", async () => {
    const statuses: KanbanSpec = { field: "status", stages: ["open", "resolved", "archived"] };
    const h = mount(statuses);
    act(() => {
      h.drag.onRowDragStart(find(h.columns, "resolved"), row({ stage: null, status: "resolved" }));
    });
    const { event } = dragEvent();
    act(() => {
      h.drag.onColumnDrop(find(h.columns, "archived"), event as never);
    });

    await waitFor(() => {
      expect(h.wire.writes("POST")).toHaveLength(1);
    });
    expect(h.wire.writes("POST")[0]?.path).toBe("/api/docs/doc_h/archive");
    expect(h.wire.writes("PUT")).toHaveLength(0);
  });

  it("leaves it through the unarchive route, never through a `status` PUT", async () => {
    const statuses: KanbanSpec = { field: "status", stages: ["open", "resolved", "archived"] };
    const h = mount(statuses);
    act(() => {
      h.drag.onRowDragStart(find(h.columns, "archived"), row({ stage: null, status: "archived" }));
    });
    const { event } = dragEvent();
    act(() => {
      h.drag.onColumnDrop(find(h.columns, "resolved"), event as never);
    });

    await waitFor(() => {
      expect(h.wire.writes("POST")).toHaveLength(1);
    });
    expect(h.wire.writes("POST")[0]?.path).toBe("/api/docs/doc_h/unarchive");
  });

  it("writes an ordinary status through the field", async () => {
    const statuses: KanbanSpec = { field: "status", stages: ["open", "resolved", "archived"] };
    const h = mount(statuses);
    act(() => {
      h.drag.onRowDragStart(find(h.columns, "open"), row({ stage: null, status: "open" }));
    });
    const { event } = dragEvent();
    act(() => {
      h.drag.onColumnDrop(find(h.columns, "resolved"), event as never);
    });

    await waitFor(() => {
      expect(h.wire.writes("PUT")).toHaveLength(1);
    });
    expect(h.wire.writes("PUT")[0]?.body).toEqual({ status: "resolved" });
  });
});
