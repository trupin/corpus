/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RevealTarget } from "@corpus/kit/plugin";
import {
  captureScrollAt,
  clearRevealAt,
  dropMissing,
  popEntry,
  pushEntry,
  useMemoryNavStack,
  type NavEntry,
} from "./useNavStack";

afterEach(cleanup);

const A: NavEntry = { docId: "doc_a", scrollY: 0 };
const ITEM: RevealTarget = { kind: "item", exact: "Call the plumber" };

describe("pushEntry", () => {
  it("writes the live scroll onto the entry being left, and starts the new one at 0", () => {
    expect(pushEntry([A], "doc_b", 420)).toEqual([
      { docId: "doc_a", scrollY: 420 },
      { docId: "doc_b", scrollY: 0 },
    ]);
  });

  it("pushes onto an empty stack without inventing a previous entry", () => {
    expect(pushEntry([], "doc_a", 99)).toEqual([{ docId: "doc_a", scrollY: 0 }]);
  });

  /** A `[[thisDoc]]` ref: de-duplicating it into a no-op strands the user. */
  it("pushes a self-referential ref like any other", () => {
    expect(pushEntry([{ docId: "doc_a", scrollY: 0 }], "doc_a", 120)).toEqual([
      { docId: "doc_a", scrollY: 120 },
      { docId: "doc_a", scrollY: 0 },
    ]);
  });

  /** UI-037. The bare push is byte-identical: no `reveal` key appears at all. */
  it("writes no reveal onto an ordinary push", () => {
    expect(Object.keys(pushEntry([], "doc_a", 0)[0] ?? {})).toEqual(["docId", "scrollY"]);
  });

  it("carries a reveal onto the entry it is pushing", () => {
    expect(pushEntry([A], "doc_b", 10, ITEM)).toEqual([
      { docId: "doc_a", scrollY: 10 },
      { docId: "doc_b", scrollY: 0, reveal: ITEM },
    ]);
  });

  /**
   * The entry being left loses an unhonoured reveal. It was an instruction
   * about *arriving*, and the user has navigated past it — carrying it would
   * make Back flash something they already walked away from.
   */
  it("drops a pending reveal from the entry being left", () => {
    const stack = [{ docId: "doc_a", scrollY: 0, reveal: ITEM }];
    expect(pushEntry(stack, "doc_b", 40)).toEqual([
      { docId: "doc_a", scrollY: 40 },
      { docId: "doc_b", scrollY: 0 },
    ]);
  });
});

describe("clearRevealAt", () => {
  it("takes the honoured instruction off the top entry", () => {
    expect(clearRevealAt([A, { docId: "doc_b", scrollY: 12, reveal: ITEM }])).toEqual([
      A,
      { docId: "doc_b", scrollY: 12 },
    ]);
  });

  it("returns the same array when there is nothing to clear, so no write happens", () => {
    const stack = [A];
    expect(clearRevealAt(stack)).toBe(stack);
    const empty: readonly NavEntry[] = [];
    expect(clearRevealAt(empty)).toBe(empty);
  });
});

describe("popEntry", () => {
  it("removes the top entry", () => {
    expect(popEntry([A, { docId: "doc_b", scrollY: 10 }])).toEqual([A]);
  });

  it("leaves an empty stack empty rather than going negative", () => {
    const empty: readonly NavEntry[] = [];
    expect(popEntry(empty)).toBe(empty);
  });
});

describe("captureScrollAt", () => {
  it("rewrites only the top entry", () => {
    expect(captureScrollAt([A, { docId: "doc_b", scrollY: 0 }], 88)).toEqual([
      A,
      { docId: "doc_b", scrollY: 88 },
    ]);
  });

  it("returns the same array when nothing moved, so no write is triggered", () => {
    const stack = [{ docId: "doc_a", scrollY: 88 }];
    expect(captureScrollAt(stack, 88)).toBe(stack);
    const empty: readonly NavEntry[] = [];
    expect(captureScrollAt(empty, 5)).toBe(empty);
  });

  /**
   * The regression this shipped with for one wave.
   *
   * A capture is debounced by 150 ms, so it runs from a snapshot of the stack
   * as it stood when the scroll happened — and revealing an item scrolls the
   * reader itself, so that snapshot still carries the reveal the reader has
   * *already* consumed. Spreading the entry wrote the dead instruction back
   * into `localStorage`, where it re-flashed the document on every later load.
   *
   * Honouring a reveal is synchronous with clearing it, so a capture carrying
   * one is always carrying a dead one: the entry is rebuilt, never spread.
   */
  it("never carries a reveal onto the entry it is rewriting", () => {
    expect(captureScrollAt([{ docId: "doc_a", scrollY: 0, reveal: ITEM }], 88)).toEqual([
      { docId: "doc_a", scrollY: 88 },
    ]);
    expect(
      Object.keys(captureScrollAt([{ docId: "doc_a", scrollY: 0, reveal: ITEM }], 88)[0] ?? {}),
    ).toEqual(["docId", "scrollY"]);
  });
});

