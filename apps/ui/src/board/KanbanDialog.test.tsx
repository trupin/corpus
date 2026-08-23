/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEscapeLayers } from "../reader/useEscapeStack";
import type { KanbanSpec } from "./boardDoc";
import { KanbanDialog, type KanbanDialogSubmit } from "./KanbanDialog";

afterEach(() => {
  cleanup();
  resetEscapeLayers();
});

function open(
  mode: "create" | "stages" | "transitions",
  kanban: KanbanSpec | null = null,
): { submitted: KanbanDialogSubmit[]; closed: () => number } {
  const submitted: KanbanDialogSubmit[] = [];
  const onClose = vi.fn();
  render(
    <KanbanDialog
      mode={mode}
      kanban={kanban}
      onSubmit={(result) => submitted.push(result)}
      onClose={onClose}
    />,
  );
  return { submitted, closed: () => onClose.mock.calls.length };
}

const field = (label: RegExp): HTMLInputElement => screen.getByLabelText(label);

const save = (): void => {
  fireEvent.click(screen.getByRole("button", { name: /Create the board|Save/ }));
};

describe("creating a kanban", () => {
  it("asks the prototype's four questions in one form, not four prompts", () => {
    open("create");
    expect(field(/Board title/)).toBeTruthy();
    expect(field(/Stages, in funnel order/)).toBeTruthy();
    expect(field(/Transitions/)).toBeTruthy();
    expect(field(/Scope/)).toBeTruthy();
  });

  it("writes NO `transitions` key for a blank line — blank is the linear funnel", () => {
    const { submitted } = open("create");
    fireEvent.change(field(/Board title/), { target: { value: "Tax season" } });
    fireEvent.change(field(/Stages, in funnel order/), { target: { value: "gather, file, paid" } });
    save();

    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.kanban).toEqual({ field: "stage", stages: ["gather", "file", "paid"] });
    expect(Object.hasOwn(submitted[0]?.kanban ?? {}, "transitions")).toBe(false);
  });

  it("writes exactly the graph the line names", () => {
    const { submitted } = open("create");
    fireEvent.change(field(/Board title/), { target: { value: "Tax season" } });
    fireEvent.change(field(/Stages, in funnel order/), { target: { value: "a, b, c" } });
    fireEvent.change(field(/Transitions/), { target: { value: "a > b; b > c, a" } });
    save();

    expect(submitted[0]?.kanban.transitions).toEqual({ a: ["b"], b: ["c", "a"], c: [] });
  });

  it("compiles the scope line, and takes blank as everything", () => {
    const { submitted } = open("create");
    fireEvent.change(field(/Board title/), { target: { value: "Tax season" } });
    fireEvent.change(field(/Scope/), { target: { value: "folder: finance" } });
    save();
    expect(submitted[0]?.query).toEqual({ folder: "finance" });

    cleanup();
    const bare = open("create");
    fireEvent.change(field(/Board title/), { target: { value: "Everything" } });
    save();
    expect(bare.submitted[0]?.query).toEqual({});
  });

  it("refuses a board with no title and one with no stages, and submits neither", () => {
    const { submitted } = open("create");
    fireEvent.change(field(/Stages, in funnel order/), { target: { value: "a, b" } });
    save();
    expect(submitted).toHaveLength(0);
    expect(screen.getByRole("alert").textContent).toContain("A board needs a title");

    fireEvent.change(field(/Board title/), { target: { value: "Tax" } });
    fireEvent.change(field(/Stages, in funnel order/), { target: { value: "  ,  " } });
    save();
    expect(submitted).toHaveLength(0);
    expect(screen.getByRole("alert").textContent).toContain("at least one stage");
  });
});

describe("editing a board's kanban", () => {
  const HOUSING: KanbanSpec = {
    field: "stage",
    stages: ["candidates", "offer"],
    transitions: { candidates: ["offer"], offer: [] },
    status: { offer: "resolved" },
  };

  it("asks only about the stages in `stages` mode, and keeps the graph and the map", () => {
    const { submitted } = open("stages", HOUSING);
    expect(screen.queryByLabelText(/Board title/)).toBeNull();
    expect(screen.queryByLabelText(/Transitions/)).toBeNull();
    expect(field(/Stages, in funnel order/).value).toBe("candidates, offer");

    fireEvent.change(field(/Stages, in funnel order/), {
      target: { value: "candidates, visiting, offer" },
    });
    save();
    // The graph is re-parsed against the **new** stage list, so a stage added
    // here gets a key of its own: the contract refuses a `transitions` map whose
    // keys are not all in `stages`, and a graph missing a declared stage would
    // be a stage the drawn picture cannot place.
    expect(submitted[0]?.kanban).toEqual({
      field: "stage",
      stages: ["candidates", "visiting", "offer"],
      transitions: { candidates: ["offer"], visiting: [], offer: [] },
      status: { offer: "resolved" },
    });
  });

  it("asks only about the transitions in `transitions` mode, pre-filled", () => {
    open("transitions", HOUSING);
    expect(screen.queryByLabelText(/Stages, in funnel order/)).toBeNull();
    expect(field(/Transitions/).value).toBe("candidates > offer; offer > ");
  });

  it("drops a status the removed stage carried, which the contract would refuse", () => {
    const { submitted } = open("stages", HOUSING);
    fireEvent.change(field(/Stages, in funnel order/), { target: { value: "candidates" } });
    save();
    expect(submitted[0]?.kanban).toEqual({
      field: "stage",
      stages: ["candidates"],
      transitions: { candidates: [] },
    });
  });

  it("never repoints a board at another field", () => {
    const statuses: KanbanSpec = { field: "status", stages: ["open", "resolved"] };
    const { submitted } = open("stages", statuses);
    save();
    expect(submitted[0]?.kanban.field).toBe("status");
  });

  it("closes on Escape without writing", () => {
    const { submitted, closed } = open("stages", HOUSING);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(closed()).toBe(1);
    expect(submitted).toHaveLength(0);
  });
});
