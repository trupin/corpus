/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { focusReplyComposer, replyRoot } from "./focusReply";

afterEach(() => {
  document.body.innerHTML = "";
});

function reader(inner: string, columnId = "one"): HTMLElement {
  const board = document.createElement("main");
  board.innerHTML = `<section class="col" data-col="${columnId}">
    <div class="reader" data-reader-column="${columnId}" data-reader-doc="doc_1">${inner}</div>
  </section>`;
  document.body.append(board);
  return board;
}

const collapsedSlot = (id: string) =>
  `<div class="thread-slot" data-slot-thread="${id}"><button class="t-chip">💬 2</button></div>`;

const expandedSlot = (id: string) =>
  `<div class="thread-slot expanded" data-slot-thread="${id}">
     <button class="t-chip">💬 2</button>
     <div class="thread-card"><input data-composer="${id}" /></div>
   </div>`;

describe("replyRoot", () => {
  it("is the active column's reader", () => {
    const board = reader(expandedSlot("thr_1"));
    expect(replyRoot(board, "one")?.getAttribute("data-reader-doc")).toBe("doc_1");
  });

  it("is focus mode whenever focus mode is up — that is the thread the user sees", () => {
    const board = reader(expandedSlot("thr_1"));
    const focus = document.createElement("div");
    focus.className = "focus open";
    focus.dataset["surface"] = "focus";
    document.body.append(focus);
    expect(replyRoot(board, "one")?.dataset["surface"]).toBe("focus");
  });

  it("is nothing when no column is active, or no reader is open there", () => {
    expect(replyRoot(null, "one")).toBeNull();
    expect(replyRoot(reader(""), null)).toBeNull();
    expect(replyRoot(reader("", "two"), "one")).toBeNull();
  });
});

describe("focusReplyComposer", () => {
  it("focuses the composer that is already on screen", () => {
    const board = reader(expandedSlot("thr_1"));
    const root = replyRoot(board, "one");
    expect(focusReplyComposer(root)).toBe("focused");
    expect(document.activeElement?.getAttribute("data-composer")).toBe("thr_1");
  });

  it("expands the first collapsed thread and focuses the composer it renders", () => {
    const board = reader(collapsedSlot("thr_1") + collapsedSlot("thr_2"));
    const root = replyRoot(board, "one") as HTMLElement;
    const chip = root.querySelector<HTMLElement>(".t-chip") as HTMLElement;
    // Standing in for React: the click expands the slot, then the composer exists.
    chip.addEventListener("click", () => {
      const composer = document.createElement("input");
      composer.setAttribute("data-composer", "thr_1");
      root.querySelector(".thread-slot")?.append(composer);
    });

    const run: (() => void)[] = [];
    expect(
      focusReplyComposer(root, (task) => {
        run.push(task);
      }),
    ).toBe("expanded");
    expect(document.activeElement?.getAttribute("data-composer")).not.toBe("thr_1");
    for (const task of run) task();
    expect(document.activeElement?.getAttribute("data-composer")).toBe("thr_1");
  });

  it("says so rather than doing nothing when the document has no threads", () => {
    expect(focusReplyComposer(replyRoot(reader(""), "one"))).toBe("none");
    expect(focusReplyComposer(null)).toBe("none");
  });

  it("defers with a real timer by default", () => {
    vi.useFakeTimers();
    try {
      const board = reader(collapsedSlot("thr_1"));
      const root = replyRoot(board, "one") as HTMLElement;
      expect(focusReplyComposer(root)).toBe("expanded");
      vi.runAllTimers();
    } finally {
      vi.useRealTimers();
    }
  });
});