describe("dropMissing", () => {
  it("drops entries naming a document that no longer exists", () => {
    const stack = [A, { docId: "doc_gone", scrollY: 0 }, { docId: "doc_c", scrollY: 0 }];
    expect(dropMissing(stack, (id) => id === "doc_gone")).toEqual([
      A,
      { docId: "doc_c", scrollY: 0 },
    ]);
  });

  it("returns the same array when every entry still resolves", () => {
    const stack = [A];
    expect(dropMissing(stack, () => false)).toBe(stack);
  });
});

describe("useNavStack", () => {
  it("reports the open document, the previous one, and the restore offset", () => {
    const { result } = renderHook(() => useMemoryNavStack());
    expect(result.current.docId).toBeNull();
    expect(result.current.previous).toBeNull();

    act(() => {
      result.current.push("doc_a", 0);
    });
    expect(result.current.docId).toBe("doc_a");
    expect(result.current.previous).toBeNull();

    act(() => {
      result.current.push("doc_b", 300);
    });
    expect(result.current.docId).toBe("doc_b");
    expect(result.current.previous).toEqual({ docId: "doc_a", scrollY: 300 });
    expect(result.current.restoreY).toBe(0);

    act(() => {
      result.current.back();
    });
    expect(result.current.docId).toBe("doc_a");
    // The exact prior offset, not "roughly".
    expect(result.current.restoreY).toBe(300);
  });

  it("exits to the list when the last entry is popped", () => {
    const { result } = renderHook(() => useMemoryNavStack([A]));
    act(() => {
      result.current.back();
    });
    expect(result.current.docId).toBeNull();
    expect(result.current.depth).toBe(0);
  });

  it("empties a deep stack in one act, rendering nothing in between", () => {
    const { result } = renderHook(() =>
      useMemoryNavStack([A, { docId: "doc_b", scrollY: 0 }, { docId: "doc_c", scrollY: 0 }]),
    );
    act(() => {
      result.current.toList();
    });
    expect(result.current.depth).toBe(0);

    // A second `toList` on an empty stack writes nothing at all.
    const before = result.current.stack;
    act(() => {
      result.current.toList();
    });
    expect(result.current.stack).toBe(before);
  });

  it("reports the current entry's pending reveal, and forgets it once consumed", () => {
    const { result } = renderHook(() => useMemoryNavStack([A]));
    expect(result.current.reveal).toBeNull();

    act(() => {
      result.current.push("doc_b", 0, ITEM);
    });
    expect(result.current.reveal).toEqual(ITEM);

    act(() => {
      result.current.consumeReveal();
    });
    expect(result.current.reveal).toBeNull();

    // Back lands on an entry that never had one: nothing to re-trigger.
    act(() => {
      result.current.back();
    });
    expect(result.current.reveal).toBeNull();

    // And consuming again writes nothing at all.
    const before = result.current.stack;
    act(() => {
      result.current.consumeReveal();
    });
    expect(result.current.stack).toBe(before);
  });

  /**
   * The host's own re-pointing (PR #19 review): focus mode is handed a new
   * `docId`/`reveal` while it is already open, and the excursion behind it
   * belongs to the instruction being replaced.
   */
  it("starts the history again at a new document, keeping nothing behind it", () => {
    const { result } = renderHook(() => useMemoryNavStack([A]));
    act(() => {
      result.current.push("doc_b", 120);
    });
    expect(result.current.depth).toBe(2);

    act(() => {
      result.current.openAt("doc_c", ITEM);
    });
    expect(result.current.depth).toBe(1);
    expect(result.current.docId).toBe("doc_c");
    expect(result.current.previous).toBeNull();
    expect(result.current.restoreY).toBe(0);
    expect(result.current.reveal).toEqual(ITEM);

    // Without one, the entry carries no `reveal` key at all — an ordinary open.
    act(() => {
      result.current.openAt("doc_d");
    });
    expect(Object.keys(result.current.stack[0] ?? {})).toEqual(["docId", "scrollY"]);
  });

  it("captures scroll without navigating", () => {
    const { result } = renderHook(() => useMemoryNavStack([A]));
    act(() => {
      result.current.captureScroll(64);
    });
    expect(result.current.depth).toBe(1);
    expect(result.current.stack[0]).toEqual({ docId: "doc_a", scrollY: 64 });
  });
});
