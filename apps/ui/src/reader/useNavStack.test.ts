/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  captureScrollAt,
  dropMissing,
  popEntry,
  pushEntry,
  useMemoryNavStack,
  type NavEntry,
} from "./useNavStack";

afterEach(cleanup);

const A: NavEntry = { docId: "doc_a", scrollY: 0 };

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

  it("captures scroll without navigating", () => {
    const { result } = renderHook(() => useMemoryNavStack([A]));
    act(() => {
      result.current.captureScroll(64);
    });
    expect(result.current.depth).toBe(1);
    expect(result.current.stack[0]).toEqual({ docId: "doc_a", scrollY: 64 });
  });
});
